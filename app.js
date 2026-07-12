/* ============================================================================
   Career & Study Dashboard — app.js
   Vanilla JS SPA. No frameworks, no external requests, no eval.
   Sections:
     - Utilities (escape / markdown-lite / dates / DOM)
     - Storage layer
     - Toasts & Modal
     - Theme
     - Router
     - Reminder engine (follow-ups + notifications)
     - Global search
     - Quick-add FAB
     - Views: Home, Journal, Timer, Jobs, Gmail, Reminders, Learnings,
              Practice, Library, Settings
     - XLSX / CSV parser + Gmail import
     - Export / Import backup
     - Init
   ============================================================================ */
'use strict';

/* ============================ Utilities ================================== */

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Markdown-lite: escape first, THEN apply a tiny safe subset. XSS-safe.
function fmtMd(raw) {
  if (!raw) return '';
  const lines = String(raw).split(/\r?\n/);
  let html = '', inList = false;
  for (let line of lines) {
    let e = esc(line);
    e = e.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    e = e.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + e.replace(/^\s*[-*]\s+/, '') + '</li>';
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim() === '') html += '';
      else html += '<p>' + e + '</p>';
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function pad2(n) { return String(n).padStart(2, '0'); }

function todayStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function parseLocalDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function fmtDateHuman(s) {
  const d = parseLocalDate(s);
  if (!d) return esc(s || '');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function hhmm(d) { d = d || new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

// Monday-start week
function weekStart(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - day);
  return x;
}
function weekEnd(d) { const x = weekStart(d); x.setDate(x.getDate() + 7); return x; } // exclusive
function inThisWeek(dateStr, ref) {
  const d = parseLocalDate(dateStr); if (!d) return false;
  const ws = weekStart(ref || new Date()), we = weekEnd(ref || new Date());
  return d >= ws && d < we;
}
// ISO week label like 2026-W28
function isoWeek(dateStr) {
  const d = parseLocalDate(dateStr) || new Date();
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - day + 3); // Thursday
  const firstThu = new Date(t.getFullYear(), 0, 4);
  const w = 1 + Math.round(((t - firstThu) / 86400000 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
  return t.getFullYear() + '-W' + pad2(w);
}

function fmtSeconds(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h > 0 ? h + ':' + pad2(m) : m) + ':' + pad2(s);
}
function fmtHours(sec) { return (sec / 3600).toFixed(1); }

function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

// Only allow http(s) links from user/imported data; blocks javascript: etc.
function safeHref(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    const u = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : 'https://' + s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch (e) { /* not a URL */ }
  return '';
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

/* ============================ Storage layer ============================== */

const KEYS = {
  journal: 'dashboard_journal',
  jobs: 'dashboard_jobs',
  reminders: 'dashboard_reminders',
  learnings: 'dashboard_learnings',
  practice: 'dashboard_practice',
  snippets: 'dashboard_snippets',
  sessions: 'dashboard_sessions',
  notesPinned: 'dashboard_notes_pinned',
  settings: 'dashboard_settings',
  meta: 'dashboard_meta',
};
const ALL_KEYS = Object.keys(KEYS).map(function (k) { return KEYS[k]; });

const DEFAULT_SETTINGS = {
  theme: '', notificationsEnabled: false, followUpDays: 7,
  practiceThreshold: 70, gmailLastImport: '', jobsView: 'kanban',
  testFiles: [], libraryFiles: [],
};

const Store = {
  get: function (key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Store.get parse failed for', key, e);
      return fallback;
    }
  },
  set: function (key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      // Ensure meta version exists on every write for future migrations.
      if (!localStorage.getItem(KEYS.meta)) {
        localStorage.setItem(KEYS.meta, JSON.stringify({ version: 1 }));
      }
      return true;
    } catch (e) {
      toast('Storage error: ' + e.message);
      return false;
    }
  },
  // Typed accessors
  journal: function () { return Store.get(KEYS.journal, []); },
  jobs: function () { return Store.get(KEYS.jobs, []); },
  reminders: function () { return Store.get(KEYS.reminders, []); },
  learnings: function () { return Store.get(KEYS.learnings, []); },
  practice: function () { return Store.get(KEYS.practice, []); },
  snippets: function () { return Store.get(KEYS.snippets, []); },
  sessions: function () { return Store.get(KEYS.sessions, []); },
  notesPinned: function () { return Store.get(KEYS.notesPinned, []); },
  settings: function () {
    const s = Store.get(KEYS.settings, {});
    return Object.assign({}, DEFAULT_SETTINGS, s || {});
  },
  saveSettings: function (patch) {
    const s = Object.assign({}, Store.settings(), patch);
    Store.set(KEYS.settings, s);
    return s;
  },
};

function seedIfEmpty() {
  if (!localStorage.getItem(KEYS.meta)) Store.set(KEYS.meta, { version: 1 });
  if (Store.get(KEYS.notesPinned, null) === null) {
    Store.set(KEYS.notesPinned, [
      { id: uid(), text: 'Tailor resume keywords to the JD', checked: false },
      { id: uid(), text: 'Check for referral first', checked: false },
      { id: uid(), text: 'Attach portfolio link', checked: false },
      { id: uid(), text: "Save the JD text before it's taken down", checked: false },
    ]);
  }
  if (Store.get(KEYS.snippets, null) === null) {
    Store.set(KEYS.snippets, [
      { id: uid(), label: 'Referral ask', text: 'Hi {name}, I noticed {company} is hiring for a Data Engineer role. I have 3+ years building data pipelines at Jio. Would you be open to referring me? Happy to share my resume. Thanks!' },
      { id: uid(), label: 'Cold cover note', text: 'Hello, I\'m applying for the Data Engineer position. My background: Spark, Airflow, SQL, cloud data warehousing, and production ETL at scale. Resume + portfolio attached. I\'d love to discuss how I can contribute.' },
    ]);
  }
}

/* Aggregate all tags app-wide for autocomplete */
function allTags() {
  const set = new Set();
  const add = function (arr) { (arr || []).forEach(function (t) { if (t) set.add(String(t).trim()); }); };
  Store.jobs().forEach(function (j) { add(j.tags); });
  Store.learnings().forEach(function (l) { add(l.tags); });
  Store.journal().forEach(function (e) { add(e.tags); });
  return Array.prototype.slice.call(set).sort();
}
function tagDatalistHtml(id) {
  return '<datalist id="' + id + '">' +
    allTags().map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist>';
}
function parseTags(str) {
  return String(str || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
}

/* ============================ Toasts & Modal ============================= */

function toast(msg, opts) {
  opts = opts || {};
  const host = $('#toastHost');
  const t = document.createElement('div');
  t.className = 'toast';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  if (opts.actionLabel && typeof opts.onAction === 'function') {
    const b = document.createElement('button');
    b.className = 'toast-btn';
    b.textContent = opts.actionLabel;
    b.addEventListener('click', function () { opts.onAction(); host.removeChild(t); });
    t.appendChild(b);
  }
  host.appendChild(t);
  setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, opts.duration || 5000);
}

// Modal: content is an HTMLElement or html string; returns handle with close().
let modalCloser = null;
function openModal(titleHtml, bodyEl, footEl) {
  closeModal();
  const host = $('#modalHost');
  host.hidden = false;
  host.innerHTML = '';
  const modal = document.createElement('div');
  modal.className = 'modal';
  const head = document.createElement('div');
  head.className = 'modal-head';
  const h = document.createElement('h2'); h.innerHTML = titleHtml; head.appendChild(h);
  const close = document.createElement('button');
  close.className = 'btn sm icon close'; close.innerHTML = '&times;';
  close.addEventListener('click', closeModal);
  head.appendChild(close);
  modal.appendChild(head);
  const body = document.createElement('div'); body.className = 'modal-body';
  if (typeof bodyEl === 'string') body.innerHTML = bodyEl; else body.appendChild(bodyEl);
  modal.appendChild(body);
  if (footEl) { const foot = document.createElement('div'); foot.className = 'modal-foot'; foot.appendChild(footEl); modal.appendChild(foot); }
  host.appendChild(modal);
  host.onclick = function (e) { if (e.target === host) closeModal(); };
  modalCloser = closeModal;
  // Focus first field
  const first = modal.querySelector('input,textarea,select,button.btn');
  if (first) setTimeout(function () { first.focus(); }, 30);
  return { close: closeModal, body: body };
}
function closeModal() {
  const host = $('#modalHost');
  host.hidden = true; host.innerHTML = ''; host.onclick = null; modalCloser = null;
}

/* ============================ Theme ===================================== */

function applyTheme() {
  const s = Store.settings();
  let theme = s.theme;
  if (!theme) {
    theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', theme);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = cur === 'light' ? 'dark' : 'light';
  Store.saveSettings({ theme: next });
  document.documentElement.setAttribute('data-theme', next);
}

/* ============================ Passcode lock ============================= */
/* A light privacy curtain for a PUBLIC static site. It stores only a one-way
   hash of the passcode on this device (never the passcode, never in the repo)
   and re-asks each new browser session. It is NOT strong security: the code is
   public and local data remains readable via devtools. It just keeps casual
   eyes out. Real protection would need an edge login gate (Cloudflare Access). */

const LOCK_KEY = 'dashboard_lock';            // { enabled, hash } — device-local, NOT exported
const UNLOCK_SESSION_KEY = 'dashboard_unlocked';
const LOCK_SALT = 'ccdash:v1:';

async function sha256Hex(str) {
  if (window.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  // Fallback for insecure contexts (e.g. file://) where crypto.subtle is absent.
  let h = 5381;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) + h) + str.charCodeAt(i); h |= 0; }
  return 'f' + (h >>> 0).toString(16);
}
function getLock() { return Store.get(LOCK_KEY, { enabled: false, hash: '' }); }
function isLocked() {
  const l = getLock();
  return !!(l.enabled && l.hash) && sessionStorage.getItem(UNLOCK_SESSION_KEY) !== '1';
}
async function setLockPasscode(pw) {
  const hash = await sha256Hex(LOCK_SALT + pw);
  Store.set(LOCK_KEY, { enabled: true, hash: hash });
}
function removeLock() {
  Store.set(LOCK_KEY, { enabled: false, hash: '' });
  sessionStorage.removeItem(UNLOCK_SESSION_KEY);
}
async function verifyPasscode(pw) {
  const l = getLock();
  return !!l.hash && (await sha256Hex(LOCK_SALT + pw)) === l.hash;
}
function showLockScreen(onUnlock) {
  const ov = document.createElement('div');
  ov.className = 'lock-screen';
  ov.innerHTML =
    '<div class="lock-box"><div class="lock-mark">DE</div>' +
    '<h1>Locked</h1><p class="faint">Enter your passcode to open the dashboard.</p>' +
    '<input id="lock-input" type="password" autocomplete="current-password" placeholder="Passcode" aria-label="Passcode">' +
    '<button class="btn primary" id="lock-go">Unlock</button>' +
    '<div id="lock-err" class="lock-err" aria-live="polite"></div></div>';
  document.body.appendChild(ov);
  const input = ov.querySelector('#lock-input');
  const err = ov.querySelector('#lock-err');
  setTimeout(function () { input.focus(); }, 30);
  async function tryUnlock() {
    if (await verifyPasscode(input.value)) {
      sessionStorage.setItem(UNLOCK_SESSION_KEY, '1');
      ov.remove();
      onUnlock();
    } else {
      err.textContent = 'Wrong passcode.';
      input.value = ''; input.focus();
    }
  }
  ov.querySelector('#lock-go').addEventListener('click', tryUnlock);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryUnlock(); });
}

/* ============================ Router ==================================== */

const routes = {
  '/': { title: 'Home', render: viewHome },
  '/journal': { title: 'Journal', render: viewJournal },
  '/timer': { title: 'Study Timer', render: viewTimer },
  '/jobs': { title: 'Jobs', render: viewJobs },
  '/gmail': { title: 'Gmail Tracker', render: viewGmail },
  '/reminders': { title: 'Reminders', render: viewReminders },
  '/learnings': { title: 'Learnings', render: viewLearnings },
  '/practice': { title: 'Practice', render: viewPractice },
  '/library': { title: 'Library', render: viewLibrary },
  '/settings': { title: 'Data & Settings', render: viewSettings },
};

function currentRoute() {
  let hash = location.hash.replace(/^#/, '');
  if (!hash || hash === '/') return { path: '/', query: {} };
  const [path, qs] = hash.split('?');
  const query = {};
  if (qs) qs.split('&').forEach(function (kv) { const [k, v] = kv.split('='); query[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
  return { path: path, query: query };
}

function router() {
  const r = currentRoute();
  const route = routes[r.path] || routes['/'];
  $all('.nav-item').forEach(function (a) {
    a.classList.toggle('active', a.getAttribute('data-route') === r.path);
  });
  document.title = route.title + ' · Career Dashboard';
  const view = $('#view');
  view.innerHTML = '';
  try {
    route.render(r.query);
  } catch (e) {
    console.error(e);
    view.innerHTML = '<div class="card"><h2>Something went wrong rendering this view</h2><pre class="faint">' + esc(e.stack || e.message) + '</pre></div>';
  }
  view.focus();
  window.scrollTo(0, 0);
  // Close mobile nav on navigation
  $('#app').classList.remove('nav-open');
  $('#scrim').hidden = true;
}

function navigate(path) { location.hash = '#' + path; }

/* ============================ Reminder engine =========================== */

// Create a follow-up reminder for a job when it becomes Applied. Idempotent per job.
function ensureFollowUp(job) {
  const reminders = Store.reminders();
  const exists = reminders.some(function (r) { return r.linkedJobId === job.id && !r.done; });
  if (exists) return null;
  const days = Store.settings().followUpDays || 7;
  const due = new Date(); due.setDate(due.getDate() + days);
  const rem = {
    id: uid(),
    text: 'Follow up: ' + job.company + ' — ' + job.role,
    dueDate: todayStr(due),
    done: false,
    linkedJobId: job.id,
    createdAt: Date.now(),
  };
  reminders.push(rem);
  Store.set(KEYS.reminders, reminders);
  return rem;
}

// Notification loop: check every minute for due, unnotified reminders.
let reminderInterval = null;
function startReminderLoop() {
  if (reminderInterval) clearInterval(reminderInterval);
  checkDueReminders();
  reminderInterval = setInterval(checkDueReminders, 60 * 1000);
}
function checkDueReminders() {
  const s = Store.settings();
  if (!s.notificationsEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const reminders = Store.reminders();
  const now = new Date();
  let changed = false;
  reminders.forEach(function (r) {
    if (r.done || r.notifiedAt) return;
    const due = parseLocalDate(r.dueDate);
    if (due && due <= new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      try {
        new Notification('Reminder due', { body: r.text });
        r.notifiedAt = Date.now();
        changed = true;
      } catch (e) { /* ignore */ }
    }
  });
  if (changed) Store.set(KEYS.reminders, reminders);
}

/* ============================ Global search ============================= */

function runGlobalSearch(q) {
  const box = $('#globalSearchResults');
  q = q.trim().toLowerCase();
  if (!q) { box.hidden = true; box.innerHTML = ''; return; }
  const results = { Journal: [], Learnings: [], Jobs: [], Reminders: [] };
  Store.journal().forEach(function (e) {
    if ((e.text || '').toLowerCase().indexOf(q) >= 0)
      results.Journal.push({ label: e.date + ' — ' + (e.text || '').slice(0, 50), route: '/journal' });
  });
  Store.learnings().forEach(function (l) {
    if (((l.topic || '') + ' ' + (l.text || '')).toLowerCase().indexOf(q) >= 0)
      results.Learnings.push({ label: (l.topic || 'Learning') + ' — ' + (l.text || '').slice(0, 40), route: '/learnings' });
  });
  Store.jobs().forEach(function (j) {
    if (((j.company || '') + ' ' + (j.role || '') + ' ' + (j.notes || '')).toLowerCase().indexOf(q) >= 0)
      results.Jobs.push({ label: (j.company || '?') + ' — ' + (j.role || ''), route: '/jobs?job=' + j.id });
  });
  Store.reminders().forEach(function (r) {
    if ((r.text || '').toLowerCase().indexOf(q) >= 0)
      results.Reminders.push({ label: r.text, route: '/reminders' });
  });
  let html = '';
  let any = false;
  Object.keys(results).forEach(function (grp) {
    const items = results[grp];
    if (!items.length) return;
    any = true;
    html += '<div class="sr-group">' + grp + '</div>';
    items.slice(0, 6).forEach(function (it) {
      html += '<a href="#' + esc(it.route) + '" data-close-search>' + esc(it.label) + '</a>';
    });
  });
  if (!any) html = '<div class="sr-empty">No matches.</div>';
  box.innerHTML = html;
  box.hidden = false;
}

/* ============================ Quick-add FAB ============================= */

function openQuickAdd(defaultTab) {
  const tabs = ['Reminder', 'Journal', 'Job', 'Learning'];
  const body = document.createElement('div');
  const tabBar = document.createElement('div'); tabBar.className = 'tabs';
  const pane = document.createElement('div');
  body.appendChild(tabBar); body.appendChild(pane);
  let active = defaultTab || 'Reminder';

  function renderPane() {
    $all('button', tabBar).forEach(function (b) { b.classList.toggle('active', b.textContent === active); });
    if (active === 'Reminder') {
      pane.innerHTML =
        '<label class="field"><span>Reminder text</span><input id="qa-text" placeholder="e.g. Follow up with recruiter"></label>' +
        '<label class="field"><span>Due date</span><input id="qa-date" type="date" value="' + todayStr() + '"></label>';
    } else if (active === 'Journal') {
      pane.innerHTML = '<label class="field"><span>Today\'s note (appends to today)</span><textarea id="qa-text" placeholder="What happened / what you learned"></textarea></label>';
    } else if (active === 'Job') {
      pane.innerHTML =
        '<label class="field"><span>Company</span><input id="qa-company"></label>' +
        '<label class="field"><span>Role</span><input id="qa-role"></label>' +
        '<label class="field"><span>Status</span><select id="qa-status">' + JOB_STATUSES.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select></label>';
    } else if (active === 'Learning') {
      pane.innerHTML =
        '<label class="field"><span>Topic</span><input id="qa-topic"></label>' +
        '<label class="field"><span>What you learned</span><textarea id="qa-text"></textarea></label>';
    }
  }
  tabs.forEach(function (t) {
    const b = document.createElement('button'); b.textContent = t;
    b.addEventListener('click', function () { active = t; renderPane(); });
    tabBar.appendChild(b);
  });
  renderPane();

  const foot = document.createElement('div');
  const saveBtn = document.createElement('button'); saveBtn.className = 'btn primary'; saveBtn.textContent = 'Save';
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeModal);
  foot.appendChild(cancel); foot.appendChild(saveBtn);
  saveBtn.addEventListener('click', function () {
    if (active === 'Reminder') {
      const text = $('#qa-text').value.trim(); if (!text) return toast('Enter reminder text');
      const arr = Store.reminders();
      arr.push({ id: uid(), text: text, dueDate: $('#qa-date').value || todayStr(), done: false, createdAt: Date.now() });
      Store.set(KEYS.reminders, arr); toast('Reminder added');
    } else if (active === 'Journal') {
      const text = $('#qa-text').value.trim(); if (!text) return toast('Enter a note');
      appendJournal(text); toast('Journal updated');
    } else if (active === 'Job') {
      const company = $('#qa-company').value.trim(); if (!company) return toast('Enter a company');
      const job = newJob({ company: company, role: $('#qa-role').value.trim(), status: $('#qa-status').value, source: 'manual' });
      saveJob(job, true); toast('Job added');
    } else if (active === 'Learning') {
      const topic = $('#qa-topic').value.trim(); const text = $('#qa-text').value.trim();
      if (!topic && !text) return toast('Enter a topic or text');
      const arr = Store.learnings();
      arr.push({ id: uid(), date: todayStr(), topic: topic, text: text, tags: [] });
      Store.set(KEYS.learnings, arr); toast('Learning saved');
    }
    closeModal();
    router();
  });
  openModal('Quick add', body, foot);
}

/* ============================ Journal helpers ========================== */

function appendJournal(text) {
  const arr = Store.journal();
  const today = todayStr();
  const existing = arr.find(function (e) { return e.date === today; });
  if (existing) {
    existing.text = existing.text + '\n\n— ' + hhmm() + '\n' + text;
    existing.ts = Date.now();
  } else {
    arr.push({ id: uid(), date: today, ts: Date.now(), text: text, tags: [] });
  }
  Store.set(KEYS.journal, arr);
}

/* ============================ Job helpers ============================== */

const JOB_STATUSES = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected', 'Action Needed'];
const STATUS_RANK = { Saved: 0, Applied: 1, 'Action Needed': 1, Interview: 2, Offer: 3, Rejected: 1 };

function newJob(p) {
  p = p || {};
  const now = Date.now();
  return {
    id: uid(), company: p.company || '', role: p.role || '', link: p.link || '',
    dateApplied: p.dateApplied || '', status: p.status || 'Saved', notes: p.notes || '',
    tags: p.tags || [], source: p.source || 'manual',
    gmailStage: p.gmailStage || '', emailLink: p.emailLink || '', headline: p.headline || '',
    createdAt: now, updatedAt: now,
  };
}

function saveJob(job, isNew) {
  const arr = Store.jobs();
  job.updatedAt = Date.now();
  if (isNew) {
    arr.push(job);
  } else {
    const i = arr.findIndex(function (j) { return j.id === job.id; });
    if (i >= 0) arr[i] = job; else arr.push(job);
  }
  Store.set(KEYS.jobs, arr);
  if (job.status === 'Applied') {
    const rem = ensureFollowUp(job);
    if (rem) {
      toast('Follow-up reminder set +' + (Store.settings().followUpDays || 7) + 'd', {
        actionLabel: 'Edit', onAction: function () { navigate('/reminders'); }
      });
    }
  }
}

/* ============================ VIEW: Home =============================== */

function viewHome() {
  const view = $('#view');
  const now = new Date();
  const hr = now.getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';

  const reminders = Store.reminders();
  const today = todayStr();
  const dueReminders = reminders.filter(function (r) {
    return !r.done && r.dueDate && r.dueDate <= today;
  }).sort(function (a, b) { return (a.dueDate || '').localeCompare(b.dueDate || ''); });

  // Jobs needing follow-up
  const jobs = Store.jobs();
  const jobById = {}; jobs.forEach(function (j) { jobById[j.id] = j; });
  const followJobIds = new Set();
  reminders.forEach(function (r) {
    if (!r.done && r.linkedJobId && r.dueDate && r.dueDate <= today) followJobIds.add(r.linkedJobId);
  });
  const followJobs = [];
  followJobIds.forEach(function (id) { if (jobById[id]) followJobs.push(jobById[id]); });
  jobs.forEach(function (j) { if (j.status === 'Action Needed' && followJobs.indexOf(j) < 0) followJobs.push(j); });

  // Week stats
  const wk = weekReview(new Date());

  let html = '';
  html += '<div class="view-head"><h1>' + esc(greet) + ', Deepesh</h1>' +
    '<div class="sub">' + esc(fmtDateHuman(today)) + ' · Career & study dashboard</div></div>';

  html += '<div class="grid cols-2">';

  // Reminders due
  html += '<div class="card"><h2>&#9200; Reminders due</h2>';
  if (!dueReminders.length) html += '<div class="empty">Nothing due. Clear head, clear pipeline.</div>';
  else {
    html += '<div class="list">';
    dueReminders.forEach(function (r) {
      const overdue = r.dueDate < today;
      html += '<div class="list-item' + (overdue ? ' overdue' : '') + '">' +
        '<input type="checkbox" data-home-done="' + esc(r.id) + '">' +
        '<div class="li-main"><div class="li-title">' + esc(r.text) + '</div>' +
        '<div class="li-sub">' + (overdue ? 'Overdue · ' : 'Due · ') + esc(fmtDateHuman(r.dueDate)) +
        (r.linkedJobId && jobById[r.linkedJobId] ? ' · <a href="#/jobs?job=' + esc(r.linkedJobId) + '">' + esc(jobById[r.linkedJobId].company) + '</a>' : '') +
        '</div></div></div>';
    });
    html += '</div>';
  }
  html += '</div>';

  // Jobs needing follow-up
  html += '<div class="card"><h2>&#128188; Jobs needing follow-up</h2>';
  if (!followJobs.length) html += '<div class="empty">No follow-ups pending.</div>';
  else {
    html += '<div class="list">';
    followJobs.slice(0, 8).forEach(function (j) {
      html += '<a class="list-item" href="#/jobs?job=' + esc(j.id) + '" style="text-decoration:none;color:inherit">' +
        '<div class="li-main"><div class="li-title">' + esc(j.company) + ' — ' + esc(j.role) + '</div>' +
        '<div class="li-sub">' + statusBadge(j.status) + (j.gmailStage ? ' · ' + esc(j.gmailStage) : '') + '</div></div></a>';
    });
    html += '</div>';
    if (followJobs.length > 8) html += '<div class="row" style="margin-top:8px"><a class="btn sm" href="#/gmail?tab=Action%20Needed">View all ' + followJobs.length + ' →</a></div>';
  }
  html += '</div>';
  html += '</div>'; // end grid

  // Quick journal + timer widget
  html += '<div class="grid cols-2">';
  html += '<div class="card"><h2>&#9998; Quick journal</h2>' +
    '<textarea id="home-journal" placeholder="Log today\'s progress (appends to today)"></textarea>' +
    '<div class="row" style="margin-top:8px"><button class="btn primary" id="home-journal-save">Save to today</button>' +
    '<a class="btn" href="#/journal">Open journal</a></div></div>';

  const todaySecs = sessionSecondsOn(today);
  html += '<div class="card"><h2>&#9201; Study timer</h2>' +
    '<div class="row" style="justify-content:space-between"><div><div class="stat" style="border:none;padding:0"><div class="val" id="home-timer-total">' + fmtSeconds(todaySecs) + '</div><div class="lbl">today</div></div></div>' +
    '<div class="row"><button class="btn primary" id="home-timer-toggle">' + (timerState.running ? 'Pause' : 'Start') + '</button>' +
    '<a class="btn" href="#/timer">Full timer</a></div></div></div>';
  html += '</div>';

  // Week in review
  html += weekReviewCard(wk, 'This week');

  // Last week snapshot on Monday mornings
  if (now.getDay() === 1) {
    const last = new Date(); last.setDate(last.getDate() - 7);
    html += weekReviewCard(weekReview(last), 'Last week (snapshot)');
  }

  view.innerHTML = html;

  // Wire
  $all('[data-home-done]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      const id = cb.getAttribute('data-home-done');
      const arr = Store.reminders();
      const r = arr.find(function (x) { return x.id === id; });
      if (r) { r.done = true; Store.set(KEYS.reminders, arr); }
      router();
    });
  });
  $('#home-journal-save').addEventListener('click', function () {
    const t = $('#home-journal').value.trim();
    if (!t) return toast('Nothing to save');
    appendJournal(t); toast('Journal updated'); router();
  });
  $('#home-timer-toggle').addEventListener('click', function () {
    if (timerState.running) stopStopwatch(); else startStopwatch();
    router();
  });
}

function statusBadge(status) {
  const cls = 'st-' + String(status).replace(/\s+/g, '');
  return '<span class="badge ' + cls + '">' + esc(status) + '</span>';
}

/* Week review computation */
function weekReview(ref) {
  const sessions = Store.sessions();
  let studySecs = 0;
  sessions.forEach(function (s) { if (inThisWeek(s.date, ref)) studySecs += (s.seconds || 0); });
  const apps = Store.jobs().filter(function (j) { return j.dateApplied && inThisWeek(j.dateApplied, ref); }).length;
  const learnings = Store.learnings().filter(function (l) { return inThisWeek(l.date, ref); }).length;
  const tests = Store.practice().filter(function (p) { return inThisWeek(p.date, ref); });
  let bestScore = null;
  tests.forEach(function (t) { const pct = t.total ? (t.score / t.total) * 100 : 0; if (bestScore === null || pct > bestScore) bestScore = pct; });
  const remindersDone = Store.reminders().filter(function (r) { return r.done && inThisWeek(r.dueDate, ref); }).length;
  return { studySecs: studySecs, apps: apps, learnings: learnings, tests: tests.length, bestScore: bestScore, remindersDone: remindersDone };
}
function weekReviewCard(wk, title) {
  return '<div class="card"><h2>&#128202; ' + esc(title) + '</h2>' +
    '<div class="grid cols-4">' +
    statTile(fmtHours(wk.studySecs) + 'h', 'studied') +
    statTile(wk.apps, 'applications') +
    statTile(wk.learnings, 'learnings') +
    statTile(wk.tests + (wk.bestScore !== null ? ' · ' + Math.round(wk.bestScore) + '%' : ''), 'tests / best') +
    '</div>' +
    '<div class="faint" style="margin-top:8px">' + wk.remindersDone + ' reminders completed this week</div></div>';
}
function statTile(val, lbl) {
  return '<div class="stat"><div class="val">' + esc(String(val)) + '</div><div class="lbl">' + esc(lbl) + '</div></div>';
}

/* ============================ VIEW: Journal =========================== */

function viewJournal(query) {
  const view = $('#view');
  let entries = Store.journal().slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  let html = '<div class="view-head"><h1>Journal</h1><div class="sub">One card per day. New notes append with a timestamp.</div></div>';

  html += '<div class="card"><div class="row">' +
    '<input id="j-search" placeholder="Search entries" style="flex:2">' +
    '<input id="j-date" type="date" style="flex:1">' +
    '<button class="btn" id="j-add">Add note to today</button></div></div>';

  html += '<div id="j-list"></div>';
  view.innerHTML = html;

  function renderList() {
    const q = ($('#j-search').value || '').toLowerCase();
    const jump = $('#j-date').value;
    let list = entries;
    if (q) list = list.filter(function (e) { return (e.text || '').toLowerCase().indexOf(q) >= 0; });
    if (jump) list = list.filter(function (e) { return e.date === jump; });
    const cont = $('#j-list');
    if (!list.length) { cont.innerHTML = '<div class="empty">No journal entries yet. Log something you did today.</div>'; return; }
    cont.innerHTML = list.map(function (e) {
      return '<div class="card entry-card"><div class="row" style="justify-content:space-between">' +
        '<span class="entry-date">' + esc(fmtDateHuman(e.date)) + '</span>' +
        '<button class="btn sm danger" data-j-del="' + esc(e.id) + '">Delete</button></div>' +
        '<div class="md">' + fmtMd(e.text) + '</div></div>';
    }).join('');
    $all('[data-j-del]', cont).forEach(function (b) {
      b.addEventListener('click', function () { deleteById(KEYS.journal, b.getAttribute('data-j-del'), 'Journal entry', function () { entries = Store.journal().slice().sort(function (a, c) { return (c.date || '').localeCompare(a.date || ''); }); renderList(); }); });
    });
  }
  $('#j-search').addEventListener('input', renderList);
  $('#j-date').addEventListener('change', renderList);
  $('#j-add').addEventListener('click', function () {
    const body = document.createElement('div');
    body.innerHTML = '<label class="field"><span>Note for today</span><textarea id="jm-text" autofocus></textarea></label>';
    const foot = document.createElement('div');
    const save = document.createElement('button'); save.className = 'btn primary'; save.textContent = 'Save';
    const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', closeModal);
    foot.appendChild(cancel); foot.appendChild(save);
    save.addEventListener('click', function () {
      const t = $('#jm-text').value.trim(); if (!t) return toast('Enter text');
      appendJournal(t); closeModal(); toast('Journal updated');
      entries = Store.journal().slice().sort(function (a, c) { return (c.date || '').localeCompare(a.date || ''); });
      renderList();
    });
    openModal('Add journal note', body, foot);
  });
  renderList();
}

function deleteById(key, id, label, after) {
  const arr = Store.get(key, []);
  const idx = arr.findIndex(function (x) { return x.id === id; });
  if (idx < 0) return;
  const removed = arr[idx];
  arr.splice(idx, 1);
  Store.set(key, arr);
  if (after) after();
  toast((label || 'Item') + ' deleted', {
    actionLabel: 'Undo', onAction: function () {
      const cur = Store.get(key, []); cur.push(removed); Store.set(key, cur);
      if (after) after(); router();
    }
  });
}

/* ============================ VIEW: Study Timer ======================= */

// Timer state (stopwatch running state persisted so refresh keeps session)
const TIMER_KEY = 'dashboard_timer_state';
let timerState = { running: false, startTs: 0, label: '' };
let timerTick = null;
// Countdown
let countdown = { active: false, endTs: 0, tick: null };

function loadTimerState() {
  const s = Store.get(TIMER_KEY, null);
  if (s && s.running) timerState = s;
}
function persistTimerState() { Store.set(TIMER_KEY, timerState); }

function sessionSecondsOn(dateStr) {
  return Store.sessions().reduce(function (acc, s) { return acc + (s.date === dateStr ? (s.seconds || 0) : 0); }, 0);
}
function currentStopwatchElapsed() {
  if (!timerState.running) return 0;
  return Math.floor((Date.now() - timerState.startTs) / 1000);
}
function startStopwatch(label) {
  timerState = { running: true, startTs: Date.now(), label: label || '' };
  persistTimerState();
  ensureTimerTick();
}
function stopStopwatch() {
  if (!timerState.running) return;
  const secs = currentStopwatchElapsed();
  if (secs >= 60) {
    const arr = Store.sessions();
    arr.push({ id: uid(), date: todayStr(new Date(timerState.startTs)), startTs: timerState.startTs, seconds: secs, label: timerState.label || '' });
    Store.set(KEYS.sessions, arr);
    toast('Logged ' + fmtSeconds(secs) + ' study session');
  } else {
    toast('Session under 60s — not logged');
  }
  timerState = { running: false, startTs: 0, label: '' };
  persistTimerState();
}
function ensureTimerTick() {
  if (timerTick) clearInterval(timerTick);
  timerTick = setInterval(function () {
    const disp = $('#sw-display');
    if (disp && timerState.running) disp.textContent = fmtSeconds(currentStopwatchElapsed());
    const homeT = $('#home-timer-total');
    if (homeT) homeT.textContent = fmtSeconds(sessionSecondsOn(todayStr()) + (timerState.running ? currentStopwatchElapsed() : 0));
  }, 1000);
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    let t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.36);
      t += 0.45;
    }
    setTimeout(function () { ctx.close(); }, 2000);
  } catch (e) { console.warn('beep failed', e); }
}

function startCountdown(minutes) {
  countdown.active = true;
  countdown.endTs = Date.now() + minutes * 60 * 1000;
  if (countdown.tick) clearInterval(countdown.tick);
  countdown.tick = setInterval(updateCountdown, 250);
  updateCountdown();
}
function stopCountdown() {
  countdown.active = false;
  if (countdown.tick) clearInterval(countdown.tick);
  countdown.tick = null;
  document.title = document.title.replace(/^\([^)]*\)\s*/, '');
}
function updateCountdown() {
  const remaining = Math.max(0, Math.floor((countdown.endTs - Date.now()) / 1000));
  const disp = $('#cd-display');
  if (disp) { disp.textContent = fmtSeconds(remaining); disp.classList.toggle('alarm', remaining <= 10); }
  document.title = '(' + fmtSeconds(remaining) + ') Study Timer · Career Dashboard';
  if (remaining <= 0) {
    stopCountdown();
    if (disp) disp.textContent = '0:00';
    beep();
    if (Store.settings().notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Time is up', { body: 'Countdown complete. Take a break or log the session.' }); } catch (e) {}
    }
    toast('⏰ Countdown complete');
  }
}

function viewTimer() {
  const view = $('#view');
  const today = todayStr();
  let html = '<div class="view-head"><h1>Study Timer</h1><div class="sub">Stopwatch logs sessions ≥ 60s. Countdown beeps + notifies.</div></div>';

  html += '<div class="grid cols-2">';
  // Stopwatch
  html += '<div class="card"><h2>Stopwatch</h2>' +
    '<div id="sw-display" class="timer-display">' + fmtSeconds(currentStopwatchElapsed()) + '</div>' +
    '<label class="field" style="margin-top:10px"><span>Label (optional)</span><input id="sw-label" placeholder="e.g. SQL practice" value="' + esc(timerState.label || '') + '"></label>' +
    '<div class="timer-controls">' +
    '<button class="btn primary" id="sw-toggle">' + (timerState.running ? 'Pause / Log' : 'Start') + '</button>' +
    '<button class="btn" id="sw-reset">Reset</button></div></div>';

  // Countdown
  html += '<div class="card"><h2>Countdown</h2>' +
    '<div id="cd-display" class="timer-display">' + (countdown.active ? fmtSeconds(Math.max(0, Math.floor((countdown.endTs - Date.now()) / 1000))) : '25:00') + '</div>' +
    '<div class="preset-row">' +
    '<button class="btn" data-cd="25">25 min</button>' +
    '<button class="btn" data-cd="45">45 min</button>' +
    '<button class="btn" data-cd="60">60 min</button></div>' +
    '<div class="row" style="margin-top:10px;justify-content:center"><input id="cd-custom" type="number" min="1" placeholder="min" style="width:80px"><button class="btn" id="cd-start-custom">Start</button><button class="btn" id="cd-stop">Stop</button></div></div>';
  html += '</div>';

  // History
  const sessions = Store.sessions();
  const byDay = {};
  sessions.forEach(function (s) { byDay[s.date] = (byDay[s.date] || 0) + (s.seconds || 0); });
  const weekSecs = sessions.reduce(function (a, s) { return a + (inThisWeek(s.date) ? (s.seconds || 0) : 0); }, 0);
  const streak = studyStreak(byDay);

  html += '<div class="card"><h2>History</h2><div class="grid cols-3">' +
    statTile(fmtSeconds(byDay[today] || 0), 'today') +
    statTile(fmtHours(weekSecs) + 'h', 'this week') +
    statTile(streak + 'd', 'streak') +
    '</div>';

  // 14-day bar chart
  html += '<div style="margin-top:20px"><div class="faint" style="margin-bottom:6px">Last 14 days (hours)</div><div class="barchart">';
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(todayStr(d)); }
  const maxSec = Math.max(3600, Math.max.apply(null, days.map(function (d) { return byDay[d] || 0; })));
  days.forEach(function (d) {
    const sec = byDay[d] || 0;
    const pct = Math.round((sec / maxSec) * 100);
    const lbl = d.slice(8);
    html += '<div class="bar" title="' + esc(d + ' · ' + fmtSeconds(sec)) + '"><span style="height:' + pct + '%"></span><span class="bl">' + esc(lbl) + '</span></div>';
  });
  html += '</div></div>';

  // Session log
  html += '<hr class="sep"><div class="faint" style="margin-bottom:6px">Recent sessions</div>';
  const recent = sessions.slice().sort(function (a, b) { return (b.startTs || 0) - (a.startTs || 0); }).slice(0, 12);
  if (!recent.length) html += '<div class="empty">No sessions logged yet.</div>';
  else {
    html += '<div class="list">';
    recent.forEach(function (s) {
      html += '<div class="list-item"><div class="li-main"><div class="li-title">' + fmtSeconds(s.seconds) + (s.label ? ' · ' + esc(s.label) : '') + '</div><div class="li-sub">' + esc(fmtDateHuman(s.date)) + '</div></div>' +
        '<button class="btn sm danger" data-sess-del="' + esc(s.id) + '">Del</button></div>';
    });
    html += '</div>';
  }
  html += '</div>';

  view.innerHTML = html;
  ensureTimerTick();

  $('#sw-toggle').addEventListener('click', function () {
    if (timerState.running) { stopStopwatch(); } else { startStopwatch($('#sw-label').value.trim()); }
    router();
  });
  $('#sw-reset').addEventListener('click', function () {
    timerState = { running: false, startTs: 0, label: '' }; persistTimerState(); router();
  });
  $all('[data-cd]').forEach(function (b) { b.addEventListener('click', function () { startCountdown(+b.getAttribute('data-cd')); }); });
  $('#cd-start-custom').addEventListener('click', function () {
    const m = +$('#cd-custom').value; if (m > 0) startCountdown(m); else toast('Enter minutes');
  });
  $('#cd-stop').addEventListener('click', stopCountdown);
  $all('[data-sess-del]').forEach(function (b) {
    b.addEventListener('click', function () { deleteById(KEYS.sessions, b.getAttribute('data-sess-del'), 'Session', function () { router(); }); });
  });
}

function studyStreak(byDay) {
  let streak = 0;
  const d = new Date();
  // If no session today, streak still counts back from yesterday
  if (!byDay[todayStr(d)]) d.setDate(d.getDate() - 1);
  for (;;) {
    if (byDay[todayStr(d)]) { streak++; d.setDate(d.getDate() - 1); } else break;
  }
  return streak;
}

/* ============================ VIEW: Jobs ============================== */

function viewJobs(query) {
  const view = $('#view');
  const settings = Store.settings();
  let mode = settings.jobsView || 'kanban';

  let html = '<div class="view-head"><h1>Jobs</h1><div class="sub">Track your pipeline. Marking "Applied" auto-sets a follow-up.</div></div>';

  // Pinned notes panel
  html += renderPinnedNotes();

  // Snippets drawer
  html += renderSnippets();

  // Toolbar
  html += '<div class="card"><div class="row">' +
    '<button class="btn primary" id="jobs-add">+ Add manually</button>' +
    '<button class="btn" id="jobs-import">Import (xlsx/csv)</button>' +
    '<div class="spacer"></div>' +
    '<button class="btn" id="jobs-view-kanban">Kanban</button>' +
    '<button class="btn" id="jobs-view-table">Table</button>' +
    '</div></div>';

  html += '<div id="jobs-body"></div>';
  view.innerHTML = html;
  wirePinnedNotes(); wireSnippets();

  $('#jobs-add').addEventListener('click', function () { openJobModal(null); });
  $('#jobs-import').addEventListener('click', openImportModal);
  $('#jobs-view-kanban').addEventListener('click', function () { mode = 'kanban'; Store.saveSettings({ jobsView: 'kanban' }); renderBody(); });
  $('#jobs-view-table').addEventListener('click', function () { mode = 'table'; Store.saveSettings({ jobsView: 'table' }); renderBody(); });

  function renderBody() {
    $('#jobs-view-kanban').classList.toggle('primary', mode === 'kanban');
    $('#jobs-view-table').classList.toggle('primary', mode === 'table');
    if (mode === 'kanban') renderKanban($('#jobs-body'));
    else renderJobsTable($('#jobs-body'));
  }
  renderBody();

  // Deep-link to a job. Strip the query immediately (without a hashchange) so
  // later router() calls — e.g. right after saving — don't reopen the modal.
  if (query && query.job) {
    const j = Store.jobs().find(function (x) { return x.id === query.job; });
    history.replaceState(null, '', '#/jobs');
    if (j) openJobModal(j);
  }
}

function renderPinnedNotes() {
  const notes = Store.notesPinned();
  let html = '<details class="panel" open><summary>&#128204; Notes to remember before applying</summary><div class="panel-body">';
  html += '<div class="list" id="pinned-list">';
  notes.forEach(function (n) {
    html += '<div class="list-item' + (n.checked ? ' done' : '') + '">' +
      '<input type="checkbox" data-pin-check="' + esc(n.id) + '"' + (n.checked ? ' checked' : '') + '>' +
      '<div class="li-main li-title">' + esc(n.text) + '</div>' +
      '<button class="btn sm danger" data-pin-del="' + esc(n.id) + '">Del</button></div>';
  });
  html += '</div>';
  html += '<div class="row" style="margin-top:10px"><input id="pin-new" placeholder="Add a checklist item"><button class="btn" id="pin-add">Add</button></div>';
  html += '</div></details>';
  return html;
}
function wirePinnedNotes() {
  $all('[data-pin-check]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      const arr = Store.notesPinned();
      const n = arr.find(function (x) { return x.id === cb.getAttribute('data-pin-check'); });
      if (n) { n.checked = cb.checked; Store.set(KEYS.notesPinned, arr); }
    });
  });
  $all('[data-pin-del]').forEach(function (b) {
    b.addEventListener('click', function () {
      const arr = Store.notesPinned().filter(function (x) { return x.id !== b.getAttribute('data-pin-del'); });
      Store.set(KEYS.notesPinned, arr); router();
    });
  });
  const addBtn = $('#pin-add');
  if (addBtn) addBtn.addEventListener('click', function () {
    const v = $('#pin-new').value.trim(); if (!v) return;
    const arr = Store.notesPinned(); arr.push({ id: uid(), text: v, checked: false });
    Store.set(KEYS.notesPinned, arr); router();
  });
}

function renderSnippets() {
  const snips = Store.snippets();
  let html = '<details class="panel"><summary>&#128203; Snippets drawer</summary><div class="panel-body">';
  if (!snips.length) html += '<div class="empty">No snippets yet.</div>';
  html += '<div class="list" id="snip-list">';
  snips.forEach(function (s) {
    html += '<div class="list-item"><div class="li-main"><div class="li-title">' + esc(s.label) + '</div><div class="li-sub" style="white-space:pre-wrap">' + esc(s.text) + '</div></div>' +
      '<div class="li-actions"><button class="btn sm" data-snip-copy="' + esc(s.id) + '">Copy</button>' +
      '<button class="btn sm" data-snip-edit="' + esc(s.id) + '">Edit</button>' +
      '<button class="btn sm danger" data-snip-del="' + esc(s.id) + '">Del</button></div></div>';
  });
  html += '</div>';
  html += '<div class="row" style="margin-top:10px"><button class="btn" id="snip-add">+ Add snippet</button></div>';
  html += '</div></details>';
  return html;
}
function wireSnippets() {
  $all('[data-snip-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      const s = Store.snippets().find(function (x) { return x.id === b.getAttribute('data-snip-copy'); });
      if (!s) return;
      copyText(s.text);
    });
  });
  $all('[data-snip-del]').forEach(function (b) {
    b.addEventListener('click', function () { deleteById(KEYS.snippets, b.getAttribute('data-snip-del'), 'Snippet', function () { router(); }); });
  });
  $all('[data-snip-edit]').forEach(function (b) {
    b.addEventListener('click', function () {
      const s = Store.snippets().find(function (x) { return x.id === b.getAttribute('data-snip-edit'); });
      if (s) openSnippetModal(s);
    });
  });
  const add = $('#snip-add');
  if (add) add.addEventListener('click', function () { openSnippetModal(null); });
}
function openSnippetModal(snip) {
  const isNew = !snip;
  snip = snip || { id: uid(), label: '', text: '' };
  const body = document.createElement('div');
  body.innerHTML =
    '<label class="field"><span>Label</span><input id="sm-label" value="' + esc(snip.label) + '"></label>' +
    '<label class="field"><span>Text</span><textarea id="sm-text" style="min-height:120px">' + esc(snip.text) + '</textarea></label>';
  const foot = document.createElement('div');
  const save = document.createElement('button'); save.className = 'btn primary'; save.textContent = 'Save';
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', closeModal);
  foot.appendChild(cancel); foot.appendChild(save);
  save.addEventListener('click', function () {
    snip.label = $('#sm-label').value.trim() || 'Untitled';
    snip.text = $('#sm-text').value;
    const arr = Store.snippets();
    if (isNew) arr.push(snip); else { const i = arr.findIndex(function (x) { return x.id === snip.id; }); if (i >= 0) arr[i] = snip; }
    Store.set(KEYS.snippets, arr); closeModal(); toast('Snippet saved'); router();
  });
  openModal(isNew ? 'Add snippet' : 'Edit snippet', body, foot);
}
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { toast('Copied'); }, function () { fallbackCopy(text); });
  } else fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Copied'); } catch (e) { toast('Copy failed'); }
  document.body.removeChild(ta);
}

function renderKanban(cont) {
  const jobs = Store.jobs();
  let html = '<div class="kanban">';
  JOB_STATUSES.forEach(function (st) {
    const col = jobs.filter(function (j) { return j.status === st; });
    html += '<div class="kan-col" data-status="' + esc(st) + '"><h3>' + esc(st) + ' <span class="count">' + col.length + '</span></h3>';
    col.forEach(function (j) { html += jobCardHtml(j); });
    html += '</div>';
  });
  html += '</div>';
  cont.innerHTML = html;

  // Drag & drop
  $all('.job-card', cont).forEach(function (card) {
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', card.getAttribute('data-job')); });
    card.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      const j = Store.jobs().find(function (x) { return x.id === card.getAttribute('data-job'); });
      if (j) openJobModal(j);
    });
  });
  $all('.kan-col', cont).forEach(function (col) {
    col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('dragover'); });
    col.addEventListener('dragleave', function () { col.classList.remove('dragover'); });
    col.addEventListener('drop', function (e) {
      e.preventDefault(); col.classList.remove('dragover');
      const id = e.dataTransfer.getData('text/plain');
      const arr = Store.jobs();
      const j = arr.find(function (x) { return x.id === id; });
      if (j && j.status !== col.getAttribute('data-status')) {
        j.status = col.getAttribute('data-status'); j.updatedAt = Date.now();
        Store.set(KEYS.jobs, arr);
        if (j.status === 'Applied') ensureFollowUp(j);
        renderKanban(cont);
      }
    });
  });
}
function jobCardHtml(j) {
  return '<div class="job-card" data-job="' + esc(j.id) + '">' +
    '<div class="jc-co">' + esc(j.company || '?') + '</div>' +
    '<div class="jc-role">' + esc(j.role || '') + '</div>' +
    '<div class="jc-meta">' +
    (j.dateApplied ? '<span class="chip">' + esc(j.dateApplied) + '</span>' : '') +
    (j.source === 'gmail' ? '<span class="chip accent">gmail</span>' : '') +
    (j.tags || []).slice(0, 2).map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('') +
    '</div></div>';
}

function renderJobsTable(cont) {
  let sortKey = 'dateApplied', sortDir = -1;
  let filterStatus = '', filterTag = '', search = '';

  function draw() {
    let jobs = Store.jobs().slice();
    if (filterStatus) jobs = jobs.filter(function (j) { return j.status === filterStatus; });
    if (filterTag) jobs = jobs.filter(function (j) { return (j.tags || []).indexOf(filterTag) >= 0; });
    if (search) { const q = search.toLowerCase(); jobs = jobs.filter(function (j) { return ((j.company || '') + ' ' + (j.role || '') + ' ' + (j.notes || '')).toLowerCase().indexOf(q) >= 0; }); }
    jobs.sort(function (a, b) {
      const av = (a[sortKey] || ''), bv = (b[sortKey] || '');
      return String(av).localeCompare(String(bv)) * sortDir;
    });

    const tags = allTags();
    let html = '<div class="card"><div class="row" style="margin-bottom:12px">' +
      '<select id="jt-status"><option value="">All statuses</option>' + JOB_STATUSES.map(function (s) { return '<option' + (s === filterStatus ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select>' +
      '<select id="jt-tag"><option value="">All tags</option>' + tags.map(function (t) { return '<option' + (t === filterTag ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select>' +
      '<input id="jt-search" placeholder="Search" value="' + esc(search) + '" style="flex:1">' +
      '</div>';

    if (!jobs.length) html += '<div class="empty">No jobs match. Import your Gmail tracker or add one.</div>';
    else {
      html += '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        thSort('company', 'Company') + thSort('role', 'Role') + thSort('status', 'Status') +
        thSort('dateApplied', 'Applied') + '<th>Source</th><th>Tags</th><th></th></tr></thead><tbody>';
      jobs.forEach(function (j) {
        html += '<tr data-job="' + esc(j.id) + '" style="cursor:pointer">' +
          '<td>' + esc(j.company || '?') + (safeHref(j.link) ? ' <a href="' + esc(safeHref(j.link)) + '" target="_blank" rel="noopener">↗</a>' : '') + '</td>' +
          '<td>' + esc(j.role || '') + '</td>' +
          '<td>' + statusBadge(j.status) + '</td>' +
          '<td class="mono">' + esc(j.dateApplied || '—') + '</td>' +
          '<td>' + esc(j.source || '') + '</td>' +
          '<td>' + (j.tags || []).map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join(' ') + '</td>' +
          '<td><button class="btn sm danger" data-job-del="' + esc(j.id) + '">Del</button></td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    cont.innerHTML = html;

    $('#jt-status').addEventListener('change', function () { filterStatus = this.value; draw(); });
    $('#jt-tag').addEventListener('change', function () { filterTag = this.value; draw(); });
    $('#jt-search').addEventListener('input', function () { search = this.value; const pos = this.selectionStart; draw(); const nf = $('#jt-search'); nf.focus(); try { nf.setSelectionRange(pos, pos); } catch (e) {} });
    $all('th[data-sort]', cont).forEach(function (th) {
      th.addEventListener('click', function () {
        const k = th.getAttribute('data-sort');
        if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = 1; }
        draw();
      });
    });
    $all('tr[data-job]', cont).forEach(function (tr) {
      tr.addEventListener('click', function (e) {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const j = Store.jobs().find(function (x) { return x.id === tr.getAttribute('data-job'); });
        if (j) openJobModal(j);
      });
    });
    $all('[data-job-del]', cont).forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); deleteById(KEYS.jobs, b.getAttribute('data-job-del'), 'Job', draw); });
    });
  }
  function thSort(key, label) {
    const arrow = sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
    return '<th data-sort="' + key + '">' + esc(label) + arrow + '</th>';
  }
  draw();
}

function openJobModal(job) {
  const isNew = !job;
  job = job ? Object.assign({}, job) : newJob({});
  const body = document.createElement('div');
  body.innerHTML =
    '<label class="field"><span>Company</span><input id="job-company" value="' + esc(job.company) + '"></label>' +
    '<label class="field"><span>Role</span><input id="job-role" value="' + esc(job.role) + '"></label>' +
    '<label class="field"><span>Link</span><input id="job-link" value="' + esc(job.link) + '" placeholder="https://"></label>' +
    '<div class="row"><label class="field" style="flex:1"><span>Date applied</span><input id="job-date" type="date" value="' + esc(job.dateApplied) + '"></label>' +
    '<label class="field" style="flex:1"><span>Status</span><select id="job-status">' + JOB_STATUSES.map(function (s) { return '<option' + (s === job.status ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></label></div>' +
    '<label class="field"><span>Source</span><input id="job-source" value="' + esc(job.source) + '"></label>' +
    '<label class="field"><span>Tags (comma-separated)</span><input id="job-tags" list="tags-dl" value="' + esc((job.tags || []).join(', ')) + '"></label>' +
    tagDatalistHtml('tags-dl') +
    '<label class="field"><span>Notes</span><textarea id="job-notes">' + esc(job.notes) + '</textarea></label>' +
    (safeHref(job.emailLink) ? '<div class="faint">Gmail: <a href="' + esc(safeHref(job.emailLink)) + '" target="_blank" rel="noopener">Open email</a> · stage ' + esc(job.gmailStage) + '</div>' : '');
  const foot = document.createElement('div');
  const save = document.createElement('button'); save.className = 'btn primary'; save.textContent = 'Save';
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', closeModal);
  if (!isNew) {
    const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'Delete';
    del.addEventListener('click', function () { closeModal(); deleteById(KEYS.jobs, job.id, 'Job', function () { router(); }); });
    foot.appendChild(del);
  }
  foot.appendChild(cancel); foot.appendChild(save);
  save.addEventListener('click', function () {
    job.company = $('#job-company').value.trim();
    job.role = $('#job-role').value.trim();
    job.link = $('#job-link').value.trim();
    job.dateApplied = $('#job-date').value;
    job.status = $('#job-status').value;
    job.source = $('#job-source').value.trim() || 'manual';
    job.tags = parseTags($('#job-tags').value);
    job.notes = $('#job-notes').value;
    if (!job.company) return toast('Company is required');
    saveJob(job, isNew);
    closeModal(); toast('Job saved'); router();
  });
  openModal(isNew ? 'Add job' : 'Edit job', body, foot);
}

/* ============================ VIEW: Gmail Tracker ===================== */

function viewGmail(query) {
  const view = $('#view');
  const settings = Store.settings();
  let tab = (query && query.tab) || 'Action Needed';
  const tabs = ['Action Needed', 'Rejected', 'All gmail'];

  let html = '<div class="view-head"><h1>Gmail Tracker</h1><div class="sub">Data as of ' +
    (settings.gmailLastImport ? esc(settings.gmailLastImport) : '—') + '</div></div>';

  html += '<div class="card"><div class="row">' +
    '<button class="btn primary" id="gmail-import">Import tracker (xlsx/csv)</button>' +
    '<div class="spacer"></div>' +
    tabs.map(function (t) { return '<button class="btn gmail-tab' + (t === tab ? ' primary' : '') + '" data-tab="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') +
    '</div></div>';

  html += '<div id="gmail-body"></div>';
  view.innerHTML = html;

  $('#gmail-import').addEventListener('click', openImportModal);
  $all('.gmail-tab').forEach(function (b) {
    b.addEventListener('click', function () { tab = b.getAttribute('data-tab'); navigate('/gmail?tab=' + encodeURIComponent(tab)); });
  });

  function renderBody() {
    let jobs = Store.jobs().filter(function (j) { return j.source === 'gmail'; });
    if (tab === 'Action Needed') jobs = jobs.filter(function (j) { return j.status === 'Action Needed'; });
    else if (tab === 'Rejected') jobs = jobs.filter(function (j) { return j.status === 'Rejected'; });
    jobs.sort(function (a, b) { return (b.dateApplied || '').localeCompare(a.dateApplied || ''); });

    const cont = $('#gmail-body');
    if (!jobs.length) { cont.innerHTML = '<div class="empty">No gmail-sourced jobs in this tab. Import your <span class="mono">Job_Applications_Tracker.xlsx</span>.</div>'; return; }
    let h = '<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Company</th><th>Role</th><th>Stage</th><th>Status</th><th>Headline</th><th>Email</th><th></th></tr></thead><tbody>';
    jobs.forEach(function (j) {
      h += '<tr><td class="mono">' + esc(j.dateApplied || '—') + '</td>' +
        '<td>' + esc(j.company || '?') + '</td>' +
        '<td>' + esc(j.role || '') + '</td>' +
        '<td>' + esc(j.gmailStage || '') + '</td>' +
        '<td>' + statusBadge(j.status) + '</td>' +
        '<td class="faint">' + esc((j.headline || '').slice(0, 60)) + '</td>' +
        '<td>' + (safeHref(j.emailLink) ? '<a href="' + esc(safeHref(j.emailLink)) + '" target="_blank" rel="noopener">Open email</a>' : '—') + '</td>' +
        '<td><button class="btn sm" data-gm-remind="' + esc(j.id) + '">⏰ Remind</button></td></tr>';
    });
    h += '</tbody></table></div></div>';
    cont.innerHTML = h;
    $all('[data-gm-remind]').forEach(function (b) {
      b.addEventListener('click', function () { openRemindForJob(b.getAttribute('data-gm-remind')); });
    });
  }
  renderBody();
}

function openRemindForJob(jobId) {
  const job = Store.jobs().find(function (x) { return x.id === jobId; });
  if (!job) return;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const body = document.createElement('div');
  body.innerHTML =
    '<div class="faint" style="margin-bottom:10px">' + esc(job.company) + ' — ' + esc(job.role) + '</div>' +
    '<label class="field"><span>Note</span><input id="rm-text" value="Follow up: ' + esc(job.company) + ' — ' + esc(job.role) + '"></label>' +
    '<label class="field"><span>Due date</span><input id="rm-date" type="date" value="' + todayStr(tomorrow) + '"></label>';
  const foot = document.createElement('div');
  const save = document.createElement('button'); save.className = 'btn primary'; save.textContent = 'Set reminder';
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', closeModal);
  foot.appendChild(cancel); foot.appendChild(save);
  save.addEventListener('click', function () {
    const arr = Store.reminders();
    arr.push({ id: uid(), text: $('#rm-text').value.trim() || 'Follow up', dueDate: $('#rm-date').value || todayStr(tomorrow), done: false, linkedJobId: job.id, createdAt: Date.now() });
    Store.set(KEYS.reminders, arr); closeModal(); toast('Reminder set');
  });
  openModal('Remind me', body, foot);
}

/* ============================ VIEW: Reminders ========================= */

function viewReminders() {
  const view = $('#view');
  let html = '<div class="view-head"><h1>Reminders</h1><div class="sub">Grouped by urgency. Notifications fire while the app is open.</div></div>';
  html += '<div class="card"><div class="row">' +
    '<input id="rem-text" placeholder="New reminder" style="flex:2">' +
    '<input id="rem-date" type="date" value="' + todayStr() + '" style="flex:1">' +
    '<button class="btn primary" id="rem-add">Add</button></div></div>';
  html += '<div id="rem-list"></div>';
  view.innerHTML = html;

  $('#rem-add').addEventListener('click', function () {
    const t = $('#rem-text').value.trim(); if (!t) return toast('Enter text');
    const arr = Store.reminders();
    arr.push({ id: uid(), text: t, dueDate: $('#rem-date').value || todayStr(), done: false, createdAt: Date.now() });
    Store.set(KEYS.reminders, arr); $('#rem-text').value = ''; drawList();
  });

  function drawList() {
    const reminders = Store.reminders();
    const jobs = Store.jobs(); const jobById = {}; jobs.forEach(function (j) { jobById[j.id] = j; });
    const today = todayStr();
    const groups = { Overdue: [], Today: [], Upcoming: [], Done: [] };
    reminders.forEach(function (r) {
      if (r.done) groups.Done.push(r);
      else if (r.dueDate < today) groups.Overdue.push(r);
      else if (r.dueDate === today) groups.Today.push(r);
      else groups.Upcoming.push(r);
    });
    ['Overdue', 'Today', 'Upcoming'].forEach(function (g) { groups[g].sort(function (a, b) { return (a.dueDate || '').localeCompare(b.dueDate || ''); }); });

    let h = '';
    ['Overdue', 'Today', 'Upcoming'].forEach(function (g) {
      if (!groups[g].length) return;
      h += '<div class="card"><h2>' + g + ' <span class="faint">(' + groups[g].length + ')</span></h2><div class="list">';
      groups[g].forEach(function (r) { h += reminderRow(r, jobById, g === 'Overdue'); });
      h += '</div></div>';
    });
    if (groups.Done.length) {
      h += '<details class="panel"><summary>Done (' + groups.Done.length + ')</summary><div class="panel-body"><div class="list">';
      groups.Done.forEach(function (r) { h += reminderRow(r, jobById, false); });
      h += '</div></div></details>';
    }
    if (!reminders.length) h = '<div class="empty">No reminders yet.</div>';
    $('#rem-list').innerHTML = h;

    $all('[data-rem-done]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const arr = Store.reminders(); const r = arr.find(function (x) { return x.id === cb.getAttribute('data-rem-done'); });
        if (r) { r.done = cb.checked; Store.set(KEYS.reminders, arr); } drawList();
      });
    });
    $all('[data-rem-del]').forEach(function (b) { b.addEventListener('click', function () { deleteById(KEYS.reminders, b.getAttribute('data-rem-del'), 'Reminder', drawList); }); });
    $all('[data-rem-edit]').forEach(function (b) { b.addEventListener('click', function () { openReminderEdit(b.getAttribute('data-rem-edit'), drawList); }); });
  }
  drawList();
}
function reminderRow(r, jobById, overdue) {
  const job = r.linkedJobId ? jobById[r.linkedJobId] : null;
  return '<div class="list-item' + (overdue ? ' overdue' : '') + (r.done ? ' done' : '') + '">' +
    '<input type="checkbox" data-rem-done="' + esc(r.id) + '"' + (r.done ? ' checked' : '') + '>' +
    '<div class="li-main"><div class="li-title">' + esc(r.text) + '</div>' +
    '<div class="li-sub">' + esc(fmtDateHuman(r.dueDate)) +
    (job ? ' · <a href="#/jobs?job=' + esc(job.id) + '"><span class="chip accent">' + esc(job.company) + ' — ' + esc(job.role) + '</span></a>' : '') +
    '</div></div>' +
    '<div class="li-actions"><button class="btn sm" data-rem-edit="' + esc(r.id) + '">Edit</button>' +
    '<button class="btn sm danger" data-rem-del="' + esc(r.id) + '">Del</button></div></div>';
}
function openReminderEdit(id, after) {
  const arr = Store.reminders(); const r = arr.find(function (x) { return x.id === id; }); if (!r) return;
  const body = document.createElement('div');
  body.innerHTML =
    '<label class="field"><span>Text</span><input id="re-text" value="' + esc(r.text) + '"></label>' +
    '<label class="field"><span>Due date</span><input id="re-date" type="date" value="' + esc(r.dueDate) + '"></label>';
  const foot = document.createElement('div');
  const save = document.createElement('button'); save.className = 'btn primary'; save.textContent = 'Save';
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', closeModal);
  foot.appendChild(cancel); foot.appendChild(save);
  save.addEventListener('click', function () {
    r.text = $('#re-text').value.trim() || r.text; r.dueDate = $('#re-date').value || r.dueDate;
    r.notifiedAt = 0;
    Store.set(KEYS.reminders, arr); closeModal(); if (after) after();
  });
  openModal('Edit reminder', body, foot);
}

/* ============================ VIEW: Learnings ========================= */

function viewLearnings() {
  const view = $('#view');
  let html = '<div class="view-head"><h1>Learnings</h1><div class="sub">Capture what you learn. Grouped by month.</div></div>';
  html += '<div class="card"><div class="row">' +
    '<button class="btn primary" id="learn-add">+ Add learning</button>' +
    '<input id="learn-search" placeholder="Search" style="flex:1">' +
    '</div><div class="row" id="learn-tags" style="margin-top:10px"></div></div>';
  html += '<div id="learn-list"></div>';
  view.innerHTML = html;

  let activeTag = '';
  $('#learn-add').addEventListener('click', function () { openLearningModal(null, draw); });
  $('#learn-search').addEventListener('input', draw);

  function draw() {
    const tags = allTags();
    $('#learn-tags').innerHTML = tags.map(function (t) {
      return '<button class="chip' + (t === activeTag ? ' accent' : '') + '" data-ltag="' + esc(t) + '">' + esc(t) + '</button>';
    }).join(' ') + (activeTag ? ' <button class="chip red" data-ltag="">clear ✕</button>' : '');
    $all('[data-ltag]').forEach(function (b) { b.addEventListener('click', function () { activeTag = b.getAttribute('data-ltag'); draw(); }); });

    const q = ($('#learn-search').value || '').toLowerCase();
    let list = Store.learnings().slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    if (activeTag) list = list.filter(function (l) { return (l.tags || []).indexOf(activeTag) >= 0; });
    if (q) list = list.filter(function (l) { return ((l.topic || '') + ' ' + (l.text || '')).toLowerCase().indexOf(q) >= 0; });

    const cont = $('#learn-list');
    if (!list.length) { cont.innerHTML = '<div class="empty">No learnings yet. Add your first insight.</div>'; return; }
    // Group by month
    const groups = {};
    list.forEach(function (l) { const m = (l.date || '').slice(0, 7) || 'Undated'; (groups[m] = groups[m] || []).push(l); });
    let h = '';
    Object.keys(groups).sort().reverse().forEach(function (m) {
      h += '<div class="card"><h2>' + esc(monthLabel(m)) + '</h2><div class="list">';
      groups[m].forEach(function (l) {
        h += '<div class="list-item" style="align-items:flex-start"><div class="li-main">' +
          '<div class="li-title">' + esc(l.topic || 'Learning') + ' <span class="faint">· ' + esc(l.date) + '</span></div>' +
          '<div class="md li-sub">' + fmtMd(l.text) + '</div>' +
          '<div class="row" style="margin-top:4px">' + (l.tags || []).map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join(' ') + '</div></div>' +
          '<div class="li-actions"><button class="btn sm" data-learn-edit="' + esc(l.id) + '">Edit</button>' +
          '<button class="btn sm danger" data-learn-del="' + esc(l.id) + '">Del</button></div></div>';
      });
      h += '</div></div>';
    });
    cont.innerHTML = h;
    $all('[data-learn-edit]').forEach(function (b) { b.addEventListener('click', function () { const l = Store.learnings().find(function (x) { return x.id === b.getAttribute('data-learn-edit'); }); if (l) openLearningModal(l, draw); }); });
    $all('[data-learn-del]').forEach(function (b) { b.addEventListener('click', function () { deleteById(KEYS.learnings, b.getAttribute('data-learn-del'), 'Learning', draw); }); });
  }
  draw();
}
function monthLabel(m) {
  if (m === 'Undated') return m;
  const d = parseLocalDate(m + '-01');
  return d ? d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : m;
}
function openLearningModal(learn, after) {
  const isNew = !learn;
  learn = learn ? Object.assign({}, learn) : { id: uid(), date: todayStr(), topic: '', text: '', tags: [] };
  const body = document.createElement('div');
  body.innerHTML =
    '<div class="row"><label class="field" style="flex:1"><span>Date</span><input id="le-date" type="date" value="' + esc(learn.date) + '"></label>' +
    '<label class="field" style="flex:2"><span>Topic</span><input id="le-topic" value="' + esc(learn.topic) + '"></label></div>' +
    '<label class="field"><span>Notes (markdown-lite)</span><textarea id="le-text" style="min-height:120px">' + esc(learn.text) + '</textarea></label>' +
    '<label class="field"><span>Tags</span><input id="le-tags" list="tags-dl2" value="' + esc((learn.tags || []).join(', ')) + '"></label>' + tagDatalistHtml('tags-dl2');
  const foot = document.createElement('div');
  const save = document.createElement('button'); save.className = 'btn primary'; save.textContent = 'Save';
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', closeModal);
  foot.appendChild(cancel); foot.appendChild(save);
  save.addEventListener('click', function () {
    learn.date = $('#le-date').value || todayStr();
    learn.topic = $('#le-topic').value.trim();
    learn.text = $('#le-text').value;
    learn.tags = parseTags($('#le-tags').value);
    const arr = Store.learnings();
    if (isNew) arr.push(learn); else { const i = arr.findIndex(function (x) { return x.id === learn.id; }); if (i >= 0) arr[i] = learn; }
    Store.set(KEYS.learnings, arr); closeModal(); toast('Learning saved'); if (after) after();
  });
  openModal(isNew ? 'Add learning' : 'Edit learning', body, foot);
}

/* ============================ VIEW: Practice ========================= */

function viewPractice() {
  const view = $('#view');
  const settings = Store.settings();
  const threshold = settings.practiceThreshold || 70;
  const attempts = Store.practice().slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });

  let html = '<div class="view-head"><h1>Practice</h1><div class="sub">Log tests, track weak topics below ' + threshold + '%.</div></div>';

  // Needs-review chips (latest attempt per topic wins)
  const topicLatest = {}; // topic -> {pct, date}
  attempts.forEach(function (a) {
    (a.weakTopics || []).forEach(function (wt) {
      // weakTopics entries: {topic, score, total}
      const pct = wt.total ? (wt.score / wt.total) * 100 : 0;
      if (!topicLatest[wt.topic] || a.date >= topicLatest[wt.topic].date) topicLatest[wt.topic] = { pct: pct, date: a.date };
    });
  });
  const needsReview = Object.keys(topicLatest).filter(function (t) { return topicLatest[t].pct < threshold; });
  html += '<div class="card"><h2>&#9888; Needs review</h2>';
  if (!needsReview.length) html += '<div class="faint">Nothing below threshold. Nice.</div>';
  else html += '<div class="row">' + needsReview.map(function (t) { return '<span class="chip red">' + esc(t) + ' · ' + Math.round(topicLatest[t].pct) + '%</span>'; }).join(' ') + '</div>';
  html += '</div>';

  html += '<div class="card"><div class="row"><button class="btn primary" id="prac-add">+ Log a test attempt</button></div></div>';

  // Score chart
  if (attempts.length) {
    html += '<div class="card"><h2>Scores over time</h2>' + scoreChartSvg(attempts) + '</div>';
  }

  // Attempts table
  html += '<div class="card"><h2>Attempts</h2>';
  if (!attempts.length) html += '<div class="empty">No attempts logged. Take the mock test then log your score.</div>';
  else {
    html += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Week</th><th>Date</th><th>Test</th><th>Score</th><th>%</th><th>Weak topics</th><th></th></tr></thead><tbody>';
    attempts.slice().reverse().forEach(function (a) {
      const pct = a.total ? Math.round((a.score / a.total) * 100) : 0;
      html += '<tr><td class="mono">' + esc(a.week || '') + '</td><td class="mono">' + esc(a.date || '') + '</td>' +
        '<td>' + esc(a.testName || '') + '</td><td class="mono">' + esc(a.score) + '/' + esc(a.total) + '</td>' +
        '<td class="mono">' + pct + '%</td>' +
        '<td>' + (a.weakTopics || []).map(function (w) { return '<span class="chip">' + esc(w.topic) + '</span>'; }).join(' ') + '</td>' +
        '<td><button class="btn sm danger" data-prac-del="' + esc(a.id) + '">Del</button></td></tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';

  // Weak spots (weak questions with reviewed checkbox)
  html += '<div class="card"><h2>Weak spots</h2>';
  const weakSpots = [];
  attempts.forEach(function (a) { (a.weakQuestions || []).forEach(function (w, i) { weakSpots.push({ attemptId: a.id, idx: i, text: w.text, reviewed: w.reviewed }); }); });
  if (!weakSpots.length) html += '<div class="faint">No weak questions logged.</div>';
  else {
    html += '<div class="list">';
    weakSpots.forEach(function (w) {
      html += '<div class="list-item' + (w.reviewed ? ' done' : '') + '"><input type="checkbox" data-weak-rev="' + esc(w.attemptId) + ':' + w.idx + '"' + (w.reviewed ? ' checked' : '') + '>' +
        '<div class="li-main li-title">' + esc(w.text) + '</div></div>';
    });
    html += '</div>';
  }
  html += '</div>';

  // Test files section
  html += renderTestFiles();

  view.innerHTML = html;

  $('#prac-add').addEventListener('click', function () { openPracticeModal(); });
  $all('[data-prac-del]').forEach(function (b) { b.addEventListener('click', function () { deleteById(KEYS.practice, b.getAttribute('data-prac-del'), 'Attempt', function () { router(); }); }); });
  $all('[data-weak-rev]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      const parts = cb.getAttribute('data-weak-rev').split(':');
      const arr = Store.practice(); const a = arr.find(function (x) { return x.id === parts[0]; });
      if (a && a.weakQuestions[+parts[1]]) { a.weakQuestions[+parts[1]].reviewed = cb.checked; Store.set(KEYS.practice, arr); }
    });
  });
  wireTestFiles();
}

function scoreChartSvg(attempts) {
  const W = 700, H = 160, pad = 30;
  const pts = attempts.map(function (a) { return a.total ? (a.score / a.total) * 100 : 0; });
  const n = pts.length;
  const stepX = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  function x(i) { return pad + i * stepX; }
  function y(v) { return H - pad - (v / 100) * (H - pad * 2); }
  let path = '';
  pts.forEach(function (v, i) { path += (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(v).toFixed(1) + ' '; });
  let dots = '';
  pts.forEach(function (v, i) { dots += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="3.5" fill="var(--accent)"></circle>'; });
  let grid = '';
  [0, 50, 100].forEach(function (g) { grid += '<line x1="' + pad + '" y1="' + y(g) + '" x2="' + (W - pad) + '" y2="' + y(g) + '" stroke="var(--border)"></line><text x="2" y="' + (y(g) + 4) + '" fill="var(--text-faint)" font-size="10">' + g + '</text>'; });
  return '<svg class="linechart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + grid +
    '<path d="' + path + '" fill="none" stroke="var(--accent)" stroke-width="2"></path>' + dots + '</svg>';
}

function openPracticeModal() {
  const body = document.createElement('div');
  const today = todayStr();
  body.innerHTML =
    '<div class="row"><label class="field" style="flex:1"><span>Date</span><input id="pr-date" type="date" value="' + today + '"></label>' +
    '<label class="field" style="flex:1"><span>Test name</span><input id="pr-name" value="DE-100"></label></div>' +
    '<div class="row"><label class="field" style="flex:1"><span>Score</span><input id="pr-score" type="number" min="0"></label>' +
    '<label class="field" style="flex:1"><span>Total</span><input id="pr-total" type="number" min="1" value="100"></label></div>' +
    '<div class="field"><span>Per-topic breakdown (optional)</span><div id="pr-topics"></div><button class="btn sm" id="pr-add-topic" type="button">+ Add topic row</button></div>' +
    '<label class="field"><span>Weak questions / notes (one per line)</span><textarea id="pr-weakq" placeholder="Q14 window functions&#10;Q31 slowly changing dimensions"></textarea></label>';
  const foot = document.createElement('div');
  const save = document.createElement('button'); save.className = 'btn primary'; save.textContent = 'Save';
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', closeModal);
  foot.appendChild(cancel); foot.appendChild(save);

  function addTopicRow() {
    const div = document.createElement('div'); div.className = 'row'; div.style.marginBottom = '6px';
    div.innerHTML = '<input class="pr-t-name" placeholder="Topic" style="flex:2"><input class="pr-t-score" type="number" placeholder="score" style="flex:1"><input class="pr-t-total" type="number" placeholder="total" value="10" style="flex:1"><button class="btn sm" type="button">✕</button>';
    div.querySelector('button').addEventListener('click', function () { div.remove(); });
    body.querySelector('#pr-topics').appendChild(div);
  }
  body.querySelector('#pr-add-topic').addEventListener('click', addTopicRow);

  save.addEventListener('click', function () {
    const date = $('#pr-date').value || today;
    const score = +$('#pr-score').value || 0;
    const total = +$('#pr-total').value || 100;
    const weakTopics = [];
    $all('#pr-topics .row').forEach(function (row) {
      const name = row.querySelector('.pr-t-name').value.trim();
      if (!name) return;
      weakTopics.push({ topic: name, score: +row.querySelector('.pr-t-score').value || 0, total: +row.querySelector('.pr-t-total').value || 10 });
    });
    const weakQuestions = $('#pr-weakq').value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (t) { return { text: t, reviewed: false }; });
    const arr = Store.practice();
    arr.push({ id: uid(), week: isoWeek(date), date: date, testName: $('#pr-name').value.trim() || 'DE-100', topic: '', score: score, total: total, weakTopics: weakTopics, weakQuestions: weakQuestions, notes: '' });
    Store.set(KEYS.practice, arr); closeModal(); toast('Attempt logged'); router();
  });
  openModal('Log test attempt', body, foot);
}

function renderTestFiles() {
  const settings = Store.settings();
  const files = settings.testFiles || [];
  let html = '<div class="card"><h2>Test files</h2>' +
    '<div class="grid cols-2">' +
    linkCard('DE-100 Mock Test', '100-question data engineering mock exam.', 'tests/DE-100_Mock_Test.html');
  files.forEach(function (f) { html += linkCard(esc(f.name), 'Registered weekly test.', 'tests/' + f.file); });
  html += '</div>';
  html += '<div class="faint" style="margin:12px 0 6px">Drop new weekly HTML files into the <span class="mono">tests/</span> folder, then register them here so they appear without code changes.</div>';
  html += '<div class="row"><input id="tf-name" placeholder="Display name" style="flex:2"><input id="tf-file" placeholder="filename.html (in tests/)" style="flex:2"><button class="btn" id="tf-add">Register</button></div>';
  html += '</div>';
  return html;
}
function wireTestFiles() {
  const add = $('#tf-add'); if (!add) return;
  add.addEventListener('click', function () {
    const name = $('#tf-name').value.trim(), file = $('#tf-file').value.trim();
    if (!name || !file) return toast('Enter name and filename');
    const s = Store.settings(); const files = (s.testFiles || []).slice();
    files.push({ name: name, file: file });
    Store.saveSettings({ testFiles: files }); toast('Test file registered'); router();
  });
}
function linkCard(title, desc, href) {
  return '<a class="link-card" href="' + encodeURI(href) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">' +
    '<h3>' + title + ' ↗</h3><p>' + esc(desc) + '</p></a>';
}

/* ============================ VIEW: Library =========================== */

function viewLibrary() {
  const view = $('#view');
  const settings = Store.settings();
  const extra = settings.libraryFiles || [];
  let html = '<div class="view-head"><h1>Library</h1><div class="sub">Study guides open in a new tab.</div></div>';
  html += '<div class="card"><div class="grid cols-2">';
  html += linkCard('DE Theory Bible 2026', 'Theory deep-dives across the data engineering syllabus.', 'library/DE_Theory_Bible_2026.html');
  html += linkCard('DE Bible 2026', 'Q&A drill format for rapid recall.', 'library/DE_Bible_2026.html');
  extra.forEach(function (f) { html += linkCard(esc(f.name), 'Registered study file.', 'library/' + f.file); });
  html += '</div>';
  html += '<div class="faint" style="margin:12px 0 6px">Add new study files into the <span class="mono">library/</span> folder then register them here.</div>';
  html += '<div class="row"><input id="lf-name" placeholder="Display name" style="flex:2"><input id="lf-file" placeholder="filename.html (in library/)" style="flex:2"><button class="btn" id="lf-add">Register</button></div>';
  html += '</div>';
  view.innerHTML = html;
  $('#lf-add').addEventListener('click', function () {
    const name = $('#lf-name').value.trim(), file = $('#lf-file').value.trim();
    if (!name || !file) return toast('Enter name and filename');
    const files = (Store.settings().libraryFiles || []).slice();
    files.push({ name: name, file: file });
    Store.saveSettings({ libraryFiles: files }); toast('Library file registered'); router();
  });
}

/* ============================ VIEW: Settings ========================= */

function viewSettings() {
  const view = $('#view');
  const s = Store.settings();
  let html = '<div class="view-head"><h1>Data &amp; Settings</h1><div class="sub">Backup, restore, and preferences.</div></div>';

  // Preferences
  html += '<div class="card"><h2>Preferences</h2>' +
    '<div class="inline-check" style="margin-bottom:12px"><button class="btn" id="set-theme">Toggle theme (now: ' + esc(document.documentElement.getAttribute('data-theme')) + ')</button></div>' +
    '<label class="inline-check" style="margin-bottom:12px"><input type="checkbox" id="set-notif"' + (s.notificationsEnabled ? ' checked' : '') + '> Enable browser notifications</label>' +
    '<div class="row"><label class="field" style="flex:1"><span>Follow-up days</span><input id="set-followup" type="number" min="1" value="' + esc(s.followUpDays) + '"></label>' +
    '<label class="field" style="flex:1"><span>Practice threshold (%)</span><input id="set-threshold" type="number" min="1" max="100" value="' + esc(s.practiceThreshold) + '"></label></div>' +
    '<button class="btn primary" id="set-save">Save preferences</button></div>';

  // Passcode lock
  const lock = getLock();
  html += '<div class="card"><h2>&#128274; Passcode lock</h2>' +
    '<div class="faint" style="margin-bottom:10px">Shows a passcode screen when the site opens, and re-asks each time it’s reopened. This is a light privacy curtain on a public site — it keeps casual visitors out, but is not strong security, and your data stays readable in browser devtools. The passcode is stored only as a one-way hash on this device.</div>' +
    (lock.enabled
      ? '<div class="row"><span class="chip green">Lock is ON</span></div>' +
        '<div class="row" style="margin-top:10px"><input id="lock-new" type="password" placeholder="New passcode (min 4 chars)" style="flex:1"><button class="btn" id="lock-change">Change</button></div>' +
        '<div class="row" style="margin-top:10px"><button class="btn" id="lock-now">Lock now</button><button class="btn danger" id="lock-remove">Remove lock</button></div>'
      : '<div class="row"><input id="lock-pw" type="password" placeholder="Set a passcode (min 4)" style="flex:1"><input id="lock-pw2" type="password" placeholder="Confirm" style="flex:1"><button class="btn primary" id="lock-set">Enable lock</button></div>'
    ) + '</div>';

  // Backup
  html += '<div class="card"><h2>Backup</h2>' +
    '<div class="row"><button class="btn primary" id="set-export">Export all data (JSON)</button>' +
    '<label class="btn" style="text-align:center">Import backup<input id="set-import" type="file" accept="application/json,.json" hidden></label></div>' +
    '<div class="faint" style="margin-top:8px">Import offers Replace-all or Merge (newer updatedAt wins).</div></div>';

  // Storage usage
  html += '<div class="card"><h2>Storage</h2><div class="faint">Approx. ' + storageKb() + ' KB used across dashboard keys.</div></div>';

  // Danger zone
  html += '<div class="card"><h2 style="color:var(--red)">Danger zone</h2>' +
    '<button class="btn danger" id="set-clear">Clear all data</button></div>';

  view.innerHTML = html;

  $('#set-theme').addEventListener('click', function () { toggleTheme(); router(); });
  $('#set-notif').addEventListener('change', function () {
    const cb = this;
    if (cb.checked && 'Notification' in window) {
      Notification.requestPermission().then(function (perm) {
        if (perm === 'granted') { Store.saveSettings({ notificationsEnabled: true }); toast('Notifications enabled'); startReminderLoop(); }
        else { cb.checked = false; Store.saveSettings({ notificationsEnabled: false }); toast('Permission denied'); }
      });
    } else {
      Store.saveSettings({ notificationsEnabled: cb.checked });
    }
  });
  $('#set-save').addEventListener('click', function () {
    Store.saveSettings({ followUpDays: +$('#set-followup').value || 7, practiceThreshold: +$('#set-threshold').value || 70 });
    toast('Preferences saved');
  });
  if (lock.enabled) {
    $('#lock-change').addEventListener('click', async function () {
      const v = $('#lock-new').value;
      if (v.length < 4) return toast('Use at least 4 characters');
      await setLockPasscode(v);
      sessionStorage.setItem(UNLOCK_SESSION_KEY, '1');
      toast('Passcode changed'); router();
    });
    $('#lock-now').addEventListener('click', function () {
      sessionStorage.removeItem(UNLOCK_SESSION_KEY); location.reload();
    });
    $('#lock-remove').addEventListener('click', function () {
      if (!confirm('Remove the passcode lock?')) return;
      removeLock(); toast('Lock removed'); router();
    });
  } else {
    $('#lock-set').addEventListener('click', async function () {
      const a = $('#lock-pw').value, b = $('#lock-pw2').value;
      if (a.length < 4) return toast('Use at least 4 characters');
      if (a !== b) return toast('Passcodes do not match');
      await setLockPasscode(a);
      sessionStorage.setItem(UNLOCK_SESSION_KEY, '1');
      toast('Passcode lock enabled — you’ll be asked for it next time you open the site'); router();
    });
  }
  $('#set-export').addEventListener('click', exportAll);
  $('#set-import').addEventListener('change', function (e) { if (e.target.files[0]) importBackup(e.target.files[0]); });
  $('#set-clear').addEventListener('click', function () {
    if (!confirm('Clear ALL dashboard data? This cannot be undone.')) return;
    if (!confirm('Really sure? Export a backup first if unsure.')) return;
    ALL_KEYS.forEach(function (k) { localStorage.removeItem(k); });
    localStorage.removeItem(TIMER_KEY);
    seedIfEmpty(); toast('All data cleared'); navigate('/'); router();
  });
}
function storageKb() {
  let bytes = 0;
  ALL_KEYS.concat([TIMER_KEY]).forEach(function (k) { const v = localStorage.getItem(k); if (v) bytes += v.length; });
  return (bytes / 1024).toFixed(1);
}

/* ============================ Export / Import ======================== */

function exportAll() {
  const data = { _meta: Store.get(KEYS.meta, { version: 1 }), _exportedAt: new Date().toISOString() };
  ALL_KEYS.forEach(function (k) { data[k] = Store.get(k, null); });
  download('career-dashboard-backup-' + todayStr() + '.json', JSON.stringify(data, null, 2));
  toast('Backup exported');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = function () {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) { return toast('Invalid JSON file'); }
    // Validate shape: must be an object with at least one known key
    if (!data || typeof data !== 'object') return toast('Invalid backup file');
    const known = ALL_KEYS.filter(function (k) { return k in data; });
    if (!known.length) return toast('No dashboard data found in file');

    const body = document.createElement('div');
    body.innerHTML = '<p>Found ' + known.length + ' data section(s). Choose how to restore:</p>' +
      '<div class="faint">Replace all overwrites everything. Merge keeps existing and adds/updates by id (newer updatedAt wins).</div>';
    const foot = document.createElement('div');
    const merge = document.createElement('button'); merge.className = 'btn'; merge.textContent = 'Merge';
    const replace = document.createElement('button'); replace.className = 'btn danger'; replace.textContent = 'Replace all';
    const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', closeModal);
    foot.appendChild(cancel); foot.appendChild(merge); foot.appendChild(replace);
    replace.addEventListener('click', function () {
      if (!confirm('Replace ALL current data with this backup?')) return;
      known.forEach(function (k) { if (data[k] !== null && data[k] !== undefined) Store.set(k, data[k]); });
      if (data._meta) Store.set(KEYS.meta, data._meta);
      closeModal(); toast('Data replaced'); navigate('/'); router();
    });
    merge.addEventListener('click', function () {
      known.forEach(function (k) {
        if (k === KEYS.settings) { // shallow merge settings
          Store.set(k, Object.assign({}, Store.get(k, {}), data[k] || {}));
          return;
        }
        if (!Array.isArray(data[k])) return;
        const cur = Store.get(k, []);
        const byId = {}; (Array.isArray(cur) ? cur : []).forEach(function (item) { if (item && item.id) byId[item.id] = item; });
        data[k].forEach(function (item) {
          if (!item || !item.id) { cur.push(item); return; }
          const ex = byId[item.id];
          if (!ex) { cur.push(item); byId[item.id] = item; }
          else if ((item.updatedAt || 0) > (ex.updatedAt || 0)) {
            const idx = cur.indexOf(ex); if (idx >= 0) cur[idx] = item; byId[item.id] = item;
          }
        });
        Store.set(k, cur);
      });
      closeModal(); toast('Data merged'); navigate('/'); router();
    });
    openModal('Import backup', body, foot);
  };
  reader.onerror = function () { toast('Could not read file'); };
  reader.readAsText(file);
}

/* ============================ XLSX / CSV parser ====================== */

// ---- ZIP reader (central-directory based) ----
function u16(dv, o) { return dv.getUint16(o, true); }
function u32(dv, o) { return dv.getUint32(o, true); }
const utf8dec = new TextDecoder('utf-8');
function bytesToText(bytes) { return utf8dec.decode(bytes); }

function readZip(buffer) {
  const dv = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // Locate End Of Central Directory (scan from end; signature 0x06054b50)
  let eocd = -1;
  const minPos = Math.max(0, buffer.byteLength - 22 - 65535);
  for (let i = buffer.byteLength - 22; i >= minPos; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx (no ZIP end-of-central-directory found)');
  const cdCount = u16(dv, eocd + 10);
  const cdOffset = u32(dv, eocd + 16);
  const entries = {};
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (u32(dv, p) !== 0x02014b50) break; // central dir header sig
    const method = u16(dv, p + 10);
    const compSize = u32(dv, p + 20);
    const nameLen = u16(dv, p + 28);
    const extraLen = u16(dv, p + 30);
    const commentLen = u16(dv, p + 32);
    const localOff = u32(dv, p + 42);
    const name = bytesToText(bytes.subarray(p + 46, p + 46 + nameLen));
    entries[name] = { method: method, compSize: compSize, localOff: localOff };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { dv: dv, bytes: bytes, entries: entries };
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream not supported in this browser');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function zipEntryText(zip, name) {
  const e = zip.entries[name];
  if (!e) return null;
  const dv = zip.dv, bytes = zip.bytes, lo = e.localOff;
  if (dv.getUint32(lo, true) !== 0x04034b50) throw new Error('Bad local file header for ' + name);
  const nameLen = u16(dv, lo + 26), extraLen = u16(dv, lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const comp = bytes.subarray(dataStart, dataStart + e.compSize);
  let out;
  if (e.method === 0) out = comp;
  else if (e.method === 8) out = await inflateRaw(comp);
  else throw new Error('Unsupported compression method ' + e.method + ' for ' + name);
  return bytesToText(out);
}

// ---- Workbook / sheet XML parsing ----
function xmlParse(text) { return new DOMParser().parseFromString(text, 'application/xml'); }

function colToIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return 0;
  let n = 0;
  const s = m[1];
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

function excelSerialToDate(n) {
  // Excel epoch 1899-12-30 (accounts for the 1900 leap year bug)
  const ms = Math.round((n - 0) * 86400000);
  const d = new Date(Date.UTC(1899, 11, 30) + ms);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

function parseSharedStrings(text) {
  if (!text) return [];
  const doc = xmlParse(text);
  const sis = doc.getElementsByTagName('si');
  const out = [];
  for (let i = 0; i < sis.length; i++) {
    const ts = sis[i].getElementsByTagName('t');
    let s = '';
    for (let j = 0; j < ts.length; j++) s += ts[j].textContent;
    out.push(s);
  }
  return out;
}

function localName(el) { return el.localName || el.nodeName.replace(/^.*:/, ''); }

function parseSheet(text, shared) {
  const doc = xmlParse(text);
  const rowsEls = doc.getElementsByTagName('row');
  const rows = [];
  for (let i = 0; i < rowsEls.length; i++) {
    const rowEl = rowsEls[i];
    const cells = [];
    const cEls = rowEl.getElementsByTagName('c');
    for (let j = 0; j < cEls.length; j++) {
      const c = cEls[j];
      const ref = c.getAttribute('r') || '';
      const ci = colToIndex(ref);
      const t = c.getAttribute('t');
      let val = '';
      if (t === 's') {
        const v = c.getElementsByTagName('v')[0];
        if (v) val = shared[+v.textContent] || '';
      } else if (t === 'inlineStr') {
        const is = c.getElementsByTagName('t');
        for (let k = 0; k < is.length; k++) val += is[k].textContent;
      } else if (t === 'str') {
        const v = c.getElementsByTagName('v')[0]; if (v) val = v.textContent;
      } else {
        // numeric (possibly a date serial); we treat as string but detect date-ish
        const v = c.getElementsByTagName('v')[0];
        if (v) {
          const raw = v.textContent;
          const num = Number(raw);
          // Heuristic: plausible Excel date serials (25569 = 1970-01-01) between 1990-2100
          if (!isNaN(num) && num > 29000 && num < 80000 && (c.getAttribute('s') !== null)) {
            val = excelSerialToDate(num);
          } else {
            val = raw;
          }
        }
      }
      cells[ci] = val;
    }
    rows.push(cells);
  }
  return rows;
}

// Locate sheet XML path by human sheet name
function resolveSheetPath(zip, wbText, relsText, sheetName) {
  const wb = xmlParse(wbText);
  const sheets = wb.getElementsByTagName('sheet');
  let rid = null;
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getAttribute('name') === sheetName) {
      rid = sheets[i].getAttribute('r:id') ||
        sheets[i].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      break;
    }
  }
  if (!rid) return null;
  const rels = xmlParse(relsText);
  const rl = rels.getElementsByTagName('Relationship');
  for (let i = 0; i < rl.length; i++) {
    if (rl[i].getAttribute('Id') === rid) {
      let target = rl[i].getAttribute('Target');
      if (target.charAt(0) === '/') return target.slice(1);
      return 'xl/' + target.replace(/^\.\//, '');
    }
  }
  return null;
}

const GMAIL_SHEET = 'All Applications & Postings';

async function parseXlsxTracker(buffer) {
  const zip = readZip(buffer);
  const wbText = await zipEntryText(zip, 'xl/workbook.xml');
  const relsText = await zipEntryText(zip, 'xl/_rels/workbook.xml.rels');
  if (!wbText || !relsText) throw new Error('workbook.xml or rels missing');
  const sharedText = await zipEntryText(zip, 'xl/sharedStrings.xml');
  const shared = parseSharedStrings(sharedText);

  const sheetPath = resolveSheetPath(zip, wbText, relsText, GMAIL_SHEET);
  if (!sheetPath) throw new Error('Sheet "' + GMAIL_SHEET + '" not found in workbook');
  const sheetText = await zipEntryText(zip, sheetPath);
  if (!sheetText) throw new Error('Sheet XML "' + sheetPath + '" could not be read');
  const rows = parseSheet(sheetText, shared);

  // Run Log sheet: LAST_RUN_DATE at row 2, col B
  let lastRun = '';
  const runPath = resolveSheetPath(zip, wbText, relsText, 'Run Log');
  if (runPath) {
    try {
      const runText = await zipEntryText(zip, runPath);
      const runRows = parseSheet(runText, shared);
      if (runRows[1] && runRows[1][1]) lastRun = String(runRows[1][1]);
    } catch (e) { /* ignore */ }
  }
  return rowsToRecords(rows, lastRun);
}

// Map a 2D array (with header row) to normalized records
function rowsToRecords(rows, lastRun) {
  // Find header row
  let headerIdx = 0;
  for (let i = 0; i < rows.length; i++) {
    const joined = (rows[i] || []).join('|').toLowerCase();
    if (joined.indexOf('company') >= 0 && joined.indexOf('stage') >= 0) { headerIdx = i; break; }
  }
  const header = (rows[headerIdx] || []).map(function (h) { return String(h || '').toLowerCase(); });
  // Find a column by trying phrases in priority order across ALL headers first,
  // so "Email Link" wins over "Headline (from email body)" for the email column.
  function findCol(phrases) {
    for (let p = 0; p < phrases.length; p++) {
      for (let i = 0; i < header.length; i++) {
        if (header[i] && header[i].indexOf(phrases[p]) >= 0) return i;
      }
    }
    return -1;
  }
  const idx = {
    date: findCol(['date']),
    company: findCol(['company']),
    role: findCol(['role', 'title', 'position']),
    source: findCol(['source', 'platform']),
    stage: findCol(['stage', 'status']),
    headline: findCol(['headline']),
    email: findCol(['email link', 'link', 'email']),
  };
  const records = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const company = pick(r, idx.company), role = pick(r, idx.role);
    const stage = pick(r, idx.stage);
    if (!company && !role && !stage) continue;
    records.push({
      date: normalizeDate(pick(r, idx.date)),
      company: company, role: role,
      source: pick(r, idx.source), stage: stage,
      headline: pick(r, idx.headline), emailLink: pick(r, idx.email),
    });
  }
  return { records: records, lastRun: normalizeDate(lastRun) };
}
function pick(row, i) { return i >= 0 && row[i] != null ? String(row[i]).trim() : ''; }
function normalizeDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  // dd/mm/yyyy or mm/dd/yyyy → keep simple: try Date parse
  const d = new Date(s);
  if (!isNaN(d)) return todayStr(d);
  return s;
}

// ---- CSV parser (robust: quotes, embedded commas/newlines) ----
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
}

// ---- Stage → status mapping ----
const STAGE_MAP = {
  'applied': 'Applied', 'applied-acknowledged': 'Applied',
  'rejected': 'Rejected', 'interview': 'Interview',
  'action needed': 'Action Needed', 'recruiter outreach': 'Action Needed',
  'job alert/rec': 'Saved',
  'system/account': null, // skip
};
function mapStage(stage) {
  const key = String(stage || '').trim().toLowerCase();
  if (key in STAGE_MAP) return STAGE_MAP[key];
  return 'Saved'; // unknown stages default to Saved rather than dropping data
}

// ---- Import orchestration ----
function openImportModal() {
  const body = document.createElement('div');
  body.innerHTML =
    '<p class="faint">Import your Claude-generated <span class="mono">Job_Applications_Tracker.xlsx</span> (or a CSV). Parsed natively in-browser — nothing is uploaded.</p>' +
    '<label class="btn primary" style="display:block;text-align:center">Choose .xlsx / .csv file<input id="imp-file" type="file" accept=".xlsx,.csv" hidden></label>' +
    '<div id="imp-status" class="faint" style="margin-top:12px"></div>';
  const foot = document.createElement('div');
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Close'; cancel.addEventListener('click', closeModal);
  foot.appendChild(cancel);
  openModal('Import Gmail tracker', body, foot);
  $('#imp-file').addEventListener('change', function (e) {
    const file = e.target.files[0]; if (!file) return;
    handleImportFile(file);
  });
}

async function handleImportFile(file) {
  const status = $('#imp-status');
  const setStatus = function (msg) { if (status) status.textContent = msg; };
  setStatus('Reading ' + file.name + '…');
  try {
    let parsed;
    if (/\.csv$/i.test(file.name)) {
      const text = await file.text();
      parsed = csvToRecords(text);
    } else {
      const buf = await file.arrayBuffer();
      parsed = await parseXlsxTracker(buf);
    }
    const summary = applyImport(parsed.records);
    const lastImport = parsed.lastRun || todayStr();
    Store.saveSettings({ gmailLastImport: lastImport });
    setStatus('Done. ' + summary.added + ' new, ' + summary.updated + ' updated, ' + summary.skipped + ' skipped.');
    toast('Imported: ' + summary.added + ' new · ' + summary.updated + ' updated · ' + summary.skipped + ' skipped');
    setTimeout(function () { closeModal(); router(); }, 1200);
  } catch (e) {
    console.error(e);
    setStatus('Import failed: ' + e.message);
    toast('Import failed: ' + e.message);
  }
}

function csvToRecords(text) {
  const rows = parseCSV(text);
  return rowsToRecords(rows, '');
}

// Dedupe + merge into dashboard_jobs.
// Identity note: in the Gmail-derived sheet, one email (digest) can mention
// SEVERAL different jobs, so the email link alone is NOT unique. The stable
// identity of a row is the job-mention within an email: emailLink+company+role.
// Rows without an email link fall back to company+role+date.
function importKey(emailLink, company, role, date) {
  const n = function (s) { return String(s || '').trim().toLowerCase(); };
  return emailLink
    ? 'e|' + n(emailLink) + '|' + n(company) + '|' + n(role)
    : 'c|' + n(company) + '|' + n(role) + '|' + n(date);
}
function applyImport(records) {
  const jobs = Store.jobs();
  let added = 0, updated = 0, skipped = 0;
  const byKey = {};
  jobs.forEach(function (j) {
    byKey[importKey(j.emailLink, j.company, j.role, j.dateApplied)] = j;
  });

  records.forEach(function (rec) {
    const status = mapStage(rec.stage);
    if (status === null) { skipped++; return; } // System/Account → not a job

    const key = importKey(rec.emailLink, rec.company, rec.role, rec.date);
    const existing = byKey[key];

    if (existing) {
      let changed = false;
      // Never downgrade a manually-advanced status back from Interview/Offer
      const curRank = STATUS_RANK[existing.status] != null ? STATUS_RANK[existing.status] : 0;
      const newRank = STATUS_RANK[status] != null ? STATUS_RANK[status] : 0;
      const isProtected = existing.status === 'Interview' || existing.status === 'Offer';
      if (existing.status !== status && !(isProtected && newRank < curRank)) {
        existing.status = status; changed = true;
      }
      if (rec.stage && existing.gmailStage !== rec.stage) { existing.gmailStage = rec.stage; changed = true; }
      if (rec.headline && existing.headline !== rec.headline) { existing.headline = rec.headline; changed = true; }
      if (rec.emailLink && existing.emailLink !== rec.emailLink) { existing.emailLink = rec.emailLink; changed = true; }
      if (existing.source !== 'gmail') { existing.source = 'gmail'; changed = true; }
      if (changed) { existing.updatedAt = Date.now(); updated++; }
    } else {
      const job = newJob({
        company: rec.company, role: rec.role, dateApplied: rec.date,
        status: status, source: 'gmail', gmailStage: rec.stage,
        headline: rec.headline, emailLink: rec.emailLink,
      });
      jobs.push(job);
      byKey[key] = job;
      added++;
    }
  });

  Store.set(KEYS.jobs, jobs);
  return { added: added, updated: updated, skipped: skipped };
}

/* ============================ Init ================================== */

function bindGlobalUI() {
  // Theme toggle in sidebar
  $('#themeToggle').addEventListener('click', function () { toggleTheme(); if (currentRoute().path === '/settings') router(); });
  // Hamburger
  $('#hamburger').addEventListener('click', function () {
    $('#app').classList.toggle('nav-open');
    $('#scrim').hidden = !$('#app').classList.contains('nav-open');
  });
  $('#scrim').addEventListener('click', function () { $('#app').classList.remove('nav-open'); $('#scrim').hidden = true; });
  // FAB
  $('#fab').addEventListener('click', function () { openQuickAdd(); });

  // Global search
  const gs = $('#globalSearch');
  gs.addEventListener('input', function () { runGlobalSearch(gs.value); });
  gs.addEventListener('focus', function () { if (gs.value) runGlobalSearch(gs.value); });
  document.addEventListener('click', function (e) {
    const box = $('#globalSearchResults');
    if (e.target.closest('[data-close-search]')) { box.hidden = true; gs.value = ''; }
    else if (!e.target.closest('.side-search')) box.hidden = true;
  });

  // Keyboard: "/" focuses search, Esc closes modal / search
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault(); gs.focus();
    } else if (e.key === 'Escape') {
      if (modalCloser) closeModal();
      else { $('#globalSearchResults').hidden = true; gs.blur(); }
    }
  });
}

function init() {
  applyTheme(); // theme first so the lock screen matches
  if (isLocked()) { showLockScreen(startApp); return; }
  startApp();
}
function startApp() {
  seedIfEmpty();
  loadTimerState();
  if (timerState.running) ensureTimerTick();
  bindGlobalUI();
  window.addEventListener('hashchange', router);
  startReminderLoop();
  router();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
