// Contacts dropdown on each application row (issue #6), driven through the real page and
// scripts in jsdom against a real app on a temp data dir.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, loadUI, waitFor } = require('./helpers');

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { await ctx.stop(); });
beforeEach(() => ctx.reset());

async function seed() {
  const jpm = (await ctx.api('POST', '/api/applications', { company: 'J.P. Morgan', role: 'IB Summer Analyst' })).body;
  const ubs = (await ctx.api('POST', '/api/applications', { company: 'UBS', role: 'Markets' })).body;
  await ctx.api('POST', '/api/contacts/bulk', [
    {
      name: 'Alex Example', title: 'Associate', company: 'JPMorgan', team: 'M&A', location: 'London',
      linkedinUrl: 'https://www.linkedin.com/in/alex-example', profileUrl: 'javascript:alert(1)',
      email: 'alex@example.com', sourceGroup: 'Old Wellingtonian', school: 'Wellington College',
      gradYear: '2019', society: 'Finance Society'
    },
    { name: 'Bea Sample', title: 'VP', company: 'JPM' }
  ]);
  return { jpm, ubs };
}

const rowFor = (window, company) =>
  [...window.document.querySelectorAll('#apps-tbody > tr:not(.contacts-row)')].find((tr) => tr.querySelector('.company-cell').textContent === company);

test('every row has a Contacts (n) control, disabled at 0', async () => {
  await seed();
  const window = loadUI(ctx.base);
  const jpmRow = await waitFor(() => rowFor(window, 'J.P. Morgan'));
  const jpmBtn = jpmRow.querySelector('.contacts-toggle');
  assert.equal(jpmBtn.textContent, 'Contacts (2)');
  assert.equal(jpmBtn.disabled, false);
  const ubsBtn = rowFor(window, 'UBS').querySelector('.contacts-toggle');
  assert.equal(ubsBtn.textContent, 'Contacts (0)');
  assert.equal(ubsBtn.disabled, true);
});

test('opening lists names with title, and a name expands every field', async () => {
  await seed();
  const window = loadUI(ctx.base);
  const { document } = window;
  const btn = await waitFor(() => rowFor(window, 'J.P. Morgan')?.querySelector('.contacts-toggle'));
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  btn.click();
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  const names = await waitFor(() => {
    const els = document.querySelectorAll('.contacts-row .contact-name');
    return els.length ? [...els] : null;
  });
  assert.deepEqual(names.map((n) => n.querySelector('.contact-name-text').textContent).sort(), ['Alex Example', 'Bea Sample']);
  const alex = names.find((n) => n.textContent.includes('Alex'));
  assert.equal(alex.querySelector('.contact-sub').textContent, 'Associate');

  alex.click();
  const detail = document.getElementById(alex.getAttribute('aria-controls'));
  assert.equal(detail.hidden, false);
  const text = detail.textContent;
  for (const v of ['Associate', 'JPMorgan', 'M&A', 'London', 'Old Wellingtonian', 'Wellington College', '2019', 'Finance Society', 'alex@example.com']) {
    assert.ok(text.includes(v), `detail shows ${v}`);
  }
  const linkedin = [...detail.querySelectorAll('a')].find((a) => a.textContent.startsWith('LinkedIn'));
  assert.equal(linkedin.href, 'https://www.linkedin.com/in/alex-example');
  assert.equal(linkedin.target, '_blank');
  assert.ok(![...detail.querySelectorAll('a')].some((a) => a.href.startsWith('javascript')), 'unsafe link not rendered');
  assert.equal(detail.querySelector('a[href^="mailto:"]').getAttribute('href'), 'mailto:alex@example.com');
  assert.equal(detail.querySelector('.contact-status').value, 'to-contact');

  btn.click();
  assert.equal(document.querySelector('.contacts-row').hidden, true);
});

test('editing status, last contacted and notes saves and toasts', async () => {
  await seed();
  const window = loadUI(ctx.base);
  const { document } = window;
  (await waitFor(() => rowFor(window, 'J.P. Morgan')?.querySelector('.contacts-toggle'))).click();
  const bea = await waitFor(() => [...document.querySelectorAll('.contact-name')].find((n) => n.textContent.includes('Bea')));
  bea.click();
  const detail = document.getElementById(bea.getAttribute('aria-controls'));

  const change = (el, value) => {
    el.value = value;
    el.dispatchEvent(new window.Event('change'));
  };
  change(detail.querySelector('.contact-status'), 'messaged');
  await waitFor(() => !document.getElementById('toast').hidden);
  assert.match(document.getElementById('toast-text').textContent, /Saved Bea Sample/);
  change(detail.querySelector('.contact-last'), '2026-10-20');
  change(detail.querySelector('.contact-notes'), 'Met at the alumni drinks');

  const saved = await waitFor(async () => {
    const b = (await ctx.api('GET', '/api/contacts')).body.find((c) => c.name === 'Bea Sample');
    return b.notes && b.lastContacted ? b : null;
  });
  assert.equal(saved.status, 'messaged');
  assert.equal(saved.lastContacted, '2026-10-20');
  assert.equal(saved.notes, 'Met at the alumni drinks');
});

test('a failed save is loud and puts the old value back', async () => {
  await seed();
  const window = loadUI(ctx.base);
  const { document } = window;
  (await waitFor(() => rowFor(window, 'J.P. Morgan')?.querySelector('.contacts-toggle'))).click();
  const bea = await waitFor(() => [...document.querySelectorAll('.contact-name')].find((n) => n.textContent.includes('Bea')));
  bea.click();
  const detail = document.getElementById(bea.getAttribute('aria-controls'));
  const id = bea.getAttribute('aria-controls').replace('contact-detail-', '');
  await ctx.api('DELETE', `/api/contacts/${id}`); // the next PUT now 404s

  const status = detail.querySelector('.contact-status');
  status.value = 'replied';
  status.dispatchEvent(new window.Event('change'));
  await waitFor(() => document.getElementById('toast').classList.contains('error'));
  assert.match(document.getElementById('toast-text').textContent, /Could not save Bea Sample/);
  assert.equal(status.value, 'to-contact');
});

test('keyboard: the toggle and names are real buttons wired with aria-controls', async () => {
  await seed();
  const window = loadUI(ctx.base);
  const btn = await waitFor(() => rowFor(window, 'J.P. Morgan')?.querySelector('.contacts-toggle'));
  assert.equal(btn.tagName, 'BUTTON');
  assert.ok(window.document.getElementById(btn.getAttribute('aria-controls')));
});
