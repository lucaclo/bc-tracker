# Issue #5: Link contacts to applications by company

https://github.com/lucaclo/bc-tracker/issues/5

Stacked on `issue-4-company-match` (PR #17).

## Steps
1. `store.defaultProfile()` gains `companyAliases: {}`; old profiles get it from the default merge.
   `PUT /api/profile` keeps the stored aliases (the profile form holds a copy loaded at page
   open, so it must not overwrite aliases added since from the contacts UI).
2. `app/lib/contacts.js`: `linkIndex(applications, contacts, aliases)` computes keys at read time
   (no stored foreign keys) → per-application contacts, counts, and the unassigned list.
   Unassigned = key matches no application AND the name is not a built-in/user alias (or empty).
3. Routes: `GET /api/applications` adds `contactCount`; `GET /api/applications/:id/contacts`;
   `GET /api/contacts/unassigned`; `POST /api/contacts/:id/assign { company }` saves
   `companyAliases[raw] = company` and re-keys every contact. All contact writes key with the
   profile's aliases.
4. Tests in `app/test/contacts-linking.test.js`.

## Testing each acceptance criterion
- per-application contacts: J.P. Morgan application + JPMorgan contact.
- contactCount: list includes counts, 0 for none.
- unassigned: contact at an unknown firm with no application listed; built-in alias firm not listed.
- assign: alias saved in profile, every contact with that raw name re-keyed, now linked.
- contacts saved before an application exist link once it's created.
- old profile without companyAliases still works; profile save doesn't drop aliases.
