const APP_BASE = 'http://localhost:5055';

let activeTab = null;
let capturedContext = null;
let formTouched = false;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// The side panel stays open as you switch tabs/windows (that's the point — it no longer
// closes the moment you click elsewhere), so unlike a popup it needs to actively track
// which tab is "current" instead of just reading it once at open time.
async function refreshForActiveTab() {
  const tab = await getActiveTab();
  if (!tab || tab.id === activeTab?.id) {
    activeTab = tab || activeTab;
    return;
  }
  activeTab = tab;
  await loadExistingFillResult();
  const stored = await chrome.storage.local.get('trackerLastCapturedContext');
  const newContext = stored.trackerLastCapturedContext || null;
  const contextChanged = newContext?.capturedAt !== capturedContext?.capturedAt;
  capturedContext = newContext;
  // Don't clobber a log entry the user is mid-way through editing — only auto-prefill
  // when they haven't touched the form yet, or a newer tracker row was captured since.
  if (!formTouched || contextChanged) prefillFromContext(capturedContext);
}

chrome.tabs.onActivated.addListener(refreshForActiveTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && tabId === activeTab?.id) refreshForActiveTab();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) refreshForActiveTab();
});

// A fill started by the keyboard shortcut (background.js) never goes through the "Fill
// this page" button below, so the panel learns about it from the content script's own
// result broadcast instead.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'WSO_FILL_RESULT' && sender.tab?.id === activeTab?.id) {
    renderFillResult(message.result);
  }
});

async function checkAppStatus() {
  const dot = document.getElementById('app-status');
  try {
    const res = await fetch(`${APP_BASE}/api/profile`);
    if (!res.ok) throw new Error('bad status');
    dot.classList.add('ok');
    dot.title = 'Local app connected';
    return await res.json();
  } catch (e) {
    dot.classList.add('bad');
    dot.title = 'Local app not reachable — run "npm start" in app/';
    return null;
  }
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
    const result = await chrome.tabs.sendMessage(activeTab.id, { type: 'WSO_RUN_FILL' });
    renderFillResult(result);
  } catch (e) {
    summary.textContent = 'Could not run on this page (try reloading the tab).';
  }
});

function populateCvOptions(profile) {
  const select = document.getElementById('cv-version-select');
  for (const cv of profile?.cvFiles || []) {
    const opt = document.createElement('option');
    opt.value = cv.name;
    opt.textContent = cv.name;
    select.appendChild(opt);
  }
}

function prefillFromContext(context) {
  const form = document.getElementById('log-form');
  const hint = document.getElementById('context-hint');
  if (context) {
    form.elements.company.value = context.company || '';
    form.elements.role.value = context.role || '';
    form.elements.industry.value = context.industry || '';
    form.elements.region.value = context.region || '';
    // deadlineISO is parsed by tracker-reader.js in local time; older captures only have
    // the raw text, which is left for the user rather than guessed at.
    form.elements.deadline.value = context.deadlineISO || '';
    hint.textContent = `Pre-filled from ${context.sourceSite || 'your tracker'} (captured ${new Date(context.capturedAt).toLocaleString()}). Edit anything that's off.`;
    markMissing(form, context);
  } else {
    hint.textContent = 'No tracker row captured recently — fill in manually, or click "Apply" on a row in your WSO tracker or Trackr first.';
    markMissing(form, null);
  }
  form.elements.dateApplied.value = localISODate(new Date());
}

const FIELD_LABELS = { company: 'Company', role: 'Role', industry: 'Industry', region: 'Region' };

// Says out loud which fields the tracker didn't provide, instead of leaving a silent blank.
function markMissing(form, context) {
  const missingEl = document.getElementById('missing-hint');
  const missing = context
    ? Object.keys(FIELD_LABELS).filter((k) => !form.elements[k].value.trim())
    : [];
  for (const key of Object.keys(FIELD_LABELS)) {
    form.elements[key].classList.toggle('missing', missing.includes(key));
  }
  missingEl.hidden = !missing.length;
  missingEl.textContent = missing.length
    ? `Not found on the tracker: ${missing.map((k) => FIELD_LABELS[k]).join(', ')}. Please fill in.`
    : '';
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
  try {
    const res = await fetch(`${APP_BASE}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('failed');
    msg.textContent = 'Logged ✓';
    setTimeout(() => (msg.textContent = ''), 2500);
    form.reset();
    markMissing(form, null);
    formTouched = false;
  } catch (err) {
    msg.textContent = 'Could not reach the local app — is it running?';
  }
});

document.getElementById('log-form').addEventListener('input', (e) => {
  formTouched = true;
  if (e.target.classList.contains('missing') && e.target.value.trim()) {
    markMissing(e.currentTarget, capturedContext);
  }
});

(async function init() {
  activeTab = await getActiveTab();
  const profile = await checkAppStatus();
  populateCvOptions(profile);
  await loadExistingFillResult();

  const stored = await chrome.storage.local.get('trackerLastCapturedContext');
  capturedContext = stored.trackerLastCapturedContext || null;
  prefillFromContext(capturedContext);
  formTouched = false; // prefill above shouldn't itself count as "touched"
})();
