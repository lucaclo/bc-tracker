# Issue #8: CSV / paste import of contacts

https://github.com/lucaclo/bc-tracker/issues/8

Stacked on `issue-7-contacts-tab` (PR #20).

## Steps
1. `app/public/js/contact-import.js` (new, UMD so Node tests can require it): `parseDelimited(text)`
   (RFC 4180: quoted commas, quoted newlines, `""`, CRLF; delimiter sniffed from , tab ;),
   `findHeaderRow(rows)` (skips LinkedIn's "Notes:" preamble), `guessMapping(headers)`,
   `rowsToContacts(rows, mapping, sourceGroup)` (First + Last → name, a linkedin.com URL goes to
   linkedinUrl, "Connected On" becomes a note, nameless rows counted as skipped).
2. Contacts tab: "Import…" button → dialog with file picker or paste box, source group, a mapping
   select per column, a preview of the first rows, then Import → `/api/contacts/bulk` and a
   created / merged / skipped summary.
3. Tests: parser + mapping unit tests (`contact-import.test.js`); jsdom test of the dialog end to end.
