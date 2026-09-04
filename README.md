# B.C Tracker — Internship Application Autofill + Tracker

A tool for internship/job applications, built around two pieces that work together:

1. Reads your WallStreetOasis Academy Application Tracker (or a the-trackr.com tracker)
   while you browse it, logged in.
2. When you click "Apply" on a role, autofills the real application form (Workday /
   Greenhouse / Lever / other company sites) from your saved profile — filling what it's
   confident about, flagging anything it can't or shouldn't guess (including any
   EEO/demographic-style question or a field that belongs to someone else, like a
   reference or emergency contact — those are never read from or written to your profile).
3. **Never submits anything.** You always review and click Submit yourself.
4. When you log the application, it's recorded into a local, always-in-sync table with
   CSV/XLSX export — the "spreadsheet."

Everything lives on your machine. The extension only ever talks to `localhost:5055`
(this app) and reads pages you already have open — it never sends your data anywhere else.

**Your data is never in this repo.** `app/data/*.json` and `app/data/backups/` are
gitignored, and the app creates a blank profile/applications file automatically the first
time it runs (`store.ensureDataFiles()`). If you're cloning this to use for your own
applications, you start from a completely empty profile — none of the original author's
data ships with the code.

## Setup, step by step

**1. Clone the repo and install dependencies**

```
git clone https://github.com/<your-username>/bc-tracker.git
cd bc-tracker/app
npm install
```

**2. Start the local app** (leave this running while you apply)

```
npm start
```

It listens at http://localhost:5055 — open that in a browser tab.

**3. Fill in your Profile**

On the app's **Profile** tab, enter your own personal info, address, education, work
experience, languages, skills, work-authorization status, and upload your CV/cover
letter. This is what the extension reads from when it autofills a form — nothing is
guessed or invented, so anything you leave blank here will show up as "needs your input"
on real application forms rather than being skipped silently.

**4. Load the browser extension** (first time only)

- Go to `chrome://extensions`
- Enable "Developer mode" (top right toggle)
- Click "Load unpacked" → select the `extension/` folder from this repo
- Click the B.C Tracker toolbar icon once to open its **side panel** — pin it (click the
  puzzle-piece icon → the pin next to B.C Tracker) so it's always one click away. Once
  opened, it stays docked on the right and follows you across tabs until you close it.

**5. Whenever you change the extension's code**, Chrome does not auto-reload it — go to
`chrome://extensions` and click the reload icon on the B.C Tracker card, then refresh any
tab that was already open before the reload (an already-loaded tab's content script loses
its connection to the extension until the tab itself is refreshed).

## Using it day-to-day

- Browse to your WSO tracker (wallstreetoasis.com/academy/dashboard/tracker) or a
  the-trackr.com tracker page and click **Apply** (or the row's application link) — the
  extension quietly captures that row's details (company, role, industry, region,
  deadline) so they're ready to prefill the log entry later.
- On the application page that opens, click **Fill this page** in the side panel. Filled
  fields get a green outline; anything that needs your attention gets an orange dashed
  outline and is listed in the panel (click an item to jump to it).
- File uploads (CV, cover letter) are never auto-attached — that's a browser security
  restriction, not a limitation of this tool. They're flagged; your CV lives in
  `app/data/cv/`, so the native file picker will be right there.
- "Add skills" search/autocomplete widgets are attempted via real interaction (open,
  match, click); anything that didn't land a match is listed by name so a partial success
  is never silently reported as complete.
- Review the whole form yourself, then submit it manually — the extension never touches
  Submit/Continue/Next buttons.
- Click **Log application** in the side panel to save it to your tracker. It's pre-filled
  from the row you last clicked "Apply" on (WSO or Trackr).
- See everything, sort/filter, edit status, or export to CSV/XLSX from the app's
  **Applications** tab.

## What's intentionally best-effort

- Workday, Greenhouse, and Lever have specific field mappings; any other site falls back
  to a generic label-matching engine, which will flag more than it fills — by design,
  since guessing wrong is worse than asking.
- Workday's country / work-authorization pickers are custom widgets that can end up in a
  broken state if a script forces their value, so those are always flagged for you to
  select manually rather than auto-filled.
- Not every skill in your profile will have a matching option on a given site — no
  autofill tool can select an option that doesn't exist in that site's own vocabulary.
- The tracker reader (`extension/content/tracker-reader.js`) matches tables by header
  *text* rather than fixed styling/CSS classes, so it should survive a site restyling its
  page. Adding another tracker site is a small, contained change: one new entry in
  `SITE_CONFIGS` in `tracker-reader.js` (header synonyms + required columns) plus its URL
  pattern in `manifest.json`'s two `content_scripts` blocks.

## Data

- `app/data/profile.json` — your personal info (gitignored)
- `app/data/applications.json` — your applications table (gitignored)
- `app/data/cv/` — uploaded CVs / cover letters (gitignored)
- `app/data/backups/` — automatic timestamped snapshots taken before every write to the
  files above (gitignored) — recovery copies if something ever gets overwritten by mistake
