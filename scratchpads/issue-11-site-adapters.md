# Issue #11: Site adapters: WSO, LinkedIn, Hivebrite, Graduway

https://github.com/lucaclo/bc-tracker/issues/11

Stacked on `issue-10-capture-panel` (PR #24).

## Findings from live checks (Claude in Chrome, read-only, 2026-10-21)
- LinkedIn people search + school alumni: hashed class names; each person is a
  `[role="listitem"]` holding `/in/<slug>` links; lines = name, "• 2nd", headline, location,
  Connect, optional "Current:/Past:" summary. → `lib/contactAdapters/linkedin.js`.
- WSO: no page lists named people. Company pages have no people section, the Mentors
  directory (`/career-services/mentors`, `.views-row`) is anonymous (industry + title only),
  and member profiles show usernames, not names. No adapter: nothing to read.
- Hivebrite / Graduway: need the URL of a network Luca belongs to (Old Wellingtonian's platform
  couldn't be identified) and his login. Left for a follow-up session with him.
