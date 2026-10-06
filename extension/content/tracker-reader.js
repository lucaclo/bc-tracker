// Reads an internship-application tracker table by HEADER TEXT (not fixed CSS
// selectors/classes), so it keeps working even if the site restyles its page. It never
// logs in, never writes to the tracker site, and only reads what's already rendered on
// screen while you're browsing your own logged-in tracker.
//
// Supports multiple tracker sites via SITE_CONFIGS below — each site gets its own
// header-name synonyms (real tables vary in wording: "Firm" vs "Company Name", etc) and
// its own required-columns check. Add a new site by adding a config here plus its match
// pattern in manifest.json; everything else (row reading, click capture, storage) is shared.
//
// Not every field lives in a column. Confirmed live on Trackr (2026-10): its tables have
// NO industry/sector or region column at all —
//   - sector is a full-width section-heading row ("Bulge Bracket", "Elite Boutique",
//     "Asset Management", …) above each group of rows, and
//   - region is the tracker itself ("UK Finance Tracker", /uk-finance/…, /hong-kong-finance/…).
// So after reading columns, readRow() fills any still-blank industry/region from those
// page-level sources (see sectionHeadingFor / trackerContext), and records in
// `missingFields` whatever it still couldn't find so the side panel can say so instead
// of silently leaving a blank.

(function () {
  const SITE_CONFIGS = [
    {
      name: 'WSO Tracker',
      hostTest: () => /wallstreetoasis\.com$/.test(location.hostname),
      // Requires both company + role — WSO's tracker always has a distinct
      // "Program Name" column, so this is a reliable "is this the right table" check.
      requiredKeys: ['company', 'role'],
      headerMap: {
        'company name': 'company',
        company: 'company',
        firm: 'company',
        'program name': 'role',
        'programme name': 'role',
        program: 'role',
        industry: 'industry',
        sector: 'industry',
        region: 'region',
        location: 'region',
        'group / division / type': 'groupDivision',
        'group/division/type': 'groupDivision',
        'role type': 'roleType',
        opening: 'opening',
        closing: 'deadline',
        deadline: 'deadline',
        'current status': 'currentStatus'
      }
    },
    {
      name: 'Trackr',
      hostTest: () => /the-trackr\.com$/.test(location.hostname),
      // Trackr's crowd-sourced recruiting trackers are organized per firm and don't
      // always have a distinct "role/program" column, so only require company — anything
      // else recognized just gets added on top. Real headers (confirmed live): "My Status",
      // "Company Name", "Programme Name", "Opening Date", "Closing Date", "Latest Stage",
      // "Last Year Opening", "Process", "Info & Test Prep", "Rolling", "Materials",
      // "Sponsors Visa", "Notes".
      requiredKeys: ['company'],
      // Trackr groups a company's multiple programmes into an expandable accordion (e.g.
      // Citi, Deutsche Bank, J.P. Morgan) — the company name is shown once on the
      // collapsed parent row, and an expanded sub-row's own "Company Name" cell is blank.
      // Since that sub-row's off-site link is exactly what a real "Apply" click lands on,
      // these keys are inherited from the nearest preceding row that has a value, rather
      // than captured as blank — see findInheritedValue below.
      inheritableKeys: ['company'],
      // Off-site links in other columns (e.g. "Info & Test Prep" → jobtestprep.co.uk) are
      // NOT applications; only an off-site link in these columns counts as "Apply".
      applyLinkColumns: ['role'],
      // Section headings that group rows by placement rather than by sector.
      nonSectorSections: ['promoted', 'featured', 'sponsored', 'miscellaneous', 'other'],
      headerMap: {
        firm: 'company',
        'firm name': 'company',
        company: 'company',
        'company name': 'company',
        employer: 'company',
        division: 'groupDivision',
        group: 'groupDivision',
        team: 'groupDivision',
        desk: 'groupDivision',
        sector: 'industry',
        industry: 'industry',
        program: 'role',
        programme: 'role',
        'program name': 'role',
        'programme name': 'role',
        position: 'role',
        role: 'role',
        'role type': 'roleType',
        location: 'region',
        region: 'region',
        office: 'region',
        country: 'region',
        status: 'currentStatus',
        'application status': 'currentStatus',
        'recruiting status': 'currentStatus',
        deadline: 'deadline',
        'application deadline': 'deadline',
        'due date': 'deadline',
        'closing date': 'deadline',
        closing: 'deadline',
        'posted date': 'opening',
        posted: 'opening',
        opens: 'opening',
        'open date': 'opening',
        'opening date': 'opening',
        opening: 'opening'
      }
    }
  ];

  const activeConfig = SITE_CONFIGS.find((c) => c.hostTest());
  if (!activeConfig) return;

  console.log(`[BC] tracker-reader active on ${location.hostname} using "${activeConfig.name}" config`);

  const CAPTURE_TEXT = /^(apply|apply now|apply here|view|view job|view posting|application|application link|link|go to application|details)$/;

  // Known tracker-name prefixes → region label. Longest first so "hong-kong" beats "h…".
  // Anything not listed still works via the heading parse in trackerContext().
  const REGION_PREFIXES = [
    ['hong-kong', 'Hong Kong'],
    ['hk', 'Hong Kong'],
    ['uk', 'UK'],
    ['us', 'US'],
    ['usa', 'US'],
    ['eu', 'Europe'],
    ['europe', 'Europe'],
    ['france', 'France'],
    ['germany', 'Germany'],
    ['ireland', 'Ireland'],
    ['singapore', 'Singapore'],
    ['canada', 'Canada'],
    ['australia', 'Australia'],
    ['india', 'India'],
    ['switzerland', 'Switzerland'],
    ['netherlands', 'Netherlands'],
    ['dubai', 'Dubai'],
    ['uae', 'UAE'],
    ['japan', 'Japan'],
    ['asia', 'Asia']
  ].sort((a, b) => b[0].length - a[0].length);

  function normalizeHeader(text) {
    return (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function titleCase(text) {
    return text.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // A cell's visible text without decorations: Trackr appends a count badge to grouped
  // rows ("Summer Analyst 2027" + a "9" pill), which plain textContent glues onto the
  // role as "Summer Analyst 2027 9".
  function cellText(cell) {
    if (!cell) return '';
    const clone = cell.cloneNode(true);
    clone
      .querySelectorAll('.select-none, [aria-hidden="true"], .sr-only, .visually-hidden, svg, i')
      .forEach((el) => el.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function buildHeaderIndex(table) {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow) return null;
    const cells = Array.from(headerRow.querySelectorAll('th, td'));
    const index = {};
    cells.forEach((cell, i) => {
      const key = activeConfig.headerMap[normalizeHeader(cellText(cell))];
      if (key && index[key] === undefined) index[key] = i;
    });
    const hasRequired = activeConfig.requiredKeys.every((k) => index[k] !== undefined);
    return hasRequired ? index : null;
  }

  function findTrackerTables() {
    return Array.from(document.querySelectorAll('table')).filter((t) => buildHeaderIndex(t));
  }

  // A full-width row with a single cell (Trackr renders them as <td colspan="100">) that
  // labels the group of rows beneath it.
  function sectionHeadingText(tr) {
    const cells = tr.querySelectorAll('td, th');
    if (cells.length !== 1 || cells[0].colSpan < 2) return '';
    return cellText(cells[0]);
  }

  function isSectorSection(label) {
    if (!label) return false;
    return !(activeConfig.nonSectorSections || []).includes(label.trim().toLowerCase());
  }

  // Nearest section heading above tr, or '' if the table has none.
  function sectionHeadingFor(table, tr) {
    const allRows = Array.from(table.querySelectorAll('tr'));
    for (let i = allRows.indexOf(tr) - 1; i >= 0; i--) {
      const label = sectionHeadingText(allRows[i]);
      if (label) return label;
    }
    return '';
  }

  // A "Promoted" row is the same firm pulled to the top; its real sector is wherever that
  // firm also appears further down. Returns '' if it doesn't appear anywhere else.
  function sectorForCompanyElsewhere(table, headerIndex, company) {
    if (!company || headerIndex.company === undefined) return '';
    const target = company.toLowerCase();
    let current = '';
    for (const row of table.querySelectorAll('tr')) {
      const heading = sectionHeadingText(row);
      if (heading) {
        current = heading;
        continue;
      }
      const name = cellText(row.querySelectorAll('td')[headerIndex.company]).toLowerCase();
      if (name === target && isSectorSection(current)) return current;
    }
    return '';
  }

  // Region + broad sector of the tracker page as a whole, e.g. "UK Finance Tracker" →
  // { region: 'UK', sector: 'Finance' }. Tries the page heading, then the URL slug, then
  // the document title.
  function trackerContext() {
    const parse = (label) => {
      const words = label
        .replace(/[-–—|].*$/, '') // "UK Finance - Trackr" → "UK Finance"
        .replace(/\btrackr?\b|\btracker\b/gi, '')
        .replace(/\b20\d\d\b/g, '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (words.length < 2) return null;
      return { region: words.slice(0, -1).join(' '), sector: words[words.length - 1] };
    };

    const heading = Array.from(document.querySelectorAll('h1, h2'))
      .map((h) => cellText(h))
      .find((t) => /tracker\b/i.test(t));
    const fromHeading = heading && parse(heading);
    if (fromHeading) return fromHeading;

    const slug = (location.pathname.split('/')[1] || '').toLowerCase().replace(/-?20\d\d$/, '');
    for (const [prefix, region] of REGION_PREFIXES) {
      if (slug === prefix || slug.startsWith(`${prefix}-`)) {
        const sector = slug.slice(prefix.length + 1).replace(/-/g, ' ');
        return { region, sector: sector ? titleCase(sector) : '' };
      }
    }

    return parse(document.title) || { region: '', sector: '' };
  }

  // Walks backward through the table's rows (in document order) from tr, looking for the
  // nearest preceding row whose OWN cell at this column index is non-empty. Handles
  // "accordion" tables where an expanded sub-row leaves an inheritable column (e.g.
  // company name) blank because it's only shown once, on the collapsed parent row.
  // Stops at a section heading: a value never leaks in from a different section.
  function findInheritedValue(table, tr, idx) {
    const allRows = Array.from(table.querySelectorAll('tr'));
    const trIdx = allRows.indexOf(tr);
    if (trIdx === -1) return '';
    for (let i = trIdx - 1; i >= 0; i--) {
      if (sectionHeadingText(allRows[i])) return '';
      const text = cellText(allRows[i].querySelectorAll('td')[idx]);
      if (text) return text;
    }
    return '';
  }

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const monthIndex = (word) => MONTHS[word.slice(0, 4)] ?? MONTHS[word.slice(0, 3)];

  // Tracker dates → YYYY-MM-DD in LOCAL time. Handles Trackr's "31 Jan 27", WSO's
  // "Aug 07" (no year: the next occurrence from today), and ISO / "31/01/2027" (UK
  // day-first). Returns '' if unparseable rather than guessing.
  function toISODate(text) {
    const s = (text || '').trim().toLowerCase().replace(/,/g, '');
    if (!s) return '';
    const pad = (n) => String(n).padStart(2, '0');
    const out = (y, m, d) => {
      const date = new Date(y, m, d);
      if (date.getMonth() !== m || date.getDate() !== d) return '';
      return `${date.getFullYear()}-${pad(m + 1)}-${pad(d)}`;
    };
    const fullYear = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));
    let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return out(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(s))) return out(fullYear(m[3]), Number(m[2]) - 1, Number(m[1]));
    if ((m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})\.? (\d{2,4})$/.exec(s))) {
      const mon = monthIndex(m[2]);
      return mon === undefined ? '' : out(fullYear(m[3]), mon, Number(m[1]));
    }
    if ((m = /^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{2,4}))?$/.exec(s))) {
      const mon = monthIndex(m[1]);
      if (mon === undefined) return '';
      if (m[3]) return out(fullYear(m[3]), mon, Number(m[2]));
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let year = today.getFullYear();
      if (new Date(year, mon, Number(m[2])) < today) year += 1;
      return out(year, mon, Number(m[2]));
    }
    return '';
  }

  function readRow(table, headerIndex, tr) {
    const cells = Array.from(tr.querySelectorAll('td'));
    const data = { capturedAt: new Date().toISOString(), sourceUrl: location.href, sourceSite: activeConfig.name };
    const inheritable = activeConfig.inheritableKeys || [];
    for (const [key, idx] of Object.entries(headerIndex)) {
      let value = cellText(cells[idx]);
      if (!value && inheritable.includes(key)) {
        value = findInheritedValue(table, tr, idx);
      }
      data[key] = value;
    }

    // Page-level fallbacks for fields this site doesn't have as columns.
    const context = trackerContext();
    if (!data.industry) {
      const section = sectionHeadingFor(table, tr);
      data.section = section;
      data.industry = isSectorSection(section)
        ? section
        : sectorForCompanyElsewhere(table, headerIndex, data.company) || context.sector || '';
    }
    if (!data.region) data.region = context.region || '';

    if (data.deadline) data.deadlineISO = toISODate(data.deadline);
    if (data.opening) data.openingISO = toISODate(data.opening);

    data.missingFields = ['company', 'role', 'industry', 'region'].filter((k) => !data[k]);
    return data;
  }

  // The <td> index of el within its row, or -1.
  function columnIndexOf(el, tr) {
    const td = el.closest('td');
    if (!td || td.closest('tr') !== tr) return -1;
    return Array.from(tr.querySelectorAll('td')).indexOf(td);
  }

  function looksLikeCaptureControl(el, tr, headerIndex) {
    const text = (el.textContent || '').trim().toLowerCase();
    if (CAPTURE_TEXT.test(text)) return true;
    const aria = (el.getAttribute?.('aria-label') || '').trim().toLowerCase();
    if (CAPTURE_TEXT.test(aria)) return true;
    // Generic fallback for sites without an obvious "Apply" label: a link inside the row
    // pointing off-site is very likely the thing that leads to the actual application —
    // unless the site config limits that to specific columns (Trackr's test-prep column
    // also links off-site).
    if (el.tagName === 'A' && el.href) {
      try {
        const linkHost = new URL(el.href, location.href).hostname;
        if (!linkHost || linkHost === location.hostname) return false;
        const allowed = activeConfig.applyLinkColumns;
        if (!allowed) return true;
        const col = columnIndexOf(el, tr);
        return allowed.some((key) => headerIndex[key] === col);
      } catch (_) {
        /* malformed href — ignore */
      }
    }
    return false;
  }

  // Returns the captured row for a click target, or null if it isn't an Apply control in
  // a tracker table. Pure: reads the DOM, writes nothing.
  function captureFromTarget(target) {
    for (const table of findTrackerTables()) {
      if (!table.contains(target)) continue;
      const headerIndex = buildHeaderIndex(table);
      if (!headerIndex) continue;

      const tr = target.closest('tr');
      if (!tr || !table.contains(tr)) continue;

      // Find the clicked control (or an ancestor within the row) that looks like it
      // leads to the actual application.
      let node = target;
      while (node && node !== tr) {
        if (looksLikeCaptureControl(node, tr, headerIndex)) return readRow(table, headerIndex, tr);
        node = node.parentElement;
      }
    }
    return null;
  }

  function saveCapturedContext(data) {
    console.log('[BC] captured tracker row:', data);
    if (data.missingFields.length) {
      console.warn(`[BC] captured row is missing: ${data.missingFields.join(', ')}`);
    }
    try {
      chrome.storage.local.set({ trackerLastCapturedContext: data });
    } catch (e) {
      // Most likely "Extension context invalidated" — the extension was reloaded
      // (chrome://extensions) while this tab's content script was already injected, so
      // its connection to the extension is dead until the tab itself is refreshed. Not a
      // logic bug, but it must never surface as an uncaught error on a real click.
      console.warn('[BC] could not save the captured row — try refreshing this tab (the extension may have reloaded since this page loaded)', e);
    }
  }

  // Shared by both trigger events below. Never throws outward — an exception here must
  // never surface as an uncaught error on a real click, and must never go silently
  // unlogged either (the whole point of this diagnostic wrapper is so a failure is always
  // visible in the console instead of just "nothing happened").
  function handlePossibleCaptureClick(event) {
    // Left or middle button only — a right-click (just opening the context menu) must not
    // overwrite the last captured row.
    if (event.button !== 0 && event.button !== 1) return;
    try {
      const rowData = captureFromTarget(event.target);
      // Do not preventDefault — let the site's own click behavior (new tab / navigation)
      // proceed.
      if (rowData) saveCapturedContext(rowData);
    } catch (e) {
      console.error('[BC] tracker-reader click handler threw — capture did not run for this click', e);
    }
  }

  // Exposed for testing only (content scripts run in an isolated world, so the page
  // itself can't see this). Has no side effects.
  window.WSO_TrackerReader = { captureFromTarget, toISODate, trackerContext };

  // Two triggers, not one: 'mousedown' fires strictly before 'click' (and before any
  // browser default action, e.g. opening a target="_blank" link's new tab), so listening
  // there too catches the row's data slightly earlier — cheap insurance against any timing
  // where the page's own click handling (React re-rendering the row, a navigation, etc)
  // could otherwise interfere before our own 'click' listener gets to run. Both listeners
  // call the exact same logic; whichever fires first wins; a duplicate second call is
  // harmless (just re-saves the same data).
  document.addEventListener('mousedown', handlePossibleCaptureClick, true);
  document.addEventListener('click', handlePossibleCaptureClick, true);
})();
