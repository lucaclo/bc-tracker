// Orchestrates autofill on any application page. Never runs automatically — only when
// you click "Fill this page" (floating button or popup). Never touches Submit/Continue/
// Next buttons. File inputs are always flagged, never auto-set (browsers block that).

(function () {
  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function getScanRoot() {
    const forms = Array.from(document.querySelectorAll('form'));
    if (forms.length === 0) return document.body;
    if (forms.length === 1) return forms[0];
    let best = forms[0];
    let bestCount = -1;
    for (const f of forms) {
      const count = f.querySelectorAll('input, select, textarea').length;
      if (count > bestCount) {
        best = f;
        bestCount = count;
      }
    }
    return best;
  }

  function clearPreviousMarks() {
    document.querySelectorAll('.wso-filled, .wso-flagged, .wso-verify-failed, [data-wso-skip]').forEach((el) => {
      el.classList.remove('wso-filled', 'wso-filled-high', 'wso-filled-medium', 'wso-flagged', 'wso-verify-failed', 'wso-flash');
      el.removeAttribute('data-wso-filled');
      el.removeAttribute('data-wso-flag-id');
      el.removeAttribute('data-wso-confidence');
      el.removeAttribute('data-wso-expected');
      el.removeAttribute('data-wso-block-key');
      el.removeAttribute('data-wso-block-field');
      delete el.dataset.wsoFlagReason;
      delete el.dataset.wsoSkip;
    });
  }

  const MONTH_NAMES = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];

  // The profile's Month fields are free text (see app/public/js/app.js) with only a "06"
  // -style placeholder as a hint — nothing stops "June"/"Jun" from being typed instead.
  // Left as a word, an <input type="month"> would silently reject the resulting
  // "2028-June" as invalid, and a plain text field would show a value in the wrong format
  // even though the underlying data was correct. This is a well-defined parse (not a
  // guess) so it belongs here rather than requiring the user to keep the exact numeric
  // format everywhere they ever enter a month.
  function normalizeMonth(month) {
    const raw = (month || '').toString().trim();
    if (/^\d{1,2}$/.test(raw)) return raw.padStart(2, '0');
    const lower = raw.toLowerCase();
    const idx = MONTH_NAMES.findIndex((name) => name === lower || name.startsWith(lower.slice(0, 3)));
    return idx >= 0 && lower.length >= 3 ? String(idx + 1).padStart(2, '0') : raw;
  }

  function formatExperienceDate(el, month, year) {
    if (!year) return '';
    const mm = normalizeMonth(month);
    if ((el.type || '').toLowerCase() === 'month') return `${year}-${mm}`;
    return month ? `${mm}/${year}` : `${year}`;
  }

  // Repeatable "Work Experience 1", "Work Experience 2"... blocks aren't a single
  // canonical field with one value — they're an ordered list. Workday explicitly labels
  // each block ("Work Experience 1", "Work Experience 2"...), so this anchors to that
  // literal heading number when present — far more robust than inferring block position
  // purely from counting "Job Title" occurrences, which silently drifts out of alignment
  // if anything else on the page interrupts that sequence (a stray field, a hidden
  // duplicate input from a date-picker widget, unexpected section ordering). Falls back
  // to counting "Job Title" occurrences only when no numbered heading is found at all, for
  // ATSes that repeat unlabeled blocks. Runs before the generic pass and marks what it
  // fills, so the generic pass skips it.
  //
  // `all` is the full descendant list of the scan root, computed once by the caller and
  // reused across every field in a pass — walking the whole DOM per-field (the old
  // behavior) was both wasteful and, worse, had no way to know when a block's fields had
  // been left behind for a completely different section (see FM.nearestSectionKind, used
  // by the boundary check further down each block pass's loop).
  function findSectionIndex(all, el, headingRegex) {
    // Walk backwards through the DOM (in document order) from this field to find the
    // nearest preceding leaf element whose own text matches "<Section> N" / "<Section>",
    // and use N (1-indexed in the page, so return N-1) as the section's index.
    const elIdx = all.indexOf(el);
    if (elIdx === -1) return -1;
    let seen = 0;
    let lastIndex = -1;
    for (let i = 0; i <= elIdx; i++) {
      const node = all[i];
      if (node.children.length > 0) continue; // only leaf nodes carry a heading's own text
      const match = headingRegex.exec(node.textContent.trim());
      if (match) {
        seen += 1;
        lastIndex = match[1] ? parseInt(match[1], 10) - 1 : seen - 1;
      }
    }
    return lastIndex;
  }

  function runExperiencePass(profile, FM) {
    const experiences = profile.workExperience || [];
    if (!experiences.length) return;

    const root = getScanRoot();
    const all = Array.from(root.querySelectorAll('*'));
    const elements = root.querySelectorAll('input, textarea, select');
    const headingRegex = /^work experience\s*(\d+)?\s*$/i;
    let currentIndex = -1;
    let jobTitleCount = -1; // fallback when no numbered heading is found
    const done = new Set(); // `${index}-${subfield}` guards against a runaway match count

    for (const el of elements) {
      if (el.dataset.wsoFilled === '1' || el.classList.contains('wso-flagged')) continue;
      if (el.disabled || el.readOnly || !isVisible(el)) continue;

      const label = window.WSO_FieldMap.normalize(window.WSO_FieldMap.getFieldLabelText(el));
      const type = (el.type || '').toLowerCase();

      // A field whose own label names a different person (a reference, an emergency
      // contact) must never be treated as this block's sub-field just because it reuses
      // a generic word like "company"/"location" — leave it untouched for the generic
      // pass, which will flag it (never auto-fill a stranger's field with your data).
      if (FM.isThirdPartyContext(label)) continue;

      if (label === 'job title' || label === 'position title') {
        jobTitleCount += 1;
        const sectionIndex = findSectionIndex(all, el, headingRegex);
        currentIndex = sectionIndex >= 0 ? sectionIndex : jobTitleCount;
        const exp = experiences[currentIndex];
        if (exp?.jobTitle && FM.fillTextLike(el, exp.jobTitle)) {
          FM.markFilled(el, 'high', undefined, { expected: exp.jobTitle, blockKey: `experience-${currentIndex}`, blockField: 'jobTitle' });
        } else if (!exp) {
          // A block beyond what's saved in your profile — e.g. Workday pre-populated an
          // extra "Work Experience N" card from an old resume parse, or it's just a spare
          // "Add Another" card. WSO has no data to offer for it; marking it skip (not
          // flagged) keeps the generic pass from nagging about it every single run.
          // Workday's own required-field validation still catches it at Save/Continue if
          // it matters, so nothing slips through silently.
          el.dataset.wsoSkip = '1';
        }
        continue;
      }

      if (currentIndex < 0) continue; // no "Job Title" seen yet — not part of a work-experience block

      // We've left the work-experience section entirely — a different section's own
      // heading (Education, References, Volunteer Experience, Certifications, ...) is the
      // nearest one above this field — so it must NOT inherit this block's index no
      // matter how generic its own label looks. Re-derived from the live DOM for every
      // field (not just once per pass) so it also catches sections that reuse "From"/"To"
      // wording without a numbered heading of their own resetting currentIndex. A null
      // result (no recognized heading found ABOVE this field at all, e.g. a page with a
      // single un-headed experience block) is NOT a mismatch — only an explicit different
      // kind is disqualifying, so that common case still falls through as before.
      const elIdx = all.indexOf(el);
      const sectionKind = FM.nearestSectionKind(all, elIdx);
      if (sectionKind && sectionKind !== 'experience') continue;

      const exp = experiences[currentIndex];

      // IMPORTANT: currentIndex never resets except on the next "Job Title" field, so
      // everything from here to the bottom of the page — Education, Skills, EEO
      // questions, the résumé upload — technically "falls under" whatever block index
      // was last seen. Only skip-mark a field when its OWN label actually identifies it
      // as one of the recognized work-experience sub-fields; anything else must fall
      // through untouched so runGenericPass evaluates it on its own merits (an unrelated
      // field like "Gender" must never be silently skipped because of this).
      const blockKey = `experience-${currentIndex}`;

      if (label === 'company' && !done.has(`${currentIndex}-company`)) {
        done.add(`${currentIndex}-company`);
        if (!exp) el.dataset.wsoSkip = '1';
        else if (exp.company && FM.fillTextLike(el, exp.company)) FM.markFilled(el, 'high', undefined, { expected: exp.company, blockKey, blockField: 'company' });
      } else if (label.includes('location') && !done.has(`${currentIndex}-location`)) {
        done.add(`${currentIndex}-location`);
        if (!exp) el.dataset.wsoSkip = '1';
        else if (exp.location && FM.fillTextLike(el, exp.location)) FM.markFilled(el, 'high', undefined, { expected: exp.location, blockKey, blockField: 'location' });
      } else if (type === 'checkbox' && /currently work here|current(ly)? employed here/.test(label) && !done.has(`${currentIndex}-current`)) {
        done.add(`${currentIndex}-current`);
        if (!exp) {
          el.dataset.wsoSkip = '1';
        } else {
          el.checked = !!exp.currentlyWorkHere;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          FM.markFilled(el); // boolean checkbox — not worth tagging for the value-fidelity/consistency checks
        }
      } else if (label === 'from' && !done.has(`${currentIndex}-from`)) {
        done.add(`${currentIndex}-from`);
        if (!exp) {
          el.dataset.wsoSkip = '1';
        } else {
          const value = formatExperienceDate(el, exp.startMonth, exp.startYear);
          // blockField 'startDate'/'endDate' are pseudo-properties — the profile splits
          // dates into separate Month/Year fields, so fillVerifier.js reconstructs its own
          // comparable value from those rather than doing a plain entry[field] lookup.
          if (value && FM.fillTextLike(el, value)) FM.markFilled(el, 'high', undefined, { expected: value, blockKey, blockField: 'startDate' });
        }
      } else if (label === 'to' && !done.has(`${currentIndex}-to`)) {
        done.add(`${currentIndex}-to`);
        if (!exp) {
          el.dataset.wsoSkip = '1';
        } else if (!exp.currentlyWorkHere) {
          const value = formatExperienceDate(el, exp.endMonth, exp.endYear);
          if (value && FM.fillTextLike(el, value)) FM.markFilled(el, 'high', undefined, { expected: value, blockKey, blockField: 'endDate' });
        }
      } else if (/role description|description of role|responsibilities/.test(label) && !done.has(`${currentIndex}-desc`)) {
        done.add(`${currentIndex}-desc`);
        if (!exp) el.dataset.wsoSkip = '1';
        else if (exp.roleDescription && FM.fillTextLike(el, exp.roleDescription)) FM.markFilled(el, 'high', undefined, { expected: exp.roleDescription, blockKey, blockField: 'roleDescription' });
      }
    }
  }

  // Same ordinal-block idea as work experience: a "Language" field starts a new block,
  // then Speaking/Writing/Reading map to that language's stored levels. Uses fillSelect's
  // exact-match behavior for <select> proficiency dropdowns, so a level that doesn't
  // exactly match one of the page's options is left for the generic pass to flag rather
  // than guessing the nearest one.
  function runLanguagePass(profile, FM) {
    const languages = profile.languages || [];
    if (!languages.length) return;

    const root = getScanRoot();
    const elements = root.querySelectorAll('input, select');
    let currentIndex = -1;
    const done = new Set();

    const fillField = (el, value) =>
      value && (el.tagName === 'SELECT' ? FM.fillSelect(el, value) : FM.fillTextLike(el, value));

    for (const el of elements) {
      if (el.dataset.wsoFilled === '1' || el.classList.contains('wso-flagged')) continue;
      if (el.disabled || el.readOnly || !isVisible(el)) continue;

      const label = window.WSO_FieldMap.normalize(window.WSO_FieldMap.getFieldLabelText(el));
      if (FM.isThirdPartyContext(label)) continue;

      if (label === 'language') {
        currentIndex += 1;
        const lang = languages[currentIndex];
        if (lang && fillField(el, lang.language)) {
          FM.markFilled(el, 'high', undefined, { expected: lang.language });
        } else if (!lang) {
          el.dataset.wsoSkip = '1'; // block beyond your saved languages — see work experience for why
        }
        continue;
      }

      if (currentIndex < 0) continue;
      const lang = languages[currentIndex];

      // Same scoping rule as work experience: only skip-mark a field whose own label
      // identifies it as a language sub-field — everything else must fall through
      // untouched for runGenericPass to evaluate on its own merits.
      if (label === 'speaking' && !done.has(`${currentIndex}-speaking`)) {
        done.add(`${currentIndex}-speaking`);
        if (!lang) el.dataset.wsoSkip = '1';
        else if (fillField(el, lang.speaking)) FM.markFilled(el, 'high', undefined, { expected: lang.speaking });
      } else if (label === 'writing' && !done.has(`${currentIndex}-writing`)) {
        done.add(`${currentIndex}-writing`);
        if (!lang) el.dataset.wsoSkip = '1';
        else if (fillField(el, lang.writing)) FM.markFilled(el, 'high', undefined, { expected: lang.writing });
      } else if (label === 'reading' && !done.has(`${currentIndex}-reading`)) {
        done.add(`${currentIndex}-reading`);
        if (!lang) el.dataset.wsoSkip = '1';
        else if (fillField(el, lang.reading)) FM.markFilled(el, 'high', undefined, { expected: lang.reading });
      }
    }
  }

  // Same heading-anchored approach as work experience: prefer Workday's literal
  // "Education N" heading number when present, falling back to counting
  // School/Institution/University field occurrences only if no numbered heading is found.
  function runEducationPass(profile, FM) {
    const educationEntries = profile.education || [];
    if (!educationEntries.length) return;

    const root = getScanRoot();
    const all = Array.from(root.querySelectorAll('*'));
    const elements = root.querySelectorAll('input, textarea, select');
    const headingRegex = /^education\s*(\d+)?\s*$/i;
    let currentIndex = -1;
    let institutionCount = -1;
    const done = new Set();

    const fillField = (el, value) =>
      value && (el.tagName === 'SELECT' ? FM.fillSelect(el, value) : FM.fillTextLike(el, value));

    for (const el of elements) {
      if (el.dataset.wsoFilled === '1' || el.classList.contains('wso-flagged')) continue;
      if (el.disabled || el.readOnly || !isVisible(el)) continue;

      const label = window.WSO_FieldMap.normalize(window.WSO_FieldMap.getFieldLabelText(el));
      if (FM.isThirdPartyContext(label)) continue;

      if (/^(school|institution|university|school or university)$/.test(label)) {
        institutionCount += 1;
        const sectionIndex = findSectionIndex(all, el, headingRegex);
        currentIndex = sectionIndex >= 0 ? sectionIndex : institutionCount;
        const edu = educationEntries[currentIndex];
        if (edu && fillField(el, edu.institution)) {
          FM.markFilled(el, 'high', undefined, { expected: edu.institution, blockKey: `education-${currentIndex}`, blockField: 'institution' });
        } else if (!edu) {
          el.dataset.wsoSkip = '1'; // block beyond your saved education — see work experience for why
        }
        continue;
      }

      if (currentIndex < 0) continue;

      // Same idea as the work-experience pass: re-derive the nearest section heading for
      // every field rather than trusting a single Education-vs-Work-Experience boundary
      // computed once — this also catches an unrelated section (Certifications, Volunteer
      // Experience, References, ...) placed between/after them that happens to reuse
      // "From"/"To"/"Degree"-shaped wording. A null result (no heading found at all above
      // this field) is not a mismatch — only an explicit different kind disqualifies it.
      const elIdx = all.indexOf(el);
      const sectionKind = FM.nearestSectionKind(all, elIdx);
      if (sectionKind && sectionKind !== 'education') continue;

      const edu = educationEntries[currentIndex];
      const blockKey = `education-${currentIndex}`;

      // Same scoping rule as work experience: only skip-mark a field whose own label
      // identifies it as an education sub-field — everything else must fall through
      // untouched for runGenericPass to evaluate on its own merits.
      if (/degree|qualification/.test(label) && !done.has(`${currentIndex}-degree`)) {
        done.add(`${currentIndex}-degree`);
        if (!edu) el.dataset.wsoSkip = '1';
        else if (fillField(el, edu.degree)) FM.markFilled(el, 'high', undefined, { expected: edu.degree, blockKey, blockField: 'degree' });
      } else if (/field of study|major|subject/.test(label) && !done.has(`${currentIndex}-field`)) {
        done.add(`${currentIndex}-field`);
        if (!edu) el.dataset.wsoSkip = '1';
        else if (fillField(el, edu.fieldOfStudy)) FM.markFilled(el, 'high', undefined, { expected: edu.fieldOfStudy, blockKey, blockField: 'fieldOfStudy' });
      } else if (/gpa|grade|classification/.test(label) && !done.has(`${currentIndex}-gpa`)) {
        done.add(`${currentIndex}-gpa`);
        if (!edu) el.dataset.wsoSkip = '1';
        else if (fillField(el, edu.gpaOrClassification)) FM.markFilled(el, 'high', undefined, { expected: edu.gpaOrClassification, blockKey, blockField: 'gpaOrClassification' });
      } else if (label === 'from' && !done.has(`${currentIndex}-from`)) {
        done.add(`${currentIndex}-from`);
        if (!edu) {
          el.dataset.wsoSkip = '1';
        } else {
          const value = formatExperienceDate(el, edu.startMonth, edu.startYear);
          // blockField 'startDate'/'endDate' are pseudo-properties — see the matching
          // work-experience From field for why fillVerifier.js handles these specially.
          if (value && FM.fillTextLike(el, value)) FM.markFilled(el, 'high', undefined, { expected: value, blockKey, blockField: 'startDate' });
        }
      } else if (
        (label === 'to' || /graduation date|expected graduation/.test(label)) &&
        !done.has(`${currentIndex}-to`)
      ) {
        done.add(`${currentIndex}-to`);
        if (!edu) {
          el.dataset.wsoSkip = '1';
        } else {
          const value = formatExperienceDate(el, edu.graduationMonth, edu.graduationYear);
          if (value && FM.fillTextLike(el, value)) FM.markFilled(el, 'high', undefined, { expected: value, blockKey, blockField: 'endDate' });
        }
      }
    }
  }

  function isRequired(el) {
    return el.required || el.getAttribute('aria-required') === 'true';
  }

  // Handles one custom-dropdown trigger (native <select> is handled inline in the main
  // loop below — this is only for ARIA combobox/listbox widgets, via WSO_ComboboxFill).
  async function handleComboboxField(el, label, profile, FM, CF, all) {
    const normLabel = FM.normalize(label);

    // Multi-select "add skills" style widgets: try real interaction instead of the old
    // blanket flag-with-a-text-list. Any values that don't land are still called out by
    // name so a partial success is never silently reported as complete.
    if (/\bskills?\b/.test(normLabel) && (profile.skills || []).length) {
      const { filled, unfilled } = await CF.fillMulti(el, profile.skills, FM);
      if (filled.length && !unfilled.length) {
        FM.markFilled(el, 'high');
      } else if (filled.length) {
        el.classList.add('wso-filled', 'wso-filled-medium');
        FM.markFlagged(el, `Skills — added ${filled.length}/${filled.length + unfilled.length}, add manually: ${unfilled.join(', ')}`);
      } else {
        FM.markFlagged(el, `Add skills manually: ${profile.skills.join(', ')}`);
      }
      return;
    }

    const canonical = FM.matchCanonicalField(label);
    if (!canonical) {
      if (isRequired(el)) FM.markFlagged(el, (label || 'Required field').trim());
      return;
    }
    // A field whose OWN label matches a canonical field but sits under a References/
    // Emergency Contact/Volunteer Experience/... heading (see fieldMap.js's
    // SECTION_HEADING_PATTERNS 'other' kind) almost certainly isn't asking about the
    // applicant at all — e.g. a bare "Phone Number" field under "Emergency Contact" with
    // no reference to that context in its own label text.
    if (FM.nearestSectionKind(all, all.indexOf(el)) === 'other') {
      FM.markFlagged(el, (label || 'Needs your input').trim());
      return;
    }
    const value = FM.resolveProfileValue(profile, canonical);
    if (!value) {
      FM.markFlagged(el, (label || 'Needs your input').trim());
      return;
    }

    const result = await CF.fill(el, value, FM);
    if (result.status === 'filled') {
      // expected = the matched OPTION's own text, not the raw profile value — an
      // alias/fuzzy match (e.g. profile "United Kingdom" -> widget option "UK") is
      // correct even though the strings differ; comparing against the profile string
      // verbatim would make Check A falsely flag every legitimate alias match.
      FM.markFilled(
        el,
        result.tier,
        result.tier === 'medium' ? `${label.trim()} — auto-matched "${result.matchedText}", worth checking` : undefined,
        { expected: result.matchedText }
      );
      return;
    }
    const suffix = result.candidates && result.candidates.length ? ` — closest options: ${result.candidates.join(', ')}` : '';
    FM.markFlagged(el, `${(label || 'Needs your input').trim()}${suffix}`);
  }

  async function runGenericPass(profile, FM, CF) {
    const root = getScanRoot();
    const processedRadioGroups = new Set();
    const elements = root.querySelectorAll(
      'input, select, textarea, [role="combobox"], [aria-haspopup="listbox"]'
    );
    // Only computed for the "other" heading check below (References, Emergency Contact,
    // Volunteer Experience, Certifications, ...) — a field's OWN label often doesn't say
    // "reference"/"emergency contact" (it's frequently just "First Name" or "Phone
    // Number", relying on the section heading alone for context), so isThirdPartyContext
    // can't catch that on the label text alone. This re-derives which section a field
    // actually sits under from the live DOM, same approach as the block passes.
    const all = Array.from(root.querySelectorAll('*'));

    for (const el of elements) {
      if (el.dataset.wsoFilled === '1' || el.classList.contains('wso-flagged') || el.dataset.wsoSkip === '1') continue;
      if (el.disabled || el.readOnly) continue;
      if (!isVisible(el)) continue;

      const isComboTrigger = CF.isCustomDropdownTrigger(el);
      const type = (el.type || '').toLowerCase();

      // A bare <button> defaults to type="submit" — that exclusion exists to protect
      // real Submit/Continue/Next buttons, not the <button aria-haspopup="listbox">
      // dropdown triggers this pass now also scans, so combobox triggers are exempted.
      if (!isComboTrigger && ['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;

      if (type === 'file') {
        const label = FM.getFieldLabelText(el) || 'File upload';
        FM.markFlagged(el, `${label.trim()} — attach manually (your CV is in app/data/cv)`);
        continue;
      }

      if (type === 'checkbox') continue; // consent/agreement toggles — never auto-check

      if (type === 'radio') {
        if (!el.name || processedRadioGroups.has(el.name)) continue;
        processedRadioGroups.add(el.name);
        const label = FM.getFieldLabelText(el) || el.name;

        if (FM.isEEOQuestion(label) || FM.isThirdPartyContext(label) || FM.isNeverInferField(label)) {
          FM.markFlagged(el, label.trim());
          continue;
        }
        const canonical = FM.matchCanonicalField(label);
        const blockedBySection = canonical && FM.nearestSectionKind(all, all.indexOf(el)) === 'other';
        const value = canonical && !blockedBySection ? FM.resolveProfileValue(profile, canonical) : '';
        if (canonical && value && FM.fillRadioGroup(el.name, value)) {
          root.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`).forEach((r) => FM.markFilled(r));
          continue;
        }
        if (canonical || isRequired(el)) FM.markFlagged(el, label.trim());
        continue;
      }

      const label = FM.getFieldLabelText(el);

      if (FM.isEEOQuestion(label) || FM.isThirdPartyContext(label) || FM.isNeverInferField(label)) {
        FM.markFlagged(el, label.trim());
        continue;
      }

      if (isComboTrigger) {
        // One misbehaving widget (an unexpected DOM shape, a timing quirk on some ATS)
        // must never take down the rest of the fill run — everything after it on the
        // page (including the file-upload flag) still needs to run. Fall back to a plain
        // flag on this one field rather than letting the error escape.
        try {
          await handleComboboxField(el, label, profile, FM, CF, all);
        } catch (e) {
          FM.markFlagged(el, (label || 'Needs your input').trim());
        }
        continue;
      }

      // "Add skills" fallback for a plain text/tag input that isn't a recognized ARIA
      // combobox (handleComboboxField covers the combobox case above) — still safest to
      // flag with the exact list rather than guess at a free-text format.
      if (/\bskills?\b/.test(FM.normalize(label)) && (profile.skills || []).length) {
        FM.markFlagged(el, `Add skills manually: ${profile.skills.join(', ')}`);
        continue;
      }

      const canonical = FM.matchCanonicalField(label);
      if (canonical) {
        // Same "other" section override as handleComboboxField above — a canonical match
        // sitting under a References/Emergency Contact/Volunteer Experience/... heading is
        // almost certainly asking about someone or something other than the applicant.
        const blockedBySection = FM.nearestSectionKind(all, all.indexOf(el)) === 'other';
        const value = blockedBySection ? '' : FM.resolveProfileValue(profile, canonical);
        if (value) {
          const filled =
            el.tagName === 'SELECT' ? FM.fillSelect(el, value) : FM.fillTextLike(el, value);
          if (filled) {
            // For a <select>, "expected" must be the matched OPTION's own text (what the
            // field will actually display), not the raw profile value — an alias match
            // (e.g. "United Kingdom" -> option "UK") is correct even though the strings
            // differ, and comparing against the profile string verbatim would make Check A
            // falsely flag every legitimate alias match. Text fields set exactly what we
            // pass in, so the profile value itself is already correct there.
            const expected =
              el.tagName === 'SELECT'
                ? (Array.from(el.options).find((o) => o.value === el.value) || {}).textContent || value
                : value;
            FM.markFilled(el, filled === true ? 'high' : filled, undefined, { expected });
            continue;
          }
        }
        // Matched a field we care about but couldn't fill it (no value, or only a weak
        // option match) — for a <select>, hand over the weak candidates as a shortlist.
        let reason = (label || 'Needs your input').trim();
        if (el.tagName === 'SELECT' && value) {
          const weak = FM.matchOptionTier(
            Array.from(el.options).map((o) => ({ texts: [o.textContent, o.value] })),
            value
          );
          if (weak && weak.tier === 'weak') {
            const candidates = weak.candidates.map((c) => (c.texts[0] || '').trim()).filter(Boolean);
            if (candidates.length) reason += ` — closest options: ${candidates.join(', ')}`;
          }
        }
        FM.markFlagged(el, reason);
        continue;
      }

      if (isRequired(el)) {
        FM.markFlagged(el, (label || 'Required field').trim());
      }
    }
  }

  function showToast(message, isError) {
    let toast = document.getElementById('wso-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'wso-toast';
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('wso-toast-error', !!isError);
    toast.classList.add('wso-toast-visible');
    clearTimeout(toast._wsoTimer);
    toast._wsoTimer = setTimeout(() => toast.classList.remove('wso-toast-visible'), 4500);
  }

  // Routed through the background service worker rather than fetched directly here:
  // a content script's fetch() carries the JOB PAGE's origin (not the extension's), so
  // the local app's CORS rule silently blocks a direct request. The background script
  // is a true extension context and isn't subject to that.
  function fetchProfile() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'WSO_GET_PROFILE' }, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response || !response.ok) return reject(new Error(response?.error || 'unreachable'));
        resolve(response.profile);
      });
    });
  }

  async function runFill() {
    const FM = window.WSO_FieldMap;
    clearPreviousMarks();
    FM.resetRegistry();

    let profile;
    try {
      profile = await fetchProfile();
    } catch (e) {
      showToast('Could not reach the B.C Tracker app at localhost:5055 — run "npm start" in app/', true);
      return { error: 'app-unreachable' };
    }

    // A password field on the page is a strong, reliable signal this is an account
    // creation/login form rather than a normal application form — use the sign-up email
    // there if one's saved, so the main contact email on regular forms is never touched
    // by mistake. The password field itself is never read from or filled in — that
    // always needs you, on purpose.
    const isAccountForm = !!getScanRoot().querySelector('input[type="password"]');
    const effectiveProfile =
      isAccountForm && profile.signupEmail ? { ...profile, email: profile.signupEmail } : profile;

    const CF = window.WSO_ComboboxFill;

    for (const mapper of Object.values(window.WSO_SiteMappers || {})) {
      if (mapper.test()) {
        // A site mapper failing must not stop the generic pass (and its file-upload
        // flags etc) from still running on the rest of the page.
        try {
          await mapper.run(effectiveProfile);
        } catch (e) {
          console.error('BC: site mapper failed, continuing with the generic pass', e);
        }
        break;
      }
    }

    runExperiencePass(effectiveProfile, FM);
    runEducationPass(effectiveProfile, FM);
    runLanguagePass(effectiveProfile, FM);
    await runGenericPass(effectiveProfile, FM, CF);

    // Post-fill audit: never fills anything, only inspects what the passes above already
    // did and downgrades anything suspicious (see extension/lib/fillVerifier.js). A bug in
    // the verifier itself must not take down an otherwise-successful fill run.
    let verifyIssueCount = 0;
    try {
      if (window.WSO_FillVerifier) {
        verifyIssueCount = window.WSO_FillVerifier.verify(effectiveProfile, FM).issueCount;
      }
    } catch (e) {
      console.error('BC: verification pass failed, filled fields are unaffected', e);
    }

    // Recomputed AFTER verification, since a failed check downgrades an element out of
    // .wso-filled-high/.wso-filled-medium.
    const highCount = document.querySelectorAll('.wso-filled-high').length;
    const mediumCount = document.querySelectorAll('.wso-filled-medium').length;
    const filledCount = highCount + mediumCount;
    const allFlags = FM.getFlags();
    const flagged = allFlags.filter((f) => f.kind === 'flagged');
    const worthChecking = allFlags.filter((f) => f.kind === 'filled-medium');
    const verifyIssues = allFlags.filter((f) => f.kind === 'verify-failed');

    showToast(
      `Filled ${filledCount} field${filledCount === 1 ? '' : 's'}` +
        (worthChecking.length ? ` (${worthChecking.length} worth a second look)` : '') +
        (verifyIssues.length ? ` · ${verifyIssues.length} flagged by verification` : '') +
        ` · Needs your input: ${flagged.length}`
    );

    const result = {
      filledCount,
      highCount,
      mediumCount,
      flagged,
      worthChecking,
      verifyIssues,
      verifyIssueCount,
      url: location.href,
      ranAt: new Date().toISOString()
    };
    try {
      chrome.runtime.sendMessage({ type: 'WSO_FILL_RESULT', result });
    } catch (e) {
      // Same "extension context invalidated" scenario as tracker-reader.js — the fill
      // itself already fully happened (fields are filled, `result` is complete); this is
      // only the fire-and-forget notification to the background script for the side
      // panel's remembered-result cache and flag telemetry. Letting this throw would
      // reject runFill()'s own promise and strand the popup's sendResponse callback,
      // misreporting a genuinely successful fill as "could not run on this page."
      console.warn('[BC] could not notify the background script of this fill result (the extension may have reloaded) — the page itself was still filled correctly', e);
    }
    return result;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'WSO_RUN_FILL') {
      runFill().then(sendResponse);
      return true; // async response
    }
    if (message.type === 'WSO_SCROLL_TO_FLAG') {
      const ok = window.WSO_FieldMap.scrollToFlag(message.id);
      sendResponse({ ok });
      return false;
    }
  });
})();
