# Contacts feature — spec (brainstorm output)

Status: draft for approval, 2026-10-21. Next step: atomic GitHub issues (Robbie's workflow).

## Goal

B.C Tracker collects people (alumni, society members, WSO members, LinkedIn connections) from
pages the user is already logged in to, and attaches each person to the company they work at.
Every application to that company then shows those people as networking leads. It must work
for any user's networks (any school, uni, society or platform), not just the original author's.

## Decisions made

| Question | Decision |
|---|---|
| How contacts are collected | **Both** modes. (1) On-page capture of the page you are viewing (default). (2) Opt-in multi-page capture that steps through a directory's pages in your own visible tab, rate-limited. Plus CSV/paste import and manual add. |
| Fields stored | Core identity, links & contact, connection context, outreach tracking (full list below) |
| Linking to applications | Automatic, by company, using fuzzy name matching (`J.P. Morgan` = `JPMorgan` = `JPM`). Contacts that match no application stay saved and link later; unrecognised companies go to a review list. |
| UI on an application | A **Contacts dropdown** that lists names. Clicking a name opens all of that person's details (editable status/notes). |
| Process | Robbie's workflow: spec → atomic issues → `/process-issue` |

## Data model — `app/data/contacts.json` (gitignored like the other data files)

```
id, name, title, company (as captured), companyKey (normalised), team, location,
linkedinUrl, profileUrl (on the source site), email,
sourceGroup (user label, e.g. "Old Wellingtonian"), sourceSite (hostname), school, gradYear, society,
status: "to-contact" | "messaged" | "replied" | "call-done" | "not-relevant",
lastContacted, notes, capturedAt, updatedAt
```

Dedupe and merge: the same `profileUrl` or `linkedinUrl`, or the same normalised name + `companyKey`,
counts as the same person. A re-capture fills empty fields and refreshes title/company. It never
overwrites user-entered `status`, `notes` or `lastContacted`.

## Company matching (shared lib, used by app + extension)

- Normalise: lowercase, strip punctuation, `&`→`and`, drop legal suffixes (LLP, Ltd, plc, Inc, Group, & Co, Holdings).
- Built-in alias table for common finance firms (JPMorgan/J.P. Morgan/JPM/Chase, Goldman Sachs/GS,
  BofA/Bank of America/Merrill Lynch, Citi/Citigroup, Morgan Stanley, Barclays, UBS, …), plus
  user-added aliases stored in the profile.
- Never guess on a weak match. If there is no exact or alias match, the contact goes to the
  "Unassigned" review list, where the user assigns it once and that alias is remembered.
  (The same flag-over-guess rule the autofill uses.)

## Capture

**Generic extractor** (works on any site): finds a repeated "person card" structure (≥3 sibling
elements with the same tag/class signature), then pulls from each card a name-like text, a profile
link, and title/company from common patterns (`Title at Company`, `Title · Company`, separate lines).
Cards it is not confident about are shown **unticked and flagged** in the review list.

**Site adapters** for known layouts, each verified against the live DOM before shipping: WSO
member/company pages, LinkedIn people search and school alumni pages, Hivebrite and Graduway (the
platforms most school/uni alumni networks run on).

**Side panel flow:** Capture contacts → preview table with checkboxes → set source group
(remembered per site) → Save. Uses the existing offline `pendingLogs`-style queue if the app is down.

**Multi-page capture (opt-in):**
- Only runs in the visible tab the user started it from. Never in the background, never on a schedule.
- Clicks the site's own Next button or scrolls the infinite list.
- Random 4–10 s delay between pages. Default cap 5 pages, maximum 25. Stop button always visible.
- Reads list pages only. It never opens individual profiles.
- The first use on each site shows a one-time warning: automated browsing may break that site's
  terms and risk the user's account.

**Import:** CSV or paste with column mapping. This includes LinkedIn's own `Connections.csv` data
export and society member spreadsheets.

## Safety / privacy rules

- All contact data stays local (`app/data/`) and is never sent anywhere.
- The tool never messages, emails or connects with anyone automatically (same spirit as "never auto-submit").
- Delete-by-source button ("remove everything captured from society X"), plus per-contact delete.
- The README states that users are responsible for following their networks' terms and data-protection rules.

## UI

- **Applications table:** "Contacts (n)" dropdown per row → names → click a name to expand all fields,
  with status, last-contacted and notes editable inline.
- **New Contacts tab:** search and filter (company / source / status), manual add/edit/delete,
  Unassigned review list, delete-by-source.
- **Export:** a Contacts sheet in the XLSX export, plus a contacts CSV.

## Out of scope (v1)

Sending messages, email lookup or guessing (e.g. firstname.lastname@ patterns), opening individual
profile pages, background/scheduled crawling, syncing contacts across machines.
