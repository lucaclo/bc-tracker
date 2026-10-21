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

**Recommended on a Mac: keep it running permanently** so you never have to remember step 3:

```
npm run autostart:install
```

This starts the app now, again every time you log in, and restarts it within ~10 seconds
if it ever stops. You can close the Terminal window afterwards. Undo with
`npm run autostart:uninstall`. The output goes to `app/data/server.log`. If you log an
application while the app is down anyway, the side panel keeps the entry and sends it
automatically when the app comes back.

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
- Clicking **Apply** on any job posting (a Workday, Greenhouse or Lever page, or a firm's
  own careers site) also captures that posting's title, company, location → country and
  closing date. If you got there from a tracker row in the last few hours for the same
  firm, the two are merged: the tracker's industry/region win and the job page fills in
  whatever the tracker didn't have (usually the deadline). Missed the Apply click? Use
  **Read this job page** in the side panel.
- Click **Log application** in the side panel to save it to your tracker. It's pre-filled
  from the last Apply you clicked. A capture older than 6 hours, or one from a different
  job site than the tab you're on, is *not* pre-filled (the panel says why and offers
  "Use it anyway"), so an old application's details never end up on a new one.
- See everything, sort/filter, edit status, or export to CSV/XLSX from the app's
  **Applications** tab. The XLSX export is a formatted Excel table (striped rows, colour-
  coded status, deadline warnings) with a Summary sheet of counts by status and industry.

## Contacts: who you know at each firm

B.C Tracker can keep a list of people (alumni from your school or university, society
members, LinkedIn connections) and attach each one to the firm they work at. Every
application to that firm then shows them as networking leads.

**Adding contacts.** On the app's **Contacts** tab:

- **Add contact** to type someone in by hand.
- **Import…** for a CSV file or rows pasted from a spreadsheet: a society member list, or
  LinkedIn's own export (LinkedIn → Settings → Data privacy → Get a copy of your data →
  Connections). Columns are matched automatically (First Name, Last Name, Company,
  Position, Email, URL, Connected On, …). You can correct any of them, set a source group
  for the batch, and preview the rows before anything is saved. Rows without a name are
  skipped and counted, never saved.

**Capturing from a page you're on.** Open a directory you're logged in to (an alumni
network, a members list, LinkedIn people search or a school's alumni page) and click
**Capture contacts** in the extension's side panel. It reads the people on that page and
shows them for review. Anyone it isn't sure about (no clear name, no company) starts
unticked, with the reason shown. Fix a company if needed, set a source group (remembered
per site), and click **Save**. If the app isn't running, the capture is kept in the
extension and saved once the app is back. Already-saved people are merged, not
duplicated: their details are refreshed, but your own status, notes and last-contacted
date are never overwritten.

**Multi-page capture (opt-in).** Tick **Capture multiple pages** to let the panel step
through a directory for you. It only works in the tab you started it from, clicks the
site's own Next button (or scrolls the list), waits a random 4–10 seconds between pages,
and stops after 5 pages by default (25 at most). It also stops on a login page, a
security check, a page with nobody new, or when you click **Stop**, and keeps what it has
so far for review. It never opens individual profiles. The first time you use it on a
site you'll be warned that automated browsing may break that site's terms and put your
account at risk, and you have to accept before it runs.

**Seeing them on your applications.** Each row on the **Applications** tab has a
**Contacts (n)** button. Open it to see the names, and click a name to see everything
saved about that person. Status, last contacted and notes can be edited right there.
Firms are matched by name, so "J.P. Morgan", "JPMorgan Chase & Co." and "JPM" are the same
firm, but a near-miss is never guessed ("Citi" is not "Citizens Bank"). People at a firm
the app doesn't recognise land in the **Unassigned** list on the Contacts tab. Say which
company they belong to once, and that name is remembered for everyone else captured
under it.

**Deleting.** Delete one person from the Contacts tab, or use **Delete a source…** to
remove everyone saved under one source group (e.g. a society list you no longer want)
after a confirmation step.

**Export.** The XLSX export has a **Contacts** sheet, and the Contacts tab has its own
**Export CSV** (`bc-tracker-contacts.csv`).

### Contacts and privacy

- Contact data stays on your computer, in `app/data/contacts.json`. It is never sent
  anywhere else.
- B.C Tracker **never messages, emails, connects with or follows anyone**. Capture only
  reads pages you already have open, and it never guesses email addresses.
- You are responsible for how you use it. Follow the terms of each network you capture
  from (many alumni platforms and LinkedIn restrict automated collection), and the data
  protection law that applies to you. In the UK that's UK GDPR: only keep what you
  genuinely need for your own networking, keep it secure, and delete it (Delete a source…
  makes that easy) when you no longer need it.

## Accuracy rule: your profile is the only source

Everything B.C Tracker types into an application comes from your **Profile** page, nothing
else. On numbered sections (Workday's "Work Experience 1…N", "Education 1…N") each card is
rebuilt from the matching profile entry. Card 2 is your second saved job, in full: fields
your profile leaves blank are **cleared** (and listed under "worth a second look"), so text
the site put there can't survive. After filling, every field is read back. Anything the site
didn't accept is flagged with the exact value it should have, and so is a card with no
matching profile entry ("delete this card") or a profile entry with no card ("click Add
Another").

On Workday, choose **Apply Manually** rather than "Autofill with Resume". Workday's CV parser
regularly invents entries (e.g. a "LEADERSHIP" job) and merges lines from one job into
another. B.C Tracker will overwrite and flag them, but starting clean is simpler.

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
- `app/data/contacts.json` — your contacts (gitignored)
- `app/data/cv/` — uploaded CVs / cover letters (gitignored)
- `app/data/backups/` — automatic timestamped snapshots taken before every write to the
  files above (gitignored) — recovery copies if something ever gets overwritten by mistake
