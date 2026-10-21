// Import dialog on the Contacts tab (issue #8), through the real page in jsdom.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, loadUI, waitFor } = require('./helpers');

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { await ctx.stop(); });
beforeEach(() => ctx.reset());

const PASTE = 'First Name\tLast Name\tEmployer\tJob\n' +
  'Ann\tExample\tUBS\tAnalyst\n' +
  '\t\tHSBC\tVP\n' +
  'Bob\tSample\tLazard\tAssociate\n';

test('paste → map → preview → import, with created / merged / skipped counts', async () => {
  await ctx.api('POST', '/api/contacts', { name: 'Ann Example', company: 'UBS', notes: 'mine' });
  const window = loadUI(ctx.base, { hash: '#contacts' });
  const { document } = window;
  await waitFor(() => document.querySelector('#contacts-tbody tr'));

  document.getElementById('import-contacts-btn').click();
  assert.equal(document.getElementById('import-dialog').open, true);
  const paste = document.getElementById('import-paste');
  paste.value = PASTE;
  paste.dispatchEvent(new window.Event('input'));

  const selects = [...document.querySelectorAll('#import-mapping select')];
  assert.deepEqual(selects.map((s) => s.value), ['firstName', 'lastName', 'company', 'title']);
  assert.match(document.getElementById('import-summary').textContent, /2 contacts to import · 1 row without a name will be skipped \(row 2\)/);
  assert.equal(document.querySelectorAll('#import-table tbody tr').length, 2);

  // The user corrects a mapping: ignore the job column.
  selects[3].value = '';
  selects[3].dispatchEvent(new window.Event('change'));
  assert.ok(!document.getElementById('import-table').textContent.includes('Analyst'));

  const source = document.getElementById('import-source');
  source.value = 'Finance Society';
  source.dispatchEvent(new window.Event('input'));
  assert.ok(document.getElementById('import-table').textContent.includes('Finance Society'));

  document.getElementById('import-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await waitFor(() => /Imported/.test(document.getElementById('toast-text').textContent));
  assert.equal(document.getElementById('toast-text').textContent, 'Imported: 1 new, 1 merged with existing, 1 skipped (no name)');

  const all = (await ctx.api('GET', '/api/contacts')).body;
  assert.equal(all.length, 2);
  const ann = all.find((c) => c.name === 'Ann Example');
  assert.equal(ann.notes, 'mine');
  assert.equal(ann.sourceGroup, 'Finance Society');
  assert.equal(all.find((c) => c.name === 'Bob Sample').title, '');
});

test('nothing to import keeps the Import button disabled', async () => {
  const window = loadUI(ctx.base, { hash: '#contacts' });
  const { document } = window;
  document.getElementById('import-contacts-btn').click();
  const paste = document.getElementById('import-paste');
  paste.value = 'Company,Title\nUBS,VP';
  paste.dispatchEvent(new window.Event('input'));
  assert.equal(document.getElementById('import-submit').disabled, true);
  assert.match(document.getElementById('import-summary').textContent, /Set which column holds the name/);
  await window.settled();
});
