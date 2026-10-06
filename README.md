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

## Install from GitHub, step by step

**What you need first**

- **Google Chrome** (or another Chromium browser such as Edge, Brave or Arc).
- **Node.js 22 or newer** — download the "LTS" installer from https://nodejs.org and run
  it. Check it worked by opening Terminal and running `node -v` (it should print `v22…`
  or higher).
- **Git** (optional) — only needed for the `git clone` route below. On a Mac, running
  `git --version` in Terminal offers to install it if it's missing.

**1. Download the code** — either:

- **With Git:**
  ```
  git clone https://github.com/lucaclo/bc-tracker.git
  cd bc-tracker
  ```
- **Without Git:** open https://github.com/lucaclo/bc-tracker, click the green **Code**
  button → **Download ZIP**, unzip it, and in Terminal `cd` into the unzipped
  `bc-tracker-main` folder.

**2. Install the app's dependencies** (first time only)

```
cd app
npm install
```

**3. Start the local app** — leave this Terminal window open while you apply:

```
npm start
```

You should see `B.C Tracker app running at http://localhost:5055`. Open
http://localhost:5055 in Chrome. If that page says "refused to connect", the app isn't
running — go back to this step.

**4. Fill in your Profile**

On the app's **Profile** tab, enter your own personal info, address, education, work
experience, languages, skills, work-authorization status, and upload your CV/cover
letter, then click **Save profile**. This is what the extension reads from when it
autofills a form — nothing is guessed or invented, so anything you leave blank here will
show up as "needs your input" on real application forms rather than being skipped silently.

**5. Load the browser extension** (first time only)

- Go to `chrome://extensions`
- Turn on **Developer mode** (top-right toggle)
- Click **Load unpacked** → select the `extension/` folder inside the downloaded code
- Click the puzzle-piece icon in Chrome's toolbar → the pin next to **B.C Tracker**
- Click the B.C Tracker icon to open its **side panel**. The dot next to "Open tracker"
  turns green when the app from step 3 is running; "Open tracker" opens the app.

**6. Updating to a newer version later**

- With Git: `git pull` in the `bc-tracker` folder. Without Git: download the ZIP again
  and replace the folder (your data in `app/data/` is not in the ZIP — copy that folder
  across first if you replace the whole thing).
- Then run `npm install` in `app/`, restart `npm start`, go to `chrome://extensions` and
  click the reload icon on the B.C Tracker card, and refresh any open tracker tabs.
  Chrome never reloads an unpacked extension by itself.

**Running the tests** (optional): `npm test` in `app/` checks the tracker reader against
a copy of Trackr's page structure.

## Using it day-to-day

- Browse to your WSO tracker (wallstreetoasis.com/academy/dashboard/tracker) or a
  the-trackr.com tracker page and click **Apply** (or the row's application link) — the
  extension quietly captures that row's details (company, role, industry, region,
  deadline) so they're ready to prefill the log entry later. On Trackr, which has no
  industry/region columns, the industry comes from the section heading above the row
  ("Bulge Bracket", "Asset Management", …) and the region from the tracker itself ("UK
  Finance", "Hong Kong Finance", …). Anything still missing is called out in the side
  panel rather than left silently blank.
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
  **Applications** tab. The XLSX export is a formatted Excel table (striped rows, colour-
  coded status, deadline warnings) with a Summary sheet of counts by status and industry.

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
