// Reads the job posting you're looking at on ANY company / ATS site (Workday, Greenhouse,
// Lever, a firm's own careers page, …) when you click its "Apply" button, so the side
// panel's "Log this application" form is pre-filled from the actual job — not from
// whatever tracker row happened to be captured last.
//
// Like tracker-reader.js it only READS what's already on the page: it never
// preventDefault()s the click, never clicks anything itself, never submits anything.
//
// Where each field comes from, most → least trustworthy:
//   role     the posting's visible title (Workday's jobPostingHeader, Lever/Greenhouse
//            headings), then JSON-LD JobPosting.title, og:title, the first <h1>, <title>
//   company  Greenhouse's "Job Application for X at Y" title, the careers-site logo alt
//            text, og:site_name, whatever's left of <title> once the role is removed,
//            JSON-LD hiringOrganization, and only as a last resort the hostname
//   region   the country named in the job's location (JSON-LD jobLocation or the visible
//            location text), as a full country name ("London, UK" → "United Kingdom")
//   deadline JSON-LD validThrough, else a "Closing date / End Date / Deadline: <date>" line
//   industry not on job pages — left blank (and flagged as missing) unless it can be
//            merged from a matching tracker capture, see mergeWithTrackerCapture
//
// Confirmed live on Workday (2026-10-09): a job page loaded directly carries a JSON-LD
// JobPosting, but Workday is a single-page app — clicking from the search list to another
// job swaps the visible posting WITHOUT replacing that JSON-LD, so it goes stale. JSON-LD
// is therefore only trusted when its title matches the visible posting title. Workday's
// JSON-LD hiringOrganization is also the legal entity ("12542 Citicorp Services India
// Private Limited"), so the careers-site logo ("Citi Careers Logo careers home") is
// preferred for the company.

(function () {
  // Newest copy wins. Reloading the extension leaves the copy that was already in an open
  // tab behind — disconnected (its chrome.* calls fail), but its globals and listeners are
  // still in the page. The side panel then injects a fresh copy. An earlier "already
  // loaded? then stop" guard saw the dead copy and refused to start the live one, so that
  // tab silently did nothing (Luca, Brown Advisory, 2026-10-09). Instead, every copy takes
  // a token and only the copy holding the latest token acts.
  const token = {};
  window.__WSO_JOB_READER_TOKEN = token;
  const isCurrent = () => window.__WSO_JOB_READER_TOKEN === token;
  const { toISODate } = window.WSO_Dates;

  const APPLY_TEXT = /^(apply|apply now|apply here|apply online|easy apply|quick apply|apply (?:for|to) (?:this |the )?(?:job|role|position|vacancy|opportunity|programme|program|internship)|start (?:your |an |my )?application|begin (?:your )?application|i'?m interested)$/i;

  // A tracker capture this recent, for the same company / site, is the same application:
  // its industry/region/role are merged in rather than thrown away.
  const MERGE_WINDOW_MS = 3 * 60 * 60 * 1000;

  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const norm = (t) => clean(t).toLowerCase().replace(/[^a-z0-9]/g, '');

  // ---- Countries --------------------------------------------------------------------

  const COUNTRY_ALIASES = {
    UK: 'United Kingdom',
    'U.K.': 'United Kingdom',
    GB: 'United Kingdom',
    'Great Britain': 'United Kingdom',
    England: 'United Kingdom',
    Scotland: 'United Kingdom',
    Wales: 'United Kingdom',
    'Northern Ireland': 'United Kingdom',
    US: 'United States',
    USA: 'United States',
    'U.S.': 'United States',
    'U.S.A.': 'United States',
    'United States of America': 'United States',
    UAE: 'United Arab Emirates',
    HK: 'Hong Kong',
    'Hong Kong SAR': 'Hong Kong'
  };

  let countryNames = null; // [{ pattern, name }], longest first
  function countryTable() {
    if (countryNames) return countryNames;
    const names = new Map(Object.entries(COUNTRY_ALIASES));
    try {
      const display = new Intl.DisplayNames(['en'], { type: 'region' });
      const A = 65;
      for (let i = 0; i < 26; i++) {
        for (let j = 0; j < 26; j++) {
          const code = String.fromCharCode(A + i, A + j);
          let name;
          try {
            name = display.of(code);
          } catch (_) {
            continue;
          }
          if (!name || name === code || /unknown/i.test(name)) continue;
          name = name.replace(/ SAR China$/, '');
          if (!names.has(name)) names.set(name, name);
        }
      }
    } catch (_) {
      /* no Intl.DisplayNames — aliases alone still cover the common cases */
    }
    countryNames = [...names.entries()]
      .sort((a, b) => b[0].length - a[0].length)
      .map(([text, name]) => {
        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Short codes ("US", "UK") only match in capitals, so the word "us" never does.
        const flags = text.length <= 4 ? '' : 'i';
        return { pattern: new RegExp(`(^|[^A-Za-z])${escaped}(?![A-Za-z])`, flags), name };
      });
    return countryNames;
  }

  function countryIn(text) {
    if (!text) return '';
    for (const { pattern, name } of countryTable()) {
      if (pattern.test(text)) return name;
    }
    return '';
  }

  // ---- JSON-LD ------------------------------------------------------------------------

  function jsonLdPostings() {
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      const type = node['@type'];
      if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) found.push(node);
      if (node['@graph']) walk(node['@graph']);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        walk(JSON.parse(script.textContent));
      } catch (_) {
        /* malformed JSON-LD — ignore */
      }
    }
    return found;
  }

  const ldText = (v) => (typeof v === 'string' ? v : v?.name || '');

  function ldLocation(posting) {
    const places = [].concat(posting.jobLocation || []);
    for (const place of places) {
      const a = place?.address || {};
      if (typeof a === 'string') return { text: a, country: countryIn(a) };
      const countryRaw = ldText(a.addressCountry);
      const country = countryRaw.length === 2 ? countryIn(countryRaw.toUpperCase()) || countryRaw : countryIn(countryRaw) || countryRaw;
      const text = [a.addressLocality, a.addressRegion, countryRaw].map(ldText).filter(Boolean).join(', ');
      if (text) return { text, country };
    }
    const required = ldText([].concat(posting.applicantLocationRequirements || [])[0]);
    return required ? { text: required, country: countryIn(required) || required } : null;
  }

  // ---- DOM helpers --------------------------------------------------------------------

  // The first match for `selector` in the closest ancestor of `from` that has one — so on
  // a page listing several jobs (Workday's search + details split view) we read the
  // posting the Apply button belongs to, not the first one in the document.
  function nearest(from, selector) {
    for (let node = from; node && node !== document; node = node.parentElement) {
      const hit = node.querySelector?.(selector);
      if (hit) return hit;
    }
    return document.querySelector(selector);
  }

  const ROLE_SELECTORS = [
    '[data-automation-id="jobPostingHeader"]', // Workday job page
    '[data-automation-id="jobTitleHeading"]', // Workday application steps (/apply/…)
    '.posting-headline h2', // Lever
    '.app-title', // Greenhouse (classic)
    '.job__title h1', // Greenhouse (new boards)
    '[data-ui="job-title"]', // Workable
    '[data-testid="job-title"]',
    '.job-title, .jobTitle, .job-header h1, .job-details h1'
  ].join(', ');

  const LOCATION_SELECTORS = [
    '[data-automation-id="locations"]', // Workday
    '.posting-categories .location', // Lever
    '.job__location', // Greenhouse (new)
    '#header .location, .app-title ~ .location', // Greenhouse (classic)
    '[data-ui="job-location"]', // Workable
    '[data-testid="job-location"]',
    '.job-location, .jobLocation'
  ].join(', ');

  // Workday's location block is "<dt>locations</dt><dd>London United Kingdom</dd>".
  function locationText(el) {
    if (!el) return '';
    const dd = el.querySelector?.('dd');
    const text = clean(dd ? dd.textContent : el.textContent).replace(/^locations?\s*:?\s*/i, '');
    return /^\d+ locations?$/i.test(text) ? '' : text; // "2 Locations" says nothing
  }

  const DATE_PATTERN = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)? [A-Za-z]{3,9}\.?,? \d{2,4}|[A-Za-z]{3,9}\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4})`;
  const DEADLINE_RE = new RegExp(
    String.raw`(?:^|[^A-Za-z])(?:end date|closing date|close date|application deadline|deadline|apply by|applications? close[sd]?(?: on)?|closes(?: on)?|expiry date|expires(?: on)?)\s*[:\-–]?\s*` + DATE_PATTERN,
    'i'
  );

  const GENERIC_WORDS = /\b(careers home|job board|join us|search for jobs|careers?|jobs?|logo|opportunities|vacancies|recruiting|recruitment|talent|portal|workday|greenhouse|lever)\b/gi;
  const LEGAL_SUFFIX = /[,\s]+(private limited|pvt\.? ltd\.?|limited|ltd\.?|llc|llp|l\.p\.|lp|inc\.?|incorporated|plc|gmbh|ag|s\.a\.|sa|corp\.?|corporation|co\.)$/i;

  function cleanCompany(text) {
    let s = clean(text).replace(GENERIC_WORDS, ' ');
    s = clean(s)
      .replace(/^(?:at|with|@)\s+/i, '')
      .replace(/^[\s\-–—|:,]+|[\s\-–—|:,]+$/g, '')
      .replace(/^[A-Z]{0,4}\d+\s+/, ''); // Workday legal-entity codes: "12542 Citicorp …", "LE018 Brown Advisory LTD"
    for (let i = 0; i < 2; i++) s = s.replace(LEGAL_SUFFIX, '');
    return clean(s);
  }

  // "brownadvisory.wd1.myworkdayjobs.com" → "Brownadvisory", "jobs.lever.co/acme-capital"
  // → "Acme Capital". A weak guess — recorded in guessedFields so the panel says so.
  function companyFromUrl() {
    const host = location.hostname.toLowerCase();
    const firstPath = (location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
    let slug;
    if (/(^|\.)lever\.co$|(^|\.)greenhouse\.io$|(^|\.)smartrecruiters\.com$|(^|\.)ashbyhq\.com$|(^|\.)workable\.com$/.test(host)) {
      slug = firstPath;
    } else {
      const labels = host.replace(/^(www|careers?|jobs?|apply|recruiting|talent)\./, '').split('.');
      slug = /myworkdayjobs|workday|taleo|icims|successfactors|oraclecloud/.test(host) ? labels[0] : labels[labels.length - 2] || labels[0];
    }
    slug = (slug || '').replace(/[-_]+/g, ' ').replace(/\b(careers?|jobs?)\b/g, '').trim();
    return slug ? slug.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
  }

  // The firm's slug in the URL: "brownadvisory" for brownadvisory.wd1.myworkdayjobs.com,
  // "acmecapital" for boards.greenhouse.io/acmecapital. Used to pick, among candidate
  // company names, the one that's actually this firm.
  function siteSlug() {
    return norm(companyFromUrl());
  }

  // Workday puts the location in the URL: /job/London%2C-UK/Equity-Research_JR1822/apply
  function workdayUrlLocation() {
    if (!/myworkdayjobs\.com$/.test(location.hostname)) return '';
    const parts = location.pathname.split('/');
    const i = parts.indexOf('job');
    if (i === -1 || !parts[i + 2]) return '';
    try {
      return clean(decodeURIComponent(parts[i + 1]).replace(/-/g, ' ').replace(/\s+,/g, ','));
    } catch (_) {
      return '';
    }
  }

  function titleParts() {
    return document.title.split(/\s+[-|–—:]\s+/).map(clean).filter(Boolean);
  }

  // ---- The reader ---------------------------------------------------------------------

  function readJobPage(applyEl) {
    const from = applyEl || document.body;
    const guessed = [];

    // Role
    const roleEl = nearest(from, ROLE_SELECTORS);
    let role = clean(roleEl?.textContent);
    const postings = jsonLdPostings();
    const bodyText = clean(document.body?.textContent);
    // Stale-JSON-LD guard (see header comment): with a visible title, JSON-LD must match
    // it; without one, its title must at least appear on the page.
    const posting =
      postings.find((p) => role && norm(p.title) === norm(role)) ||
      (!role ? postings.find((p) => p.title && bodyText.includes(clean(p.title))) : null) ||
      null;
    if (!role && posting) role = clean(posting.title);
    if (!role) {
      const og = clean(document.querySelector('meta[property="og:title"]')?.content);
      const h1 = clean(document.querySelector('h1')?.textContent);
      role = og || h1 || titleParts()[0] || '';
      if (role) guessed.push('role');
    }

    // Company: gather every candidate, then prefer one matching the firm's URL slug.
    // Confirmed live (Brown Advisory, 2026-10-09): Workday's logo alt can be just
    // " search for jobs" and <title> can be empty, leaving only JSON-LD's
    // "LE018 Brown Advisory LTD" — which matches the "brownadvisory" slug once cleaned.
    let company = '';
    const greenhouse = /^job application for (.+) at (.+)$/i.exec(clean(document.title));
    if (greenhouse && !role) role = clean(greenhouse[1]);
    const logo = document.querySelector('[data-automation-id="logoLink"] img, [data-automation-id="logo"], header img[alt*="logo" i], img[alt*="careers" i][alt*="logo" i]');
    const candidates = [
      greenhouse && greenhouse[2],
      logo?.getAttribute('alt') || logo?.getAttribute('aria-label'),
      document.querySelector('meta[property="og:site_name"]')?.content,
      ...titleParts().filter((p) => norm(p) !== norm(role)),
      ...postings.map((p) => ldText(p.hiringOrganization)) // same on every page of the site, so a stale one is fine
    ]
      .map(cleanCompany)
      .filter((c) => c && c.length > 1);
    const slug = siteSlug();
    company =
      (slug.length >= 3 && candidates.find((c) => norm(c) === slug || norm(c).startsWith(slug) || slug.startsWith(norm(c)))) ||
      candidates[0] ||
      '';
    if (!company) {
      company = companyFromUrl();
      if (company) guessed.push('company');
    }

    // Location / region
    const ld = posting && ldLocation(posting);
    const locationLabel = locationText(nearest(from, LOCATION_SELECTORS)) || workdayUrlLocation() || ld?.text || '';
    let region = countryIn(locationLabel) || ld?.country || '';
    if (!region && !ld) {
      const m = /\blocations?\s*[:\n]\s*([^\n]{2,80})/i.exec(roleEl?.closest('main, article, section')?.innerText || '');
      if (m) region = countryIn(m[1]);
    }
    if (!region && locationLabel) region = locationLabel; // e.g. "New York, NY": still better than blank

    // Deadline
    let deadlineISO = toISODate(posting?.validThrough);
    let deadline = posting?.validThrough || '';
    if (!deadlineISO) {
      const scope = roleEl ? roleEl.closest('main, article, [role="main"]') || document.body : document.body;
      const m = DEADLINE_RE.exec(scope?.innerText || scope?.textContent || '');
      if (m) {
        deadline = m[1];
        deadlineISO = toISODate(m[1]);
      }
    }

    const data = {
      capturedAt: new Date().toISOString(),
      sourceUrl: window.location.href,
      sourceSite: 'Job page',
      sourceHost: window.location.hostname,
      company,
      role,
      industry: clean(posting?.industry && ldText(posting.industry)),
      region,
      location: locationLabel,
      deadline,
      deadlineISO,
      guessedFields: guessed
    };
    data.missingFields = ['company', 'role', 'industry', 'region'].filter((k) => !data[k]);
    // Whether this is recognizably a job posting / application rather than any page that
    // happens to have an <h1> — the side panel only auto-reads pages where this is true.
    data.looksLikeJob = !!(posting || (roleEl && role) || /myworkdayjobs\.com$|greenhouse\.io$|lever\.co$|smartrecruiters\.com$|ashbyhq\.com$|workable\.com$|icims\.com$|taleo\.net$|successfactors\.(com|eu)$|oraclecloud\.com$/.test(location.hostname));
    return data;
  }

  // ---- Merge with a tracker capture of the same application ---------------------------

  const hostOf = (url) => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  };
  const companyKey = (t) => norm(cleanCompany(t)).replace(/^the/, '');

  function isSameApplication(prev, page) {
    if (!prev || prev.sourceSite === 'Job page') return false;
    const age = Date.now() - Date.parse(prev.capturedAt);
    if (!(age >= 0 && age < MERGE_WINDOW_MS)) return false;
    if (prev.applyUrl && hostOf(prev.applyUrl) === page.sourceHost) return true;
    const a = companyKey(prev.company);
    if (a.length < 3) return false;
    const candidates = [companyKey(page.company), norm(page.sourceHost)];
    return candidates.some((b) => b.length >= 3 && (b.includes(a) || a.includes(b)));
  }

  // The tracker row was what Luca chose to apply to, and carries the sector/region
  // classification job pages don't have — so its non-blank fields win, and the job page
  // only fills what the tracker left blank (typically the deadline or region).
  function mergeWithTrackerCapture(prev, page) {
    const merged = { ...page };
    for (const [key, value] of Object.entries(prev)) {
      if (value !== '' && value != null && !(Array.isArray(value) && !value.length)) merged[key] = value;
    }
    merged.capturedAt = page.capturedAt;
    merged.sourceUrl = page.sourceUrl;
    merged.sourceHost = page.sourceHost;
    merged.mergedJobPage = true;
    merged.guessedFields = (page.guessedFields || []).filter((k) => !prev[k]);
    merged.missingFields = ['company', 'role', 'industry', 'region'].filter((k) => !merged[k]);
    return merged;
  }

  async function captureAndSave(applyEl, { onlyIfJob = false } = {}) {
    const page = readJobPage(applyEl);
    if (!page.role && !page.company) return null;
    if (onlyIfJob && !page.looksLikeJob) return null;
    let data = page;
    try {
      const { trackerLastCapturedContext: prev } = await chrome.storage.local.get('trackerLastCapturedContext');
      if (isSameApplication(prev, page)) data = mergeWithTrackerCapture(prev, page);
      await chrome.storage.local.set({ trackerLastCapturedContext: data });
      console.log('[BC] captured job page:', data);
    } catch (e) {
      // Same "extension context invalidated" case as tracker-reader.js — never surface it.
      console.warn('[BC] could not save the job page capture — try refreshing this tab (the extension may have reloaded since this page loaded)', e);
    }
    return data;
  }

  function findApplyControl(target) {
    const el = target?.closest?.('a, button, [role="button"], input[type="submit"], input[type="button"]');
    if (!el) return null;
    if (el.getAttribute('data-automation-id') === 'adventureButton') return el; // Workday's Apply
    const text = clean(el.tagName === 'INPUT' ? el.value : el.textContent);
    const aria = clean(el.getAttribute('aria-label'));
    return APPLY_TEXT.test(text) || APPLY_TEXT.test(aria) ? el : null;
  }

  // mousedown fires before the click navigates / opens Workday's "Start your application"
  // modal, while the posting is still on screen; click is the fallback for keyboard
  // activation. The same Apply press triggers both, so the second is skipped.
  let lastCapture = { el: null, at: 0 };
  function handleClick(event) {
    if (!isCurrent()) return;
    if (event.type === 'mousedown' && event.button !== 0 && event.button !== 1) return;
    try {
      const applyEl = findApplyControl(event.target);
      if (!applyEl) return;
      if (lastCapture.el === applyEl && Date.now() - lastCapture.at < 1500) return;
      lastCapture = { el: applyEl, at: Date.now() };
      captureAndSave(applyEl);
    } catch (e) {
      console.error('[BC] job-page-reader click handler threw — capture did not run for this click', e);
    }
  }

  document.addEventListener('mousedown', handleClick, true);
  document.addEventListener('click', handleClick, true);

  // The side panel's "Read this page" button: same capture, without needing an Apply click.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'WSO_READ_JOB_PAGE' || !isCurrent()) return false;
    captureAndSave(null, { onlyIfJob: !!message.auto }).then((data) => sendResponse({ ok: !!data, data }));
    return true;
  });

  // Exposed for testing only (isolated world — the page itself can't see this).
  window.WSO_JobPageReader = { readJobPage, isSameApplication, mergeWithTrackerCapture, findApplyControl, countryIn, cleanCompany };
})();
