# Issue #12: Opt-in multi-page capture

https://github.com/lucaclo/bc-tracker/issues/12

Stacked on `issue-11-site-adapters` (PR #25).

## Steps
1. `contact-reader.js`: `findNextControl` (rel=next, aria-label Next, Next/Show more/›/» text; never
   disabled), `goToNextPage` (click it, else scroll an infinite list, else null), `pageBlocker`
   (CAPTCHA / bot check / login wall), `BC_NEXT_PAGE` message, `blocked` in `BC_READ_CONTACTS`.
2. Side panel: "Capture multiple pages" checkbox (off every time the panel opens), page cap
   (default 5, clamped 2–25), one-time per-site terms warning stored in `multiPageAccepted`,
   loop in the starting tab only with random 4–10 s waits, Stop button, dedupe across pages,
   stop reasons, results into the same review list.
3. Tests: `multi-page-capture.test.js`.
