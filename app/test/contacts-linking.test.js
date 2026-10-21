// Linking contacts to applications by company (issue #5): computed at read time, alias-aware,
// unrecognised firms go to an Unassigned list, and assigning one remembers the alias.
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
const addApp = async (company) => (await api('POST', '/api/applications', { company, role: 'Summer Analyst' })).body;

test('an application lists contacts at the same firm, by alias', async () => {
  const jpm = await addApp('J.P. Morgan');
  await addApp('Lazard');
  await api('POST', '/api/contacts/bulk', [
    { name: 'A', company: 'JPMorgan Chase & Co.' },
    { name: 'B', company: 'JPM' },
    { name: 'C', company: 'Lazard Frères' }
  ]);
  const res = await api('GET', `/api/applications/${jpm.id}/contacts`);
  assert.deepEqual(res.body.map((c) => c.name).sort(), ['A', 'B']);
  assert.equal((await api('GET', '/api/applications/nope/contacts')).status, 404);
});

test('GET /api/applications includes contactCount', async () => {
  await addApp('Goldman Sachs');
  await addApp('Blackstone');
  await api('POST', '/api/contacts/bulk', [{ name: 'A', company: 'GS' }, { name: 'B', company: 'Goldman Sachs International' }]);
  const list = (await api('GET', '/api/applications')).body;
  const count = Object.fromEntries(list.map((a) => [a.company, a.contactCount]));
  assert.deepEqual(count, { 'Goldman Sachs': 2, Blackstone: 0 });
});

test('contactCount is never written back into applications.json', async () => {
  const a = await addApp('UBS');
  await api('PUT', `/api/applications/${a.id}`, { status: 'Offer', contactCount: 9 });
  const stored = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'applications.json'), 'utf8'));
  assert.equal(stored[0].contactCount, undefined);
});

test('unassigned = no application and no known alias', async () => {
  await addApp('Brown Advisory');
  await api('POST', '/api/contacts/bulk', [
    { name: 'Linked', company: 'Brown Advisory Ltd' },
    { name: 'Known firm, no application', company: 'Morgan Stanley' },
    { name: 'Unknown', company: 'Acme Capital' },
    { name: 'No company' }
  ]);
  const names = (await api('GET', '/api/contacts/unassigned')).body.map((c) => c.name).sort();
  assert.deepEqual(names, ['No company', 'Unknown']);
});

test('assigning saves the alias and re-keys every contact with that raw name', async () => {
  const app = await addApp('Goldman Sachs');
  await api('POST', '/api/contacts/bulk', [
    { name: 'One', company: 'GSAM London' },
    { name: 'Two', company: 'gsam london' },
    { name: 'Three', company: 'Other Co' }
  ]);
  const one = (await api('GET', '/api/contacts')).body.find((c) => c.name === 'One');
  const res = await api('POST', `/api/contacts/${one.id}/assign`, { company: 'Goldman Sachs' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.aliases, { 'GSAM London': 'Goldman Sachs' });

  const profile = (await api('GET', '/api/profile')).body;
  assert.deepEqual(profile.companyAliases, { 'GSAM London': 'Goldman Sachs' });
  const linked = (await api('GET', `/api/applications/${app.id}/contacts`)).body.map((c) => c.name).sort();
  assert.deepEqual(linked, ['One', 'Two']);
  const stored = (await api('GET', '/api/contacts')).body;
  assert.equal(stored.find((c) => c.name === 'Two').companyKey, 'goldmansachs');
  assert.deepEqual((await api('GET', '/api/contacts/unassigned')).body.map((c) => c.name), ['Three']);

  // New captures under the same raw name link straight away.
  await api('POST', '/api/contacts/bulk', [{ name: 'Four', company: 'GSAM London' }]);
  assert.equal((await api('GET', `/api/applications/${app.id}/contacts`)).body.length, 3);
});

test('assigning a contact with no company sets just that contact', async () => {
  const c = (await api('POST', '/api/contacts', { name: 'Blank' })).body;
  const res = await api('POST', `/api/contacts/${c.id}/assign`, { company: 'HSBC' });
  assert.equal(res.body.contact.company, 'HSBC');
  assert.deepEqual(res.body.aliases, {});
  assert.equal((await api('POST', `/api/contacts/${c.id}/assign`, {})).status, 400);
});

test('contacts saved before the application link once it exists', async () => {
  await api('POST', '/api/contacts/bulk', [{ name: 'Early', company: 'Evercore' }]);
  assert.equal((await api('GET', '/api/contacts/unassigned')).body.length, 0); // known firm
  const app = await addApp('Evercore Partners');
  assert.deepEqual((await api('GET', `/api/applications/${app.id}/contacts`)).body.map((c) => c.name), ['Early']);
});

test('an old profile without companyAliases works, and saving the profile keeps aliases', async () => {
  fs.writeFileSync(path.join(ctx.dataDir, 'profile.json'), JSON.stringify({ legalFirstName: 'Old' }));
  assert.deepEqual((await api('GET', '/api/profile')).body.companyAliases, {});

  const c = (await api('POST', '/api/contacts', { name: 'X', company: 'Weird Name' })).body;
  await api('POST', `/api/contacts/${c.id}/assign`, { company: 'Barclays' });
  // The profile form sends the copy it loaded earlier, without the new alias.
  await api('PUT', '/api/profile', { legalFirstName: 'Old', companyAliases: {} });
  assert.deepEqual((await api('GET', '/api/profile')).body.companyAliases, { 'Weird Name': 'Barclays' });
});
