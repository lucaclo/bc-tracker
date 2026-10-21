// Side panel "Capture contacts" flow (issue #10): the real popup.html + popup.js in jsdom with
// a stubbed chrome.* API, saving to a real app on a temp data dir.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { startApp, waitFor } = require('./helpers');

const EXT = path.join(__dirname, '..', '..', 'extension');
let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { await ctx.stop(); });
const open = [];
beforeEach(() => ctx.reset());
afterEach(() => { while (open.length) open.pop().close(); });

const FOUND = [
  { name: 'Ann Example', title: 'Analyst', company: 'J.P. Morgan', location: 'London', profileUrl: 'https://alumni.example.org/p/1', linkedinUrl: '', email: '', confidence: 'high', flags: [] },
  { name: 'Bob Sample', title: 'Associate', company: 'Mystery Partners', location: '', profileUrl: 'https://alumni.example.org/p/2', linkedinUrl: '', email: '', confidence: 'medium', flags: [] },
  { name: 'Cy Nofirm', title: 'Student', company: '', location: '', profileUrl: 'https://alumni.example.org/p/3', linkedinUrl: '', email: '', confidence: 'low', flags: ['no company found'] }
];

function panel({ url = 'https://alumni.example.org/directory', store = {}, appDown = () => false } = {}) {
  const html = fs.readFileSync(path.join(EXT, 'popup.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'chrome-extension://test/popup.html', runScripts: 'outside-only' });
  const { window } = dom;
  const changeListeners = [];
  const injected = [];
  const noop = { addListener() {} };
  window.chrome = {
    runtime: { getManifest: () => ({ version: '9.9.9' }), onMessage: noop, sendMessage: (m, cb) => cb && cb(null) },
    tabs: {
      query: async () => [{ id: 7, url }],
      onActivated: noop,
      onUpdated: noop,
      sendMessage: async (id, msg) => (msg.type === 'BC_READ_CONTACTS'
        ? { ok: true, url, site: new URL(url).hostname, source: 'generic', contacts: JSON.parse(JSON.stringify(FOUND)) }
        : { ok: false })
    },
    windows: { onFocusChanged: noop, WINDOW_ID_NONE: -1 },
    scripting: { executeScript: async (opts) => { injected.push(opts.files); }, insertCSS: async () => {} },
    storage: {
      local: {
        get: async (key) => ({ [key]: store[key] }),
        set: async (values) => {
          for (const [k, v] of Object.entries(values)) {
            const oldValue = store[k];
            store[k] = v;
            for (const fn of changeListeners) fn({ [k]: { oldValue, newValue: v } }, 'local');
          }
        }
      },
      onChanged: { addListener: (fn) => changeListeners.push(fn) }
    }
  };
  window.fetch = async (u, opts) => {
    if (appDown()) throw new TypeError('Failed to fetch');
    return fetch(String(u).replace('http://localhost:5055', ctx.base), opts);
  };
  window.console = { log() {}, warn() {}, error() {} };
  window.eval(fs.readFileSync(path.join(EXT, 'popup.js'), 'utf8'));
  // init() has run once the app status dot is set.
  const ready = waitFor(() => window.document.getElementById('app-status').className.match(/ok|bad/));
  const p = { window, document: window.document, store, injected, ready, close: () => window.close() };
  open.push(p);
  return p;
}

const rows = (document) => [...document.querySelectorAll('#capture-rows li')];

test('Capture contacts shows a preview; flagged rows start unticked with the reason', async () => {
  const p = panel();
  const { document } = p;
  await p.ready;
  document.getElementById('capture-btn').click();
  await waitFor(() => !document.getElementById('capture-review').hidden);
  assert.deepEqual(JSON.parse(JSON.stringify(p.injected[0])), ['lib/companyMatch.js', 'content/contact-reader.js']);
  const list = rows(document);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((li) => li.querySelector('input[type=checkbox]').checked), [true, true, false]);
  assert.match(list[2].textContent, /Flagged: no company found/);
  assert.match(document.getElementById('capture-msg').textContent, /Found 3 people · 1 flagged/);
  assert.equal(document.getElementById('capture-save').textContent, 'Save 2 contacts');
});

test('edit a company, set the source group, save: counts shown and group remembered per site', async () => {
  const p = panel();
  const { document, window, store } = p;
  await p.ready;
  document.getElementById('capture-btn').click();
  await waitFor(() => !document.getElementById('capture-review').hidden);
  const company = rows(document)[1].querySelector('.capture-company');
  company.value = 'Goldman Sachs';
  company.dispatchEvent(new window.Event('input'));
  const source = document.getElementById('capture-source');
  source.value = 'Old Wellingtonian';
  document.getElementById('capture-save').click();
  await waitFor(() => /Saved:/.test(document.getElementById('capture-msg').textContent));
  assert.equal(document.getElementById('capture-msg').textContent, 'Saved: 2 new, 0 merged with contacts you already had.');

  const saved = (await ctx.api('GET', '/api/contacts')).body;
  assert.deepEqual(saved.map((c) => c.name).sort(), ['Ann Example', 'Bob Sample']);
  const bob = saved.find((c) => c.name === 'Bob Sample');
  assert.equal(bob.company, 'Goldman Sachs');
  assert.equal(bob.sourceGroup, 'Old Wellingtonian');
  assert.equal(bob.sourceSite, 'alumni.example.org');
  assert.deepEqual({ ...store.captureSourceGroups }, { 'alumni.example.org': 'Old Wellingtonian' });

  // Capturing again on the same site pre-fills the group, and re-saving merges.
  document.getElementById('capture-btn').click();
  await waitFor(() => !document.getElementById('capture-review').hidden);
  assert.equal(source.value, 'Old Wellingtonian');
  document.getElementById('capture-save').click();
  await waitFor(() => /merged/.test(document.getElementById('capture-msg').textContent) && /0 new/.test(document.getElementById('capture-msg').textContent));
});

test('ticking a flagged row and select-all', async () => {
  const p = panel();
  const { document, window } = p;
  await p.ready;
  document.getElementById('capture-btn').click();
  await waitFor(() => !document.getElementById('capture-review').hidden);
  const all = document.getElementById('capture-all');
  assert.equal(all.indeterminate, true);
  all.checked = false;
  all.dispatchEvent(new window.Event('change'));
  assert.equal(document.getElementById('capture-save').disabled, true);
  const box = rows(document)[2].querySelector('input[type=checkbox]');
  box.checked = true;
  box.dispatchEvent(new window.Event('change'));
  assert.equal(document.getElementById('capture-save').textContent, 'Save 1 contact');
});

test('app down: captures queue in chrome.storage and send when it returns', async () => {
  let down = true;
  const p = panel({ appDown: () => down });
  const { document, window, store } = p;
  await p.ready;
  document.getElementById('capture-btn').click();
  await waitFor(() => !document.getElementById('capture-review').hidden);
  document.getElementById('capture-save').click();
  await waitFor(() => /App not running/.test(document.getElementById('capture-msg').textContent));
  assert.equal(store.pendingContacts.length, 1);
  assert.equal(store.pendingContacts[0].contacts.length, 2);
  assert.match(document.getElementById('pending-contacts-hint').textContent, /2 captured contacts waiting/);
  assert.equal((await ctx.api('GET', '/api/contacts')).body.length, 0);

  down = false;
  await window.flushPendingContacts();
  assert.equal(store.pendingContacts.length, 0);
  assert.equal(document.getElementById('pending-contacts-hint').hidden, true);
  assert.equal((await ctx.api('GET', '/api/contacts')).body.length, 2);
});

test("won't try to read the app itself or chrome:// pages", async () => {
  const p = panel({ url: 'http://localhost:5055/#contacts' });
  const { document } = p;
  await p.ready;
  document.getElementById('capture-btn').click();
  await waitFor(() => /Open the directory page/.test(document.getElementById('capture-msg').textContent));
  assert.equal(p.injected.length, 0);
});
