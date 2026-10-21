# Issue #10: Side panel: Capture contacts flow

https://github.com/lucaclo/bc-tracker/issues/10

Stacked on `issue-9-contact-reader` (PR #23).

## Steps
1. `popup.html`: "Capture contacts" section: button, status line, review list (checkbox, name ·
   title, editable company, flag reason), source group box, Save / Discard, pending hint.
2. `popup.js`: inject `lib/companyMatch.js` + `content/contact-reader.js` (always, newest copy wins),
   send `BC_READ_CONTACTS`, tick everything except low-confidence rows, remember the source group
   per hostname (`captureSourceGroups`), POST `/api/contacts/bulk`, show created/merged counts;
   app down → `pendingContacts` batches flushed by `checkAppStatus` like `pendingLogs`.
3. `popup.css` styles; manifest 1.6.1 → 1.7.0.
4. `app/test/capture-panel.test.js`: real popup.html/js in jsdom with stubbed chrome.* and a real app.
