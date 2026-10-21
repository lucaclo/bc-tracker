// LinkedIn adapter for content/contact-reader.js: people search results
// (/search/results/people/), school alumni pages (/school/<slug>/people/ or /alumni/) and
// company people pages (/company/<slug>/people/).
//
// Verified live 2026-10-21 on /search/results/people/ and /school/durham-university/alumni/.
// LinkedIn's class names are build hashes ("kfelqk"), so this matches structure instead: each
// person is a [role="listitem"] holding an /in/<slug> link. Inside it, the lines are
// name, "· 2nd" badge, headline ("Analyst at X", "Associate | X | Y"), location, and on
// search results an optional "Current: <title> at <company>" summary, which is preferred
// over the free-text headline.
(function () {
  const PAGES = /^https:\/\/([a-z]+\.)?linkedin\.com\/(search\/results\/people|school\/[^/]+\/(people|alumni)|company\/[^/]+\/people)/i;

  function profileUrl(item) {
    const a = item.querySelector('a[href*="/in/"]');
    if (!a) return '';
    try {
      const u = new URL(a.getAttribute('href'), location.href);
      return `https://www.linkedin.com${u.pathname.replace(/\/?$/, '/')}`;
    } catch (_) {
      return '';
    }
  }

  function read(doc) {
    const R = window.BC_ContactReader;
    const items = [...doc.querySelectorAll('[role="listitem"]')].filter((li) =>
      li.querySelector('a[href*="/in/"]') && !li.parentElement.closest('[role="listitem"]'));
    return items.map((item) => {
      const lines = R.textLines(item)
        .map((l) => l.replace(/\s*,?\s*\(?(he|she|they)\/(him|her|them)\)?$/i, ''))
        .filter((l) => !/^(·|•)?\s*(1st|2nd|3rd\+?)$/i.test(l) && !/^(connect|message|follow|pending)$/i.test(l));
      const name = lines.find((l) => R.isNameLike(l)) || '';
      const rest = lines.filter((l) => l !== name);
      const current = rest.find((l) => /^current:/i.test(l));
      const headline = rest.find((l) => !/^(current|past|summary):/i.test(l)) || '';
      const location = rest.find((l) => l !== headline && !/:/.test(l) && !/connections?$/i.test(l)) || '';

      let title = headline;
      let company = '';
      let confidence = 'medium';
      const fromCurrent = current && R.splitTitleCompany(current.replace(/^current:\s*/i, ''));
      if (fromCurrent && fromCurrent.how === 'at') {
        ({ title, company } = fromCurrent);
        confidence = 'high';
      } else {
        // Headlines are free text: "Analyst at X" is clear, "Associate | X | Y" is a best guess.
        const split = R.splitTitleCompany(headline);
        if (split) {
          title = split.title;
          company = split.company.split(/\s+[|·•]\s+/)[0];
          confidence = split.how === 'at' ? 'high' : 'medium';
        }
      }
      return { name, title, company, location, linkedinUrl: profileUrl(item), profileUrl: '', email: '', confidence };
    });
  }

  const adapter = { name: 'linkedin', match: (url) => PAGES.test(url), read };
  // The reader may load after this file (registerAdapter) or before it (the shared list).
  if (window.BC_ContactReader) window.BC_ContactReader.registerAdapter(adapter);
  else {
    window.BC_CONTACT_ADAPTERS = window.BC_CONTACT_ADAPTERS || [];
    window.BC_CONTACT_ADAPTERS = window.BC_CONTACT_ADAPTERS.filter((a) => a.name !== adapter.name).concat(adapter);
  }
})();
