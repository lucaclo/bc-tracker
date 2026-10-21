// End-to-end test of the real fill engine (extension/content/autofill.js + lib/*) against
// a page shaped like Workday's "My Experience" step AFTER its "Autofill with Resume" CV
// parser has filled the cards with garbage — the situation Luca hit on Brown Advisory
// (2026-10-09): a "LEADERSHIP" card, "Equity Research" as a company, the next job's
// company glued onto a description, dates off by a month.
//
// The rule under test: every card ends up showing exactly its own profile entry and
// nothing else; anything the fill can't set is flagged with the value it should be.
// Profile data here is fictional (this repo is public).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const EXT = path.join(__dirname, '..', '..', 'extension');
const FILES = [
  'lib/fieldMap.js',
  'lib/comboboxFill.js',
  'lib/fillVerifier.js',
  'lib/blockFill.js',
  'lib/siteMappers/workday.js',
  'lib/siteMappers/greenhouse.js',
  'lib/siteMappers/lever.js',
  'content/autofill.js'
].map((f) => fs.readFileSync(path.join(EXT, f), 'utf8'));

const PROFILE = {
  legalFirstName: 'Alex',
  legalLastName: 'Sample',
  email: 'alex@example.com',
  phoneNumber: '07700 900123',
  city: 'London',
  workExperience: [
    { jobTitle: 'Summer Analyst', company: 'Northwind Capital', location: 'Hong Kong', startMonth: '07', startYear: '2026', endMonth: '08', endYear: '2026', currentlyWorkHere: false, roleDescription: '' },
    { jobTitle: 'Research Intern', company: 'Contoso Research', location: 'Saratoga, CA', startMonth: '06', startYear: '2026', endMonth: '09', endYear: '2026', currentlyWorkHere: false, roleDescription: '' },
    { jobTitle: 'Equity Research Work Experience', company: 'Fabrikam Asset Management', location: 'Hong Kong', startMonth: '11', startYear: '2024', endMonth: '11', endYear: '2024', currentlyWorkHere: false, roleDescription: '' },
    { jobTitle: 'Work Experience', company: 'Tailspin Markets', location: 'Hong Kong', startMonth: 'June', startYear: '2023', endMonth: 'Jul', endYear: '2023', currentlyWorkHere: false, roleDescription: 'Shadowed the derivatives desk' },
    { jobTitle: 'Summer Internship', company: 'Litware Podcast', location: 'London', startMonth: '09', startYear: '2026', endMonth: '09', endYear: '2026', currentlyWorkHere: false, roleDescription: '' }
  ],
  education: [],
  languages: [],
  skills: []
};

let uid = 0;
const text = (label, value, { area = false } = {}) => {
  const id = `f${++uid}`;
  return `<div data-automation-id="formField"><label for="${id}">${label}</label>${
    area ? `<textarea id="${id}">${value}</textarea>` : `<input type="text" id="${id}" value="${value}">`
  }</div>`;
};
const date = (label, mm, yyyy) => {
  const id = `l${++uid}`;
  return `<div data-automation-id="formField"><label id="${id}">${label}</label>
    <div role="group" aria-labelledby="${id}" data-automation-id="dateInputWrapper">
      <input type="text" role="spinbutton" data-automation-id="dateSectionMonth-input" aria-label="Month" value="${mm}">
      <input type="text" role="spinbutton" data-automation-id="dateSectionYear-input" aria-label="Year" value="${yyyy}">
    </div></div>`;
};
const card = (n, { title, company, location, from, to, desc }) => `
  <div><h4>Work Experience ${n}</h4><button type="button">Delete</button></div>
  ${text('Job Title*', title)}${text('Company*', company)}${text('Location', location)}
  <div data-automation-id="formField"><label for="cur${n}">I currently work here</label><input type="checkbox" id="cur${n}"></div>
  ${date('From*', ...from)}${date('To*', ...to)}
  ${text('Role Description', desc, { area: true })}`;

// What Workday's CV parser left on the page (cf. Luca's screenshots).
const PARSED = [
  { title: 'Summer analyst', company: 'Equity Research', location: '', from: ['07', '2026'], to: ['08', '2026'], desc: 'Built models' },
  { title: 'Research Intern', company: 'Contoso Research', location: 'Saratoga CA', from: ['06', '2026'], to: ['08', '2026'], desc: 'Completed 100+ hours of self-study.\nNorthwind Capital HK Hong Kong SAR' },
  { title: 'Equity Research', company: 'Fabrikam', location: '', from: ['11', '2024'], to: ['', ''], desc: 'an AI query layer\nFabrikam Asset Management Hong Kong SAR' },
  { title: 'LEADERSHIP', company: 'Education for a Better Future', location: 'London UK', from: ['04', '2023'], to: ['', ''], desc: 'Shadowed the derivatives desk' },
  { title: 'Summer Internship', company: 'Litware Podcast', location: 'London', from: ['09', '2026'], to: ['09', '2026'], desc: '' },
  { title: 'President', company: 'Investment Society', location: 'London', from: ['10', '2024'], to: ['', ''], desc: 'Ran the society' }
];

function workdayPage(cards, extra = '') {
  const html = `<!doctype html><html><body><form>
    <h3>My Experience</h3>
    <h3>Work Experience</h3>
    ${cards.map((c, i) => card(i + 1, c)).join('')}
    <button type="button">Add Another</button>
    <h3>Education</h3>
    ${extra}
  </form></body></html>`;
  const dom = new JSDOM(html, { url: 'https://acme.wd1.myworkdayjobs.com/en-US/careers/job/x/apply', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = function () {
    return [{ width: 10, height: 10 }];
  };
  let onMessage;
  window.chrome = {
    runtime: {
      sendMessage(msg, cb) {
        if (msg.type === 'WSO_GET_PROFILE') cb({ ok: true, profile: PROFILE });
      },
      onMessage: { addListener: (fn) => (onMessage = fn) },
      lastError: null
    }
  };
  window.console = { log() {}, warn() {}, error: console.error };
  for (const src of FILES) window.eval(src);
  const runFill = () => new Promise((resolve) => onMessage({ type: 'WSO_RUN_FILL' }, {}, resolve));
  return { window, document: window.document, runFill };
}

function cardValues(document, n) {
  const all = [...document.querySelectorAll('h4')];
  const heading = all.find((h) => h.textContent === `Work Experience ${n}`);
  const next = all[all.indexOf(heading) + 1];
  const inCard = (el) =>
    heading.compareDocumentPosition(el) & 4 && (!next || next.compareDocumentPosition(el) & 2);
  const fields = [...document.querySelectorAll('input, textarea')].filter(inCard);
  const [title, company, location, cur, fm, fy, tm, ty, desc] = fields;
  return {
    title: title.value, company: company.value, location: location.value, current: cur.checked,
    from: `${fm.value}/${fy.value}`, to: `${tm.value}/${ty.value}`, desc: desc.value, fields
  };
}

test('every Workday card shows exactly its own profile entry after Fill', async () => {
  const { document, runFill } = workdayPage(PARSED);
  await runFill();
  const expected = [
    ['Summer Analyst', 'Northwind Capital', 'Hong Kong', '07/2026', '08/2026', ''],
    ['Research Intern', 'Contoso Research', 'Saratoga, CA', '06/2026', '09/2026', ''],
    ['Equity Research Work Experience', 'Fabrikam Asset Management', 'Hong Kong', '11/2024', '11/2024', ''],
    ['Work Experience', 'Tailspin Markets', 'Hong Kong', '06/2023', '07/2023', 'Shadowed the derivatives desk'],
    ['Summer Internship', 'Litware Podcast', 'London', '09/2026', '09/2026', '']
  ];
  expected.forEach(([title, company, location, from, to, desc], i) => {
    const v = cardValues(document, i + 1);
    assert.deepEqual(
      { title: v.title, company: v.company, location: v.location, from: v.from, to: v.to, desc: v.desc, current: v.current },
      { title, company, location, from, to, desc, current: false },
      `Work Experience ${i + 1}`
    );
  });
});

test('nothing parsed by the site survives: no "LEADERSHIP", no glued-on company lines', async () => {
  const { document, runFill } = workdayPage(PARSED);
  await runFill();
  const shown = [1, 2, 3, 4, 5].flatMap((n) => cardValues(document, n).fields.map((f) => f.value)).join(' | ');
  for (const junk of ['LEADERSHIP', 'Education for a Better Future', 'Equity Research |', 'Saratoga CA', 'Hong Kong SAR', 'self-study', 'AI query layer', 'Built models']) {
    assert.ok(!shown.includes(junk), `"${junk}" is still on the page`);
  }
});

test('a card with no profile entry is flagged for deletion, never filled', async () => {
  const { document, runFill } = workdayPage(PARSED);
  const result = await runFill();
  const v = cardValues(document, 6);
  assert.equal(v.title, 'President'); // left as-is…
  const flag = result.flagged.find((f) => /Work Experience 6 is not in your profile/.test(f.label));
  assert.ok(flag, 'card 6 flagged'); // …but loudly flagged
  assert.match(flag.label, /Delete this card/);
});

test('profile entries without a card are flagged with "Add Another"', async () => {
  const { runFill } = workdayPage(PARSED.slice(0, 3));
  const result = await runFill();
  const flag = result.flagged.find((f) => /Add Another/.test(f.label));
  assert.ok(flag);
  assert.match(flag.label, /4\. Work Experience at Tailspin Markets; 5\. Summer Internship at Litware Podcast/);
});

test('clearing site-parsed text is reported, not silent', async () => {
  const { runFill } = workdayPage(PARSED);
  const result = await runFill();
  const cleared = result.worthChecking.filter((f) => /cleared text that isn't in your profile/.test(f.label));
  assert.ok(cleared.some((f) => /Work Experience 2 · Role Description/.test(f.label)));
});

test('a field the site refuses to take is flagged with the profile value', async () => {
  const { window, document, runFill } = workdayPage(PARSED);
  // Simulate Workday reverting the To-month after we set it.
  const toMonth = cardValues(document, 2).fields[6];
  toMonth.addEventListener('focusout', () => setTimeout(() => (toMonth.value = '08'), 0));
  const result = await runFill();
  assert.equal(toMonth.value, '08');
  assert.ok(result.flagged.some((f) => /Work Experience 2 · To month should be 09 \(09\/2026\)/.test(f.label)), JSON.stringify(result.flagged.map((f) => f.label)));
  assert.ok(!toMonth.classList.contains('wso-filled-high'));
  void window;
});

test('My Information: phone extension / device type / phone code never get profile data', async () => {
  const id = () => `p${++uid}`;
  const ext = id();
  const code = id();
  const { document, runFill } = workdayPage([], `
    <h3>My Information</h3>
    <label for="${code}">Country Phone Code*</label><input id="${code}" value="">
    <label for="ph">Phone Number*</label><input id="ph" value="">
    <label for="${ext}">Phone Extension</label><input id="${ext}" value="">`);
  await runFill();
  assert.equal(document.getElementById('ph').value, '07700 900123');
  assert.equal(document.getElementById(ext).value, '');
  assert.equal(document.getElementById(code).value, '');
});
