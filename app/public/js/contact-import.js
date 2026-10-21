// CSV / pasted-table import for contacts: society member spreadsheets, LinkedIn's own
// Connections.csv export, anything with a header row. Pure functions, shared by the Contacts
// tab (window.BC_ContactImport) and the tests (require()).
/* global module */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BC_ContactImport = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Import targets, in the order the mapping dropdown shows them.
  const TARGETS = [
    ['', 'Ignore'],
    ['name', 'Name'],
    ['firstName', 'First name'],
    ['lastName', 'Last name'],
    ['title', 'Title'],
    ['company', 'Company'],
    ['team', 'Team'],
    ['location', 'Location'],
    ['email', 'Email'],
    ['linkedinUrl', 'LinkedIn URL'],
    ['profileUrl', 'Profile URL'],
    ['school', 'School'],
    ['gradYear', 'Grad year'],
    ['society', 'Society'],
    ['notes', 'Notes'],
    ['connectedOn', 'Connected on (added to notes)']
  ];

  // Header text (lowercased, punctuation squashed) → target.
  const HEADER_SYNONYMS = {
    name: ['name', 'full name', 'contact name', 'member name', 'member'],
    firstName: ['first name', 'firstname', 'forename', 'given name', 'first'],
    lastName: ['last name', 'lastname', 'surname', 'family name', 'last'],
    title: ['title', 'job title', 'position', 'role', 'job', 'occupation', 'headline'],
    company: ['company', 'employer', 'organisation', 'organization', 'firm', 'current company', 'company name', 'workplace'],
    team: ['team', 'department', 'division', 'group'],
    location: ['location', 'city', 'based in', 'country', 'region'],
    email: ['email', 'email address', 'e mail', 'e mail address', 'mail'],
    linkedinUrl: ['linkedin', 'linkedin url', 'linkedin profile'],
    profileUrl: ['url', 'profile url', 'profile', 'profile link', 'link'],
    school: ['school', 'university', 'college', 'institution'],
    gradYear: ['grad year', 'graduation year', 'class of', 'year of graduation', 'leaving year', 'class year', 'year'],
    society: ['society', 'club'],
    notes: ['notes', 'note', 'comments'],
    connectedOn: ['connected on', 'connection date', 'date connected']
  };
  const SYNONYM_LOOKUP = {};
  for (const [target, words] of Object.entries(HEADER_SYNONYMS)) for (const w of words) SYNONYM_LOOKUP[w] = target;

  const normaliseHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // Comma, tab or semicolon: whichever appears most in the first few lines, outside quotes.
  function sniffDelimiter(text) {
    const sample = text.split(/\r?\n/).slice(0, 10).join('\n').replace(/"[^"]*"/g, '');
    const counts = [',', '\t', ';'].map((d) => [d, sample.split(d).length - 1]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 0 ? counts[0][0] : ',';
  }

  // RFC 4180: quoted fields may hold the delimiter, newlines and doubled quotes ("").
  function parseDelimited(text, delimiter = sniffDelimiter(text)) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += ch;
      } else if (ch === '"' && field === '') {
        quoted = true;
      } else if (ch === delimiter) {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // Blank lines carry nothing.
    return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  }

  function guessMapping(headers) {
    const used = new Set();
    return headers.map((h) => {
      const target = SYNONYM_LOOKUP[normaliseHeader(h)] || '';
      // Two columns can't both be "Name": the second is ignored until the user says otherwise.
      if (!target || used.has(target)) return '';
      used.add(target);
      return target;
    });
  }

  // LinkedIn's Connections.csv starts with a few "Notes:" lines before the real header, so
  // the header is the first row where at least two cells are recognised column names.
  function findHeaderRow(rows) {
    const idx = rows.findIndex((r) => guessMapping(r).filter(Boolean).length >= 2);
    return idx === -1 ? 0 : idx;
  }

  function parseImport(text) {
    const rows = parseDelimited(text);
    if (!rows.length) return { headers: [], rows: [], mapping: [] };
    const h = findHeaderRow(rows);
    const headers = rows[h].map((c) => c.trim());
    return { headers, rows: rows.slice(h + 1), mapping: guessMapping(headers) };
  }

  // Applies a column mapping. Rows without a name are reported, never returned for saving.
  function rowsToContacts(rows, mapping, sourceGroup = '') {
    const contacts = [];
    const skipped = [];
    rows.forEach((row, i) => {
      const v = {};
      mapping.forEach((target, col) => {
        const cell = (row[col] || '').trim();
        if (target && cell) v[target] = v[target] ? `${v[target]} ${cell}` : cell;
      });
      const name = v.name || [v.firstName, v.lastName].filter(Boolean).join(' ');
      if (!name) {
        skipped.push(i);
        return;
      }
      const contact = { name };
      for (const key of ['title', 'company', 'team', 'location', 'email', 'linkedinUrl', 'profileUrl', 'school', 'gradYear', 'society', 'notes']) {
        if (v[key]) contact[key] = v[key];
      }
      // A LinkedIn profile in a generic URL column is a LinkedIn URL.
      if (!contact.linkedinUrl && /(^|\/\/|\.)linkedin\.com\//i.test(contact.profileUrl || '')) {
        contact.linkedinUrl = contact.profileUrl;
        delete contact.profileUrl;
      }
      if (v.connectedOn) contact.notes = [contact.notes, `Connected on LinkedIn ${v.connectedOn}`].filter(Boolean).join('\n');
      if (sourceGroup) contact.sourceGroup = sourceGroup;
      contacts.push(contact);
    });
    return { contacts, skipped };
  }

  return { TARGETS, sniffDelimiter, parseDelimited, guessMapping, findHeaderRow, parseImport, rowsToContacts };
});
