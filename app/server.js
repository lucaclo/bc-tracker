const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const store = require('./lib/store');

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
  const saved = store.saveProfile(req.body || {});
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
  res.json(store.getApplications());
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
  applications[idx] = updated;
  store.saveApplications(applications);
  res.json(updated);
});

app.delete('/api/applications/:id', (req, res) => {
  const applications = store.getApplications().filter((a) => a.id !== req.params.id);
  store.saveApplications(applications);
  res.status(204).end();
});

const EXPORT_COLUMNS = [
  { header: 'Company', key: 'company', width: 24 },
  { header: 'Role / Program', key: 'role', width: 30 },
  { header: 'Industry', key: 'industry', width: 16 },
  { header: 'Region', key: 'region', width: 14 },
  { header: 'Group / Division', key: 'groupDivision', width: 18 },
  { header: 'Role Type', key: 'roleType', width: 12 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Date Applied', key: 'dateApplied', width: 14 },
  { header: 'Deadline', key: 'deadline', width: 14 },
  { header: 'Source', key: 'source', width: 14 },
  { header: 'Application Link', key: 'applicationLink', width: 40 },
  { header: 'CV Version Used', key: 'cvVersionUsed', width: 18 },
  { header: 'Notes', key: 'notes', width: 40 }
];

app.get('/api/applications/export.xlsx', async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Applications');
  sheet.columns = EXPORT_COLUMNS;
  sheet.getRow(1).font = { bold: true };
  for (const application of store.getApplications()) {
    sheet.addRow(application);
  }
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="bc-tracker-applications.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

app.get('/api/applications/export.csv', (req, res) => {
  const rows = store.getApplications();
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

app.listen(PORT, '127.0.0.1', () => {
  console.log(`B.C Tracker app running at http://localhost:${PORT}`);
});
