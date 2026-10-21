// Starts the real app against a throwaway data folder on a spare port. Each test file runs in
// its own process (node --test), so setting BC_DATA_DIR before the first require is enough.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function startApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-tracker-test-'));
  process.env.BC_DATA_DIR = dataDir;
  const app = require('../server');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  }

  function reset() {
    for (const f of ['contacts.json', 'applications.json']) {
      fs.writeFileSync(path.join(dataDir, f), '[]');
    }
    fs.rmSync(path.join(dataDir, 'profile.json'), { force: true });
    fs.rmSync(path.join(dataDir, 'backups'), { recursive: true, force: true });
    fs.mkdirSync(path.join(dataDir, 'backups'));
  }

  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  return { base, api, reset, stop, dataDir };
}

module.exports = { startApp };

// Loads the app's real page and scripts into jsdom, with fetch pointed at a running test app.
function loadUI(base, { hash = '' } = {}) {
  const { JSDOM } = require('jsdom');
  const pub = path.join(__dirname, '..', 'public');
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: `http://localhost/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  // Counts requests in flight so a test can wait for the page to settle before the app stops.
  let inFlight = 0;
  window.fetch = async (url, opts) => {
    inFlight += 1;
    try { return await fetch(new URL(url, base), opts); } finally { inFlight -= 1; }
  };
  window.settled = () => waitFor(() => inFlight === 0);
  window.HTMLDialogElement.prototype.showModal ||= function () { this.open = true; };
  window.HTMLDialogElement.prototype.close ||= function () { this.open = false; };
  window.console = { log() {}, warn() {}, error() {} };
  for (const file of ['contact-import.js', 'contacts.js', 'app.js']) {
    window.eval(fs.readFileSync(path.join(pub, 'js', file), 'utf8'));
  }
  return window;
}

// Polls until check() returns something truthy (the UI fetches asynchronously).
async function waitFor(check, { timeout = 3000 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

module.exports.loadUI = loadUI;
module.exports.waitFor = waitFor;
