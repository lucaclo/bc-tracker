const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PROFILE_PATH = path.join(DATA_DIR, 'profile.json');
const APPLICATIONS_PATH = path.join(DATA_DIR, 'applications.json');
const FLAG_LOG_PATH = path.join(DATA_DIR, 'flagLog.json');
const CV_DIR = path.join(DATA_DIR, 'cv');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS_PER_FILE = 20;

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CV_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!fs.existsSync(PROFILE_PATH)) {
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(defaultProfile(), null, 2));
  }
  if (!fs.existsSync(APPLICATIONS_PATH)) {
    fs.writeFileSync(APPLICATIONS_PATH, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(FLAG_LOG_PATH)) {
    fs.writeFileSync(FLAG_LOG_PATH, JSON.stringify({}, null, 2));
  }
}

function defaultProfile() {
  return {
    legalFirstName: '',
    legalMiddleName: '',
    legalLastName: '',
    preferredName: '',
    dateOfBirth: '',
    email: '',
    signupEmail: '',
    phoneCountryCode: '',
    phoneNumber: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    postcode: '',
    country: '',
    linkedinUrl: '',
    portfolioUrl: '',
    education: [],
    ukRightToWork: '',
    ukVisaType: '',
    hkRightToWork: '',
    hkVisaType: '',
    sponsorshipNeeded: '',
    availabilityStartDate: '',
    noticePeriod: '',
    howHeardAboutUs: '',
    cvFiles: [],
    coverLetterFiles: [],
    workExperience: [],
    skills: [],
    languages: []
  };
}

function readJson(filePath) {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Snapshots the file's CURRENT on-disk content (before it's overwritten) into
// data/backups/, keyed by name + timestamp, then prunes to the most recent
// MAX_BACKUPS_PER_FILE. ISO timestamps sort lexicographically, so "most recent" is just
// "last N alphabetically" — no need to parse dates back out.
function snapshotBeforeOverwrite(filePath) {
  if (!fs.existsSync(filePath)) return;
  const base = path.basename(filePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `${base}.${timestamp}.bak`);
  fs.copyFileSync(filePath, backupPath);

  const prefix = `${base}.`;
  const existing = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(prefix))
    .sort();
  const excess = existing.length - MAX_BACKUPS_PER_FILE;
  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(path.join(BACKUP_DIR, existing[i]));
  }
}

// Atomic write: write to a temp file in the same directory, then rename over the target
// (rename is an atomic replace on Darwin/POSIX) — a crash or kill mid-write can never
// leave the target file truncated or half-written. A snapshot of the pre-write content is
// kept in data/backups/ first, so even a bad write of genuinely wrong data is recoverable.
function writeJson(filePath, data) {
  ensureDataFiles();
  snapshotBeforeOverwrite(filePath);
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

// One-time migration: profiles saved before education became a repeatable list had
// flat university/degree/etc fields. Fold that into the first education entry instead
// of silently dropping real saved data.
function migrateLegacyEducation(raw) {
  // An empty array is truthy in JS — `if (raw.education)` alone would wrongly treat
  // "education: []" as "already migrated, nothing to do" and skip the legacy fields
  // below even when they hold real data that hasn't been folded in yet.
  if (Array.isArray(raw.education) && raw.education.length) return raw.education;
  if (raw.university || raw.degree) {
    return [
      {
        institution: raw.university || '',
        institutionType: 'University',
        degree: raw.degree || '',
        fieldOfStudy: raw.fieldOfStudy || '',
        gpaOrClassification: raw.gpaOrClassification || '',
        startMonth: '',
        startYear: '',
        graduationMonth: raw.graduationMonth || '',
        graduationYear: raw.graduationYear || ''
      }
    ];
  }
  return [];
}

function getProfile() {
  const raw = readJson(PROFILE_PATH);
  const merged = { ...defaultProfile(), ...raw };
  merged.education = migrateLegacyEducation(raw);
  delete merged.university;
  delete merged.degree;
  delete merged.fieldOfStudy;
  delete merged.gpaOrClassification;
  delete merged.graduationMonth;
  delete merged.graduationYear;
  return merged;
}

function saveProfile(profile) {
  const merged = { ...defaultProfile(), ...profile };
  writeJson(PROFILE_PATH, merged);
  return merged;
}

function getApplications() {
  return readJson(APPLICATIONS_PATH);
}

function saveApplications(applications) {
  writeJson(APPLICATIONS_PATH, applications);
  return applications;
}

// Flag log: which field labels the autofill engine had to flag for manual entry, and how
// often. Not tied to a specific application — this is aggregate signal across the whole
// application season for which FIELD_KEYWORDS/mappers are worth extending next. Keyed by
// normalized label text.
function normalizeFlagLabel(label) {
  return (label || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function getFlagLog() {
  return readJson(FLAG_LOG_PATH);
}

function recordFlags(flags) {
  const log = getFlagLog();
  const now = new Date().toISOString();
  for (const flag of flags || []) {
    const key = normalizeFlagLabel(flag && flag.label);
    if (!key) continue;
    const entry = log[key] || { label: (flag.label || '').trim(), count: 0, firstSeenAt: now, lastSeenAt: now, sampleUrls: [] };
    entry.count += 1;
    entry.lastSeenAt = now;
    if (flag.url && !entry.sampleUrls.includes(flag.url) && entry.sampleUrls.length < 5) {
      entry.sampleUrls.push(flag.url);
    }
    log[key] = entry;
  }
  writeJson(FLAG_LOG_PATH, log);
  return log;
}

module.exports = {
  DATA_DIR,
  PROFILE_PATH,
  APPLICATIONS_PATH,
  FLAG_LOG_PATH,
  CV_DIR,
  ensureDataFiles,
  defaultProfile,
  getProfile,
  saveProfile,
  getApplications,
  saveApplications,
  getFlagLog,
  recordFlags
};
