// Shared field-mapping engine, loaded before content/autofill.js and the site-specific
// mappers. Attaches everything to window.WSO_FieldMap so plain <script> content scripts
// (no bundler / no modules) can share it in execution order.

(function () {
  const FIELD_KEYWORDS = {
    fullName: ['full name', "applicant's name", 'applicant name', 'your name'],
    legalFirstName: ['first name', 'given name', 'forename', 'legal first name'],
    legalMiddleName: ['middle name'],
    legalLastName: ['last name', 'surname', 'family name', 'legal last name'],
    preferredName: ['preferred name', 'nickname', 'goes by', 'known as'],
    dateOfBirth: ['date of birth', 'birth date', 'dob'],
    email: ['email address', 'e-mail', 'email'],
    phoneCountryCode: ['country code', 'phone country code', 'dial code'],
    phoneNumber: [
      'phone number',
      'mobile number',
      'telephone number',
      'contact number',
      'mobile phone',
      'mobile',
      'telephone',
      'phone'
    ],
    addressLine1: ['address line 1', 'street address', 'address 1', 'home address'],
    addressLine2: ['address line 2', 'apartment', 'suite', 'address 2'],
    city: ['city', 'town'],
    postcode: ['postcode', 'postal code', 'zip code', 'zip'],
    country: ['country'],
    linkedinUrl: ['linkedin'],
    portfolioUrl: ['portfolio url', 'portfolio', 'personal website', 'website url', 'github'],
    university: ['university', 'school name', 'college name', 'institution', 'college'],
    degree: ['degree type', 'degree', 'qualification'],
    fieldOfStudy: ['field of study', 'major', 'course of study', 'area of study'],
    gpaOrClassification: ['gpa', 'degree classification', 'grade average', 'classification'],
    graduationMonth: ['graduation month', 'month of graduation'],
    graduationYear: ['graduation year', 'expected graduation', 'year of graduation'],
    ukRightToWork: [
      'right to work in the uk',
      'eligible to work in the uk',
      'uk right to work',
      'authorised to work in the united kingdom'
    ],
    hkRightToWork: [
      'right to work in hong kong',
      'eligible to work in hong kong',
      'hong kong right to work'
    ],
    sponsorshipNeeded: [
      'require visa sponsorship',
      'need sponsorship',
      'require sponsorship',
      'visa sponsorship',
      'sponsorship'
    ],
    availabilityStartDate: ['available to start', 'start date', 'availability date', 'earliest start'],
    noticePeriod: ['notice period'],
    howHeardAboutUs: [
      'how did you hear about us',
      'how did you hear about this role',
      'how did you hear about this opportunity',
      'referral source'
    ]
  };

  // Anything matching these is ALWAYS flagged for manual entry, never read from or
  // written to the profile, even if it also happens to match a keyword above.
  const EEO_PATTERNS = [
    'gender',
    'race',
    'ethnicity',
    'ethnic origin',
    'ethnic background',
    'disability',
    'disabled',
    'veteran',
    'sexual orientation',
    'transgender',
    'hispanic or latino',
    'protected veteran',
    'pronouns'
  ];

  // A field whose OWN label names a different person (a reference, an emergency
  // contact, a recommender) must never be filled with Luca's own data just because the
  // label also happens to contain a generic word like "name"/"phone"/"company" that
  // matches a FIELD_KEYWORDS entry — that would silently put his info in someone else's
  // field. Applications commonly include a "Please provide 2 references" section with
  // Name/Email/Phone/Company/Relationship fields that reuse exactly those generic words.
  const THIRD_PARTY_PATTERNS = [
    'reference',
    'referee',
    'recommender',
    'recommendation',
    'emergency contact',
    'next of kin',
    'guarantor',
    'supervisor',
    'manager'
  ];

  // Distinct from EEO (which is "never asked at all") — these ARE legitimate questions,
  // but the profile has no such data (only current-address country is stored, which is
  // not the same thing as country of birth/citizenship/nationality) and answering from
  // the address country would be a guess, not a read of real data.
  const NEVER_INFER_PATTERNS = ['nationality', 'citizenship', 'country of birth', 'place of birth'];

  // Common wording variants for values that show up in <select> options and custom
  // dropdown widgets. Keyed by the profile's normalized canonical value; each alias
  // normalizes to the same "exact" match tier in either direction (target-has-alias or
  // option-has-alias), so "United Kingdom" in the profile matches a page option spelled
  // "UK" and vice versa.
  // Keys/aliases here must already be in normalizeForMatch's output shape (lowercase,
  // no . , ' ( ) — see normalizeForMatch below) since aliasSet() compares against it
  // directly; an alias spelled with an apostrophe would silently never match.
  const VALUE_ALIASES = {
    'united kingdom': ['uk', 'gb', 'great britain', 'england'],
    'united states': ['usa', 'us', 'united states of america', 'america'],
    'hong kong': ['hk', 'hong kong sar', 'hksar'],
    yes: ['y', 'true'],
    no: ['n', 'false'],
    'bachelors degree': ['bachelors', 'bachelor', 'ba', 'bsc', 'undergraduate degree'],
    'masters degree': ['masters', 'master', 'ma', 'msc', 'postgraduate degree']
  };

  function normalize(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[*:•]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Looser than normalize() — also strips punctuation that's noise for VALUE matching
  // (option labels, not field labels) so "U.K." and "UK" and "the U.K." all collapse
  // together. Kept separate from normalize() so label-matching behavior elsewhere is
  // untouched.
  function normalizeForMatch(text) {
    return normalize(text)
      .replace(/[.,'()]/g, '')
      .replace(/-/g, ' ') // "A-Levels" vs "A Levels", "Pre-Med" vs "Pre Med", etc — same option, different punctuation
      .replace(/\s+/g, ' ')
      .trim();
  }

  function humanizeAttr(value) {
    if (!value) return '';
    return value
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_]/g, ' ')
      .toLowerCase();
  }

  function getFieldLabelText(el) {
    if (el.labels && el.labels.length) {
      const text = Array.from(el.labels)
        .map((l) => l.textContent)
        .join(' ');
      if (normalize(text)) return text;
    }
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ');
      if (normalize(text)) return text;
    }

    const closestLabel = el.closest('label');
    if (closestLabel && normalize(closestLabel.textContent)) return closestLabel.textContent;

    if (el.placeholder) return el.placeholder;

    // Common non-semantic pattern: a sibling/ancestor holds the visible label text.
    const container = el.closest('div, li, fieldset, tr');
    if (container) {
      const candidate = container.querySelector('label, .label, [class*="label"]');
      if (candidate && candidate !== el && normalize(candidate.textContent)) {
        return candidate.textContent;
      }
    }

    return humanizeAttr(el.name || el.id || '');
  }

  function isEEOQuestion(labelText) {
    const normalized = normalize(labelText);
    return EEO_PATTERNS.some((p) => normalized.includes(p));
  }

  function isThirdPartyContext(labelText) {
    const normalized = normalize(labelText);
    return THIRD_PARTY_PATTERNS.some((p) => normalized.includes(p));
  }

  function isNeverInferField(labelText) {
    const normalized = normalize(labelText);
    return NEVER_INFER_PATTERNS.some((p) => normalized.includes(p));
  }

  // Headings that mark the start of a repeatable or standalone section. Shared by
  // autofill.js's block passes (experience/education/language) to figure out which
  // section a candidate sub-field actually sits under — not just "has a Job Title been
  // seen so far", which has no way to notice the page has moved into a completely
  // different section (References, Volunteer Experience, Certifications, ...) that
  // happens to reuse the same generic sub-field wording ("From", "To", "Company",
  // "Location"). Deliberately duplicated (not reused) by fillVerifier.js's own copy of
  // this idea — see that file for why an independent post-fill check must not share this
  // list with the code it's checking.
  const SECTION_HEADING_PATTERNS = [
    { kind: 'experience', re: /^work experience\s*(\d+)?\s*$/i },
    { kind: 'education', re: /^education\s*(\d+)?\s*$/i },
    { kind: 'education', re: /^(school|institution|university|school or university)$/i },
    { kind: 'language', re: /^languages?\s*(\d+)?\s*$/i },
    {
      kind: 'other',
      re: /^(references?|referees?|emergency contact|next of kin|volunteer(ing)?\s*experience|certifications?|licenses?|publications?|awards?(\s*\/?\s*honors?)?|additional (experience|information)|projects?)\s*(\d+)?\s*$/i
    }
  ];

  function classifySectionHeading(text) {
    for (const { kind, re } of SECTION_HEADING_PATTERNS) {
      if (re.test(text)) return kind;
    }
    return null;
  }

  // Walks backward in document order from `all[elIdx]` for the nearest leaf element whose
  // own text looks like a section heading, and returns which kind of section that is (or
  // null if none found above it). `all` is the full descendant list of the scan root,
  // computed once by the caller and reused across every field in a pass.
  function nearestSectionKind(all, elIdx) {
    for (let i = elIdx; i >= 0; i--) {
      const node = all[i];
      if (node.children && node.children.length > 0) continue; // only leaf nodes carry a heading's own text
      const kind = classifySectionHeading((node.textContent || '').trim());
      if (kind) return kind;
    }
    return null;
  }

  function matchCanonicalField(labelText) {
    const normalized = normalize(labelText);
    if (!normalized) return null;

    let best = null; // { key, len }
    let bestIsAmbiguous = false;

    for (const [key, keywords] of Object.entries(FIELD_KEYWORDS)) {
      for (const kw of keywords) {
        if (normalized.includes(kw)) {
          if (!best || kw.length > best.len) {
            best = { key, len: kw.length };
            bestIsAmbiguous = false;
          } else if (kw.length === best.len && key !== best.key) {
            bestIsAmbiguous = true;
          }
          break; // only need the best keyword per field
        }
      }
    }

    if (!best || bestIsAmbiguous) return null;
    return best.key;
  }

  function resolveProfileValue(profile, canonicalKey) {
    if (canonicalKey === 'fullName') {
      return [profile.legalFirstName, profile.legalLastName].filter(Boolean).join(' ');
    }
    const value = profile[canonicalKey];
    return typeof value === 'string' ? value : '';
  }

  // ---- Tiered option matching, shared by native <select> and custom dropdown widgets ----
  //
  // 'high'   — exact match (post-normalization, or via VALUE_ALIASES) — auto-filled.
  // 'medium' — one string is a prefix of the other — auto-filled, but flagged in the UI
  //            as "worth a second look" rather than treated as fully confident.
  // 'weak'   — substring-only overlap — this is the tier closest to guessing, so per the
  //            flag-over-guess rule it is NEVER auto-filled. Callers use the returned
  //            candidates to give a shortlist in the flag reason instead of a blank
  //            "needs your input".

  function aliasSet(norm) {
    const set = new Set([norm]);
    for (const [key, aliases] of Object.entries(VALUE_ALIASES)) {
      if (norm === key || aliases.includes(norm)) {
        set.add(key);
        aliases.forEach((a) => set.add(a));
      }
    }
    return set;
  }

  // Structured dropdown options ("United Kingdom (UK)", "BSc (Hons) Economics") are
  // short — a handful of words at most. A long free-text answer that merely happens to
  // contain the target word ("I am not authorised and do not have a UK visa") is not the
  // same kind of match and must not be promoted by the token check below; this bound is
  // what keeps that distinction.
  const MAX_TOKEN_CHECK_WORDS = 5;

  function classifyMatch(targetNorm, targetAliases, candidateNorm) {
    if (!candidateNorm) return null;
    if (targetAliases.has(candidateNorm)) return 'high';
    if (aliasSet(candidateNorm).has(targetNorm)) return 'high';

    // Handles "Country (ABBR)" style options, e.g. target "UK" against an option
    // literally spelled "United Kingdom (UK)" — a whole-token exact match anywhere in a
    // SHORT, structured candidate is still a confident, non-guessed signal. Bounded to
    // short candidates (see MAX_TOKEN_CHECK_WORDS) and whole tokens only (not substring)
    // so it can't fire on a long sentence that merely contains the word ("...have a UK
    // visa") or a short unrelated word that happens to start with it ("no" in "Norway").
    const candidateTokens = candidateNorm.split(' ').filter(Boolean);
    if (candidateTokens.length <= MAX_TOKEN_CHECK_WORDS) {
      if (candidateTokens.some((t) => targetAliases.has(t) || aliasSet(t).has(targetNorm))) return 'high';
    }

    // Prefix/substring tiers are guarded to length > 2 on both sides — below that, a
    // "match" is really just two short strings sharing a few letters (e.g. target "No"
    // is a prefix of "Norway"), which is closer to a coin flip than a fuzzy match. Short
    // targets still get every other tier above; they just don't get this loose one.
    if (candidateNorm.length > 2 && targetNorm.length > 2) {
      if (candidateNorm.startsWith(targetNorm) || targetNorm.startsWith(candidateNorm)) return 'medium';
      if (candidateNorm.includes(targetNorm) || targetNorm.includes(candidateNorm)) return 'weak';
    }
    return null;
  }

  const TIER_RANK = { high: 0, medium: 1, weak: 2 };

  // items: [{ ref, texts: string[] }]. Returns { tier: 'high'|'medium', item } on an
  // auto-fillable match, { tier: 'weak', candidates: item[] } when only weak matches
  // exist (caller should flag, not fill), or null when nothing matched at all.
  function matchOptionTier(items, targetValue) {
    const targetNorm = normalizeForMatch(targetValue);
    if (!targetNorm) return null;
    const targetAliases = aliasSet(targetNorm);

    let best = null;
    const weakCandidates = [];

    for (const item of items) {
      let itemTier = null;
      for (const text of item.texts) {
        const tier = classifyMatch(targetNorm, targetAliases, normalizeForMatch(text));
        if (tier && (!itemTier || TIER_RANK[tier] < TIER_RANK[itemTier])) itemTier = tier;
      }
      if (!itemTier) continue;
      if (itemTier === 'weak') {
        weakCandidates.push(item);
      } else if (!best || TIER_RANK[itemTier] < TIER_RANK[best.tier]) {
        best = { tier: itemTier, item };
      }
    }

    if (best) return best;
    if (weakCandidates.length) return { tier: 'weak', candidates: weakCandidates.slice(0, 5) };
    return null;
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : el.tagName === 'SELECT'
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillTextLike(el, value) {
    if (!value) return false;
    setNativeValue(el, value);
    return true;
  }

  // Returns 'high' | 'medium' | false. Falsy on failure so existing `if (fillSelect(...))`
  // call sites keep working unchanged; callers that care about confidence read the tier.
  function fillSelect(el, value) {
    if (!value) return false;
    const items = Array.from(el.options).map((o) => ({ ref: o, texts: [o.textContent, o.value] }));
    const result = matchOptionTier(items, value);
    if (!result || result.tier === 'weak') return false;
    setNativeValue(el, result.item.ref.value);
    return result.tier;
  }

  function fillRadioGroup(name, value) {
    if (!value) return false;
    const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`));
    const target = normalize(value);
    const match = radios.find((r) => {
      const label = getFieldLabelText(r) || r.value;
      return normalize(label) === target || normalize(r.value) === target;
    });
    if (!match) return false;
    match.checked = true;
    match.dispatchEvent(new Event('input', { bubbles: true }));
    match.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  let flagCounter = 0;
  const flagRegistry = new Map();

  // confidence: 'high' (default) | 'medium'. A medium-confidence fill is also registered
  // in the same flag/scroll registry as an actionable "worth checking" item (kind:
  // 'filled-medium'), reusing the exact popup/scroll-to plumbing flagged fields already
  // use — see extension/popup.js.
  //
  // meta (optional) records what this fill INTENDED to write, purely as data for the
  // post-fill verification pass (fillVerifier.js) to check against later — markFilled
  // itself doesn't interpret any of it:
  //   expected   — the exact string this fill call wrote, for a later live-value re-read
  //                to be compared against (catches a page silently reformatting/clobbering
  //                it after we set it).
  //   blockKey   — which repeatable block this belongs to, e.g. "experience-2" — lets the
  //                verifier group a block's fields and cross-check them against the
  //                profile from scratch, independent of whatever index the fill pass used.
  //   blockField — which profile property this field represents within that block, e.g.
  //                "company".
  function markFilled(el, confidence, labelText, meta) {
    const tier = confidence === 'medium' ? 'medium' : 'high';
    el.classList.add('wso-filled', `wso-filled-${tier}`);
    el.setAttribute('data-wso-filled', '1');
    el.setAttribute('data-wso-confidence', tier);

    if (meta) {
      if (meta.expected !== undefined) el.setAttribute('data-wso-expected', meta.expected);
      if (meta.blockKey) el.setAttribute('data-wso-block-key', meta.blockKey);
      if (meta.blockField) el.setAttribute('data-wso-block-field', meta.blockField);
    }

    if (tier === 'medium' && !el.hasAttribute('data-wso-flag-id')) {
      flagCounter += 1;
      const id = `wso-check-${flagCounter}`;
      el.setAttribute('data-wso-flag-id', id);
      const reason = labelText || getFieldLabelText(el) || 'Auto-matched — worth checking';
      flagRegistry.set(id, { el, reason, kind: 'filled-medium' });
    }
  }

  function markFlagged(el, reason) {
    if (el.hasAttribute('data-wso-flag-id')) {
      // Already flagged this run (e.g. a radio group) — just keep the first reason.
      const id = el.getAttribute('data-wso-flag-id');
      const existing = flagRegistry.get(id);
      return { id, label: existing?.reason };
    }
    el.classList.add('wso-flagged');
    flagCounter += 1;
    const id = `wso-flag-${flagCounter}`;
    el.setAttribute('data-wso-flag-id', id);
    el.dataset.wsoFlagReason = reason || 'Needs your input';
    flagRegistry.set(id, { el, reason: reason || 'Needs your input', kind: 'flagged' });
    return { id, label: reason };
  }

  // Called only by the post-fill verification pass (fillVerifier.js), never during normal
  // filling — downgrades a field WSO already filled from "trust me" to "I filled this, but
  // my own follow-up check found something off, please look." Distinct from markFlagged
  // (which means "never had data for this") and from medium-confidence (which just means a
  // fuzzy match, not a detected problem).
  function markVerifyIssue(el, reason) {
    el.classList.remove('wso-filled-high', 'wso-filled-medium');
    el.classList.add('wso-filled', 'wso-verify-failed');
    if (el.hasAttribute('data-wso-flag-id')) {
      const id = el.getAttribute('data-wso-flag-id');
      const existing = flagRegistry.get(id);
      if (existing) {
        existing.reason = reason || existing.reason;
        existing.kind = 'verify-failed';
      }
      return { id, label: reason };
    }
    flagCounter += 1;
    const id = `wso-verify-${flagCounter}`;
    el.setAttribute('data-wso-flag-id', id);
    flagRegistry.set(id, { el, reason: reason || 'Worth double-checking', kind: 'verify-failed' });
    return { id, label: reason };
  }

  function getFlags() {
    return Array.from(flagRegistry.entries()).map(([id, { reason, kind }]) => ({
      id,
      label: reason,
      kind: kind || 'flagged'
    }));
  }

  function scrollToFlag(id) {
    const entry = flagRegistry.get(id);
    if (!entry) return false;
    entry.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    entry.el.classList.add('wso-flash');
    setTimeout(() => entry.el.classList.remove('wso-flash'), 1200);
    entry.el.focus({ preventScroll: true });
    return true;
  }

  function resetRegistry() {
    flagRegistry.clear();
    flagCounter = 0;
  }

  window.WSO_FieldMap = {
    FIELD_KEYWORDS,
    EEO_PATTERNS,
    normalize,
    normalizeForMatch,
    matchOptionTier,
    getFieldLabelText,
    isEEOQuestion,
    isThirdPartyContext,
    isNeverInferField,
    nearestSectionKind,
    matchCanonicalField,
    resolveProfileValue,
    setNativeValue,
    fillTextLike,
    fillSelect,
    fillRadioGroup,
    markFilled,
    markVerifyIssue,
    markFlagged,
    getFlags,
    scrollToFlag,
    resetRegistry
  };
})();
