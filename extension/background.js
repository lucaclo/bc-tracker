// Minimal relay: remembers the last autofill result per tab so the side panel can show
// it again after being closed and reopened. Does nothing else — no auto-actions, ever.

// Clicking the toolbar icon opens the side panel (stays open across tab switches)
// instead of a popup (which closes the instant you click anywhere else).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const tabResults = new Map();
const APP_BASE = 'http://localhost:5055';

// Content scripts run in the job page's own security context, so a fetch() from
// content/autofill.js would be sent with THAT page's origin (not the extension's) and
// gets silently blocked by the local app's CORS rule. The background service worker is
// a true extension context, so it fetches localhost on the content script's behalf.
async function fetchProfileFromApp() {
  const res = await fetch(`${APP_BASE}/api/profile`);
  if (!res.ok) throw new Error(`app responded ${res.status}`);
  return res.json();
}

// Fire-and-forget telemetry: which field labels got flagged, so the app can surface
// "flagged N times this season" and point at what's worth extending in FIELD_KEYWORDS.
// Never awaited, never blocks the fill flow, and a failure (app not running) is swallowed
// silently — this must never surface an error to the user.
function reportFlags(result) {
  const flags = [...(result.flagged || []), ...(result.worthChecking || [])].map((f) => ({
    label: f.label,
    url: result.url
  }));
  if (!flags.length) return;
  fetch(`${APP_BASE}/api/flags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flags })
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'WSO_FILL_RESULT' && sender.tab) {
    tabResults.set(sender.tab.id, message.result);
    reportFlags(message.result);
    return false;
  }
  if (message.type === 'WSO_GET_TAB_RESULT') {
    sendResponse(tabResults.get(message.tabId) || null);
    return false;
  }
  if (message.type === 'WSO_GET_PROFILE') {
    fetchProfileFromApp()
      .then((profile) => sendResponse({ ok: true, profile }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // async response
  }
});

chrome.tabs.onRemoved.addListener((tabId) => tabResults.delete(tabId));
