// Post-fill audit pass: runs once at the very end of runFill(), after every other pass has
// already filled/flagged what it's going to. Fills nothing itself — only inspects what's
// already on the page and downgrades anything suspicious from "filled, trust me" to
// "filled, but please double-check" (FM.markVerifyIssue), same flag-over-guess philosophy
// applied retroactively to this run's own output rather than only to individual decisions.
//
// Two checks:
//
// Check A (value fidelity) — every tagged fill recorded the exact string it intended to
// write (data-wso-expected, set by FM.markFilled's meta param). Re-read the live value and
// compare; a mismatch means something changed the field after WSO touched it (a page-side
// reformatter, a length cap, a validator silently stripping characters).
//
// Check B (block-internal consistency) — deliberately does NOT trust whatever index the
// fill passes used. For each repeatable block (data-wso-block-key, e.g. "experience-2"),
// gather the values that actually ended up in its fields and ask: is there any single
// entry in the profile array whose OWN fields match every one of these values at once? If
// the Job Title's value only matches profile entry 0 but the Company's value only matches
// entry 2, that's a genuine contradiction regardless of what the fill logic believed it was
// doing — this is exactly the class of bug (index tracking leaking across a section
// boundary) already found and fixed once this session, and is meant to catch a recurrence
// of it, or a different bug with the same symptom, automatically.
//
// Check B only trusts the blockKey's INDEX, though, not which entity type it claims to be
// (data-wso-block-key's "experience-"/"education-" prefix) — that classification was made
// by the very fill pass that could be buggy, so a mis-SECTION bug (an education field
// mistakenly tagged "experience-0") would tag both the real experience fields and the
// wrongly-captured education fields under the same key, and they could still look
// internally consistent to each other. Check B' (below, the geometry check) closes that
// gap: independently, from the live DOM, find the nearest preceding "Work Experience"/
// "Education" heading above each tagged field and confirm it actually matches what the tag
// claims — this doesn't read the tag's index at all, only its "which section" prefix, so
// it can't share a section-misclassification bug with the code that assigned the tag.
//
// Check C (duplicate values across blocks) rides along for free from the same grouping: the
// same company/institution value appearing in two different blocks is also a strong signal
// something's mixed up.

(function () {
  function getExpected(el) {
    return el.hasAttribute('data-wso-expected') ? el.getAttribute('data-wso-expected') : undefined;
  }

  function liveValue(el) {
    if (el.tagName === 'SELECT') {
      const selected = Array.from(el.options || []).find((o) => o.value === el.value);
      return (selected && selected.textContent) || el.value || '';
    }
    return el.value || '';
  }

  // Recognizes the SAME heading shapes autofill.js's own block passes look for — but this
  // is a deliberately separate, independently-computed copy, not a shared reference to
  // anything autofill.js decided. If the fill pass's own boundary logic has a bug (or gets
  // a future one), this check doesn't inherit it.
  const SECTION_HEADING_PATTERNS = [
    { kind: 'experience', re: /^work experience\s*(\d+)?\s*$/i },
    { kind: 'education', re: /^education\s*(\d+)?\s*$/i },
    { kind: 'education', re: /^(school|institution|university|school or university)$/i }
  ];

  function classifySectionHeading(text) {
    for (const { kind, re } of SECTION_HEADING_PATTERNS) {
      if (re.test(text)) return kind;
    }
    return null;
  }

  // Walks backward from elIdx for the nearest heading-shaped leaf text, independent of
  // any data-wso-* tag — this is what makes Check B' able to catch a field tagged for the
  // wrong SECTION entirely (as opposed to Check B, which only catches the wrong INDEX
  // within a section it already trusts was correctly identified).
  function nearestSectionKind(all, elIdx) {
    for (let i = elIdx; i >= 0; i--) {
      const node = all[i];
      if (node.children && node.children.length > 0) continue;
      const kind = classifySectionHeading((node.textContent || '').trim());
      if (kind) return kind;
    }
    return null;
  }

  function runSectionGeometryCheck(FM, filledEls, issueEls) {
    const taggedEls = filledEls.filter((el) => el.getAttribute('data-wso-block-key'));
    if (!taggedEls.length) return;
    const all = Array.from(document.querySelectorAll('*'));
    for (const el of taggedEls) {
      const key = el.getAttribute('data-wso-block-key');
      const claimedKind = key.startsWith('experience-') ? 'experience' : key.startsWith('education-') ? 'education' : null;
      if (!claimedKind) continue;
      const elIdx = all.indexOf(el);
      if (elIdx === -1) continue;
      const actualKind = nearestSectionKind(all, elIdx);
      if (actualKind && actualKind !== claimedKind) {
        issueEls.add(el);
        const actualLabel = actualKind === 'education' ? 'Education' : 'Work Experience';
        const claimedLabel = claimedKind === 'education' ? 'an education' : 'a work-experience';
        FM.markVerifyIssue(
          el,
          `This field sits under a "${actualLabel}" heading on the page, but B.C Tracker filled it as ${claimedLabel} field — it's likely been mixed up with the wrong section.`
        );
      }
    }
  }

  function runValueFidelityCheck(FM, filledEls, issueEls) {
    for (const el of filledEls) {
      const expected = getExpected(el);
      if (expected === undefined || expected === '') continue;
      const actual = liveValue(el);
      if (FM.normalizeForMatch(actual) !== FM.normalizeForMatch(expected)) {
        issueEls.add(el);
        FM.markVerifyIssue(
          el,
          `Expected "${expected}" here but the field now shows "${actual || '(empty)'}" — something changed it after B.C Tracker filled it in.`
        );
      }
    }
  }

  // Groups elements by data-wso-block-key, e.g. { "experience-0": [...], "experience-1": [...] }
  function groupByBlockKey(filledEls, prefix) {
    const groups = new Map();
    for (const el of filledEls) {
      const key = el.getAttribute('data-wso-block-key');
      if (!key || !key.startsWith(prefix)) continue;
      const field = el.getAttribute('data-wso-block-field');
      const expected = getExpected(el);
      if (!field || expected === undefined || expected === '') continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ el, field, expected });
    }
    return groups;
  }

  // Independent of autofill.js's own date formatting (deliberately re-implemented here
  // rather than shared/imported) — "startDate"/"endDate" aren't real profile properties
  // (dates are split into separate Month/Year fields), so a plain entry[field] lookup
  // can't compare them. Small enough to duplicate; the whole point of this check is to
  // NOT trust the same code path that did the filling.
  function formatDateForCompare(month, year) {
    if (!year) return '';
    const mm = (month || '').toString().padStart(2, '0');
    return month ? `${mm}/${year}` : `${year}`;
  }

  function getComparableValue(entry, field, entityKind) {
    if (field === 'startDate') return formatDateForCompare(entry.startMonth, entry.startYear);
    if (field === 'endDate') {
      return entityKind === 'education'
        ? formatDateForCompare(entry.graduationMonth, entry.graduationYear)
        : formatDateForCompare(entry.endMonth, entry.endYear);
    }
    return entry[field] || '';
  }

  function runBlockConsistencyCheck(FM, filledEls, entries, prefix, kindLabel, entityKind, issueEls) {
    if (!entries || !entries.length) return;

    const groups = groupByBlockKey(filledEls, prefix);
    // value (normalized) -> blockKey of the first block that claimed it, for the
    // duplicate-across-blocks check.
    const claimedValues = new Map();

    for (const [blockKey, fields] of groups) {
      // Which profile-array indices are consistent with EVERY field's value at once?
      let candidateIndices = null;
      for (const { field, expected } of fields) {
        const norm = FM.normalizeForMatch(expected);
        const matching = entries
          .map((entry, i) => ({ i, val: FM.normalizeForMatch(getComparableValue(entry, field, entityKind)) }))
          .filter((x) => x.val && x.val === norm)
          .map((x) => x.i);
        candidateIndices = candidateIndices === null ? new Set(matching) : new Set([...candidateIndices].filter((i) => matching.includes(i)));
      }
      const consistent = candidateIndices && candidateIndices.size > 0;

      if (!consistent) {
        for (const { el, field, expected } of fields) {
          issueEls.add(el);
          FM.markVerifyIssue(
            el,
            `This ${kindLabel} block's fields don't all trace back to the same saved entry (this one says "${field}: ${expected}") — worth a careful check before you submit.`
          );
        }
      }

      // Duplicate-value check, independent of the consistency result above.
      for (const { el, field, expected } of fields) {
        const dupKey = `${field}::${FM.normalizeForMatch(expected)}`;
        const claimedBy = claimedValues.get(dupKey);
        if (claimedBy && claimedBy !== blockKey) {
          issueEls.add(el);
          FM.markVerifyIssue(
            el,
            `The same "${field}" value ("${expected}") also appears in another ${kindLabel} block — double-check these weren't mixed up.`
          );
        } else {
          claimedValues.set(dupKey, blockKey);
        }
      }
    }
  }

  function verify(profile, FM) {
    const filledEls = Array.from(document.querySelectorAll('.wso-filled'));
    const issueEls = new Set();

    runValueFidelityCheck(FM, filledEls, issueEls);
    runBlockConsistencyCheck(FM, filledEls, profile.workExperience, 'experience-', 'work experience', 'experience', issueEls);
    runBlockConsistencyCheck(FM, filledEls, profile.education, 'education-', 'education', 'education', issueEls);
    // Runs last so its more specific diagnosis (wrong SECTION, not just wrong index) wins
    // if a field somehow trips more than one check.
    runSectionGeometryCheck(FM, filledEls, issueEls);

    return {
      verifiedCount: filledEls.length - issueEls.size,
      issueCount: issueEls.size
    };
  }

  window.WSO_FillVerifier = { verify };
})();
