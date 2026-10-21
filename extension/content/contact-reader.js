// Reads people off the page you're looking at (an alumni directory, a society members list,
// LinkedIn search results, a WSO company page…) without any site-specific code. Injected on
// demand by the side panel's "Capture contacts" button, never on every page.
//
// It only READS: it never clicks, scrolls, opens profiles or changes the page. Results go
// back to the side panel for the user to review before anything is saved.
//
// How the generic reader finds people:
//   1. Look for repeated "cards": at least 3 sibling elements with the same tag + class
//      signature (list items, grid tiles, table rows).
//   2. Keep groups whose cards mostly look like people: a name-like line plus at least one
//      more line of text. Navigation menus, footers and headers are skipped outright.
//   3. From each card take the name (heading / profile link / class hint / first name-like
//      line), the profile link, and title + company from "Title at Company",
//      "Title · Company", "Title | Company", "Title, Company" or separate lines.
//   4. Every result carries a confidence. No clear name or no company → "low" with the
//      reason, so the side panel shows it unticked. Flag, don't guess.
//
// Site adapters (lib/contactAdapters/*) register with registerAdapter({ name, match(url),
// read(document) }). A matching adapter goes first; if it finds nobody, the generic reader runs.

(function () {
  // Newest copy wins (see job-page-reader.js): after an extension reload the old copy's
  // globals linger in the tab, so a fresh injection must take over rather than bow out.
  const token = {};
  window.__BC_CONTACT_READER_TOKEN = token;
  const isCurrent = () => window.__BC_CONTACT_READER_TOKEN === token;
  const CM = window.BC_CompanyMatch;

  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();

  // ---- Adapters -----------------------------------------------------------------------

  // Shared with the adapter files, which may load before or after this one.
  window.BC_CONTACT_ADAPTERS = window.BC_CONTACT_ADAPTERS || [];
  function registerAdapter(adapter) {
    const list = window.BC_CONTACT_ADAPTERS;
    const i = list.findIndex((a) => a.name === adapter.name);
    if (i === -1) list.push(adapter);
    else list[i] = adapter; // a re-injected copy replaces the old one
  }

  // ---- Text helpers -------------------------------------------------------------------

  const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'DD', 'DT',
    'ARTICLE', 'SECTION', 'HEADER', 'FOOTER', 'UL', 'OL', 'TR', 'TABLE', 'FIGCAPTION', 'BLOCKQUOTE', 'ADDRESS']);
  const SEP = '\u0001';
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'BUTTON', 'SELECT', 'TEXTAREA', 'INPUT']);

  // Words on buttons and badges inside cards, never part of a person's details.
  const NOISE_LINE = /^(message|connect|follow|following|pending|view( full)? profile|view|more|see more|send (a )?message|save|share|invite|•|·|\||-|\d+(st|nd|rd|th)\+?|1st|2nd|3rd\+?|degree connection|mutual connections?|status is (online|offline|reachable))$/i;

  // Screen-reader-only text ("View Jane's profile") is skipped. aria-hidden is NOT: LinkedIn
  // shows the visible name inside aria-hidden and repeats it for screen readers.
  function isHidden(el) {
    return el.hidden || /visually-hidden|sr-only|screen-reader/i.test(typeof el.className === 'string' ? el.className : '');
  }

  // A card's visible text as separate lines, split at block elements and <br>. Our own
  // walker (not innerText) so it behaves the same in the browser and in jsdom tests.
  function textLines(root) {
    const lines = [];
    let current = '';
    const push = (text) => {
      // A trailing connection-degree badge ("Jane Doe • 2nd") isn't part of the name.
      const t = clean(text).replace(/\s*[•·]\s*(1st|2nd|3rd\+?)$/i, '');
      if (t && !NOISE_LINE.test(t.replace(/^[•·|\s-]+/, ''))) lines.push(t);
    };
    // Inline elements are marked with SEP. Text that touches across a mark with no space
    // ("Kate Nguyen" + "• 2nd" in two spans) was laid out apart, so it becomes two lines.
    const flush = () => {
      let line = '';
      for (const part of current.split(SEP)) {
        if (!line.trim() || !part || /\s$/.test(line) || /^\s/.test(part)) line += part;
        else { push(line); line = part; }
      }
      push(line);
      current = '';
    };
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) current += child.nodeValue;
        else if (child.nodeType === 1) {
          if (SKIP_TAGS.has(child.tagName) || isHidden(child)) continue;
          if (child.tagName === 'BR') { flush(); continue; }
          const block = BLOCK_TAGS.has(child.tagName);
          if (block) flush(); else current += SEP;
          walk(child);
          if (block) flush(); else current += SEP;
        }
      }
    };
    walk(root);
    flush();
    return lines.filter((l, i) => lines.indexOf(l) === i);
  }

  // UI words that come in pairs of capitalised words ("About Us", "Sign In") and so look
  // like names to a pattern alone.
  const NOT_A_NAME = /\b(about|contact|home|privacy|policy|terms|sign|log|login|logout|register|more|view|all|see|our|us|news|events?|jobs?|careers?|people|help|settings|profile|message|connect|follow|search|menu|page|next|previous|back|read|learn|show|load|cookie|cookies|account|members?|directory|alumni|group|groups|company|companies|filters?|results?|network|notifications?|premium|messaging|services?|products?|solutions?|team|teams|blog|press|investors?|support|faq|language|english|united|kingdom|states|london|new york|hong kong)\b/i;

  // "Jane Doe", "Mary-Kate O'Neill", "J. R. Smith", "Siobhán Ní Bhriain", "Jane DOE".
  function isNameLike(text) {
    const t = clean(text).replace(/\s*,?\s*\(?(he|she|they)\/(him|her|them)\)?$/i, '');
    if (t.length < 4 || t.length > 60 || /\d|@|https?:|[|·•:;!?]/.test(t)) return false;
    const words = t.split(' ');
    if (words.length < 2 || words.length > 5) return false;
    const particle = /^(de|da|del|della|di|du|la|le|van|von|der|den|ter|bin|al|el|ní|ni|nic|mac|st\.?)$/i;
    const word = /^(\p{Lu}[\p{L}'’-]*\.?|\p{Lu}\.)$/u;
    if (!words.every((w) => word.test(w) || particle.test(w))) return false;
    // "Goldman Sachs", "Summer Analyst" and "Brown Capital Partners" are capitalised pairs too.
    return !NOT_A_NAME.test(t) && !TITLE_WORDS.test(t) && !CORPORATE.test(t) && !(CM && CM.isKnownAlias(t));
  }
  const stripPronouns = (t) => clean(t).replace(/\s*,?\s*\(?(he|she|they)\/(him|her|them)\)?$/i, '');

  const TITLE_WORDS = /\b(analyst|associate|vp|vice president|director|managing director|md|manager|intern|internship|summer|partner|principal|engineer|developer|student|undergraduate|graduate|president|chair|officer|head|lead|consultant|banker|trader|founder|co-founder|ceo|cfo|coo|cto|cio|chief|executive|specialist|advisor|adviser|researcher|economist|strategist|recruiter|lawyer|solicitor|barrister|investor|portfolio|fellow|professor|lecturer|teacher|secretary|treasurer|member|candidate|apprentice|trainee|controller|accountant|actuary|underwriter|sales|trading)\b/i;
  const CORPORATE = /\b(capital|partners|bank|banking|group|advisors|advisory|management|holdings|securities|investments?|ventures|equity|fund|funds|asset|assets|markets|financial|finance|consulting|llp|ltd|limited|plc|inc|llc|corp|co|company|university|college|school|society|association|foundation|trust|club)\b/i;
  const LOCATION_LINE = /(\b(area|greater|metropolitan|region)\b|^[\p{Lu}][\p{L} .'-]+,\s*[\p{Lu}][\p{L} .'-]+$|\b(united kingdom|england|scotland|wales|ireland|united states|usa|hong kong|singapore|london|new york|paris|frankfurt|dubai|zurich|geneva|madrid|milan|amsterdam|sydney|tokyo|shanghai|beijing)\b)/iu;

  // "Analyst at Goldman Sachs", "Analyst · Goldman Sachs", "Analyst | Goldman Sachs",
  // "Analyst - Goldman Sachs". Returns null when there's no explicit separator.
  function splitTitleCompany(line) {
    let m = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(line);
    if (m) return { title: clean(m[1]), company: clean(m[2]), how: 'at' };
    m = /^(.+?)\s+[·|•–—]\s+(.+)$/.exec(line) || /^(.+?)\s+-\s+(.+)$/.exec(line);
    if (m) return { title: clean(m[1]), company: clean(m[2]), how: 'separator' };
    return null;
  }

  // ---- Reading one card ---------------------------------------------------------------

  const HINT = (el, word) => {
    const attrs = `${el.className || ''} ${el.getAttribute('data-testid') || ''} ${el.getAttribute('itemprop') || ''} ${el.getAttribute('aria-label') || ''}`;
    return new RegExp(`(^|[^a-z])${word}`, 'i').test(attrs);
  };
  const visibleText = (el) => textLines(el).join(' ');
  const hinted = (card, word) => [...card.querySelectorAll('*')].find((el) => HINT(el, word) && visibleText(el));

  function absoluteUrl(href) {
    try {
      const u = new URL(href, location.href);
      return /^https?:$/.test(u.protocol) ? u.href : '';
    } catch (_) {
      return '';
    }
  }

  function readCard(card) {
    const lines = textLines(card);
    const flags = [];
    const anchors = [...card.querySelectorAll('a[href]')];

    // Name: a heading, a link whose text is a name, a "name" class hint, then any name-like line.
    const candidates = [
      ...[...card.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b')].map(visibleText),
      ...anchors.map(visibleText),
      ...(hinted(card, 'name') ? [visibleText(hinted(card, 'name'))] : []),
      ...lines
    ].map(stripPronouns);
    let name = candidates.find(isNameLike) || '';
    if (!name) flags.push('no clear name');

    const nameAnchor = anchors.find((a) => name && stripPronouns(visibleText(a)) === name);
    const profileAnchor = nameAnchor || anchors.find((a) => {
      const h = a.getAttribute('href') || '';
      return h && !h.startsWith('#') && !/^(mailto|tel|javascript):/i.test(h);
    });
    const profileUrl = profileAnchor ? absoluteUrl(profileAnchor.getAttribute('href')) : '';
    const linkedin = anchors.map((a) => absoluteUrl(a.getAttribute('href'))).find((u) => /linkedin\.com\/in\//i.test(u)) || '';
    const mail = anchors.find((a) => /^mailto:/i.test(a.getAttribute('href') || ''));
    const emailMatch = (mail ? mail.getAttribute('href').slice(7).split('?')[0] : '') ||
      (lines.join(' ').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0];

    // Everything that isn't the name or an email/URL is title/company/location material.
    const rest = lines
      .map(stripPronouns)
      .filter((l) => l !== name && !l.includes('@') && !/^https?:/i.test(l) && l.length <= 160);

    let title = '';
    let company = '';
    let location = '';
    let confident = false;

    const hintedCompany = hinted(card, 'company') || hinted(card, 'employer') || hinted(card, 'organi');
    const hintedTitle = hinted(card, 'title') || hinted(card, 'position') || hinted(card, 'job') || hinted(card, 'headline');
    const hintedLocation = hinted(card, 'location') || hinted(card, 'city');
    if (hintedLocation) location = visibleText(hintedLocation);
    if (hintedCompany && visibleText(hintedCompany) !== name) {
      company = visibleText(hintedCompany);
      confident = true;
    }
    // "title" in a class often means the card's heading, i.e. the person's name: skip that.
    const titleText = hintedTitle ? stripPronouns(visibleText(hintedTitle)) : '';
    if (titleText && titleText !== name && !isNameLike(titleText)) {
      const split = splitTitleCompany(titleText);
      if (split && !company) { title = split.title; company = split.company; confident = true; }
      else title = titleText;
    }

    const others = rest.filter((l) => l !== location && l !== title && l !== company);
    if (!company) {
      for (const line of others) {
        const split = splitTitleCompany(line);
        if (split) {
          title = title || split.title;
          company = split.company;
          confident = true;
          break;
        }
      }
    }
    if (!location) location = others.find((l) => LOCATION_LINE.test(l) && !TITLE_WORDS.test(l) && !(CM && CM.isKnownAlias(l))) || '';
    const plain = others.filter((l) => l !== location && !splitTitleCompany(l));

    if (!company && plain.length) {
      const known = plain.find((l) => CM && CM.isKnownAlias(l));
      const titled = plain.find((l) => TITLE_WORDS.test(l));
      if (known) {
        company = known;
        title = title || plain.find((l) => l !== known) || '';
        confident = true;
      } else if (titled && plain.length >= 2) {
        title = title || titled;
        company = plain.find((l) => l !== titled);
      } else if (plain.length >= 2) {
        title = title || plain[0];
        company = plain[1];
      } else {
        // One line, e.g. "Associate, Lazard": split at the last comma, but don't trust it.
        const m = /^(.+),\s*([^,]+)$/.exec(plain[0]);
        if (m && TITLE_WORDS.test(m[1]) && !TITLE_WORDS.test(m[2])) {
          title = title || clean(m[1]);
          company = clean(m[2]);
        } else if (TITLE_WORDS.test(plain[0])) {
          title = title || plain[0];
        } else {
          company = plain[0];
        }
      }
    }
    if (!title) title = plain.find((l) => l !== company) || '';
    if (!company) flags.push('no company found');

    const confidence = flags.length ? 'low' : confident ? 'high' : 'medium';
    return {
      name,
      title,
      company,
      location,
      profileUrl,
      linkedinUrl: linkedin,
      email: emailMatch,
      companyKey: CM ? CM.companyKey(company) : '',
      confidence,
      flags
    };
  }

  // ---- Finding the cards ----------------------------------------------------------------

  const CHROME = 'nav, footer, header, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="menu"], [role="menubar"], [role="tablist"]';
  // Class names that change per build ("css-1x2y3z", "_a1b2c3") would split one list into
  // many groups, so they're left out of the signature.
  const stableClasses = (el) => [...el.classList].filter((c) => !/\d{2,}|^_|^css-|^sc-|^jsx-|--|__[a-z0-9]{5,}$/i.test(c)).sort().join('.');
  const signature = (el) => `${el.tagName}.${stableClasses(el)}`;

  function findCardGroups(doc) {
    const groups = [];
    for (const parent of doc.querySelectorAll('body, body *')) {
      if (parent.children.length < 3 || SKIP_TAGS.has(parent.tagName)) continue;
      if (parent.closest(CHROME)) continue;
      const bySig = new Map();
      for (const child of parent.children) {
        if (SKIP_TAGS.has(child.tagName) || isHidden(child)) continue;
        const sig = signature(child);
        if (!bySig.has(sig)) bySig.set(sig, []);
        bySig.get(sig).push(child);
      }
      for (const cards of bySig.values()) if (cards.length >= 3) groups.push(cards);
    }
    return groups;
  }

  // Sentences ("Tickets on sale now for the spring event.") are articles, not job titles.
  const isProse = (l) => l.split(' ').length > 12 || (/[.!?]$/.test(l) && l.split(' ').length >= 4);

  // A group counts as people when most cards have a name-like line plus at least one
  // short, non-sentence line (a title, a firm, a place).
  function scoreGroup(cards) {
    let people = 0;
    for (const card of cards) {
      const lines = textLines(card).map(stripPronouns);
      if (lines.length < 2 || lines.length > 25) continue;
      const name = lines.find(isNameLike);
      if (name && lines.some((l) => l !== name && !isProse(l) && /\p{L}{2,}/u.test(l) && !/[£$€¥]\s?\d/.test(l))) people += 1;
    }
    return people / cards.length >= 0.6 ? people : 0;
  }

  function readGeneric(doc) {
    let best = null;
    let bestScore = 0;
    for (const cards of findCardGroups(doc)) {
      const score = scoreGroup(cards);
      // Ties go to the deeper (more specific) group, which is found later in document order.
      if (score && score >= bestScore) {
        best = cards;
        bestScore = score;
      }
    }
    if (!best) return [];
    return best.map(readCard).filter((c) => c.name || c.company || c.title);
  }

  // ---- Entry point --------------------------------------------------------------------

  function readContacts(doc = document, url = location.href) {
    for (const adapter of window.BC_CONTACT_ADAPTERS) {
      let matches = false;
      try { matches = adapter.match(url); } catch (_) { matches = false; }
      if (!matches) continue;
      try {
        const found = adapter.read(doc) || [];
        if (found.length) {
          const contacts = found.map((c) => {
            const flags = [...(c.flags || [])];
            if (!c.name) flags.push('no clear name');
            if (!c.company) flags.push('no company found');
            return {
              name: '', title: '', company: '', location: '', profileUrl: '', linkedinUrl: '', email: '',
              ...c,
              companyKey: CM ? CM.companyKey(c.company) : '',
              confidence: flags.length ? 'low' : c.confidence || 'high',
              flags
            };
          });
          return { source: `adapter:${adapter.name}`, contacts };
        }
      } catch (e) {
        console.error(`[BC] contact adapter ${adapter.name} threw — falling back to the generic reader`, e);
      }
    }
    return { source: 'generic', contacts: readGeneric(doc) };
  }

  // ---- Multi-page capture helpers (only ever driven by the side panel, opt-in) ---------

  // A login wall or a bot check means stop, never push through.
  function pageBlocker(doc = document) {
    const text = clean(doc.body ? doc.body.textContent : '').slice(0, 5000).toLowerCase();
    if (doc.querySelector('iframe[src*="captcha"], iframe[src*="challenges.cloudflare"], .g-recaptcha, .h-captcha, #captcha, [id*="captcha" i]') ||
        /verify (that )?you('| a)re (a )?human|are you a robot|security check|unusual (activity|traffic)|complete the captcha/.test(text)) {
      return 'captcha';
    }
    const password = doc.querySelector('input[type="password"]');
    if (password && !findCardGroups(doc).length) return 'login';
    if (/^(sign in|log in|login)\b/.test(clean(doc.title).toLowerCase())) return 'login';
    return null;
  }

  const NEXT_TEXT = /^(next|next page|show more( results)?|load more( results)?|more results|›|»|→|>)$/i;
  // The site's own "Next" control: rel=next, aria-label "Next", or a button/link that says
  // Next. Never a profile link. Disabled controls mean the last page.
  function findNextControl(doc = document) {
    const candidates = [...doc.querySelectorAll('a[rel="next"], a, button, [role="button"]')];
    return candidates.find((el) => {
      if (el.closest('nav[aria-label*="breadcrumb" i]')) return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/.test(el.className || '')) return false;
      const label = clean(el.getAttribute('aria-label') || '');
      const text = clean(textLines(el).join(' '));
      return el.getAttribute('rel') === 'next' || NEXT_TEXT.test(text) || /^next( page)?$/i.test(label);
    }) || null;
  }

  // Moves to the next page in this tab: clicks the site's Next control, or scrolls an
  // infinite list to the bottom. Reports which, so the panel can stop when neither works.
  function goToNextPage(doc = document) {
    const next = findNextControl(doc);
    if (next) {
      next.scrollIntoView?.({ block: 'center' });
      next.click();
      return 'click';
    }
    const before = doc.documentElement.scrollHeight;
    const atBottom = window.scrollY + window.innerHeight >= before - 4;
    if (!atBottom) {
      window.scrollTo(0, before);
      return 'scroll';
    }
    return null;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isCurrent()) return false;
    if (message.type === 'BC_NEXT_PAGE') {
      sendResponse({ ok: true, how: goToNextPage() });
      return false;
    }
    if (message.type !== 'BC_READ_CONTACTS') return false;
    try {
      const blocked = pageBlocker();
      const { source, contacts } = blocked ? { source: 'blocked', contacts: [] } : readContacts();
      sendResponse({ ok: true, url: location.href, site: location.hostname, title: document.title, source, contacts, blocked });
    } catch (e) {
      console.error('[BC] contact reader threw', e);
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
    return false;
  });

  window.BC_ContactReader = { readContacts, readGeneric, pageBlocker, findNextControl, goToNextPage, readCard, isNameLike, splitTitleCompany, textLines, registerAdapter };
})();
