// Site adapters for the contact reader (issue #11). Fixtures under fixtures/contact-adapters/
// are shaped like the live pages (checked 2026-10-21) but every person in them is invented.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const EXT = path.join(__dirname, '..', '..', 'extension');
const src = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');
const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', 'contact-adapters', f), 'utf8');

// Same order the side panel injects: matcher, adapters, reader.
function load(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  dom.window.chrome = { runtime: { onMessage: { addListener() {} } } };
  dom.window.console = { log() {}, warn() {}, error() {} };
  for (const f of ['lib/companyMatch.js', 'lib/contactAdapters/linkedin.js', 'content/contact-reader.js']) dom.window.eval(src(f));
  return JSON.parse(JSON.stringify(dom.window.BC_ContactReader.readContacts()));
}

test('LinkedIn people search: Current: summary beats the headline, badges and pronouns stripped', () => {
  const { source, contacts } = load(fixture('linkedin-search.html'), 'https://www.linkedin.com/search/results/people/?keywords=pe');
  assert.equal(source, 'adapter:linkedin');
  assert.deepEqual(contacts.map((c) => c.name), ['Ada Fenwick', 'Rory Quill', 'Lena Marsh', 'Tobi V.']);
  const [ada, rory, lena, tobi] = contacts;
  assert.equal(ada.title, 'Private Equity Analyst');
  assert.equal(ada.company, 'Harbour Fund Partners');
  assert.equal(ada.confidence, 'high');
  assert.equal(ada.linkedinUrl, 'https://www.linkedin.com/in/ada-fenwick/');
  assert.equal(ada.location, 'London');
  // "A | B | C" headline: best guess, and "Past:" is never used as the current firm.
  assert.equal(rory.title, 'Private Equity Associate');
  assert.equal(rory.company, 'Ex-JPM');
  assert.equal(rory.confidence, 'medium');
  assert.equal(lena.company, 'Goldman Sachs');
  assert.equal(lena.companyKey, 'goldmansachs');
  assert.equal(lena.location, 'Greater London');
  assert.equal(tobi.company, 'Example Capital');
  assert.equal(tobi.location, 'United Kingdom');
});

test('LinkedIn school alumni page', () => {
  const { source, contacts } = load(fixture('linkedin-alumni.html'), 'https://www.linkedin.com/school/durham-university/alumni/');
  assert.equal(source, 'adapter:linkedin');
  assert.deepEqual(contacts.map((c) => [c.name, c.title, c.company]), [
    ['Isla Brook', 'Economics student', 'Durham University'],
    ['Omar Pike', 'Associate', 'Rothschild & Co'],
    ['Wen Holt', 'Analyst', 'Evercore']
  ]);
  assert.equal(contacts[1].companyKey, 'rothschild');
});

test('the LinkedIn adapter only claims LinkedIn people pages', () => {
  const generic = load('<ul><li><a href="/a">Ann Bell</a><p>Analyst at Lazard</p></li><li><a href="/b">Cy Dunn</a><p>VP at Lazard</p></li><li><a href="/c">Ed Fox</a><p>MD at Lazard</p></li></ul>', 'https://www.linkedin.com/feed/');
  assert.equal(generic.source, 'generic');
});

test('if the adapter finds nobody, the generic reader still runs', () => {
  const html = '<main><ul class="people"><li><a href="/x/1">Ann Bell</a><p>Analyst at Lazard</p></li><li><a href="/x/2">Cy Dunn</a><p>VP at Lazard</p></li><li><a href="/x/3">Ed Fox</a><p>MD at Lazard</p></li></ul></main>';
  const result = load(html, 'https://www.linkedin.com/search/results/people/?keywords=x');
  assert.equal(result.source, 'generic');
  assert.equal(result.contacts.length, 3);
});
