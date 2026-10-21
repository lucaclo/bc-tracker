// Fills numbered repeatable sections — "Work Experience 1…N", "Education 1…N" — so that
// every card ends up showing EXACTLY one profile entry, and nothing else.
//
// Why this exists (Luca, 2026-10-09, Brown Advisory on Workday): Workday's "Autofill with
// Resume" parses the CV and pre-populates cards with garbage — "LEADERSHIP" as a job title,
// "Equity Research" as a company, "Saratoga CA", the NEXT job's company glued onto the end
// of a description. The old per-field pass only ever wrote fields whose profile value was
// non-empty and silently skipped cards beyond the profile, so all of that stayed on the
// page looking like B.C Tracker had put it there. The rule now:
//
//   THE PROFILE IS THE ONLY SOURCE. Card N shows profile entry N in full:
//   - every recognized field is set to the profile value — and CLEARED when the profile
//     has nothing for it (an empty profile description means an empty description box,
//     never whatever Workday parsed);
//   - dates are written into Workday's separate Month / Year boxes;
//   - after a short pause (Workday re-renders), every field is re-read and anything that
//     doesn't match the profile is flagged with the exact value it should have;
//   - a card the profile has no entry for is flagged "delete this card", and profile
//     entries with no card are flagged "click Add Another".
//
// Only handles pages with explicitly NUMBERED headings ("Work Experience 2"); anything
// else falls back to the older label-sequence passes in content/autofill.js.

(function () {
  const SECTIONS = {
    experience: {
      heading: /^work experience\s*(\d+)$/i,
      title: 'Work Experience',
      profileKey: 'workExperience',
      identity: (e) => [e.jobTitle, e.company].filter(Boolean).join(' at '),
      fields: [
        { key: 'jobTitle', label: /^(job title|position title|title|position|role title)$/ },
        { key: 'company', label: /^(company|company name|employer|organi[sz]ation)$/ },
        { key: 'location', label: /^(location|city|job location)$/ },
        { key: 'currentlyWorkHere', label: /currently work here|current(ly)? employed here|current job/, checkbox: true },
        { key: 'startDate', label: /^(from|start date|start)$/, date: ['startMonth', 'startYear'] },
        { key: 'endDate', label: /^(to|end date|end)$/, date: ['endMonth', 'endYear'], skipIf: (e) => e.currentlyWorkHere },
        { key: 'roleDescription', label: /^(role description|description|description of role|responsibilities|duties)$/, multiline: true }
      ]
    },
    education: {
      heading: /^education\s*(\d+)$/i,
      title: 'Education',
      profileKey: 'education',
      identity: (e) => [e.degree, e.institution].filter(Boolean).join(' at '),
      fields: [
        { key: 'institution', label: /^(school|institution|university|school or university|college|school name)$/ },
        { key: 'degree', label: /^(degree|degree type|qualification)$/ },
        { key: 'fieldOfStudy', label: /^(field of study|major|subject|course)$/ },
        { key: 'gpaOrClassification', label: /^(overall result( \(gpa\))?|gpa|grade|classification|degree classification)$/ },
        { key: 'startDate', label: /^(from|start date|start)$/, date: ['startMonth', 'startYear'] },
        { key: 'endDate', label: /^(to|end date|end|graduation date|expected graduation( date)?)$/, date: ['graduationMonth', 'graduationYear'] }
      ]
    }
  };

  const FIELD_SELECTOR = 'input:not([type="hidden"]), textarea, select, button[aria-haspopup="listbox"]';

  const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function monthNumber(month) {
    const raw = (month || '').toString().trim().toLowerCase();
    if (/^\d{1,2}$/.test(raw)) return String(Number(raw)).padStart(2, '0');
    const i = MONTH_NAMES.findIndex((m) => raw.length >= 3 && m.startsWith(raw.slice(0, 3)));
    return i >= 0 ? String(i + 1).padStart(2, '0') : '';
  }
  const dateText = (mm, yyyy) => (yyyy ? (mm ? `${mm}/${yyyy}` : yyyy) : '');

  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const isLeaf = (n) => !n.children || n.children.length === 0;

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // ---- Locating cards ----------------------------------------------------------------

  // Any heading that ends a card: another numbered card of any section, or a section
  // title like "Education", "Languages", "Skills", "Websites", "Resume/CV".
  const ANY_SECTION_HEADING = /^(work experience|education|languages?|skills|websites?|social network urls|resume\/?cv|certifications?|references?|volunteer(ing)? experience|additional information|application questions)\s*(\d+)?$/i;

  function findCards(all, section) {
    const cards = [];
    for (let i = 0; i < all.length; i++) {
      const node = all[i];
      if (!isLeaf(node)) continue;
      const m = section.heading.exec(clean(node.textContent));
      if (m) cards.push({ number: Number(m[1]), headingIdx: i, heading: node });
    }
    // Each card runs from its heading to the next section heading of any kind.
    for (const card of cards) {
      let end = all.length;
      for (let j = card.headingIdx + 1; j < all.length; j++) {
        if (isLeaf(all[j]) && ANY_SECTION_HEADING.test(clean(all[j].textContent))) {
          end = j;
          break;
        }
      }
      card.endIdx = end;
      card.fields = [];
    }
    return cards;
  }

  // ---- Field roles -------------------------------------------------------------------

  const DATE_PART_RE = /^(month|mm|year|yyyy|day|dd)$/;

  function datePartOf(el, FM) {
    const aid = (el.getAttribute('data-automation-id') || el.id || '').toLowerCase();
    if (/month/.test(aid)) return 'month';
    if (/year/.test(aid)) return 'year';
    const own = FM.normalize(el.getAttribute('aria-label') || el.placeholder || '');
    if (/^(month|mm)$/.test(own)) return 'month';
    if (/^(year|yyyy)$/.test(own)) return 'year';
    return null;
  }

  // The visible label of the date GROUP a Month/Year box belongs to ("From", "To").
  function groupLabel(el, FM) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      const labelledBy = node.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
        if (FM.normalize(text)) return FM.normalize(text);
      }
      const label = node.querySelector(':scope > label, :scope > legend, :scope > * > label, :scope > * > legend');
      if (label && !label.contains(el) && FM.normalize(label.textContent)) return FM.normalize(label.textContent);
    }
    return '';
  }

  function roleOf(el, section, FM) {
    const own = FM.normalize(FM.getFieldLabelText(el));
    const type = (el.type || '').toLowerCase();
    const part = datePartOf(el, FM);
    const label = part || DATE_PART_RE.test(own) ? groupLabel(el, FM) || own : own;
    for (const spec of section.fields) {
      if (!spec.label.test(label)) continue;
      if (spec.checkbox && type !== 'checkbox') continue;
      if (!spec.checkbox && type === 'checkbox') continue;
      return { spec, part: spec.date ? part || 'whole' : null };
    }
    return null;
  }

  // ---- Reading / writing -------------------------------------------------------------

  function commit(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  function writeText(el, value, FM) {
    if (el.tagName === 'SELECT') return FM.fillSelect(el, value) || false;
    FM.setNativeValue(el, value);
    commit(el);
    return true;
  }

  // Workday's Month/Year boxes may keep the digits in a sibling "display" element rather
  // than in the input's own value.
  function readDatePart(el) {
    const own = clean(el.value) || el.getAttribute('aria-valuenow') || '';
    if (own) return own;
    const aid = el.getAttribute('data-automation-id') || '';
    const display = aid && el.parentElement?.querySelector(`[data-automation-id="${aid.replace('-input', '-display')}"]`);
    const text = clean(display?.textContent);
    return /^\d+$/.test(text) ? text : '';
  }

  const sameNumber = (a, b) => (a === '' && b === '') || (a !== '' && b !== '' && Number(a) === Number(b));

  // ---- The pass ----------------------------------------------------------------------

  async function runSection(kind, profile, FM, CF, root, all) {
    const section = SECTIONS[kind];
    const entries = profile[section.profileKey] || [];
    const cards = findCards(all, section);
    if (!cards.length) return false; // not a numbered-card page — legacy pass handles it

    const position = new Map(all.map((n, i) => [n, i]));
    for (const el of root.querySelectorAll(FIELD_SELECTOR)) {
      const idx = position.get(el);
      const card = cards.find((c) => idx > c.headingIdx && idx < c.endIdx);
      if (card) card.fields.push(el);
    }

    const checks = []; // { el, expected, describe, kind: 'text'|'date'|'checkbox' }

    for (const card of cards) {
      const where = `${section.title} ${card.number}`;
      // Card N on the page is profile entry N — the heading number, not DOM order, so a
      // card Workday renders out of order still gets its own entry.
      const entry = entries[card.number - 1];

      if (!entry) {
        const shown = card.fields
          .filter((el) => el.tagName !== 'BUTTON' && el.type !== 'checkbox')
          .map((el) => clean(el.value))
          .filter(Boolean)
          .slice(0, 2)
          .join(' / ');
        const first = card.fields.find(isVisible) || card.fields[0];
        if (first) {
          FM.markFlagged(
            first,
            `${where} is not in your profile${shown ? ` ("${shown}")` : ''} — it came from the site, not from you. Delete this card (or add it to your profile first).`
          );
        }
        card.fields.forEach((el) => (el.dataset.wsoSkip = '1'));
        continue;
      }

      for (const el of card.fields) {
        if (el.disabled || el.readOnly) continue;
        const role = roleOf(el, section, FM);
        if (!role) continue; // unknown field in the card — generic pass decides
        const { spec, part } = role;
        const name = `${where} · ${FM.getFieldLabelText(el).replace(/\*/g, '').trim() || spec.key}`;

        if (spec.checkbox) {
          const want = !!entry[spec.key];
          if (el.checked !== want) el.click();
          checks.push({ el, kind: 'checkbox', expected: want, describe: `${where} · "I currently work here" should be ${want ? 'ticked' : 'unticked'}` });
          continue;
        }

        if (spec.date) {
          const skipped = spec.skipIf && spec.skipIf(entry);
          const mm = skipped ? '' : monthNumber(entry[spec.date[0]]);
          const yyyy = skipped ? '' : clean(entry[spec.date[1]]);
          const full = dateText(mm, yyyy);
          if (skipped) {
            el.dataset.wsoSkip = '1';
            continue;
          }
          if (part !== 'whole' && !(part === 'month' ? mm : yyyy) && !readDatePart(el)) {
            el.dataset.wsoSkip = '1';
            continue;
          }
          if (part === 'month') {
            writeText(el, mm, FM);
            checks.push({ el, kind: 'date', expected: mm, describe: `${where} · ${spec.key === 'startDate' ? 'From' : 'To'} month should be ${mm || '(blank)'} (${full || 'not in your profile'})` });
          } else if (part === 'year') {
            writeText(el, yyyy, FM);
            checks.push({ el, kind: 'date', expected: yyyy, describe: `${where} · ${spec.key === 'startDate' ? 'From' : 'To'} year should be ${yyyy || '(blank)'} (${full || 'not in your profile'})` });
          } else {
            const value = (el.type || '').toLowerCase() === 'month' && yyyy ? `${yyyy}-${mm || '01'}` : full;
            writeText(el, value, FM);
            checks.push({ el, kind: 'text', expected: value, describe: `${name} should be ${full || '(blank)'}` });
          }
          continue;
        }

        const value = clean(entry[spec.key]);

        // Workday-style custom dropdown (e.g. Degree): pick the option by real clicks.
        if (el.tagName === 'BUTTON') {
          if (!value) {
            FM.markFlagged(el, `${name} — not in your profile, please choose`);
            continue;
          }
          let result = { status: 'failed' };
          try {
            result = await CF.fill(el, value, FM);
          } catch (_) {
            /* falls through to the flag below */
          }
          if (result.status === 'filled') {
            FM.markFilled(el, result.tier, result.tier === 'medium' ? `${name} — matched "${result.matchedText}" for "${value}", worth checking` : undefined);
          } else {
            FM.markFlagged(el, `${name} should be "${value}" — no matching option, please choose by hand`);
          }
          continue;
        }

        const before = clean(el.value);
        if (!value && !before) {
          el.dataset.wsoSkip = '1'; // blank in the profile and blank on the page — nothing to do
          continue;
        }
        writeText(el, value, FM);
        checks.push({
          el,
          kind: 'text',
          expected: value,
          cleared: !value && !!before,
          clearedText: before,
          blockKey: `${kind}-${card.number - 1}`,
          blockField: spec.key,
          describe: `${name} should be ${value ? `"${value}"` : 'blank (nothing in your profile)'}`
        });
      }
    }

    // Profile entries with no card on the page.
    const shownNumbers = new Set(cards.map((c) => c.number));
    const missing = entries.map((e, i) => ({ e, n: i + 1 })).filter(({ n }) => !shownNumbers.has(n));
    if (missing.length) {
      const lastCard = cards[cards.length - 1];
      const after = all.slice(lastCard.headingIdx).find((n) => /^(add|add another)$/i.test(clean(n.textContent)) && n.matches?.('button, [role="button"], a'));
      const anchor = after || lastCard.fields.find(isVisible) || lastCard.fields[0];
      if (anchor) {
        FM.markFlagged(
          anchor,
          `Your profile has ${entries.length} ${section.title.toLowerCase()} entries but this page has ${cards.length} — click "Add Another", then Fill again, for: ${missing.map(({ e, n }) => `${n}. ${section.identity(e) || 'entry ' + n}`).join('; ')}`
        );
      }
    }

    // Let the page re-render (Workday re-applies its own state on blur), then re-read
    // EVERYTHING written above and compare to the profile — a field that didn't take is
    // flagged with the exact value it should hold, never left looking filled.
    await new Promise((r) => setTimeout(r, 400));
    for (const c of checks) {
      let ok;
      if (c.kind === 'checkbox') ok = c.el.checked === c.expected;
      else if (c.kind === 'date') ok = sameNumber(readDatePart(c.el), c.expected);
      else ok = c.el.tagName === 'SELECT'
        ? !!c.expected === !!c.el.value && (!c.expected || FM.normalizeForMatch(c.el.options[c.el.selectedIndex]?.textContent) === FM.normalizeForMatch(c.expected) || FM.normalizeForMatch(c.el.value) === FM.normalizeForMatch(c.expected))
        : clean(c.el.value) === clean(c.expected);

      if (!ok) {
        FM.markFlagged(c.el, `${c.describe} — the site didn't accept it, please set it by hand.`);
      } else if (c.cleared) {
        FM.markFilled(c.el, 'medium', `${c.describe.replace(/ should be .*/, '')} — cleared text that isn't in your profile ("${c.clearedText.slice(0, 60)}${c.clearedText.length > 60 ? '…' : ''}")`);
      } else {
        // expected only for non-empty text values — fillVerifier's checks key off it.
        const meta = c.kind === 'text' && c.expected ? { expected: c.expected, blockKey: c.blockKey, blockField: c.blockField } : undefined;
        FM.markFilled(c.el, 'high', undefined, meta);
      }
    }
    return true;
  }

  async function run(profile, FM, CF, root) {
    const all = Array.from(root.querySelectorAll('*'));
    const handled = {};
    for (const kind of Object.keys(SECTIONS)) {
      try {
        handled[kind] = await runSection(kind, profile, FM, CF, root, all);
      } catch (e) {
        console.error(`[BC] ${kind} card fill failed`, e);
        handled[kind] = false;
      }
    }
    return handled;
  }

  window.WSO_BlockFill = { run, monthNumber };
})();
