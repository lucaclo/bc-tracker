# Issue #7: App UI: Contacts tab

https://github.com/lucaclo/bc-tracker/issues/7

Stacked on `issue-6-contacts-dropdown` (PR #19).

## Steps
1. `index.html`: Contacts tab (beside Applications) with search, company/source/status filters,
   Unassigned panel, contacts table, empty state listing the three ways to add; contact dialog;
   delete-by-source confirm dialog.
2. `contacts.js`: `loadContactsTab()` (called from `selectTab`), table rendering that reuses
   `renderContactDetail`, undo-delete like applications, assign form → `/api/contacts/:id/assign`,
   delete-by-source dialog showing the count before anything is removed.
3. CSS for the new bits, theme tokens only.
4. jsdom tests for each acceptance criterion.
