// Opt-in multi-page capture (issue #12): the reader's Next/blocker helpers in jsdom, and the side
// panel's stepping loop with a stubbed chrome API that serves one "page" per read.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { startApp, waitFor } = require('./helpers');

const EXT = path.join(__dirname, '..', '..', 'extension');
const src = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');

function readerPage(body, title = 'Directory') {
  const dom = new JSDOM(`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`, { url: 'https://alumni.example.org/dir', runScripts: 'outside-only' });
  dom.window.chrome = { runtime: { onMessage: { addListener() {} } } };
  dom.window.eval(src('lib/companyMatch.js'));
  dom.window.eval(src('content/contact-reader.js'));
  return dom.window;
}

const PEOPLE = '<ul><li><a href="/p/1">Ann Bell</a><p>Analyst at UBS</p></li><li><a href="/p/2">Cy Dunn</a><p>VP at UBS</p></li><li><a href="/p/3">Ed Fox</a><p>MD at UBS</p></li></ul>';

test('finds the site\'s own Next control, never a disabled one or a profile link', () => {
  let w = readerPage(`${PEOPLE}<nav class="pagination"><a href="?page=1">1</a><a href="?page=2" aria-label="Next">›</a></nav>`);
  assert.equal(w.BC_ContactReader.findNextControl().getAttribute('href'), '?page=2');
  w = readerPage(`${PEOPLE}<button>Next</button>`);
  assert.equal(w.BC_ContactReader.findNextControl().tagName, 'BUTTON');
  w = readerPage(`${PEOPLE}<button disabled>Next</button>`);
  assert.equal(w.BC_ContactReader.findNextControl(), null);
  w = readerPage(`${PEOPLE}<a rel="next" href="/dir?p=3">More</a>`);
  assert.equal(w.BC_ContactReader.findNextControl().getAttribute('rel'), 'next');
  w = readerPage(PEOPLE);
  assert.equal(w.BC_ContactReader.findNextControl(), null);
});

test('clicking Next is the only page action', () => {
  const w = readerPage(`${PEOPLE}<button id="n">Next</button>`);
  let clicks = 0;
  w.document.getElementById('n').addEventListener('click', () => clicks++);
  assert.equal(w.BC_ContactReader.goToNextPage(), 'click');
  assert.equal(clicks, 1);
});

test('detects login walls and CAPTCHAs', () => {
  assert.equal(readerPage('<form><input type="text"><input type="password"></form>').BC_ContactReader.pageBlocker(), 'login');
  assert.equal(readerPage(PEOPLE, 'Sign In | Example').BC_ContactReader.pageBlocker(), 'login');
  assert.equal(readerPage('<div class="g-recaptcha"></div>').BC_ContactReader.pageBlocker(), 'captcha');
  assert.equal(readerPage('<p>Please verify you are a human to continue</p>').BC_ContactReader.pageBlocker(), 'captcha');
  assert.equal(readerPage(PEOPLE).BC_ContactReader.pageBlocker(), null);
});

// ---- Side panel loop ----

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { await ctx.stop(); });
beforeEach(() => ctx.reset());
const open = [];
afterEach(() => { while (open.length) open.pop().window.close(); });

const person = (n) => ({ name: `Person ${n}`, title: 'Analyst', company: 'UBS', companyKey: 'ubs', profileUrl: `https://alumni.example.org/p/${n}`, linkedinUrl: '', confidence: 'high', flags: [] });

// pages: array of reader replies, served in order; nextHow: what BC_NEXT_PAGE answers.
function panel({ pages, nextHow = () => 'click', store = {} }) {
  const html = src('popup.html').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'chrome-extension://test/popup.html', runScripts: 'outside-only' });
  const { window } = dom;
  const noop = { addListener() {} };
  const calls = { reads: 0, nexts: 0, messages: [] };
  const url = 'https://alumni.example.org/dir';
  window.chrome = {
    runtime: { getManifest: () => ({ version: 't' }), onMessage: noop, sendMessage: (m, cb) => cb && cb(null) },
    tabs: {
      query: async () => [{ id: 7, url }],
      onActivated: noop,
      onUpdated: noop,
      sendMessage: async (id, msg) => {
        calls.messages.push(msg.type);
        if (msg.type === 'BC_READ_CONTACTS') {
          const page = pages[Math.min(calls.reads++, pages.length - 1)];
          return { ok: true, url, site: 'alumni.example.org', source: 'generic', blocked: null, ...page };
        }
        if (msg.type === 'BC_NEXT_PAGE') { calls.nexts++; return { ok: true, how: nextHow(calls.nexts) }; }
        return { ok: false };
      }
    },
    windows: { onFocusChanged: noop, WINDOW_ID_NONE: -1 },
    scripting: { executeScript: async () => {}, insertCSS: async () => {} },
    storage: {
      local: {
        get: async (k) => ({ [k]: store[k] }),
        set: async (v) => Object.assign(store, v)
      },
      onChanged: noop
    }
  };
  window.fetch = (u, o) => fetch(String(u).replace('http://localhost:5055', ctx.base), o);
  window.console = { log() {}, warn() {}, error() {} };
  window.eval(src('popup.js'));
  window.pageDelayMs = () => 0;
  const p = { window, document: window.document, store, calls, ready: waitFor(() => window.document.getElementById('app-status').className.match(/ok|bad/)) };
  open.push(p);
  return p;
}

async function start(p) {
  await p.ready;
  const box = p.document.getElementById('multi-page');
  box.checked = true;
  box.dispatchEvent(new p.window.Event('change'));
  p.document.getElementById('capture-btn').click();
}

test('off by default; the first use on a site needs the terms warning accepted', async () => {
  const p = panel({ pages: [{ contacts: [person(1)] }] });
  await p.ready;
  assert.equal(p.document.getElementById('multi-page').checked, false);
  await start(p);
  await waitFor(() => !p.document.getElementById('multi-warning').hidden);
  assert.match(p.document.getElementById('multi-warning-text').textContent, /may break this site's\s+terms/);
  assert.equal(p.calls.reads, 0); // nothing happens until accepted
  p.document.getElementById('multi-accept').click();
  await waitFor(() => !p.document.getElementById('capture-review').hidden);
  assert.ok(p.store.multiPageAccepted['alumni.example.org']);
});

test('steps pages with Next up to the cap, deduping, then shows everything for review', async () => {
  const pages = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ contacts: [person(n * 2), person(n * 2 + 1), person(2)] }));
  const p = panel({ pages, store: { multiPageAccepted: { 'alumni.example.org': 'x' } } });
  await p.ready;
  p.document.getElementById('multi-pages').value = '3';
  await start(p);
  await waitFor(() => !p.document.getElementById('capture-review').hidden);
  assert.equal(p.calls.reads, 3);
  assert.equal(p.calls.nexts, 2);
  assert.equal(p.document.querySelectorAll('#capture-rows li').length, 6); // 2,3 + 4,5 + 6,7, with Person 2 on every page
  assert.match(p.document.getElementById('capture-msg').textContent, /Stopped after 3 pages because reached the 3-page limit/);
});

test('the cap can never go above 25', async () => {
  const pages = Array.from({ length: 40 }, (_, i) => ({ contacts: [person(i)] }));
  const p = panel({ pages, store: { multiPageAccepted: { 'alumni.example.org': 'x' } } });
  await p.ready;
  p.document.getElementById('multi-pages').value = '100';
  await start(p);
  await waitFor(() => !p.document.getElementById('capture-review').hidden, { timeout: 8000 });
  assert.equal(p.calls.reads, 25);
});

test('stops on a page with no new people, on a login wall, and when there is no Next', async () => {
  let p = panel({ pages: [{ contacts: [person(1)] }, { contacts: [person(1)] }], store: { multiPageAccepted: { 'alumni.example.org': 'x' } } });
  await start(p);
  await waitFor(() => !p.document.getElementById('capture-review').hidden);
  assert.match(p.document.getElementById('capture-msg').textContent, /because a page had no new people/);

  p = panel({ pages: [{ contacts: [person(1)] }, { contacts: [], blocked: 'login' }], store: { multiPageAccepted: { 'alumni.example.org': 'x' } } });
  await start(p);
  await waitFor(() => !p.document.getElementById('capture-review').hidden);
  assert.match(p.document.getElementById('capture-msg').textContent, /because the site asked you to sign in/);
  assert.equal(p.document.querySelectorAll('#capture-rows li').length, 1); // kept what it had

  p = panel({ pages: [{ contacts: [person(1)] }, { contacts: [], blocked: 'captcha' }], store: { multiPageAccepted: { 'alumni.example.org': 'x' } } });
  await start(p);
  await waitFor(() => !p.document.getElementById('capture-review').hidden);
  assert.match(p.document.getElementById('capture-msg').textContent, /security check/);

  p = panel({ pages: [{ contacts: [person(1)] }], nextHow: () => null, store: { multiPageAccepted: { 'alumni.example.org': 'x' } } });
  await start(p);
  await waitFor(() => !p.document.getElementById('capture-review').hidden);
  assert.match(p.document.getElementById('capture-msg').textContent, /because there was no next page/);
});

test('Stop is visible while running and keeps what was captured', async () => {
  const pages = Array.from({ length: 10 }, (_, i) => ({ contacts: [person(i)] }));
  const p = panel({ pages, store: { multiPageAccepted: { 'alumni.example.org': 'x' } } });
  await p.ready;
  p.window.pageDelayMs = () => 60000; // a long wait between pages
  await start(p);
  const stop = p.document.getElementById('capture-stop');
  await waitFor(() => !stop.hidden && p.calls.nexts === 1);
  stop.click();
  await waitFor(() => !p.document.getElementById('capture-review').hidden);
  assert.equal(stop.hidden, true);
  assert.equal(p.document.querySelectorAll('#capture-rows li').length, 1);
  assert.match(p.document.getElementById('capture-msg').textContent, /because you stopped it/);
});

test('pages are 4–10 s apart and only BC_* messages go to the tab (no profile opening)', async () => {
  const p = panel({ pages: [{ contacts: [person(1)] }, { contacts: [person(2)] }], store: { multiPageAccepted: { 'alumni.example.org': 'x' } } });
  await p.ready;
  const real = p.window.eval('(' + src('popup.js').match(/function pageDelayMs\(\) \{[\s\S]*?\n\}/)[0] + ')');
  for (let i = 0; i < 200; i++) {
    const ms = real();
    assert.ok(ms >= 4000 && ms <= 10000, String(ms));
  }
  p.document.getElementById('multi-pages').value = '2';
  await start(p);
  await waitFor(() => !p.document.getElementById('capture-review').hidden);
  // WSO_READ_JOB_PAGE is the panel's existing job-page auto-read, unrelated to capture.
  const allowed = new Set(['BC_READ_CONTACTS', 'BC_NEXT_PAGE', 'WSO_READ_JOB_PAGE']);
  assert.ok(p.calls.messages.every((m) => allowed.has(m)), p.calls.messages.join(','));
  assert.equal(p.calls.messages.filter((m) => m === 'BC_NEXT_PAGE').length, 1);
});
