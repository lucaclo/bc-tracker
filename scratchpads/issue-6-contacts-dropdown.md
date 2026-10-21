# Issue #6: App UI: Contacts dropdown on each application row

https://github.com/lucaclo/bc-tracker/issues/6

Stacked on `issue-5-link-contacts` (PR #18).

## Steps
1. `app/public/js/contacts.js` (new, loaded before app.js): `renderContactList` (names → disclosure
   buttons) and `renderContactDetail` (all fields, status/last-contacted/notes saved on change,
   toast on success, error toast + revert on failure). Reused by the Contacts tab (#7).
2. `app.js`: new Contacts column with a `Contacts (n)` button (disabled at 0) that toggles a full-width
   row under the application; contacts lazy-loaded from `/api/applications/:id/contacts` on first open.
3. `style.css`: tokens only, so light/dark both work; panel is sticky-left and wraps at narrow widths.
4. jsdom tests drive the real page against a real app on a temp data dir.
