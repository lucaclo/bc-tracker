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

// Keyboard shortcut (default Cmd+Shift+F on Mac, Ctrl+Shift+F elsewhere — see manifest.json
// "commands", customizable at chrome://extensions/shortcuts). Runs the exact same fill as
// the side panel's "Fill this page" button on the current tab's content script, which
// already loads on any website (see manifest.json content_scripts <all_urls>) and reports
// its own result back via WSO_FILL_RESULT above — so no extra result-handling needed here.
//
// Deliberately does NOT auto-submit the "Log this application" entry: the panel's
// pre-filled company/role comes from whatever tracker row was last captured, which can be
// stale or belong to a different job than the one just filled (confirmed live — a captured
// "Alantra" context was still showing while autofilling an unrelated HSBC page). Silently
// POSTing that would record a wrong application. Instead this just opens the panel so Luca
// can glance at the pre-filled fields and click "Log application" himself.
//
// sidePanel.open() is only allowed while the keypress's user gesture is still active, which
// ends at the first `await` — so it must be called synchronously, using the `tab` Chrome
// passes to onCommand, before anything else is awaited.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'run-fill' || !tab?.id) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {
    // Not critical — the fill still proceeds; the panel can be opened from the toolbar.
  });
  chrome.tabs.sendMessage(tab.id, { type: 'WSO_RUN_FILL' }).catch(() => {
    // No content script on this tab (chrome:// page, tracker page, etc.) — nothing to fill.
  });
});

chrome.tabs.onRemoved.addListener((tabId) => tabResults.delete(tabId));
