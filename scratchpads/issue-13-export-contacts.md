# Issue #13: Export contacts (XLSX sheet + CSV)

https://github.com/lucaclo/bc-tracker/issues/13

Stacked on `issue-8-contact-import` (PR #21).

## Steps
1. `server.js`: `CONTACT_EXPORT_COLUMNS` (every field + "Linked application", the company name of
   the application this contact links to via `linkIndex`), `buildContactsSheet` styled like the
   Applications sheet (brand header, frozen first row/column, table with filters, stripes, links).
   Added to `export.xlsx` after Summary.
2. `GET /api/contacts/export.csv` → `bc-tracker-contacts.csv`, same columns; "Export CSV" on the
   Contacts tab toolbar.
3. Tests (`contacts-export.test.js`): XLSX has a Contacts sheet with the headers and one row;
   CSV headers + one row, quoting.
