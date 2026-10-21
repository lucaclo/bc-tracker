// Generic on-page contact reader (extension/content/contact-reader.js, issue #9). Synthetic
// layouts with invented people: list, grid, table, LinkedIn-like, and pages with nobody on them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const EXT = path.join(__dirname, '..', '..', 'extension');
const MATCH_SRC = fs.readFileSync(path.join(EXT, 'lib', 'companyMatch.js'), 'utf8');
const READER_SRC = fs.readFileSync(path.join(EXT, 'content', 'contact-reader.js'), 'utf8');

function page(body, url = 'https://alumni.example.org/directory', { before = '' } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><title>Directory</title></head><body>${body}</body></html>`, { url, runScripts: 'outside-only' });
  const listeners = [];
  dom.window.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) } } };
  dom.window.console = { log() {}, warn() {}, error() {} };
  dom.window.eval(MATCH_SRC);
  if (before) dom.window.eval(before);
  dom.window.eval(READER_SRC);
  return { window: dom.window, reader: dom.window.BC_ContactReader, listeners };
}

const SITE_CHROME = `
  <header><nav><ul>
    <li><a href="/">Home</a></li><li><a href="/about">About Us</a></li>
    <li><a href="/events">Events</a></li><li><a href="/contact">Contact Us</a></li>
  </ul></nav></header>`;
const FOOTER = `
  <footer><ul>
    <li><a href="/privacy">Privacy Policy</a></li><li><a href="/terms">Terms Of Use</a></li>
    <li><a href="/cookies">Cookie Settings</a></li><li><a href="/help">Help Centre</a></li>
  </ul></footer>`;

test('list layout: "Title at Company" lines', () => {
  const { reader } = page(`${SITE_CHROME}
    <ul class="results">
      <li class="person"><a href="/people/1">Jane Doe</a><p>Analyst at Goldman Sachs</p><p>London, United Kingdom</p></li>
      <li class="person"><a href="/people/2">Tom O'Brien</a><p>Associate at Lazard</p><p>Paris, France</p></li>
      <li class="person"><a href="/people/3">Priya Shah</a><p>Vice President at J.P. Morgan</p></li>
    </ul>${FOOTER}`);
  const { source, contacts } = reader.readContacts();
  assert.equal(source, 'generic');
  assert.equal(contacts.length, 3);
  assert.deepEqual(
    { ...contacts[0], flags: [...contacts[0].flags] },
    {
      name: 'Jane Doe', title: 'Analyst', company: 'Goldman Sachs', location: 'London, United Kingdom',
      profileUrl: 'https://alumni.example.org/people/1', linkedinUrl: '', email: '',
      companyKey: 'goldmansachs', confidence: 'high', flags: []
    }
  );
  assert.equal(contacts[1].name, "Tom O'Brien");
  assert.equal(contacts[2].companyKey, 'jpmorgan');
});

test('grid layout: separate title and company lines, class hints, email', () => {
  const { reader } = page(`
    <div class="grid">
      <div class="card"><h3>Amelia Hart</h3><div class="job-title">Summer Analyst</div><div class="company-name">Evercore</div>
        <a href="mailto:amelia@example.com">Email</a><button>Message</button></div>
      <div class="card"><h3>Ben Carter</h3><div class="job-title">Investment Banking Associate</div><div class="company-name">PJT Partners</div></div>
      <div class="card"><h3>Chloé Martin</h3><div class="job-title">Director</div><div class="company-name">Rothschild &amp; Co</div></div>
      <div class="card"><h3>Dev Patel</h3><div class="job-title">Student</div></div>
    </div>`);
  const { contacts } = reader.readContacts();
  assert.equal(contacts.length, 4);
  assert.equal(contacts[0].name, 'Amelia Hart');
  assert.equal(contacts[0].title, 'Summer Analyst');
  assert.equal(contacts[0].company, 'Evercore');
  assert.equal(contacts[0].email, 'amelia@example.com');
  assert.equal(contacts[0].confidence, 'high');
  assert.equal(contacts[2].name, 'Chloé Martin');
  assert.equal(contacts[2].companyKey, 'rothschild');
  // No company → flagged, never guessed.
  assert.equal(contacts[3].confidence, 'low');
  assert.deepEqual([...contacts[3].flags], ['no company found']);
});

test('table layout: one row per person', () => {
  const { reader } = page(`
    <table><thead><tr><th>Name</th><th>Position</th><th>Organisation</th><th>Year</th></tr></thead>
      <tbody>
        <tr><td><a href="/m/11">Hannah Lee</a></td><td>Analyst</td><td>Barclays</td><td>2019</td></tr>
        <tr><td><a href="/m/12">Isaac Newton-Smith</a></td><td>Trader</td><td>Citi</td><td>2017</td></tr>
        <tr><td><a href="/m/13">Jo March</a></td><td>Associate</td><td>Blackstone</td><td>2015</td></tr>
      </tbody></table>`);
  const { contacts } = reader.readContacts();
  assert.deepEqual(JSON.parse(JSON.stringify(contacts.map((c) => [c.name, c.title, c.company]))), [
    ['Hannah Lee', 'Analyst', 'Barclays'],
    ['Isaac Newton-Smith', 'Trader', 'Citi'],
    ['Jo March', 'Associate', 'Blackstone']
  ]);
  assert.equal(contacts[2].confidence, 'medium'); // unknown firm placed by line order
});

test('LinkedIn-like layout: separators, pronouns, degree badges, linkedin URL', () => {
  const card = (slug, name, headline, loc) => `
    <li class="reusable-search__result-container">
      <div class="entity-result">
        <span class="entity-result__title-text"><a class="app-aware-link" href="https://www.linkedin.com/in/${slug}?miniProfileUrn=x">
          <span aria-hidden="true">${name}</span><span class="visually-hidden">View ${name}’s profile</span></a></span>
        <span class="entity-result__badge"><span aria-hidden="true">• 2nd</span></span>
        <div class="entity-result__primary-subtitle">${headline}</div>
        <div class="entity-result__secondary-subtitle">${loc}</div>
        <button>Connect</button>
      </div>
    </li>`;
  const { reader } = page(`${SITE_CHROME}<main><ul class="reusable-search__entity-result-list">
      ${card('kate-n', 'Kate Nguyen', 'Analyst · Morgan Stanley', 'Greater London')}
      ${card('liam-o', 'Liam Okafor (he/him)', 'Incoming Summer Analyst | UBS', 'London Area, United Kingdom')}
      ${card('mia-r', 'Mia Rossi', 'Student at Durham University', 'Durham, England')}
    </ul></main>`, 'https://www.linkedin.com/search/results/people/?keywords=x');
  const { contacts } = reader.readContacts();
  assert.equal(contacts.length, 3);
  assert.equal(contacts[0].name, 'Kate Nguyen');
  assert.equal(contacts[0].title, 'Analyst');
  assert.equal(contacts[0].company, 'Morgan Stanley');
  assert.equal(contacts[0].location, 'Greater London');
  assert.equal(contacts[0].linkedinUrl, 'https://www.linkedin.com/in/kate-n?miniProfileUrn=x');
  assert.equal(contacts[1].name, 'Liam Okafor');
  assert.equal(contacts[1].company, 'UBS');
  assert.equal(contacts[2].company, 'Durham University');
});

test('a page with no people returns nothing (nav, footer, articles, products)', () => {
  const { reader } = page(`${SITE_CHROME}
    <main>
      <section class="news">
        <article class="post"><h2>Annual Dinner Returns</h2><p>Tickets on sale now for the spring event.</p></article>
        <article class="post"><h2>New Mentoring Scheme</h2><p>Sign up by Friday to be matched.</p></article>
        <article class="post"><h2>Careers Fair Recap</h2><p>Over forty firms attended this year.</p></article>
      </section>
      <ul class="products"><li><span>Blue Mug</span><span>£8</span></li><li><span>Red Scarf</span><span>£20</span></li><li><span>Green Tie</span><span>£15</span></li></ul>
      <ul class="tags"><li>Investment Banking</li><li>Private Equity</li><li>Asset Management</li></ul>
    </main>${FOOTER}`);
  assert.deepEqual([...reader.readContacts().contacts], []);
});

test('cards without a clear name are returned flagged', () => {
  const { reader } = page(`
    <ul>
      <li><a href="/p/1">Nora Quinn</a><p>Analyst at HSBC</p></li>
      <li><a href="/p/2">Oscar Reid</a><p>Associate at Barclays</p></li>
      <li><a href="/p/3">Pia Stone</a><p>Analyst at UBS</p></li>
      <li><a href="/p/4">member 4471</a><p>Analyst at Citi</p></li>
    </ul>`);
  const { contacts } = reader.readContacts();
  assert.equal(contacts.length, 4);
  assert.equal(contacts[3].name, '');
  assert.equal(contacts[3].confidence, 'low');
  assert.ok(contacts[3].flags.includes('no clear name'));
});

test('BC_READ_CONTACTS message answers without changing the page', () => {
  const body = `<ul><li><a href="/a">Ann Bell</a><p>Analyst at Lazard</p></li><li><a href="/b">Cy Dunn</a><p>VP at Lazard</p></li><li><a href="/c">Ed Fox</a><p>MD at Lazard</p></li></ul>`;
  const { window, listeners } = page(body);
  const before = window.document.body.innerHTML;
  let reply;
  const async = listeners[0]({ type: 'BC_READ_CONTACTS' }, {}, (r) => { reply = r; });
  assert.equal(async, false);
  assert.equal(reply.ok, true);
  assert.equal(reply.site, 'alumni.example.org');
  assert.equal(reply.contacts.length, 3);
  assert.equal(window.document.body.innerHTML, before);
  assert.equal(listeners[0]({ type: 'OTHER' }, {}, () => {}), false);
});

test('a matching adapter goes first; an empty adapter falls back to generic', () => {
  const body = `<ul><li><a href="/a">Ann Bell</a><p>Analyst at Lazard</p></li><li><a href="/b">Cy Dunn</a><p>VP at Lazard</p></li><li><a href="/c">Ed Fox</a><p>MD at Lazard</p></li></ul>`;
  const adapters = `window.BC_CONTACT_ADAPTERS = [
    { name: 'empty', match: (u) => u.includes('empty'), read: () => [] },
    { name: 'fake', match: (u) => u.includes('fake'), read: () => [{ name: 'From Adapter', company: 'UBS' }, { name: 'No Firm' }] }
  ];`;
  let { reader } = page(body, 'https://fake.example.com/', { before: adapters });
  let result = reader.readContacts();
  assert.equal(result.source, 'adapter:fake');
  assert.equal(result.contacts[0].companyKey, 'ubs');
  assert.equal(result.contacts[1].confidence, 'low');
  ({ reader } = page(body, 'https://empty.example.com/', { before: adapters }));
  result = reader.readContacts();
  assert.equal(result.source, 'generic');
  assert.equal(result.contacts.length, 3);
});

test('a fresh injection takes over from a stale copy', () => {
  const { window, listeners } = page('<p>nobody</p>');
  window.eval(READER_SRC);
  let reply = null;
  listeners[0]({ type: 'BC_READ_CONTACTS' }, {}, (r) => { reply = r; });
  assert.equal(reply, null); // old copy stays quiet
  listeners[1]({ type: 'BC_READ_CONTACTS' }, {}, (r) => { reply = r; });
  assert.equal(reply.ok, true);
});
