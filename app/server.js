const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const store = require('./lib/store');
const contactsLib = require('./lib/contacts');

const PORT = 5055;
const app = express();

app.use(express.json({ limit: '2mb' }));

// CORS: only allow the local extension (chrome-extension://<id>) and same-origin
// browser requests to this local app. This app never talks to any other server.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origin.startsWith('chrome-extension://')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

store.ensureDataFiles();

const upload = multer({ dest: store.CV_DIR, limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/cv', express.static(store.CV_DIR));

// ---- Profile ----

app.get('/api/profile', (req, res) => {
  res.json(store.getProfile());
});

app.put('/api/profile', (req, res) => {
  // Company aliases are only changed through /api/contacts/:id/assign. The profile form sends
  // the copy it loaded at page open, which may be older than an alias added since.
  const saved = store.saveProfile({ ...(req.body || {}), companyAliases: store.getProfile().companyAliases });
  res.json(saved);
});

app.post('/api/profile/cv', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const kind = req.body.kind === 'coverLetter' ? 'coverLetterFiles' : 'cvFiles';
  const name = (req.body.name || req.file.originalname || 'CV').trim();

  const ext = path.extname(req.file.originalname) || '';
  const finalFileName = req.file.filename + ext;
  const fs = require('fs');
  fs.renameSync(
    path.join(store.CV_DIR, req.file.filename),
    path.join(store.CV_DIR, finalFileName)
  );

  const profile = store.getProfile();
  const entry = {
    id: crypto.randomUUID(),
    name,
    fileName: finalFileName,
    originalName: req.file.originalname,
    uploadedAt: new Date().toISOString()
  };
  profile[kind] = [...(profile[kind] || []), entry];
  store.saveProfile(profile);
  res.json({ profile, entry });
});

app.delete('/api/profile/cv/:kind/:id', (req, res) => {
  const kind = req.params.kind === 'coverLetter' ? 'coverLetterFiles' : 'cvFiles';
  const profile = store.getProfile();
  const target = (profile[kind] || []).find((f) => f.id === req.params.id);
  if (target) {
    const fs = require('fs');
    const filePath = path.join(store.CV_DIR, target.fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  profile[kind] = (profile[kind] || []).filter((f) => f.id !== req.params.id);
  store.saveProfile(profile);
  res.json(profile);
});

// ---- Applications ----

const STATUSES = ['Bookmarked', 'Applying', 'Applied', 'Interviewing', 'Offer', 'Rejected'];

app.get('/api/applications', (req, res) => {
  const applications = store.getApplications();
  const links = contactsLib.linkIndex(applications, store.getContacts(), aliases());
  res.json(applications.map((a) => ({ ...a, contactCount: links.contactsFor(a).length })));
});

app.get('/api/applications/:id/contacts', (req, res) => {
  const applications = store.getApplications();
  const application = applications.find((a) => a.id === req.params.id);
  if (!application) return res.status(404).json({ error: 'Not found' });
  res.json(contactsLib.linkIndex(applications, store.getContacts(), aliases()).contactsFor(application));
});

app.post('/api/applications', (req, res) => {
  const body = req.body || {};
  const now = new Date().toISOString();
  const entry = {
    id: crypto.randomUUID(),
    company: body.company || '',
    role: body.role || '',
    industry: body.industry || '',
    region: body.region || '',
    groupDivision: body.groupDivision || '',
    roleType: body.roleType || '',
    source: body.source || 'Manual',
    applicationLink: body.applicationLink || '',
    dateApplied: body.dateApplied || now.slice(0, 10),
    deadline: body.deadline || '',
    status: STATUSES.includes(body.status) ? body.status : 'Applied',
    notes: body.notes || '',
    cvVersionUsed: body.cvVersionUsed || '',
    createdAt: now,
    updatedAt: now
  };
  const applications = store.getApplications();
  applications.unshift(entry);
  store.saveApplications(applications);
  res.status(201).json(entry);
});

app.put('/api/applications/:id', (req, res) => {
  const applications = store.getApplications();
  const idx = applications.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const updated = {
    ...applications[idx],
    ...req.body,
    id: applications[idx].id,
    updatedAt: new Date().toISOString()
  };
  delete updated.contactCount; // computed on read, never stored
  applications[idx] = updated;
  store.saveApplications(applications);
  res.json(updated);
});

app.delete('/api/applications/:id', (req, res) => {
  const applications = store.getApplications().filter((a) => a.id !== req.params.id);
  store.saveApplications(applications);
  res.status(204).end();
});

// ---- Contacts ----

const aliases = () => store.getProfile().companyAliases || {};
const keyOf = () => {
  const a = aliases();
  return (company) => contactsLib.companyKey(company, a);
};

app.get('/api/contacts', (req, res) => {
  res.json(store.getContacts());
});

app.post('/api/contacts', (req, res) => {
  const key = keyOf();
  const candidate = contactsLib.normaliseContact(req.body || {}, key);
  if (!candidate.name) return res.status(400).json({ error: 'A contact needs a name' });
  const result = contactsLib.upsertContacts(store.getContacts(), [candidate], key);
  store.saveContacts(result.contacts);
  const saved = result.contacts.find((c) => c.id === result.ids[0]);
  res.status(result.created ? 201 : 200).json(saved);
});

// A capture or import: an array of contacts, merged into the store in one write.
app.post('/api/contacts/bulk', (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : req.body?.contacts;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'Send an array of contacts' });
  const result = contactsLib.upsertContacts(store.getContacts(), rows, keyOf());
  if (result.created || result.merged) store.saveContacts(result.contacts);
  res.json({ created: result.created, merged: result.merged, skipped: result.skipped, ids: result.ids });
});

// Contacts at firms with no application yet that the matcher doesn't recognise either.
app.get('/api/contacts/unassigned', (req, res) => {
  res.json(contactsLib.linkIndex(store.getApplications(), store.getContacts(), aliases()).unassigned);
});

// The user says which firm an unrecognised company name really is. That raw name → firm alias
// is remembered, so everyone else captured under the same name links too.
app.post('/api/contacts/:id/assign', (req, res) => {
  const company = String(req.body?.company || '').trim();
  if (!company) return res.status(400).json({ error: 'Pass the company to assign to' });
  let contacts = store.getContacts();
  const contact = contacts.find((c) => c.id === req.params.id);
  if (!contact) return res.status(404).json({ error: 'Not found' });

  const profile = store.getProfile();
  if (contact.company && contactsLib.companyKey(contact.company) !== contactsLib.companyKey(company)) {
    profile.companyAliases = { ...(profile.companyAliases || {}), [contact.company]: company };
    store.saveProfile(profile);
  } else {
    // Nothing to remember for a blank company: just set this one contact's firm.
    contact.company = company;
  }
  contacts = contactsLib.rekeyAll(contacts, profile.companyAliases);
  store.saveContacts(contacts);
  res.json({ contact: contacts.find((c) => c.id === req.params.id), aliases: profile.companyAliases });
});

app.put('/api/contacts/:id', (req, res) => {
  const contacts = store.getContacts();
  const idx = contacts.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const updated = contactsLib.updateContact(contacts[idx], req.body || {}, keyOf());
  if (!updated.name) return res.status(400).json({ error: 'A contact needs a name' });
  contacts[idx] = updated;
  store.saveContacts(contacts);
  res.json(updated);
});

app.delete('/api/contacts/:id', (req, res) => {
  const contacts = store.getContacts();
  const remaining = contacts.filter((c) => c.id !== req.params.id);
  if (remaining.length === contacts.length) return res.status(404).json({ error: 'Not found' });
  store.saveContacts(remaining);
  res.status(204).end();
});

// Delete-by-source: everything captured from one group (e.g. a society list) in one go.
app.delete('/api/contacts', (req, res) => {
  const group = String(req.query.sourceGroup || '').trim();
  if (!group) return res.status(400).json({ error: 'Pass ?sourceGroup= to delete a group' });
  const contacts = store.getContacts();
  const remaining = contacts.filter((c) => c.sourceGroup !== group);
  if (remaining.length !== contacts.length) store.saveContacts(remaining);
  res.json({ deleted: contacts.length - remaining.length });
});

// Column order for both exports: what you scan for first (who, what, where it stands,
// when it's due) on the left; reference detail on the right.
const EXPORT_COLUMNS = [
  { header: 'Company', key: 'company', width: 22 },
  { header: 'Role / Program', key: 'role', width: 38, wrap: true },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Deadline', key: 'deadline', width: 13, date: true },
  { header: 'Date Applied', key: 'dateApplied', width: 13, date: true },
  { header: 'Industry', key: 'industry', width: 20 },
  { header: 'Region', key: 'region', width: 12 },
  { header: 'Group / Division', key: 'groupDivision', width: 20 },
  { header: 'Role Type', key: 'roleType', width: 13 },
  { header: 'Source', key: 'source', width: 12 },
  { header: 'CV Version Used', key: 'cvVersionUsed', width: 18 },
  { header: 'Application Link', key: 'applicationLink', width: 12, link: true },
  { header: 'Notes', key: 'notes', width: 48, wrap: true }
];

const STATUS_ORDER = ['Offer', 'Interviewing', 'Applied', 'Applying', 'Bookmarked', 'Rejected'];
// Same palette as the app's status pills (fill, text).
const STATUS_COLORS = {
  Bookmarked: ['FFE5E7EB', 'FF374151'],
  Applying: ['FFDBEAFE', 'FF1D4ED8'],
  Applied: ['FFDCFCE7', 'FF166534'],
  Interviewing: ['FFFEF3C7', 'FF92400E'],
  Offer: ['FFCCFBF1', 'FF115E59'],
  Rejected: ['FFFEE2E2', 'FF991B1B']
};
const BRAND = 'FF0F766E';
const STRIPE = 'FFEEF6F5'; // soft teal for alternate rows
// Every font names its face explicitly: ExcelJS doesn't inherit the default font into a
// style that only sets e.g. bold, and some viewers then fall back to Times.
const font = (opts = {}) => ({ name: 'Calibri', size: 11, ...opts });
const OPEN_STATUSES = new Set(['Bookmarked', 'Applying']);

function parseISODate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  // UTC midnight: Excel dates have no time zone, and ExcelJS writes Dates as UTC.
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

// Pipeline order (offers first, rejections last), then soonest deadline, then company.
function sortForExport(applications) {
  const rank = (s) => (STATUS_ORDER.includes(s) ? STATUS_ORDER.indexOf(s) : STATUS_ORDER.length);
  return applications.slice().sort((a, b) =>
    rank(a.status) - rank(b.status) ||
    (a.deadline || '9999').localeCompare(b.deadline || '9999') ||
    (a.company || '').localeCompare(b.company || '')
  );
}

function buildApplicationsSheet(workbook, applications) {
  const sheet = workbook.addWorksheet('Applications', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:1',
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
    }
  });
  EXPORT_COLUMNS.forEach((c, i) => (sheet.getColumn(i + 1).width = c.width));

  const rows = applications.map((a) =>
    EXPORT_COLUMNS.map((c) => {
      const value = a[c.key] || '';
      if (c.date) return parseISODate(value) || value || null;
      if (c.link) return value ? { text: 'Open link', hyperlink: value, tooltip: value } : null;
      return value || null;
    })
  );

  // A real Excel table (filter button on every header, grows as rows are added). Its own
  // banding is off: Excel's built-in stripes are heavy grey or theme orange, and they
  // don't skip rows hidden by a filter. The stripes come from conditional formatting below.
  sheet.addTable({
    name: 'Applications',
    ref: 'A1',
    headerRow: true,
    style: { theme: 'TableStyleLight1', showRowStripes: false },
    columns: EXPORT_COLUMNS.map((c) => ({ name: c.header, filterButton: true })),
    rows: rows.length ? rows : [EXPORT_COLUMNS.map(() => null)]
  });

  const header = sheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  // Alternate-row stripes that follow the VISIBLE rows: SUBTOTAL(103, …) counts only
  // unfiltered rows, so stripes stay alternating after sorting and filtering. Applied
  // around the Status column, whose own colour would otherwise be painted over.
  const lastRow = Math.max(applications.length + 1, 2) + 500; // room for rows added in Excel
  const statusCol = EXPORT_COLUMNS.findIndex((c) => c.key === 'status') + 1;
  const letter = (n) => String.fromCharCode(64 + n);
  const stripeRule = {
    type: 'expression',
    formulae: ['MOD(SUBTOTAL(103,$A$2:$A2),2)=0'],
    style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: STRIPE } } }
  };
  sheet.addConditionalFormatting({ ref: `A2:${letter(statusCol - 1)}${lastRow}`, rules: [stripeRule] });
  sheet.addConditionalFormatting({ ref: `${letter(statusCol + 1)}2:${letter(EXPORT_COLUMNS.length)}${lastRow}`, rules: [stripeRule] });

  const today = new Date();
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  applications.forEach((a, i) => {
    const row = sheet.getRow(i + 2);
    EXPORT_COLUMNS.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      cell.font = font({ color: { argb: 'FF1E2433' } });
      cell.alignment = { vertical: 'top', wrapText: !!c.wrap };
      if (c.date) cell.numFmt = 'd mmm yyyy';
      if (c.link && cell.value) cell.font = font({ color: { argb: BRAND }, underline: true });
    });
    row.getCell(1).font = font({ bold: true });

    const colors = STATUS_COLORS[a.status];
    if (colors) {
      const statusCell = row.getCell(EXPORT_COLUMNS.findIndex((c) => c.key === 'status') + 1);
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors[0] } };
      statusCell.font = font({ bold: true, color: { argb: colors[1] } });
      statusCell.alignment = { vertical: 'top', horizontal: 'center' };
    }

    // Deadlines still to act on: red within 3 days, amber within 14, grey once passed.
    const due = parseISODate(a.deadline);
    if (due && OPEN_STATUSES.has(a.status)) {
      const days = Math.round((due - todayUTC) / 86400000);
      const color = days < 0 ? 'FF6B7280' : days <= 3 ? 'FFB91C1C' : days <= 14 ? 'FFB45309' : null;
      if (color) row.getCell(EXPORT_COLUMNS.findIndex((c) => c.key === 'deadline') + 1).font = font({ bold: days >= 0, color: { argb: color } });
    }
  });
  return sheet;
}

// Live counts (COUNTIF formulas over the Applications sheet, so they update if you edit
// statuses in Excel) by status and by industry.
function buildSummarySheet(workbook, applications) {
  const sheet = workbook.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  sheet.getColumn(1).width = 26;
  sheet.getColumn(2).width = 10;
  sheet.getColumn(4).width = 26;
  sheet.getColumn(5).width = 10;

  const title = sheet.getCell('A1');
  title.value = 'B.C Tracker — applications summary';
  title.font = font({ bold: true, size: 14, color: { argb: BRAND } });
  sheet.getCell('A2').value = `Exported ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${applications.length} applications`;
  sheet.getCell('A2').font = font({ color: { argb: 'FF5B6472' } });

  const col = (key) => String.fromCharCode(65 + EXPORT_COLUMNS.findIndex((c) => c.key === key));

  const block = (startCol, heading, key, labels) => {
    const [labelCol, countCol] = startCol === 'A' ? ['A', 'B'] : ['D', 'E'];
    const head = [sheet.getCell(`${labelCol}4`), sheet.getCell(`${countCol}4`)];
    head[0].value = heading;
    head[1].value = 'Count';
    for (const cell of head) {
      cell.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    }
    labels.forEach((label, i) => {
      const r = 5 + i;
      // Whole column, so rows added later in Excel are counted too (the header never matches).
      const range = `Applications!$${col(key)}:$${col(key)}`;
      sheet.getCell(`${labelCol}${r}`).value = label;
      sheet.getCell(`${labelCol}${r}`).font = font();
      sheet.getCell(`${countCol}${r}`).font = font();
      sheet.getCell(`${countCol}${r}`).value = {
        formula: `COUNTIF(${range},"${label.replace(/"/g, '""')}")`,
        result: applications.filter((a) => (a[key] || '') === label).length
      };
      if (i % 2) {
        for (const c of [labelCol, countCol]) {
          sheet.getCell(`${c}${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE } };
        }
      }
      if (key === 'status' && STATUS_COLORS[label]) {
        sheet.getCell(`${labelCol}${r}`).font = font({ bold: true, color: { argb: STATUS_COLORS[label][1] } });
      }
    });
  };

  block('A', 'Status', 'status', STATUS_ORDER);
  const industries = [...new Set(applications.map((a) => a.industry).filter(Boolean))].sort();
  if (industries.length) block('D', 'Industry', 'industry', industries);
  return sheet;
}

const CONTACT_STATUS_LABELS = {
  'to-contact': 'To contact',
  messaged: 'Messaged',
  replied: 'Replied',
  'call-done': 'Call done',
  'not-relevant': 'Not relevant'
};

const CONTACT_EXPORT_COLUMNS = [
  { header: 'Name', key: 'name', width: 24 },
  { header: 'Title', key: 'title', width: 28, wrap: true },
  { header: 'Company', key: 'company', width: 22 },
  { header: 'Linked application', key: 'linkedApplication', width: 22 },
  { header: 'Status', key: 'statusLabel', width: 13 },
  { header: 'Last Contacted', key: 'lastContacted', width: 14, date: true },
  { header: 'Team', key: 'team', width: 16 },
  { header: 'Location', key: 'location', width: 16 },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'LinkedIn', key: 'linkedinUrl', width: 12, link: true },
  { header: 'Profile', key: 'profileUrl', width: 12, link: true },
  { header: 'Source Group', key: 'sourceGroup', width: 20 },
  { header: 'Source Site', key: 'sourceSite', width: 18 },
  { header: 'School', key: 'school', width: 20 },
  { header: 'Grad Year', key: 'gradYear', width: 10 },
  { header: 'Society', key: 'society', width: 18 },
  { header: 'Notes', key: 'notes', width: 40, wrap: true }
];

// Contacts ready to export: sorted by company then name, with the application each links to.
function contactsForExport() {
  const applications = store.getApplications();
  const links = contactsLib.linkIndex(applications, store.getContacts(), aliases());
  const linked = new Map();
  for (const a of applications) for (const c of links.contactsFor(a)) if (!linked.has(c.id)) linked.set(c.id, a.company);
  return store.getContacts()
    .map((c) => ({ ...c, linkedApplication: linked.get(c.id) || '', statusLabel: CONTACT_STATUS_LABELS[c.status] || c.status || '' }))
    .sort((a, b) => (a.company || '~').localeCompare(b.company || '~') || (a.name || '').localeCompare(b.name || ''));
}

// Same look as the Applications sheet: brand header, filterable table, visible-row stripes.
function buildContactsSheet(workbook, contacts) {
  const sheet = workbook.addWorksheet('Contacts', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' }
  });
  CONTACT_EXPORT_COLUMNS.forEach((c, i) => (sheet.getColumn(i + 1).width = c.width));
  const safeLink = (v) => (/^https?:\/\//i.test(v) ? v : '');
  const rows = contacts.map((c) =>
    CONTACT_EXPORT_COLUMNS.map((col) => {
      const value = c[col.key] || '';
      if (col.date) return parseISODate(value) || value || null;
      if (col.link) return safeLink(value) ? { text: 'Open link', hyperlink: value, tooltip: value } : value || null;
      return value || null;
    })
  );
  sheet.addTable({
    name: 'Contacts',
    ref: 'A1',
    headerRow: true,
    style: { theme: 'TableStyleLight1', showRowStripes: false },
    columns: CONTACT_EXPORT_COLUMNS.map((c) => ({ name: c.header, filterButton: true })),
    rows: rows.length ? rows : [CONTACT_EXPORT_COLUMNS.map(() => null)]
  });

  const header = sheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
  const lastRow = Math.max(contacts.length + 1, 2) + 500;
  const lastCol = String.fromCharCode(64 + CONTACT_EXPORT_COLUMNS.length);
  sheet.addConditionalFormatting({
    ref: `A2:${lastCol}${lastRow}`,
    rules: [{
      type: 'expression',
      formulae: ['MOD(SUBTOTAL(103,$A$2:$A2),2)=0'],
      style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: STRIPE } } }
    }]
  });
  contacts.forEach((c, i) => {
    const row = sheet.getRow(i + 2);
    CONTACT_EXPORT_COLUMNS.forEach((col, j) => {
      const cell = row.getCell(j + 1);
      cell.font = font({ color: { argb: 'FF1E2433' } });
      cell.alignment = { vertical: 'top', wrapText: !!col.wrap };
      if (col.date) cell.numFmt = 'd mmm yyyy';
      if (col.link && cell.value && cell.value.hyperlink) cell.font = font({ color: { argb: BRAND }, underline: true });
    });
    row.getCell(1).font = font({ bold: true });
  });
  return sheet;
}

app.get('/api/contacts/export.csv', (req, res) => {
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [CONTACT_EXPORT_COLUMNS.map((c) => escape(c.header)).join(',')];
  for (const row of contactsForExport()) lines.push(CONTACT_EXPORT_COLUMNS.map((c) => escape(row[c.key])).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bc-tracker-contacts.csv"');
  res.send(lines.join('\n'));
});

app.get('/api/applications/export.xlsx', async (req, res) => {
  const applications = sortForExport(store.getApplications());
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'B.C Tracker';
  workbook.created = new Date();
  buildApplicationsSheet(workbook, applications);
  buildSummarySheet(workbook, applications);
  buildContactsSheet(workbook, contactsForExport());

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="bc-tracker-applications.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

app.get('/api/applications/export.csv', (req, res) => {
  const rows = sortForExport(store.getApplications());
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [EXPORT_COLUMNS.map((c) => escape(c.header)).join(',')];
  for (const row of rows) {
    lines.push(EXPORT_COLUMNS.map((c) => escape(row[c.key])).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bc-tracker-applications.csv"');
  res.send(lines.join('\n'));
});

// ---- Flag log (which fields the autofill engine had to flag, and how often) ----

app.post('/api/flags', (req, res) => {
  const flags = Array.isArray(req.body?.flags) ? req.body.flags : [];
  const log = store.recordFlags(flags);
  res.status(201).json(log);
});

app.get('/api/flags', (req, res) => {
  const log = store.getFlagLog();
  const rows = Object.values(log).sort((a, b) => b.count - a.count);
  res.json(rows);
});

module.exports = app;

// Tests require() the app and listen on a spare port themselves.
if (require.main === module) {
  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`B.C Tracker app running at http://localhost:${PORT}`);
  });

  // With autostart installed (npm run autostart:install) the app is normally already
  // running in the background, so a manual `npm start` just finds the port taken. That's
  // not an error worth a stack trace.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`B.C Tracker app is already running at http://localhost:${PORT} — nothing to do.`);
      process.exit(0);
    }
    throw err;
  });
}
