# Issue #3: Contacts store and REST API

https://github.com/lucaclo/bc-tracker/issues/3

Stacked on `issue-2-ci` (PR #15 not merged yet; Luca chose stacked PRs).

## Steps
1. `app/lib/store.js`: `BC_DATA_DIR` env override for the data dir (so tests use a temp dir),
   `CONTACTS_PATH`, created as `[]` by `ensureDataFiles()`, `getContacts`/`saveContacts` using the
   existing atomic write + snapshot. Already gitignored by `app/data/*.json`.
2. `app/lib/contacts.js` (new): field list, `STATUSES`, `normaliseContact`, `companyKey`
   placeholder (lowercase/trim, one function so #4 can swap it), `findMatch`, `mergeContact`,
   `upsertContacts` returning `{ contacts, created, merged, skipped }`.
3. `app/server.js`: `GET/POST /api/contacts`, `POST /api/contacts/bulk`, `PUT/DELETE /api/contacts/:id`,
   `DELETE /api/contacts?sourceGroup=X`. Export `app`; only listen when run directly.
4. `app/test/contacts-api.test.js`: start the app on an ephemeral port against a temp data dir.

## Testing each acceptance criterion
- contacts.json created empty + gitignored: test checks file exists with `[]`; `git check-ignore`.
- CRUD + bulk: tests hit each route.
- merge on profileUrl / linkedinUrl / name+companyKey: one test per key.
- status/notes/lastContacted preserved, empty filled, title/company refreshed: merge test.
- delete by sourceGroup: test.
- backup before write: test counts files in `backups/` after a write.
