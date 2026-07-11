# Career & Study Dashboard — Implementation Brief

**Owner:** Deepesh Niranjan — Data Engineer at Jio Platforms Limited, Mumbai. Preparing for Data Engineer job switch.
**Deliverable:** A fully static personal dashboard website in `/Users/deepeshniranjan/Claude/career-dashboard/` — `index.html`, `style.css`, `app.js` at the repo root. No build tools, no frameworks, no external CDNs (must work offline and on GitHub Pages). Vanilla HTML/CSS/JS only.

## Already in place (do NOT rebuild these)
- `library/DE_Theory_Bible_2026.html` — theory study guide (self-contained, has own sidebar/search/dark mode)
- `library/DE_Bible_2026.html` — Q&A style study guide (self-contained)
- `tests/DE-100_Mock_Test.html` — 100-question mock test (self-contained quiz app)

These open as separate pages via plain `<a href target="_blank">` links from the dashboard. Do not inline or iframe-embed them by default (they're 0.8–1.1 MB each); a simple link card with description is correct.

## Global design requirements
- Left sidebar navigation (collapsible on mobile via hamburger) with sections: **Home · Journal · Study Timer · Jobs · Gmail Tracker · Reminders · Learnings · Practice · Library · Data & Settings**. SPA-style: one `index.html`, sections shown/hidden via JS routing on `location.hash` (e.g. `#/jobs`) so views are bookmarkable and back-button works.
- Dark mode toggle (persisted in settings; respect `prefers-color-scheme` as initial default). Use CSS custom properties for theming. Aesthetic direction: match the existing assets — dark slate/navy panels, amber accent, `Inter`-ish system font stack + monospace for numbers/tags (use system fonts, no Google Fonts since no external requests).
- Fully responsive down to 375px phone width.
- **Quick-add floating action button (FAB)** visible on every view: opens a small modal with tabs to add a Reminder / Journal note / Job / Learning in one step.
- **Global search** in the sidebar: searches journal entries, learnings, job company/role/notes, reminders — results grouped by type, clicking navigates to the item.
- Keyboard-friendly: `/` focuses global search, `Esc` closes modals.
- Toast notifications for actions (saved, imported, deleted with Undo for deletes).

## Storage (localStorage, all JSON)
- `dashboard_journal` → `[{ id, date (YYYY-MM-DD), ts, text, tags[] }]`
- `dashboard_jobs` → `[{ id, company, role, link, dateApplied, status, notes, tags[], source, gmailStage?, emailLink?, headline?, createdAt, updatedAt }]`
- `dashboard_reminders` → `[{ id, text, dueDate, done, linkedJobId?, createdAt }]`
- `dashboard_learnings` → `[{ id, date, topic, text, tags[] }]`
- `dashboard_practice` → `[{ id, week, date, testName, topic?, score, total, weakTopics[], weakQuestions[], notes }]`
- `dashboard_snippets` → `[{ id, label, text }]`
- `dashboard_sessions` → study timer session log `[{ id, date, startTs, seconds, label? }]`
- `dashboard_notes_pinned` → the "before applying" checklist: `[{ id, text, checked }]`
- `dashboard_settings` → `{ theme, notificationsEnabled, followUpDays (default 7), practiceThreshold (default 70), gmailLastImport }`
- Use a tiny storage module with get/set + JSON parse guards. `id` = `Date.now().toString(36) + random`. Wrap all writes so a schema version key `dashboard_meta = {version:1}` exists for future migrations.

## Sections

### 1. Home (`#/`)
Single glanceable screen:
- Greeting + today's date.
- **Reminders due** (today or overdue; overdue highlighted red) with done-checkbox inline.
- **Jobs needing follow-up**: status "Applied" with a linked reminder due/overdue, plus all "Action Needed" gmail-stage jobs. Each row links to the job.
- **Quick journal box**: textarea + save appends to today's journal entry.
- **Study timer widget**: compact start/pause + today's total; links to full timer view.
- **This week mini-stats**: hours studied, applications sent, learnings logged, practice tests taken (computed Mon–Sun).

### 2. Journal (`#/journal`)
- One card per day, newest first. Adding text on a day that already has an entry appends with a `— HH:MM` timestamp line.
- Markdown-lite render: `**bold**`, `*italic*`, `- bullets`, line breaks. Write a small safe renderer (escape HTML first, then apply formatting). NO innerHTML of raw user input anywhere in the app — XSS-safe rendering throughout.
- Search box filters by keyword; date picker jumps to a date.

### 3. Study Timer (`#/timer`)
- **Stopwatch mode**: start/pause/reset; on pause/stop ≥60s, log a session (with optional label e.g. "SQL practice"). Persist running state (`startTs` in localStorage) so a page refresh doesn't lose the session — recompute elapsed from wall clock, never setInterval-accumulate.
- **Countdown/alarm mode**: preset buttons (25/45/60 min) + custom; on completion play a beep (generate via Web Audio API oscillator — no audio file) and fire a browser Notification (request permission on first enable in settings). Show remaining time in the document title while running.
- **History**: per-day totals, current week total, streak counter (consecutive days with ≥1 session). Simple bar chart for last 14 days (pure CSS/inline SVG, no chart libs).

### 4. Jobs (`#/jobs`)
- Statuses: `Saved → Applied → Interview → Offer` plus `Rejected` and `Action Needed`.
- Two views (toggle, persisted): **Kanban** (columns by status, cards draggable via HTML5 drag & drop) and **Table** (sortable by date/company/status, filterable by status/tag/search).
- Add/edit modal: Company, Role, Link, Date Applied, Status, Notes, Tags (comma or chip input), Source.
- **Marking a job "Applied" auto-creates a follow-up reminder** dated +`followUpDays` (default 7, from settings), text "Follow up: {company} — {role}", linked via `linkedJobId`. Show a toast with "edit reminder" link. Don't duplicate if one already exists for that job.
- **Pinned "Notes to Remember Before Applying"** panel: always-visible collapsible checklist block at top of Jobs view; items add/edit/check/uncheck (`dashboard_notes_pinned`). Seed with: "Tailor resume keywords to the JD", "Check for referral first", "Attach portfolio link", "Save the JD text before it's taken down".
- **Snippets drawer** in Jobs view: the 2–3 saved intro/cover-note texts with one-click Copy buttons; add/edit/delete snippets.
- Bulk import button (shared importer, see Gmail Tracker below) + "Add manually".

### 5. Gmail Tracker (`#/gmail`)
Same `dashboard_jobs` store, this view filters to `source === 'gmail'` with status tabs: **Action Needed · Rejected · All gmail**. Header shows "Data as of {gmailLastImport}".

**Importer (critical feature):** file input accepting `.xlsx` and `.csv`.
- The xlsx is a known, Claude-generated workbook: `Job_Applications_Tracker.xlsx`, sheet named **"All Applications & Postings"**, header row: `Date | Company | Role / Title | Source / Platform | Stage | Headline (from email body) | Email Link`. There is also a "Run Log" sheet with `LAST_RUN_DATE` in row 2 col B — read it if present to set `gmailLastImport`, else use today.
- **Parse .xlsx natively — no SheetJS, no external libs.** Implementation: xlsx is a ZIP. Read the file as ArrayBuffer, parse the ZIP End-of-Central-Directory + central directory entries (handle both stored (method 0) and deflate (method 8); inflate via native `DecompressionStream('deflate-raw')` — Safari 16.4+/Chrome/Firefox all support it). Extract `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/sharedStrings.xml` (may be absent), and the target sheet XML. Parse cell XML with `DOMParser`: handle `t="s"` shared strings, `t="inlineStr"` (`<is><t>`), `t="str"`, and numeric cells; handle date serial numbers (Excel epoch 1899-12-30) → YYYY-MM-DD, though this workbook stores dates as strings. Find the sheet by name from workbook.xml sheet list → r:id → rels target. Column letters from cell `r` attributes (don't assume dense rows).
- CSV fallback: robust CSV parse (quoted fields, commas, newlines in quotes) expecting the same 7 columns; also accept simpler CSVs mapping by fuzzy header match (company/role/date/status/link).
- **Stage → status mapping:** `Applied`, `Applied-Acknowledged` → Applied · `Rejected` → Rejected · `Interview` → Interview · `Action Needed`, `Recruiter Outreach` → Action Needed · `Job Alert/Rec` → Saved · `System/Account` → **skip** (not a job). Preserve original in `gmailStage`, keep `headline` and `emailLink` (rendered as "Open email" link).
- **Idempotent re-import** (user re-imports periodically): dedupe key = `emailLink` if present, else `company|role|date` lowercased. Existing records update stage/status if changed (but never downgrade a manually-set status backwards from Interview/Offer); new records append. After import show a summary: X new, Y updated, Z skipped.
- Every gmail job row has a quick **"⏰ Remind me"** action → creates a reminder linked to that job (prompt for date + note, default tomorrow). Action Needed items also surface on Home.

### 6. Reminders (`#/reminders`)
- List grouped: Overdue / Today / Upcoming / Done (collapsed). Add with text + due date; toggle done; edit; delete.
- If `linkedJobId`, show company/role chip linking to the job.
- Browser Notification at due time while app is open (check every minute via one global interval; notify once per reminder, track `notifiedAt`).

### 7. Learnings (`#/learnings`)
- Entries: date, topic, text (markdown-lite), tags. Filter by tag chips + text search. Newest first, grouped by month.
- Tag vocabulary is **shared app-wide**: one helper collects all tags across jobs/learnings/journal and offers them as autocomplete suggestions in every tag input.

### 8. Practice (`#/practice`)
- Log a test attempt: week (auto = ISO week of date), test name (default "DE-100"), score, total (default 100), per-topic breakdown optional (topic + score/total rows, addable), weak questions notes.
- Table of attempts + line/bar of scores over weeks (inline SVG).
- **Topics below `practiceThreshold` (default 70%) auto-flagged "needs review"** — red chip list at top, aggregated across attempts (latest attempt per topic wins).
- **Weak spots list**: running list built from logged weak questions; each has "reviewed" checkbox.
- **Test files section**: card linking to `tests/DE-100_Mock_Test.html` (target _blank). Plus "Register a test file" — user drops future weekly HTML files into `tests/` and adds name + filename via a small form; stored in settings so new weekly tests appear without code changes. Show hint text explaining the drop-into-`tests/`-folder convention.

### 9. Library (`#/library`)
Cards for the two bibles (`library/DE_Theory_Bible_2026.html`, `library/DE_Bible_2026.html`) with descriptions ("Theory deep-dives" / "Q&A drill format") + open-in-new-tab. Same register-a-file option for future additions.

### 10. Data & Settings (`#/settings`)
- **Export All Data**: one JSON file `career-dashboard-backup-YYYY-MM-DD.json` containing every `dashboard_*` key + meta version — via Blob download.
- **Import**: file input restoring that JSON. Two modes: **Replace all** (confirm dialog) and **Merge** (by id; newer `updatedAt` wins where present, else keep existing). Validate shape before touching storage; on invalid file show error and change nothing.
- Theme toggle, notifications enable (requests permission), follow-up days, practice threshold.
- Storage usage indicator (rough KB used).
- Danger zone: clear all data (double confirm).

### Weekly auto-summary
On Home, a "Week in review" card (for current week, and last week's snapshot Mon morning): hours studied, applications sent (jobs whose dateApplied ∈ week), learnings logged, tests taken + best score, reminders completed. Pure computation from stores — no storage needed except nothing.

## Quality bar
- No external network requests anywhere. No eval. All user content rendered XSS-safe (escape-then-format helper used everywhere).
- Every list re-render must be idempotent; state lives in the stores, views are pure render functions. Keep app.js organized with clear section comments: `// ===== Storage =====`, `// ===== Router =====`, per-view modules, `// ===== XLSX parser =====` etc.
- Handle empty states with friendly prompts ("No jobs yet — import your Gmail tracker or add one").
- Dates: use local time consistently; week = Monday-start.
- Test the xlsx parser logic carefully: ZIP parsing must locate entries via central directory (EOCD scan from end), not assume file order.
- Write a concise `README.md`: what it is, how to use, how to deploy to GitHub Pages (repo → Settings → Pages → main root), how to do the periodic Gmail import, how to add weekly test files, how to back up.

Everything must work by opening `index.html` from a local file:// URL as well as GitHub Pages (note: DecompressionStream works on file:// too; avoid fetch() of local files — the importer uses FileReader on user-selected files, and library/tests are plain links).
