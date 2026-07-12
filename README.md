# Career & Study Dashboard

A fully static, offline-first personal dashboard for a Data Engineer preparing to switch jobs.
Journal, study timer, job pipeline, Gmail application tracker, reminders, learnings, practice
tests, and a study library — all in one place.

No build tools, no frameworks, no external network requests. Pure vanilla HTML/CSS/JS.
Works by double-clicking `index.html` (a `file://` URL) or hosted on GitHub Pages.

## What's in the box

```
career-dashboard/
├── index.html      ← the whole app shell (open this)
├── style.css       ← theme (dark default, amber accent) + layout
├── app.js          ← all logic (storage, router, views, xlsx parser)
├── library/        ← study guides (open as separate pages)
│   ├── DE_Theory_Bible_2026.html
│   └── DE_Bible_2026.html
└── tests/
    └── DE-100_Mock_Test.html
```

Everything you enter is stored **locally in your browser** (`localStorage`). Nothing is uploaded
anywhere. Different origins (e.g. `file://` vs a Pages URL) keep separate data — use the
Export/Import backup to move between them.

## Using it

- **Left sidebar** navigates between sections. URLs are hash-based (`#/jobs`), so bookmarks and the
  browser back button work.
- **Quick-add button** (the `+` bottom-right) adds a Reminder / Journal note / Job / Learning from
  any screen.
- **Global search** (top-left, or press `/`) searches journal, learnings, jobs, and reminders.
- **Theme** toggles dark/light (bottom-left, or in Data & Settings). Defaults to your OS preference.
- Press `Esc` to close any modal.

### Sections

- **Home** – reminders due, jobs needing follow-up, a quick-journal box, the study-timer widget, and
  a "This week" review.
- **Journal** – one card per day; new notes append with a timestamp. Supports markdown-lite
  (`**bold**`, `*italic*`, `- bullets`).
- **Study Timer** – a stopwatch (logs sessions ≥ 60s, survives page refresh) and a countdown that
  beeps (Web Audio) and fires a notification when done. 14-day bar chart + streak.
- **Jobs** – Kanban (drag cards between columns) or sortable Table. Marking a job **Applied**
  auto-creates a follow-up reminder. Includes a pinned "before applying" checklist and a snippets
  drawer with copy buttons.
- **Gmail Tracker** – the Gmail-imported subset of your jobs, with Action-Needed / Rejected / All
  tabs.
- **Reminders** – grouped Overdue / Today / Upcoming / Done; notifications fire at due time while the
  app is open.
- **Learnings** – dated notes with tags, grouped by month, filterable by tag or text.
- **Practice** – log test attempts and per-topic scores; topics below the threshold are flagged
  "needs review"; weak questions get a reviewed checkbox.
- **Library / Practice test files** – link cards to the study guides and mock test.
- **Data & Settings** – backup/restore, theme, notifications, follow-up days, practice threshold,
  storage usage, and a clear-all danger zone.

## Periodic Gmail import

Your Gmail activity is summarised by a Claude-generated workbook, `Job_Applications_Tracker.xlsx`,
with a sheet named **"All Applications & Postings"** and columns:

```
Date | Company | Role / Title | Source / Platform | Stage | Headline (from email body) | Email Link
```

To import:

1. Go to **Jobs → Import (xlsx/csv)** (or **Gmail Tracker → Import tracker**).
2. Choose your `.xlsx` (or a `.csv` with the same columns).
3. The file is parsed **entirely in your browser** — it is never uploaded. You'll see a summary:
   *X new, Y updated, Z skipped*.

Import is **idempotent**: re-import anytime. Rows are de-duplicated by **Email Link + Company +
Role** (a single digest email can mention several different jobs, so the link alone isn't unique);
rows without an email link fall back to company+role+date. Existing jobs are updated if their stage changed, but a status you manually
advanced to **Interview** or **Offer** is never downgraded by a re-import. `System/Account` rows are
skipped. The tracker's `LAST_RUN_DATE` (from its "Run Log" sheet) becomes the "Data as of" date.

The `.xlsx` parser is native (no SheetJS): it reads the ZIP central directory, inflates entries with
the browser's `DecompressionStream('deflate-raw')`, and parses the XML with `DOMParser`. Requires a
modern browser (Chrome/Edge/Firefox, or Safari 16.4+).

## Adding weekly test files

Drop a new self-contained quiz HTML file into the `tests/` folder, then in **Practice → Test files**
enter a display name and the filename. It appears as a link card — no code changes. The same
"register a file" option exists in **Library** for new study guides in `library/`.

## Backup & restore

- **Export** (Data & Settings) downloads `career-dashboard-backup-YYYY-MM-DD.json` containing every
  `dashboard_*` key.
- **Import** restores it, with two modes:
  - **Replace all** — overwrites everything (confirmation required).
  - **Merge** — keeps existing items and adds/updates by `id`; where both have an `updatedAt`, the
    newer wins.

The file's shape is validated before anything is written; an invalid file changes nothing.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository (files at the repo root).
2. Repo **Settings → Pages**.
3. Under **Build and deployment**, set **Source = Deploy from a branch**, **Branch = `main`**,
   **Folder = `/ (root)`**, then Save.
4. Your dashboard is served at `https://<username>.github.io/<repo>/`.

Because it's fully static with no external requests, it also runs by just opening `index.html`
locally.

## Passcode lock (optional)

**Data & Settings → Passcode lock** adds a passcode screen shown whenever the site is opened, and
re-asks each new session. Set it per device; it's stored only as a one-way hash on that device
(never the passcode itself, never in the code) and is deliberately left out of the JSON backup.

It is a **light privacy curtain, not strong security**: because this is a public static site, the
code is visible and your data remains readable in browser devtools by anyone holding an unlocked
device. It keeps casual visitors and over-the-shoulder snoopers out — nothing more. For genuine
protection you'd put the site behind an edge login gate (e.g. Cloudflare Access, free).

## Privacy & safety

- No network requests, no analytics, no `eval`.
- All user-entered content is HTML-escaped before rendering (XSS-safe throughout).
- All data lives only in your browser's `localStorage` on the machine you use.
