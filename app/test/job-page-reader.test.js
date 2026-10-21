// Regression tests for extension/content/job-page-reader.js: capturing the job you're
// applying to from the company / ATS page itself. Fixtures mirror real markup inspected
// live on Workday (2026-10-09): data-automation-id attributes, a logo whose alt is
// "<Firm> Careers Logo careers home", JSON-LD whose hiringOrganization is the legal
// entity, and JSON-LD that goes stale after in-app navigation. Run with `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const EXT = path.join(__dirname, '..', '..', 'extension');
const DATES_SRC = fs.readFileSync(path.join(EXT, 'lib', 'dates.js'), 'utf8');
const READER_SRC = fs.readFileSync(path.join(EXT, 'content', 'job-page-reader.js'), 'utf8');

function page(html, url, { stored = null } = {}) {
  const dom = new JSDOM(`<!doctype html><html>${html}</html>`, { url, runScripts: 'outside-only' });
  const store = { trackerLastCapturedContext: stored };
  dom.window.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: store[key] }),
        set: async (v) => Object.assign(store, v)
      }
    },
    runtime: { onMessage: { addListener() {} } }
  };
  dom.window.console = { log() {}, warn() {}, error: console.error };
  dom.window.eval(DATES_SRC);
  dom.window.eval(READER_SRC);
  return { window: dom.window, document: dom.window.document, store, reader: dom.window.WSO_JobPageReader };
}

const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

// Shaped like the Brown Advisory posting from the bug report.
const workdayJob = ({ title = 'Equity Research Summer Analyst', ldTitle = title, location = 'London, UK' } = {}) => `
  <head><title>${title} - Brown Advisory Careers Logo</title>
    ${ld({ '@type': 'JobPosting', title: ldTitle, hiringOrganization: { name: '0042 Brown Advisory Limited' },
      jobLocation: { address: { addressCountry: 'United Kingdom', addressLocality: 'London' } }, datePosted: '2026-10-08' })}
  </head>
  <body>
    <header><a data-automation-id="logoLink"><img data-automation-id="logo" alt="Brown Advisory Careers Logo careers home"></a></header>
    <main>
      <div data-automation-id="jobDetails">
        <h2 data-automation-id="jobPostingHeader">${title}</h2>
        <a data-automation-id="adventureButton" href="/apply">Apply</a>
        <div data-automation-id="locations"><dl><dt>locations</dt><dd>${location}</dd></dl></div>
        <div>Full time</div><div>Posted Yesterday</div>
        <div>End Date: October 16, 2026 (6 days left to apply)</div>
        <div data-automation-id="requisitionId"><dl><dt>job requisition id</dt><dd>JR1822</dd></dl></div>
        <p>Company Overview — every firm has a culture…</p>
      </div>
    </main>
  </body>`;

const WORKDAY_URL = 'https://brownadvisory.wd1.myworkdayjobs.com/en-US/careers/job/London-UK/Equity-Research-Summer-Analyst_JR1822';

test('reads company, role, region and deadline from a Workday posting', () => {
  const { document, reader } = page(workdayJob(), WORKDAY_URL);
  const data = reader.readJobPage(document.querySelector('[data-automation-id="adventureButton"]'));
  assert.equal(data.company, 'Brown Advisory');
  assert.equal(data.role, 'Equity Research Summer Analyst');
  assert.equal(data.region, 'United Kingdom');
  assert.equal(data.location, 'London, UK');
  assert.equal(data.deadlineISO, '2026-10-16');
  assert.equal(data.sourceSite, 'Job page');
  assert.equal(data.sourceHost, 'brownadvisory.wd1.myworkdayjobs.com');
  assert.deepEqual([...data.guessedFields], []);
  assert.deepEqual([...data.missingFields], ['industry']); // job pages don't say — flagged, not guessed
});

test('stale JSON-LD from a previously viewed Workday job is ignored', () => {
  // Workday SPA: moved from "Full Stack Developer" to this job without a reload.
  const { document, reader } = page(workdayJob({ ldTitle: 'Full Stack Developer', location: 'Hong Kong' }), WORKDAY_URL);
  const data = reader.readJobPage(document.querySelector('[data-automation-id="adventureButton"]'));
  assert.equal(data.role, 'Equity Research Summer Analyst');
  assert.equal(data.region, 'Hong Kong'); // from the visible posting, not the stale London JSON-LD
});

test('clicking Apply saves the capture without blocking the click', async () => {
  const { window, document, store } = page(workdayJob(), WORKDAY_URL);
  const apply = document.querySelector('[data-automation-id="adventureButton"]');
  const ev = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  apply.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(store.trackerLastCapturedContext.company, 'Brown Advisory');
});

test('a 4-day-old tracker capture for another firm is replaced, not merged', async () => {
  const hsbc = { company: 'HSBC', role: 'Investment Banking - Corporate', industry: 'Investment Banking', region: 'United Kingdom',
    sourceSite: 'WSO Tracker', capturedAt: new Date(Date.now() - 4 * 864e5).toISOString() };
  const { window, document, store } = page(workdayJob(), WORKDAY_URL, { stored: hsbc });
  document.querySelector('[data-automation-id="adventureButton"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  const saved = store.trackerLastCapturedContext;
  assert.equal(saved.company, 'Brown Advisory');
  assert.equal(saved.industry, '');
  assert.equal(saved.mergedJobPage, undefined);
});

test('a recent tracker capture of the same firm is merged, the tracker winning', async () => {
  const trackr = { company: 'Brown Advisory', role: 'Summer Analyst Programme 2027', industry: 'Asset Management', region: 'UK',
    deadline: '', sourceSite: 'Trackr', capturedAt: new Date(Date.now() - 20 * 60e3).toISOString() };
  const { window, document, store } = page(workdayJob(), WORKDAY_URL, { stored: trackr });
  document.querySelector('[data-automation-id="adventureButton"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  const saved = store.trackerLastCapturedContext;
  assert.equal(saved.mergedJobPage, true);
  assert.equal(saved.sourceSite, 'Trackr');
  assert.equal(saved.industry, 'Asset Management');
  assert.equal(saved.role, 'Summer Analyst Programme 2027');
  assert.equal(saved.deadlineISO, '2026-10-16'); // the job page filled the tracker's gap
});

test('a tracker capture matches by the host its Apply link pointed at', () => {
  const { reader } = page('<body></body>', 'https://db.wd3.myworkdayjobs.com/x');
  const prev = { company: 'Deutsche Bank', sourceSite: 'Trackr', applyUrl: 'https://db.wd3.myworkdayjobs.com/job/1', capturedAt: new Date().toISOString() };
  assert.equal(reader.isSameApplication(prev, { company: 'Db', sourceHost: 'db.wd3.myworkdayjobs.com' }), true);
  assert.equal(reader.isSameApplication(prev, { company: 'Barclays', sourceHost: 'barclays.wd3.myworkdayjobs.com' }), false);
});

test('Greenhouse: role and company from the "Job application for … at …" title', () => {
  const { reader } = page(
    '<head><title>Job Application for Summer Analyst 2027 at Acme Capital</title></head><body><div id="header"><h1 class="app-title">Summer Analyst 2027</h1><div class="location">Hong Kong</div></div><a href="#app">Apply for this job</a></body>',
    'https://boards.greenhouse.io/acmecapital/jobs/123'
  );
  const data = reader.readJobPage(null);
  assert.equal(data.company, 'Acme Capital');
  assert.equal(data.role, 'Summer Analyst 2027');
  assert.equal(data.region, 'Hong Kong');
});

test('a firm careers page with nothing but a title falls back to the hostname, marked as a guess', () => {
  const { reader } = page(
    '<head><title>Spring Week 2027</title></head><body><h1>Spring Week 2027</h1><p>Applications close 30th November 2026.</p><button>Apply now</button></body>',
    'https://careers.rothschildandco.com/spring-week'
  );
  const data = reader.readJobPage(null);
  assert.equal(data.role, 'Spring Week 2027');
  assert.equal(data.company, 'Rothschildandco');
  assert.ok(data.guessedFields.includes('company'));
  assert.equal(data.deadlineISO, '2026-11-30');
});

test('only Apply-type controls trigger a capture — never Submit / Next', () => {
  const { document, reader } = page(
    '<body><button id="a">Apply now</button><button id="b">Submit application</button><button id="c">Next</button><a id="d" href="#">Start your application</a><button id="e"><span>Apply</span></button></body>',
    'https://example.com/job'
  );
  const hit = (id) => !!reader.findApplyControl(document.getElementById(id));
  assert.equal(hit('a'), true);
  assert.equal(hit('b'), false);
  assert.equal(hit('c'), false);
  assert.equal(hit('d'), true);
  assert.equal(reader.findApplyControl(document.querySelector('#e span'))?.id, 'e');
});

test('country names come out in full, and "us" in prose is not the US', () => {
  const { reader } = page('<body></body>', 'https://example.com/');
  assert.equal(reader.countryIn('London, UK'), 'United Kingdom');
  assert.equal(reader.countryIn('London United Kingdom'), 'United Kingdom');
  assert.equal(reader.countryIn('New York, NY, USA'), 'United States');
  assert.equal(reader.countryIn('Hong Kong SAR'), 'Hong Kong');
  assert.equal(reader.countryIn('join us in the office'), '');
});

// The real Brown Advisory pages, as inspected live 2026-10-09: logo alt is just
// " search for jobs", <title> is empty, and the application steps (/apply/…) show the job
// as data-automation-id="jobTitleHeading" with no location or end date on screen.
const brownApplyStep = `
  <head><title></title>
    ${ld({ '@type': 'JobPosting', title: 'Equity Research Summer Analyst', validThrough: '2026-10-16',
      hiringOrganization: { name: 'LE018 Brown Advisory LTD' },
      jobLocation: { address: { addressCountry: 'United Kingdom', addressLocality: 'UK London Office' } } })}
  </head>
  <body>
    <a data-automation-id="logoLink"><img data-automation-id="logo" alt=" search for jobs"></a>
    <a href="#">Back to Job Posting</a>
    <h2 data-automation-id="jobTitleHeading">Equity Research Summer Analyst</h2>
    <ol><li>Create Account/Sign In</li><li>My Information</li><li>Application Questions</li></ol>
    <label>Email Address <input></label>
  </body>`;

test('Workday application step (real Brown Advisory markup) reads the whole job', () => {
  const { reader } = page(brownApplyStep,
    'https://brownadvisory.wd1.myworkdayjobs.com/en-US/Brown-Interns/job/London%2C-UK/Equity-Research-Summer-Analyst_JR1822/apply/applyManually');
  const data = reader.readJobPage(null);
  assert.equal(data.company, 'Brown Advisory');
  assert.equal(data.role, 'Equity Research Summer Analyst');
  assert.equal(data.location, 'London, UK'); // from the Workday URL
  assert.equal(data.region, 'United Kingdom');
  assert.equal(data.deadlineISO, '2026-10-16');
  assert.equal(data.looksLikeJob, true);
  assert.deepEqual([...data.guessedFields], []);
});

test('company picks the candidate matching the firm in the URL', () => {
  const { reader } = page(
    `<head><title>Summer Analyst - Citi Careers Logo</title>${ld({ '@type': 'JobPosting', title: 'Summer Analyst', hiringOrganization: { name: '12542 Citicorp Services India Private Limited' } })}</head>
     <body><img data-automation-id="logo" alt="Citi Careers Logo careers home"><h2 data-automation-id="jobPostingHeader">Summer Analyst</h2></body>`,
    'https://citi.wd5.myworkdayjobs.com/en-US/2/job/London-United-Kingdom/Summer-Analyst_1');
  assert.equal(reader.readJobPage(null).company, 'Citi');
});

test('an ordinary page is not auto-captured', async () => {
  const { window, store } = page('<head><title>Inbox</title></head><body><h1>Inbox</h1></body>', 'https://mail.example.com/');
  // Same path the side panel's auto-read uses.
  const listener = [];
  window.chrome.runtime.onMessage.addListener = (fn) => listener.push(fn);
  window.WSO_JobPageReader = undefined;
  window.eval(READER_SRC);
  const res = await new Promise((resolve) => listener[0]({ type: 'WSO_READ_JOB_PAGE', auto: true }, {}, resolve));
  assert.equal(res.ok, false);
  assert.equal(store.trackerLastCapturedContext, null);
});

test('a re-injected copy takes over from a stale one left by an extension reload', async () => {
  const { window, store } = page(workdayJob(), WORKDAY_URL);
  // The panel injects a fresh copy into the same tab.
  const listeners = [];
  window.chrome.runtime.onMessage.addListener = (fn) => listeners.push(fn);
  window.eval(READER_SRC);
  assert.equal(listeners.length, 1, 'the fresh copy registered its listener');
  const res = await new Promise((resolve) => listeners[0]({ type: 'WSO_READ_JOB_PAGE', auto: true }, {}, resolve));
  assert.equal(res.ok, true);
  assert.equal(store.trackerLastCapturedContext.role, 'Equity Research Summer Analyst');
  // The stale copy's click handler must stay inert (only one capture per Apply).
  let saves = 0;
  const set = window.chrome.storage.local.set;
  window.chrome.storage.local.set = async (v) => (saves++, set(v));
  window.document.querySelector('[data-automation-id="adventureButton"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(saves, 1);
});
