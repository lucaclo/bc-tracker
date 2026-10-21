// Contacts store + REST API (issue #3): CRUD, bulk captures, duplicate merging that never
// overwrites what the user wrote, delete-by-source, and backups before every write.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApp } = require('./helpers');

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { await ctx.stop(); });
beforeEach(() => ctx.reset());

const api = (...args) => ctx.api(...args);

test('contacts.json is created empty on first run', () => {
  const file = path.join(ctx.dataDir, 'contacts.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);
});

test('create, list, update and delete a contact', async () => {
  const created = await api('POST', '/api/contacts', { name: 'Jane Doe', company: 'Lazard', title: 'Analyst' });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'to-contact');
  assert.ok(created.body.id);
  assert.equal(created.body.companyKey, 'lazard');

  const list = await api('GET', '/api/contacts');
  assert.equal(list.body.length, 1);

  const updated = await api('PUT', `/api/contacts/${created.body.id}`, { status: 'messaged', notes: 'Sent intro' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.status, 'messaged');
  assert.equal(updated.body.notes, 'Sent intro');
  assert.equal(updated.body.title, 'Analyst');

  const bad = await api('PUT', `/api/contacts/${created.body.id}`, { status: 'bogus' });
  assert.equal(bad.body.status, 'messaged');

  assert.equal((await api('DELETE', `/api/contacts/${created.body.id}`)).status, 204);
  assert.equal((await api('GET', '/api/contacts')).body.length, 0);
  assert.equal((await api('DELETE', '/api/contacts/nope')).status, 404);
});

test('a contact without a name is rejected', async () => {
  assert.equal((await api('POST', '/api/contacts', { company: 'UBS' })).status, 400);
});

test('bulk import creates, merges and skips nameless rows', async () => {
  const res = await api('POST', '/api/contacts/bulk', [
    { name: 'A One', company: 'UBS' },
    { name: 'B Two', company: 'HSBC' },
    { company: 'No Name Ltd' },
    { name: 'a  one', company: 'ubs ' }
  ]);
  assert.deepEqual([res.body.created, res.body.merged, res.body.skipped], [2, 1, 1]);
  assert.equal((await api('GET', '/api/contacts')).body.length, 2);
  assert.equal((await api('POST', '/api/contacts/bulk', { nope: 1 })).status, 400);
});

test('merges on the same profileUrl even when the name differs', async () => {
  await api('POST', '/api/contacts/bulk', [{ name: 'Sam Smith', profileUrl: 'https://www.example.org/people/42/' }]);
  const res = await api('POST', '/api/contacts/bulk', [{ name: 'Samuel Smith', profileUrl: 'https://example.org/people/42?ref=x' }]);
  assert.equal(res.body.merged, 1);
  assert.equal((await api('GET', '/api/contacts')).body.length, 1);
});

test('merges on the same linkedinUrl', async () => {
  await api('POST', '/api/contacts/bulk', [{ name: 'Sam Smith', linkedinUrl: 'https://www.linkedin.com/in/sam-smith' }]);
  const res = await api('POST', '/api/contacts/bulk', [{ name: 'S. Smith', linkedinUrl: 'https://linkedin.com/in/sam-smith/' }]);
  assert.equal(res.body.merged, 1);
});

test('same name at a different company is a different person', async () => {
  await api('POST', '/api/contacts/bulk', [{ name: 'Sam Smith', company: 'UBS' }]);
  const res = await api('POST', '/api/contacts/bulk', [{ name: 'Sam Smith', company: 'HSBC' }]);
  assert.equal(res.body.created, 1);
});

test('merge keeps status, notes and last contacted; fills blanks; refreshes title and company', async () => {
  const first = await api('POST', '/api/contacts', {
    name: 'Jo Bloggs', company: 'Evercore', title: 'Analyst', linkedinUrl: 'https://linkedin.com/in/jo'
  });
  await api('PUT', `/api/contacts/${first.body.id}`, { status: 'replied', notes: 'Coffee on Fri', lastContacted: '2026-10-01' });

  await api('POST', '/api/contacts/bulk', [{
    name: 'Jo Bloggs', linkedinUrl: 'https://linkedin.com/in/jo', company: 'PJT Partners', title: 'Associate',
    location: 'London', status: 'to-contact', notes: 'captured note', lastContacted: '2020-01-01'
  }]);

  const [jo] = (await api('GET', '/api/contacts')).body;
  assert.equal(jo.status, 'replied');
  assert.equal(jo.notes, 'Coffee on Fri');
  assert.equal(jo.lastContacted, '2026-10-01');
  assert.equal(jo.location, 'London');
  assert.equal(jo.title, 'Associate');
  assert.equal(jo.company, 'PJT Partners');
  assert.equal(jo.companyKey, 'pjt partners');
});

test('delete by source group removes only that group', async () => {
  await api('POST', '/api/contacts/bulk', [
    { name: 'A', sourceGroup: 'Old Wellingtonian' },
    { name: 'B', sourceGroup: 'Old Wellingtonian' },
    { name: 'C', sourceGroup: 'Finance Society' }
  ]);
  const res = await api('DELETE', '/api/contacts?sourceGroup=Old%20Wellingtonian');
  assert.equal(res.body.deleted, 2);
  const left = (await api('GET', '/api/contacts')).body;
  assert.deepEqual(left.map((c) => c.name), ['C']);
  assert.equal((await api('DELETE', '/api/contacts')).status, 400);
});

test('every write snapshots contacts.json into backups first', async () => {
  const backups = () => fs.readdirSync(path.join(ctx.dataDir, 'backups')).filter((f) => f.startsWith('contacts.json.'));
  assert.equal(backups().length, 0);
  await api('POST', '/api/contacts', { name: 'X' });
  assert.equal(backups().length, 1);
  await api('POST', '/api/contacts', { name: 'Y' });
  assert.equal(backups().length, 2);
});
