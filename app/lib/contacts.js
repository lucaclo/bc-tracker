// Contacts: people you know (or could reach) at firms you're applying to. Pure functions
// over the array kept in data/contacts.json — server.js does the reading and writing.
const crypto = require('crypto');

const STATUSES = ['to-contact', 'messaged', 'replied', 'call-done', 'not-relevant'];

// Every stored field except id/companyKey/timestamps, in display order.
const FIELDS = [
  'name', 'title', 'company', 'team', 'location',
  'linkedinUrl', 'profileUrl', 'email',
  'sourceGroup', 'sourceSite', 'school', 'gradYear', 'society',
  'status', 'lastContacted', 'notes'
];

// What the user writes themselves. A re-capture or import never overwrites these once set.
const USER_FIELDS = new Set(['status', 'lastContacted', 'notes']);
// A re-capture is the freshest view of where someone works now, so these get replaced.
const REFRESH_FIELDS = new Set(['title', 'company']);

// Placeholder until the shared company matcher lands: one function so it can be swapped.
function companyKey(company) {
  return String(company || '').toLowerCase().trim();
}

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function normaliseName(name) {
  return clean(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Same person, same page: ignore case in the host, query strings, fragments and a trailing slash.
function normaliseUrl(url) {
  const raw = clean(url);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return (u.host.toLowerCase().replace(/^www\./, '') + u.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch (_) {
    return raw.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

// Turns whatever a caller sent into a stored-shape contact (no id/timestamps yet).
function normaliseContact(input, keyOf = companyKey) {
  const out = {};
  for (const f of FIELDS) out[f] = clean(input && input[f]);
  if (!STATUSES.includes(out.status)) out.status = '';
  out.companyKey = keyOf(out.company);
  return out;
}

function findMatch(contacts, candidate) {
  const profile = normaliseUrl(candidate.profileUrl);
  const linkedin = normaliseUrl(candidate.linkedinUrl);
  const name = normaliseName(candidate.name);
  return contacts.find((c) =>
    (profile && normaliseUrl(c.profileUrl) === profile) ||
    (linkedin && normaliseUrl(c.linkedinUrl) === linkedin) ||
    (name && candidate.companyKey && c.companyKey === candidate.companyKey && normaliseName(c.name) === name)
  );
}

// Folds a fresh capture into an existing contact: empty fields get filled, title/company
// refresh, and the user's own status/notes/last-contacted are never touched once set.
function mergeContact(existing, incoming, now = new Date().toISOString()) {
  const merged = { ...existing };
  for (const f of FIELDS) {
    const value = incoming[f];
    if (!value) continue;
    if (USER_FIELDS.has(f)) {
      // Status always has a value once saved, so a capture can never change it.
      if (!existing[f]) merged[f] = value;
    } else if (REFRESH_FIELDS.has(f) || !existing[f]) {
      merged[f] = value;
    }
  }
  if (incoming.company) merged.companyKey = incoming.companyKey;
  merged.updatedAt = now;
  return merged;
}

function createContact(fields, now = new Date().toISOString()) {
  return {
    id: crypto.randomUUID(),
    ...fields,
    status: fields.status || 'to-contact',
    capturedAt: now,
    updatedAt: now
  };
}

// Adds a batch (a capture or an import) to the list. Returns the new list and what happened
// to each row; rows without a name are skipped, never saved.
function upsertContacts(contacts, inputs, keyOf = companyKey) {
  const list = contacts.slice();
  const now = new Date().toISOString();
  const result = { created: 0, merged: 0, skipped: 0, ids: [] };
  for (const input of inputs || []) {
    const candidate = normaliseContact(input, keyOf);
    if (!candidate.name) {
      result.skipped += 1;
      continue;
    }
    const match = findMatch(list, candidate);
    if (match) {
      const idx = list.indexOf(match);
      list[idx] = mergeContact(match, candidate, now);
      result.merged += 1;
      result.ids.push(match.id);
    } else {
      const created = createContact(candidate, now);
      list.push(created);
      result.created += 1;
      result.ids.push(created.id);
    }
  }
  return { contacts: list, ...result };
}

// A direct edit from the UI: the user's word wins on every field it sends.
function updateContact(existing, changes, keyOf = companyKey) {
  const updated = { ...existing };
  for (const f of FIELDS) {
    if (changes && Object.prototype.hasOwnProperty.call(changes, f)) updated[f] = clean(changes[f]);
  }
  if (!STATUSES.includes(updated.status)) updated.status = existing.status || 'to-contact';
  updated.companyKey = keyOf(updated.company);
  updated.updatedAt = new Date().toISOString();
  return updated;
}

module.exports = {
  STATUSES,
  FIELDS,
  companyKey,
  normaliseName,
  normaliseUrl,
  normaliseContact,
  findMatch,
  mergeContact,
  createContact,
  upsertContacts,
  updateContact
};
