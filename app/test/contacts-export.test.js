// Contacts export (issue #13): a formatted Contacts sheet in the XLSX, and a contacts CSV.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { startApp } = require('./helpers');

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { await ctx.stop(); });
beforeEach(() => ctx.reset());

const HEADERS = ['Name', 'Title', 'Company', 'Linked application', 'Status', 'Last Contacted', 'Team', 'Location',
  'Email', 'LinkedIn', 'Profile', 'Source Group', 'Source Site', 'School', 'Grad Year', 'Society', 'Notes'];

async function seed() {
  await ctx.api('POST', '/api/applications', { company: 'J.P. Morgan', role: 'IBD' });
  const c = (await ctx.api('POST', '/api/contacts', {
    name: 'Ann Example', title: 'Analyst', company: 'JPMorgan', email: 'ann@example.com',
    linkedinUrl: 'https://www.linkedin.com/in/ann', sourceGroup: 'Old Wellingtonian', notes: 'Said "call me"'
  })).body;
  await ctx.api('PUT', `/api/contacts/${c.id}`, { status: 'replied', lastContacted: '2026-10-01' });
}

test('XLSX export has a formatted Contacts sheet', async () => {
  await seed();
  const res = await fetch(`${ctx.base}/api/applications/export.xlsx`);
  assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual(wb.worksheets.map((s) => s.name), ['Applications', 'Summary', 'Contacts']);

  const sheet = wb.getWorksheet('Contacts');
  assert.deepEqual(sheet.getRow(1).values.slice(1), HEADERS);
  assert.equal(sheet.getRow(1).getCell(1).font.bold, true);
  const row = sheet.getRow(2);
  const cell = (h) => row.getCell(HEADERS.indexOf(h) + 1).value;
  assert.equal(cell('Name'), 'Ann Example');
  assert.equal(cell('Linked application'), 'J.P. Morgan');
  assert.equal(cell('Status'), 'Replied');
  assert.equal(cell('LinkedIn').hyperlink, 'https://www.linkedin.com/in/ann');
  assert.ok(cell('Last Contacted') instanceof Date);
  assert.equal(sheet.views[0].ySplit, 1);
});

test('contacts CSV download: headers and one row', async () => {
  await seed();
  const res = await fetch(`${ctx.base}/api/contacts/export.csv`);
  assert.match(res.headers.get('content-disposition'), /bc-tracker-contacts\.csv/);
  const [head, line, ...rest] = (await res.text()).split('\n');
  assert.equal(head, HEADERS.map((h) => `"${h}"`).join(','));
  assert.equal(rest.length, 0);
  assert.ok(line.startsWith('"Ann Example","Analyst","JPMorgan","J.P. Morgan","Replied","2026-10-01"'));
  assert.ok(line.includes('"Said ""call me"""'));
});

test('an empty contacts list still exports', async () => {
  const res = await fetch(`${ctx.base}/api/applications/export.xlsx`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  assert.ok(wb.getWorksheet('Contacts'));
  assert.equal((await (await fetch(`${ctx.base}/api/contacts/export.csv`)).text()).split('\n').length, 1);
});
