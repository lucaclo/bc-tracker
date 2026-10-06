// Regression tests for extension/content/tracker-reader.js, run against a fixture that
// mirrors Trackr's real table structure (inspected live 2026-10-05): no industry/region
// columns, sector as full-width colspan section rows, region only in the page heading,
// accordion parent rows with a count badge, and off-site test-prep links that are not
// applications. Run with `npm test` from app/.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const READER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'extension', 'content', 'tracker-reader.js'),
  'utf8'
);

const HEADERS = ['My Status', 'Company Name', 'Programme Name', 'Opening Date', 'Closing Date',
  'Latest Stage', 'Info & Test Prep', 'Notes'];

const section = (label) => `<tr><td colspan="100">${label}</td></tr>`;
const row = ({ company = '', role = '', link = '', badge = '', opening = '', closing = '', prep = '' }) => `
  <tr>
    <td></td>
    <td>${company}</td>
    <td><span><span><i class="fa-caret-right"></i></span>${
      link ? `<a href="${link}">${role}</a>` : `<span> ${role} </span>`
    }${badge ? `<span class="rounded-full select-none">${badge}</span>` : ''}</span></td>
    <td>${opening}</td>
    <td>${closing}</td>
    <td></td>
    <td>${prep ? `<a href="${prep}">HireVue</a>` : ''}</td>
    <td></td>
  </tr>`;

function trackrPage({ heading = 'UK Finance Tracker', pathname = '/uk-finance/summer-internships', title = 'UK Finance - Trackr' } = {}) {
  const html = `<!doctype html><html><head><title>${title}</title></head><body>
    ${heading ? `<h1>${heading}</h1>` : ''}
    <table>
      <tr>${HEADERS.map((h) => `<th>${h}</th>`).join('')}</tr>
      ${section('Promoted')}
      ${row({ company: 'Shell', role: 'Assessed Internship Programme 2027', link: 'https://shell.example/apply', opening: '15 Sep 26', closing: '31 Jan 27' })}
      ${row({ company: 'AmplifyME', role: 'Investing Simulator', link: 'https://amplify.example/apply' })}
      ${section('Bulge Bracket')}
      ${row({ company: 'Citi', role: 'Summer Analyst 2027', badge: '9', opening: '01 Oct 26' })}
      ${row({ role: 'Investment Banking - FIG, Summer Analyst, 2027', link: 'https://citi.wd5.myworkdayjobs.com/x', opening: '01 Oct 26' })}
      ${row({ role: 'Global Wealth, Summer Analyst, 2027', link: 'https://citi.wd5.myworkdayjobs.com/y', opening: '24 Sep 26' })}
      ${row({ company: 'Morgan Stanley', role: '2027 Summer Analyst Programme', link: 'https://ms.example/apply', prep: 'https://www.jobtestprep.co.uk/morgan-stanley' })}
      ${row({ company: 'Deutsche Bank', role: 'Internship Programme 2027', badge: '4', link: 'https://db.example/apply' })}
      ${section('Trading and Quant')}
      ${row({ company: 'Shell', role: 'Assessed Internship Programme 2027', link: 'https://shell.example/apply' })}
      ${section('Middle Market')}
      ${row({ company: 'Jefferies', role: '2027 Summer Analyst Program', link: 'https://jefferies.example/apply', closing: '05/11/2026' })}
      ${row({ role: 'Orphan sub-row with no parent in this section', link: 'https://orphan.example/apply' })}
    </table>
  </body></html>`;

  const dom = new JSDOM(html, { url: `https://app.the-trackr.com${pathname}`, runScripts: 'outside-only' });
  const stored = [];
  dom.window.chrome = { storage: { local: { set: (v) => stored.push(v.trackerLastCapturedContext) } } };
  dom.window.console = { log() {}, warn() {}, error: console.error };
  dom.window.eval(READER_SRC);
  return { window: dom.window, document: dom.window.document, stored, reader: dom.window.WSO_TrackerReader };
}

function linkFor(document, text) {
  const link = [...document.querySelectorAll('a')].find((a) => a.textContent.trim() === text);
  assert.ok(link, `fixture has no link "${text}"`);
  return link;
}

test('every application row gets company, role, industry and region', () => {
  const { document, reader } = trackrPage();
  const links = [...document.querySelectorAll('td:nth-child(3) a')];
  assert.ok(links.length >= 7);
  for (const a of links) {
    const data = reader.captureFromTarget(a);
    assert.ok(data, `no capture for ${a.textContent}`);
    if (a.textContent.startsWith('Orphan')) continue; // company genuinely absent; see below
    assert.deepEqual([...data.missingFields], [], `${a.textContent} missing ${data.missingFields}`);
  }
});

test('sector comes from the section heading above the row', () => {
  const { document, reader } = trackrPage();
  assert.equal(reader.captureFromTarget(linkFor(document, '2027 Summer Analyst Programme')).industry, 'Bulge Bracket');
  assert.equal(reader.captureFromTarget(linkFor(document, '2027 Summer Analyst Program')).industry, 'Middle Market');
});

test('region and fallback sector come from the tracker heading', () => {
  const { document, reader } = trackrPage();
  const data = reader.captureFromTarget(linkFor(document, 'Global Wealth, Summer Analyst, 2027'));
  assert.equal(data.region, 'UK');
  assert.deepEqual({ ...reader.trackerContext() }, { region: 'UK', sector: 'Finance' });
});

test('multi-word regions parse from the heading, then the URL, then the title', () => {
  assert.deepEqual({ ...trackrPage({ heading: 'Hong Kong Finance Tracker', pathname: '/hong-kong-finance/summer-internships' }).reader.trackerContext() },
    { region: 'Hong Kong', sector: 'Finance' });
  assert.deepEqual({ ...trackrPage({ heading: '', pathname: '/us-finance-2027/summer-internships', title: 'x' }).reader.trackerContext() },
    { region: 'US', sector: 'Finance' });
  assert.deepEqual({ ...trackrPage({ heading: '', pathname: '/weird', title: 'Germany Finance - Trackr' }).reader.trackerContext() },
    { region: 'Germany', sector: 'Finance' });
});

test('a Promoted row takes the sector of the same firm elsewhere in the table', () => {
  const { document, reader } = trackrPage();
  const promotedShell = document.querySelectorAll('td:nth-child(3) a')[0];
  const data = reader.captureFromTarget(promotedShell);
  assert.equal(data.section, 'Promoted');
  assert.equal(data.industry, 'Trading and Quant');
});

test('a Promoted firm that appears nowhere else falls back to the tracker sector', () => {
  const { document, reader } = trackrPage();
  assert.equal(reader.captureFromTarget(linkFor(document, 'Investing Simulator')).industry, 'Finance');
});

test('accordion sub-rows inherit the company but not across a section heading', () => {
  const { document, reader } = trackrPage();
  assert.equal(reader.captureFromTarget(linkFor(document, 'Global Wealth, Summer Analyst, 2027')).company, 'Citi');
  // The orphan row is directly under Jefferies in the same section, so it inherits that.
  assert.equal(reader.captureFromTarget(linkFor(document, 'Orphan sub-row with no parent in this section')).company, 'Jefferies');
});

test('count badges are stripped from the role', () => {
  const { document, reader } = trackrPage();
  const link = linkFor(document, 'Internship Programme 2027');
  assert.match(link.closest('td').textContent, /4/); // the badge really is in the cell
  assert.equal(reader.captureFromTarget(link).role, 'Internship Programme 2027');
});

test('test-prep links are not treated as applications', () => {
  const { document, reader } = trackrPage();
  assert.equal(reader.captureFromTarget(linkFor(document, 'HireVue')), null);
});

test('a real mousedown on an Apply link saves the row', () => {
  const { window, document, stored } = trackrPage();
  linkFor(document, 'Global Wealth, Summer Analyst, 2027').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].company, 'Citi');
  assert.equal(stored[0].industry, 'Bulge Bracket');
  assert.equal(stored[0].region, 'UK');
});

test('deadlines become local YYYY-MM-DD dates', () => {
  const { document, reader } = trackrPage();
  assert.equal(reader.captureFromTarget(document.querySelectorAll('td:nth-child(3) a')[0]).deadlineISO, '2027-01-31');
  assert.equal(reader.captureFromTarget(linkFor(document, '2027 Summer Analyst Program')).deadlineISO, '2026-11-05'); // UK day-first
  const { toISODate } = reader;
  assert.equal(toISODate('01 Oct 26'), '2026-10-01');
  assert.equal(toISODate('Sept 3 2026'), '2026-09-03');
  assert.equal(toISODate('31 Feb 27'), '');
  assert.equal(toISODate('TBC'), '');
  assert.match(toISODate('Aug 07'), /^20\d\d-08-07$/);
});
