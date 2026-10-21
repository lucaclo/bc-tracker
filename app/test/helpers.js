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
