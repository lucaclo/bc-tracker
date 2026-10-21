# Issue #9: Extension: generic on-page contact reader

https://github.com/lucaclo/bc-tracker/issues/9

Stacked on `issue-13-export-contacts` (PR #22).

## Steps
1. `extension/content/contact-reader.js` (new): newest-copy-wins token, own text walker (block
   elements, `<br>` and touching inline spans split lines; screen-reader-only text skipped),
   card groups = ≥3 siblings with the same tag + stable-class signature outside nav/header/footer,
   person score (name-like line + a short non-sentence line), per-card extraction with confidence
   + flags, adapter registry (`registerAdapter`, `window.BC_CONTACT_ADAPTERS`) with generic fallback,
   `BC_READ_CONTACTS` message. Needs `lib/companyMatch.js` injected first.
2. Not in the manifest's content scripts: the side panel (#10) injects it with chrome.scripting.
3. `app/test/contact-reader.test.js`: list, grid, table, LinkedIn-like, no-people page, flagged
   cards, message reply, adapter precedence/fallback, re-injection.
