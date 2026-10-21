// Contacts tab (issue #7): table with search and filters, manual add/edit/delete, the
// Unassigned review list, delete-by-source with a confirm step, and the empty state.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, loadUI, waitFor } = require('./helpers');

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { await ctx.stop(); });
beforeEach(() => ctx.reset());

async function seed() {
  await ctx.api('POST', '/api/applications', { company: 'Goldman Sachs', role: 'IBD' });
  await ctx.api('POST', '/api/contacts/bulk', [
    { name: 'Ann Alpha', company: 'GS', sourceGroup: 'Old Wellingtonian', title: 'Analyst' },
    { name: 'Ben Beta', company: 'Goldman Sachs', sourceGroup: 'Finance Society' },
    { name: 'Cat Gamma', company: 'Lazard', sourceGroup: 'Old Wellingtonian' },
    { name: 'Dan Delta', company: 'Mystery Capital', sourceGroup: 'Finance Society' }
  ]);
  const all = (await ctx.api('GET', '/api/contacts')).body;
  await ctx.api('PUT', `/api/contacts/${all.find((c) => c.name === 'Cat Gamma').id}`, { status: 'replied' });
}

const names = (document) =>
  [...document.querySelectorAll('#contacts-tbody .contact-name-text')].map((el) => el.textContent);

async function openTab() {
  const window = loadUI(ctx.base, { hash: '#contacts' });
  await waitFor(() => window.document.querySelector('#contacts-tbody tr') || !window.document.getElementById('contacts-empty').hidden);
  return window;
}

const choose = (window, el, value) => {
  el.value = value;
  el.dispatchEvent(new window.Event(el.tagName === 'INPUT' ? 'input' : 'change'));
};

test('lists every contact; search by name and filter by company, source and status', async () => {
  await seed();
  const window = await openTab();
  const { document } = window;
  assert.deepEqual(names(document), ['Ann Alpha', 'Ben Beta', 'Cat Gamma', 'Dan Delta']);
  assert.equal(document.getElementById('contacts-count').textContent, '4');

  choose(window, document.getElementById('contact-search'), 'be');
  assert.deepEqual(names(document), ['Ben Beta']);
  choose(window, document.getElementById('contact-search'), '');

  // GS and Goldman Sachs are one firm, so one filter option.
  const company = document.getElementById('contact-filter-company');
  assert.equal([...company.options].filter((o) => o.value === 'goldmansachs').length, 1);
  choose(window, company, 'goldmansachs');
  assert.deepEqual(names(document), ['Ann Alpha', 'Ben Beta']);
  choose(window, document.getElementById('contact-filter-source'), 'Finance Society');
  assert.deepEqual(names(document), ['Ben Beta']);
  choose(window, company, '');
  choose(window, document.getElementById('contact-filter-source'), '');
  choose(window, document.getElementById('contact-filter-status'), 'replied');
  assert.deepEqual(names(document), ['Cat Gamma']);
});

test('add, edit and delete a contact by hand', async () => {
  const window = await openTab();
  const { document } = window;
  document.getElementById('add-contact-btn').click();
  const form = document.getElementById('contact-form');
  form.elements.name.value = 'Eve Epsilon';
  form.elements.company.value = 'UBS';
  form.elements.sourceGroup.value = 'LinkedIn';
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await waitFor(() => names(document).includes('Eve Epsilon'));

  document.querySelector('#contacts-tbody .row-edit').click();
  assert.equal(form.elements.company.value, 'UBS');
  form.elements.title.value = 'Associate';
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await waitFor(async () => (await ctx.api('GET', '/api/contacts')).body[0].title === 'Associate');
  assert.equal((await ctx.api('GET', '/api/contacts')).body.length, 1);

  await waitFor(() => document.querySelector('#contacts-tbody .row-delete'));
  document.querySelector('#contacts-tbody .row-delete').click();
  assert.deepEqual(names(document), []); // hidden at once, undo offered
  assert.match(document.getElementById('toast-text').textContent, /Deleted Eve Epsilon/);
  document.getElementById('toast-action').click(); // undo
  assert.deepEqual(names(document), ['Eve Epsilon']);
  assert.equal((await ctx.api('GET', '/api/contacts')).body.length, 1);
});

test('unassigned list: assigning remembers the alias', async () => {
  await seed();
  const window = await openTab();
  const { document } = window;
  const panel = document.getElementById('unassigned-panel');
  assert.equal(panel.hidden, false);
  const items = [...document.querySelectorAll('#unassigned-list li')];
  assert.equal(items.length, 1);
  assert.match(items[0].textContent, /Dan Delta/);
  assert.match(items[0].textContent, /Mystery Capital/);

  const form = items[0].querySelector('form');
  form.elements.company.value = 'Goldman Sachs';
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await waitFor(() => document.getElementById('unassigned-panel').hidden);
  const profile = (await ctx.api('GET', '/api/profile')).body;
  assert.deepEqual(profile.companyAliases, { 'Mystery Capital': 'Goldman Sachs' });
});

test('delete by source asks first, then removes only that group', async () => {
  await seed();
  const window = await openTab();
  const { document } = window;
  document.getElementById('delete-source-btn').click();
  const dialog = document.getElementById('delete-source-dialog');
  assert.equal(dialog.open, true);
  const select = document.getElementById('delete-source-select');
  choose(window, select, 'Old Wellingtonian');
  assert.equal(document.getElementById('confirm-delete-source').textContent, 'Delete 2 contacts');
  assert.equal((await ctx.api('GET', '/api/contacts')).body.length, 4); // nothing yet

  document.getElementById('delete-source-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await waitFor(() => names(document).length === 2);
  assert.deepEqual(names(document), ['Ben Beta', 'Dan Delta']);
  assert.equal((await ctx.api('GET', '/api/contacts')).body.length, 2);
});

test('empty state explains the ways to add contacts', async () => {
  const window = await openTab();
  const { document } = window;
  const empty = document.getElementById('contacts-empty');
  assert.equal(empty.hidden, false);
  const text = empty.textContent;
  for (const way of ['Add by hand', 'Import', 'Capture']) assert.ok(text.includes(way), way);
});
