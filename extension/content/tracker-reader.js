// Reads an internship-application tracker table by HEADER TEXT (not fixed CSS
// selectors/classes), so it keeps working even if the site restyles its page. It never
// logs in, never writes to the tracker site, and only reads what's already rendered on
// screen while you're browsing your own logged-in tracker.
//
// Supports multiple tracker sites via SITE_CONFIGS below — each site gets its own
// header-name synonyms (real tables vary in wording: "Firm" vs "Company Name", etc) and
// its own required-columns check. Add a new site by adding a config here plus its match
// pattern in manifest.json; everything else (row reading, click capture, storage) is shared.

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
        'program name': 'role',
        industry: 'industry',
        region: 'region',
        'group / division / type': 'groupDivision',
        'group/division/type': 'groupDivision',
        'role type': 'roleType',
        opening: 'opening',
        closing: 'deadline',
        'current status': 'currentStatus'
      }
    },
    {
      name: 'Trackr',
      hostTest: () => /the-trackr\.com$/.test(location.hostname),
      // Trackr's crowd-sourced recruiting trackers are organized per firm and don't
      // always have a distinct "role/program" column, so only require company — anything
      // else recognized just gets added on top. Confirmed live (2026-09) against
      // app.the-trackr.com/uk-finance/summer-internships — real headers are "Company
      // Name", "Programme Name", "Opening Date", "Closing Date" (the two-word "Name"/
      // "Date" forms specifically didn't match the original single-word guesses).
      requiredKeys: ['company'],
      // Trackr groups a company's multiple programmes into an expandable accordion (e.g.
      // Citi, Deutsche Bank, J.P. Morgan) — the company name is shown once on the
      // collapsed parent row, and an expanded sub-row's own "Company Name" cell is blank.
      // Since that sub-row's off-site link is exactly what a real "Apply" click lands on,
      // these keys are inherited from the nearest preceding row that has a value, rather
      // than captured as blank — see findInheritedValue below.
      inheritableKeys: ['company'],
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

  function normalizeHeader(text) {
    return (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function buildHeaderIndex(table) {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow) return null;
    const cells = Array.from(headerRow.querySelectorAll('th, td'));
    const index = {};
    cells.forEach((cell, i) => {
      const key = activeConfig.headerMap[normalizeHeader(cell.textContent)];
      if (key && index[key] === undefined) index[key] = i;
    });
    const hasRequired = activeConfig.requiredKeys.every((k) => index[k] !== undefined);
    return hasRequired ? index : null;
  }

  function findTrackerTables() {
    return Array.from(document.querySelectorAll('table')).filter((t) => buildHeaderIndex(t));
  }

  // Walks backward through the table's rows (in document order) from tr, looking for the
  // nearest preceding row whose OWN cell at this column index is non-empty. Handles
  // "accordion" tables where an expanded sub-row leaves an inheritable column (e.g.
  // company name) blank because it's only shown once, on the collapsed parent row.
  function findInheritedValue(table, tr, idx) {
    const allRows = Array.from(table.querySelectorAll('tr'));
    const trIdx = allRows.indexOf(tr);
    if (trIdx === -1) return '';
    for (let i = trIdx - 1; i >= 0; i--) {
      const cells = Array.from(allRows[i].querySelectorAll('td'));
      const text = (cells[idx]?.textContent || '').trim();
      if (text) return text;
    }
    return '';
  }

  function readRow(table, headerIndex, tr) {
    const cells = Array.from(tr.querySelectorAll('td'));
    const data = { capturedAt: new Date().toISOString(), sourceUrl: location.href, sourceSite: activeConfig.name };
    const inheritable = activeConfig.inheritableKeys || [];
    for (const [key, idx] of Object.entries(headerIndex)) {
      let value = (cells[idx]?.textContent || '').trim();
      if (!value && inheritable.includes(key)) {
        value = findInheritedValue(table, tr, idx);
      }
      data[key] = value;
    }
    return data;
  }

  function looksLikeCaptureControl(el) {
    const text = (el.textContent || '').trim().toLowerCase();
    if (CAPTURE_TEXT.test(text)) return true;
    const aria = (el.getAttribute?.('aria-label') || '').trim().toLowerCase();
    if (CAPTURE_TEXT.test(aria)) return true;
    // Generic fallback for sites without an obvious "Apply" label: a link inside the row
    // pointing off-site is very likely the thing that leads to the actual application.
    if (el.tagName === 'A' && el.href) {
      try {
        const linkHost = new URL(el.href, location.href).hostname;
        if (linkHost && linkHost !== location.hostname) return true;
      } catch (_) {
        /* malformed href — ignore */
      }
    }
    return false;
  }

  function saveCapturedContext(data) {
    console.log('[BC] captured tracker row:', data);
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
      const tables = findTrackerTables();
      for (const table of tables) {
        if (!table.contains(event.target)) continue;
        const headerIndex = buildHeaderIndex(table);
        if (!headerIndex) continue;

        const tr = event.target.closest('tr');
        if (!tr || !table.contains(tr)) continue;

        // Find the clicked control (or an ancestor within the row) that looks like it
        // leads to the actual application.
        let node = event.target;
        let isCapture = false;
        while (node && node !== tr) {
          if (looksLikeCaptureControl(node)) {
            isCapture = true;
            break;
          }
          node = node.parentElement;
        }
        if (!isCapture) continue;

        const rowData = readRow(table, headerIndex, tr);
        saveCapturedContext(rowData);
        // Do not preventDefault — let the site's own click behavior (new tab / navigation)
        // proceed.
      }
    } catch (e) {
      console.error('[BC] tracker-reader click handler threw — capture did not run for this click', e);
    }
  }

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
