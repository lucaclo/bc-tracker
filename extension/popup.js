const APP_BASE = 'http://localhost:5055';

let activeTab = null;
let capturedContext = null;
let formTouched = false;
// capturedAt of a stale capture the user explicitly chose to use via "Use it anyway".
let staleOverride = null;
let cvOptionsLoaded = false;

// A capture older than this is almost certainly a different application (the original
// bug: a 4-day-old HSBC tracker row pre-filled while applying to Brown Advisory).
const STALE_MS = 6 * 60 * 60 * 1000;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// The side panel stays open as you switch tabs/windows (that's the point — it no longer
// closes the moment you click elsewhere), so unlike a popup it needs to actively track
// which tab is "current" instead of just reading it once at open time.
async function refreshForActiveTab({ navigated = false } = {}) {
  const tab = await getActiveTab();
  if (!tab) return;
  const sameTab = tab.id === activeTab?.id;
  activeTab = tab;
  // Same tab, nothing changed (e.g. window focus bounced) — leave everything alone.
  if (sameTab && !navigated) return;
  if (!sameTab) await loadExistingFillResult();
  const stored = await chrome.storage.local.get('trackerLastCapturedContext');
  const newContext = stored.trackerLastCapturedContext || null;
  const contextChanged = newContext?.capturedAt !== capturedContext?.capturedAt;
  capturedContext = newContext;
  // Don't clobber a log entry the user is mid-way through editing — only auto-prefill
  // when they haven't touched the form yet, or a newer capture arrived since.
  if (!formTouched || contextChanged) prefillFromContext(capturedContext);
  autoReadIfNeeded();
}

chrome.tabs.onActivated.addListener(() => refreshForActiveTab());
// changeInfo.url catches single-page-app navigations (Workday's job page → /apply → each
// application step) that never fire a fresh 'complete'.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== activeTab?.id) return;
  if (changeInfo.url || changeInfo.status === 'complete') refreshForActiveTab({ navigated: true });
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) refreshForActiveTab();
});

// A capture made while the panel is open (Apply clicked on a job page or a tracker row,
// or "Read this job page") shows up immediately — Workday-style single-page apps never
// fire a tab 'complete' event, so waiting for a tab change would miss it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.trackerLastCapturedContext) {
    capturedContext = changes.trackerLastCapturedContext.newValue || null;
    prefillFromContext(capturedContext);
    formTouched = false;
  }
  if (changes.pendingLogs) renderPending(changes.pendingLogs.newValue || []);
});

// A fill started by the keyboard shortcut (background.js) never goes through the "Fill
// this page" button below, so the panel learns about it from the content script's own
// result broadcast instead.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'WSO_FILL_RESULT' && sender.tab?.id === activeTab?.id) {
    renderFillResult(message.result);
  }
});

// Re-checked on a timer, not just once when the panel opens — otherwise a panel opened
// while the app was down stays red (and keeps refusing to log) after the app comes back.
async function checkAppStatus() {
  const dot = document.getElementById('app-status');
  let profile = null;
  try {
    const res = await fetch(`${APP_BASE}/api/profile`);
    if (!res.ok) throw new Error('bad status');
    profile = await res.json();
  } catch (e) {
    profile = null;
  }
  const up = !!profile;
  dot.classList.toggle('ok', up);
  dot.classList.toggle('bad', !up);
  dot.title = up ? 'Local app connected' : 'Local app not reachable — run "npm start" in app/';
  document.getElementById('app-down').hidden = up;
  if (up) {
    if (!cvOptionsLoaded) populateCvOptions(profile);
    flushPendingLogs();
  }
  setTimeout(checkAppStatus, up ? 30000 : 4000);
  return profile;
}

function renderFlagListInto(listEl, entries) {
  listEl.innerHTML = '';
  for (const entry of entries) {
    const li = document.createElement('li');
    li.textContent = entry.label;
    li.addEventListener('click', () => {
      chrome.tabs.sendMessage(activeTab.id, { type: 'WSO_SCROLL_TO_FLAG', id: entry.id });
    });
    listEl.appendChild(li);
  }
}

function renderFillResult(result) {
  const summary = document.getElementById('fill-summary');
  const list = document.getElementById('flag-list');
  const verifyHeading = document.getElementById('verify-heading');
  const verifyList = document.getElementById('verify-list');
  const checkHeading = document.getElementById('check-heading');
  const checkList = document.getElementById('check-list');
  list.innerHTML = '';
  verifyList.innerHTML = '';
  checkList.innerHTML = '';
  verifyHeading.hidden = true;
  checkHeading.hidden = true;
  if (!result) {
    summary.textContent = '';
    return;
  }
  if (result.error) {
    summary.textContent = 'Could not reach the B.C Tracker app (localhost:5055).';
    return;
  }
  const worthChecking = result.worthChecking || [];
  const verifyIssues = result.verifyIssues || [];
  summary.textContent =
    `Filled ${result.filledCount} field${result.filledCount === 1 ? '' : 's'}` +
    (worthChecking.length ? ` (${worthChecking.length} worth a second look)` : '') +
    (verifyIssues.length ? ` · ${verifyIssues.length} flagged by verification` : '') +
    ` · ${result.flagged.length} need your input`;
  renderFlagListInto(list, result.flagged);
  if (verifyIssues.length) {
    verifyHeading.hidden = false;
    renderFlagListInto(verifyList, verifyIssues);
  }
  if (worthChecking.length) {
    checkHeading.hidden = false;
    renderFlagListInto(checkList, worthChecking);
  }
}

async function loadExistingFillResult() {
  chrome.runtime.sendMessage({ type: 'WSO_GET_TAB_RESULT', tabId: activeTab.id }, (result) => {
    renderFillResult(result);
  });
}

document.getElementById('fill-btn').addEventListener('click', async () => {
  const summary = document.getElementById('fill-summary');
  summary.textContent = 'Filling…';
  try {
    const result = await sendToTab({ type: 'WSO_RUN_FILL' }, FILL_FILES, ['content/autofill.css']);
    renderFillResult(result);
  } catch (e) {
    summary.textContent = 'Could not run on this page (try reloading the tab).';
  }
});

function populateCvOptions(profile) {
  if (!profile) return;
  cvOptionsLoaded = true;
  const select = document.getElementById('cv-version-select');
  for (const cv of profile?.cvFiles || []) {
    const opt = document.createElement('option');
    opt.value = cv.name;
    opt.textContent = cv.name;
    select.appendChild(opt);
  }
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return '';
  }
};

function timeAgo(ms) {
  const hours = Math.round(ms / 3600000);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// Why a capture should NOT be pre-filled into the current tab's log form, or '' if it's fine.
function contextProblem(context) {
  if (!context || staleOverride === context.capturedAt) return '';
  const age = Date.now() - Date.parse(context.capturedAt);
  if (!(age < STALE_MS)) return `it was captured ${timeAgo(age)}`;
  // A job-page capture knows exactly which site it came from; a different site is a
  // different job. (Tracker captures can't be checked this way: their links often go via
  // a firm's careers page that redirects to Workday etc.)
  const tabHost = hostOf(activeTab?.url);
  if (context.sourceHost && tabHost && !isOwnPage(activeTab.url) && tabHost !== context.sourceHost) {
    return `it came from ${context.sourceHost}, not this site`;
  }
  return '';
}

function sourceLabel(context) {
  if (context.sourceSite === 'Job page') return `the job page on ${context.sourceHost || 'this site'}`;
  if (context.mergedJobPage) return `${context.sourceSite} + the job page`;
  return context.sourceSite || 'your tracker';
}

const PREFILL_KEYS = ['company', 'role', 'industry', 'region', 'deadline'];

function prefillFromContext(context) {
  const form = document.getElementById('log-form');
  const hint = document.getElementById('context-hint');
  const problem = contextProblem(context);
  document.getElementById('use-stale-btn').hidden = !problem;
  if (context && !problem) {
    form.elements.company.value = context.company || '';
    form.elements.role.value = context.role || '';
    form.elements.industry.value = context.industry || '';
    form.elements.region.value = context.region || '';
    // deadlineISO is parsed in local time by lib/dates.js; older captures only have the
    // raw text, which is left for the user rather than guessed at.
    form.elements.deadline.value = context.deadlineISO || '';
    hint.textContent = `Pre-filled from ${sourceLabel(context)} (captured ${new Date(context.capturedAt).toLocaleString()}). Edit anything that's off.`;
    markMissing(form, context);
  } else {
    // Never leave an old application's details sitting in the form.
    for (const key of PREFILL_KEYS) form.elements[key].value = '';
    hint.textContent = problem
      ? `Last capture (${context.company || '?'} — ${context.role || '?'}) wasn't used because ${problem}. Click "Apply" on the job posting, or read this page.`
      : 'Nothing captured yet — click "Apply" on the job posting (or a tracker row), or read this page.';
    markMissing(form, null);
  }
  form.elements.dateApplied.value = localISODate(new Date());
}

const FIELD_LABELS = { company: 'Company', role: 'Role', industry: 'Industry', region: 'Region' };

// Says out loud which fields the capture didn't provide (or only guessed), instead of
// leaving a silent blank or a silent guess.
function markMissing(form, context) {
  const missingEl = document.getElementById('missing-hint');
  const missing = context
    ? Object.keys(FIELD_LABELS).filter((k) => !form.elements[k].value.trim())
    : [];
  const guessed = context
    ? (context.guessedFields || []).filter((k) => FIELD_LABELS[k] && form.elements[k].value.trim())
    : [];
  for (const key of Object.keys(FIELD_LABELS)) {
    form.elements[key].classList.toggle('missing', missing.includes(key) || guessed.includes(key));
  }
  const parts = [];
  if (missing.length) parts.push(`Not found on the page: ${missing.map((k) => FIELD_LABELS[k]).join(', ')}. Please fill in.`);
  if (guessed.length) parts.push(`Best guess, please check: ${guessed.map((k) => FIELD_LABELS[k]).join(', ')}.`);
  missingEl.hidden = !parts.length;
  missingEl.textContent = parts.join(' ');
}

function localISODate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

document.getElementById('log-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  body.source = capturedContext?.sourceSite || 'Manual';
  body.applicationLink = activeTab?.url || '';
  body.groupDivision = capturedContext?.groupDivision || capturedContext?.section || '';
  body.roleType = capturedContext?.roleType || '';

  const msg = document.getElementById('log-msg');
  if (await postApplication(body)) {
    msg.textContent = 'Logged ✓';
  } else {
    // Never lose an entry because the app happened to be down: keep it and send it as
    // soon as checkAppStatus() sees the app again.
    await queuePendingLog(body);
    msg.textContent = 'App not running — saved here, and it will be logged automatically once the app is back.';
  }
  setTimeout(() => (msg.textContent = ''), 5000);
  form.reset();
  markMissing(form, null);
  form.elements.dateApplied.value = localISODate(new Date());
  formTouched = false;
});

async function postApplication(body) {
  try {
    const res = await fetch(`${APP_BASE}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function getPendingLogs() {
  return (await chrome.storage.local.get('pendingLogs')).pendingLogs || [];
}

async function queuePendingLog(body) {
  const pending = await getPendingLogs();
  pending.push({ ...body, queuedAt: new Date().toISOString() });
  await chrome.storage.local.set({ pendingLogs: pending });
}

let flushing = false;
async function flushPendingLogs() {
  if (flushing) return;
  flushing = true;
  try {
    let pending = await getPendingLogs();
    while (pending.length) {
      const { queuedAt, ...body } = pending[0];
      if (!(await postApplication(body))) break;
      pending = pending.slice(1);
      await chrome.storage.local.set({ pendingLogs: pending });
    }
  } finally {
    flushing = false;
  }
}

function renderPending(pending) {
  const el = document.getElementById('pending-hint');
  el.hidden = !pending.length;
  el.textContent = pending.length
    ? `${pending.length} logged application${pending.length === 1 ? '' : 's'} waiting for the app to come back: ${pending.map((p) => p.company).join(', ')}`
    : '';
}

document.getElementById('use-stale-btn').addEventListener('click', () => {
  if (!capturedContext) return;
  staleOverride = capturedContext.capturedAt;
  prefillFromContext(capturedContext);
});

const isOwnPage = (url) => /^(localhost|127\.0\.0\.1)$|wallstreetoasis\.com$|the-trackr\.com$/.test(hostOf(url));

// Sends a message to the tab's content scripts. A tab that was already open when the
// extension was installed or reloaded has NO content scripts (Chrome only injects them on
// page load) — the original "Apply did nothing" cause — so on "no receiver" the needed
// files are injected now and the message retried, instead of asking for a tab reload.
async function sendToTab(message, files, css) {
  try {
    const res = await chrome.tabs.sendMessage(activeTab.id, message);
    // Both handlers always answer; no answer means only some other script (e.g. a reader
    // injected earlier without the fill engine) was listening.
    if (res === undefined) throw new Error('no handler for this message');
    return res;
  } catch (e) {
    if (isOwnPage(activeTab?.url)) throw e;
    if (css) await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: css });
    await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files });
    return await chrome.tabs.sendMessage(activeTab.id, message);
  }
}

const READER_FILES = ['lib/dates.js', 'content/job-page-reader.js'];
const FILL_FILES = [
  'lib/fieldMap.js',
  'lib/comboboxFill.js',
  'lib/fillVerifier.js',
  'lib/blockFill.js',
  'lib/siteMappers/workday.js',
  'lib/siteMappers/greenhouse.js',
  'lib/siteMappers/lever.js',
  'content/autofill.js',
  ...READER_FILES
];

const requestJobPageRead = (auto) => sendToTab({ type: 'WSO_READ_JOB_PAGE', auto }, READER_FILES);

// With nothing usable to pre-fill, read the job straight off the tab you're on — so it
// works even if the Apply click wasn't caught (or you opened the panel mid-application,
// e.g. on Workday's "Application Questions" step). Only pages that recognizably are a job
// posting / application get captured (see looksLikeJob in job-page-reader.js). Workday
// renders the posting a moment after navigating, hence the retries.
let autoReadKey = null;
async function autoReadIfNeeded() {
  if (!activeTab?.url || isOwnPage(activeTab.url) || !/^https?:/.test(activeTab.url)) return;
  if (formTouched || (capturedContext && !contextProblem(capturedContext))) return;
  const key = `${activeTab.id}|${activeTab.url}`;
  if (autoReadKey === key) return;
  autoReadKey = key;
  let lastError = '';
  for (const delay of [0, 1500, 3500]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (autoReadKey !== key || formTouched) return; // moved on meanwhile
    try {
      const res = await requestJobPageRead(true);
      if (res?.ok) return; // the capture arrives via chrome.storage.onChanged above
    } catch (e) {
      lastError = String(e?.message || e);
    }
  }
  // Never fail silently: say what happened, so a broken setup is visible immediately.
  if (autoReadKey === key && !formTouched) {
    const hint = document.getElementById('context-hint');
    hint.textContent = lastError
      ? `Couldn't read this tab automatically (${lastError}). Try "Read this job page"; if that fails too, reload this tab.`
      : `No job title found on this page yet. On the job posting or an application step, click "Read this job page".`;
  }
}

document.getElementById('read-page-btn').addEventListener('click', async () => {
  const hint = document.getElementById('context-hint');
  try {
    const res = await requestJobPageRead(false);
    // On success the new capture arrives via chrome.storage.onChanged above.
    if (!res?.ok) hint.textContent = "Couldn't find a job title or company on this page — fill in manually.";
  } catch (e) {
    hint.textContent = "Can't read this page (job pages only — not the tracker, the app, or chrome:// pages).";
  }
});

document.getElementById('log-form').addEventListener('input', (e) => {
  formTouched = true;
  if (e.target.classList.contains('missing') && e.target.value.trim()) {
    markMissing(e.currentTarget, capturedContext);
  }
});

(async function init() {
  document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;
  activeTab = await getActiveTab();
  await checkAppStatus();
  renderPending(await getPendingLogs());
  await loadExistingFillResult();

  const stored = await chrome.storage.local.get('trackerLastCapturedContext');
  capturedContext = stored.trackerLastCapturedContext || null;
  prefillFromContext(capturedContext);
  formTouched = false; // prefill above shouldn't itself count as "touched"
  autoReadIfNeeded();
})();
