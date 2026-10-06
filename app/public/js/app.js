const STATUSES = ['Bookmarked', 'Applying', 'Applied', 'Interviewing', 'Offer', 'Rejected'];
// Statuses where an approaching deadline still matters.
const OPEN_STATUSES = new Set(['Bookmarked', 'Applying']);

// ---- Tabs ----
// The active tab lives in the URL hash so a reload (or the extension's "Open tracker"
// link with #profile etc.) lands on the same section.
const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));

function selectTab(name, { focus = false } = {}) {
  const btn = tabButtons.find((b) => b.dataset.tab === name) || tabButtons[0];
  for (const b of tabButtons) {
    const on = b === btn;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    document.getElementById(`tab-${b.dataset.tab}`).classList.toggle('active', on);
  }
  if (focus) btn.focus();
  if (location.hash.slice(1) !== btn.dataset.tab) history.replaceState(null, '', `#${btn.dataset.tab}`);
  if (btn.dataset.tab === 'insights') loadInsights();
}

tabButtons.forEach((btn, i) => {
  btn.addEventListener('click', () => selectTab(btn.dataset.tab));
  btn.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    selectTab(tabButtons[(i + step + tabButtons.length) % tabButtons.length].dataset.tab, { focus: true });
  });
});
window.addEventListener('hashchange', () => selectTab(location.hash.slice(1)));

// ---- Toast ----
// In-page feedback instead of alert(): errors and the undo offer for deletes.
const toastEl = document.getElementById('toast');
const toastText = document.getElementById('toast-text');
const toastAction = document.getElementById('toast-action');
let toastTimer = null;

function showToast(message, { actionLabel, onAction, error = false, duration = 5000 } = {}) {
  clearTimeout(toastTimer);
  toastText.textContent = message;
  toastEl.classList.toggle('error', error);
  toastAction.hidden = !actionLabel;
  toastAction.textContent = actionLabel || '';
  toastAction.onclick = () => {
    hideToast();
    onAction?.();
  };
  toastEl.hidden = false;
  toastTimer = setTimeout(hideToast, duration);
}
function hideToast() {
  clearTimeout(toastTimer);
  toastEl.hidden = true;
}

// ---- Dates ----
function parseISODate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function formatDate(value) {
  const d = parseISODate(value);
  if (!d) return escapeHtml(value);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function daysUntil(value) {
  const d = parseISODate(value);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

// ---- Applications ----
let applications = [];
let sortKey = 'dateApplied';
let sortDir = -1;

const tbody = document.getElementById('apps-tbody');
const emptyState = document.getElementById('apps-empty');
const searchInput = document.getElementById('app-search');
const pipelineEl = document.getElementById('pipeline');
const emptyText = document.getElementById('apps-empty-text');
const emptyAction = document.getElementById('apps-empty-action');
let statusVal = '';
// Rows deleted but still inside their undo window: hidden here, not yet sent to the server.
const pendingDeletes = new Map();

async function loadApplications() {
  try {
    const res = await fetch('/api/applications');
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    applications = await res.json();
  } catch (err) {
    console.error('[BC] could not load applications', err);
    showToast('Could not load applications. Is the app (npm start) running?', { error: true, duration: 10000 });
  }
  renderApplications();
}

function visibleApplications() {
  return applications.filter((a) => !pendingDeletes.has(a.id));
}

function renderPipeline() {
  const all = visibleApplications();
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const a of all) if (a.status in counts) counts[a.status] += 1;

  document.getElementById('apps-count').textContent = all.length || '';

  const stages = [['', 'All', all.length], ...STATUSES.map((s) => [s, s, counts[s]])];
  pipelineEl.innerHTML = stages
    .map(([value, label, n]) => `
      <button type="button" class="stage" data-status="${value}" aria-pressed="${statusVal === value}">
        <span class="stage-count">${n}</span>
        <span class="stage-label">${value ? `<span class="stage-dot status-${value}"></span>` : ''}${label}</span>
      </button>`)
    .join('');
}

pipelineEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.stage');
  if (!btn) return;
  // Clicking the active stage again clears the filter.
  statusVal = statusVal === btn.dataset.status ? '' : btn.dataset.status;
  renderApplications();
});

function deadlineHtml(app) {
  if (!app.deadline) return '<span class="muted">—</span>';
  const date = formatDate(app.deadline);
  const days = daysUntil(app.deadline);
  if (days === null || !OPEN_STATUSES.has(app.status)) return date;
  let note = '';
  let cls = '';
  if (days < 0) { note = 'Passed'; cls = 'due-past'; }
  else if (days === 0) { note = 'Due today'; cls = 'due-urgent'; }
  else if (days <= 3) { note = `${days} day${days === 1 ? '' : 's'} left`; cls = 'due-urgent'; }
  else if (days <= 14) { note = `${days} days left`; cls = 'due-soon'; }
  return note ? `${date}<span class="due ${cls}">${note}</span>` : date;
}

function renderApplications() {
  renderPipeline();
  const term = searchInput.value.trim().toLowerCase();

  let rows = visibleApplications().filter((a) => {
    if (statusVal && a.status !== statusVal) return false;
    if (!term) return true;
    return [a.company, a.role, a.notes, a.industry, a.region]
      .join(' ')
      .toLowerCase()
      .includes(term);
  });

  rows = rows.slice().sort((a, b) => {
    const av = (a[sortKey] || '').toString();
    const bv = (b[sortKey] || '').toString();
    return av.localeCompare(bv) * sortDir;
  });

  document.querySelectorAll('#apps-table th[data-sort]').forEach((th) => {
    if (th.dataset.sort === sortKey) th.setAttribute('aria-sort', sortDir === 1 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });

  tbody.innerHTML = '';
  emptyState.hidden = rows.length > 0;
  if (!rows.length) {
    const filtered = term || statusVal;
    emptyText.textContent = filtered
      ? 'No applications match this search or filter.'
      : 'No applications yet. Log one from the extension side panel, or add one here.';
    emptyAction.textContent = filtered ? 'Clear filters' : 'Add application';
    emptyAction.onclick = filtered
      ? () => {
          searchInput.value = '';
          statusVal = '';
          renderApplications();
        }
      : openAddDialog;
  }

  for (const app of rows) {
    const tr = document.createElement('tr');

    const linkHtml = app.applicationLink
      ? `<a href="${escapeAttr(app.applicationLink)}" target="_blank" rel="noopener" aria-label="Open ${escapeAttr(app.company)} application in a new tab">Open ↗</a>`
      : '';
    const label = `${app.company} – ${app.role}`;

    tr.innerHTML = `
      <td class="company-cell">${escapeHtml(app.company)}</td>
      <td class="role-cell">${escapeHtml(app.role)}</td>
      <td>${escapeHtml(app.region)}</td>
      <td>${escapeHtml(app.industry)}</td>
      <td></td>
      <td class="date-cell">${app.dateApplied ? formatDate(app.dateApplied) : '<span class="muted">—</span>'}</td>
      <td class="date-cell">${deadlineHtml(app)}</td>
      <td>${escapeHtml(app.source)}</td>
      <td class="link-cell">${linkHtml}</td>
      <td class="notes-cell" title="${escapeAttr(app.notes)}"><span class="notes-clamp">${escapeHtml(app.notes)}</span></td>
      <td class="actions-col">
        <div class="row-actions">
          <button type="button" class="btn-link row-edit" aria-label="Edit ${escapeAttr(label)}">Edit</button>
          <button type="button" class="btn-link danger row-delete" aria-label="Delete ${escapeAttr(label)}">Delete</button>
        </div>
      </td>
    `;

    const statusCell = tr.children[4];
    const select = document.createElement('select');
    select.className = `status-pill status-${app.status}`;
    select.setAttribute('aria-label', `Status for ${label}`);
    for (const s of STATUSES) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      if (s === app.status) opt.selected = true;
      select.appendChild(opt);
    }
    select.dataset.saved = app.status;
    select.addEventListener('change', async () => {
      try {
        await updateApplication(app.id, { status: select.value });
        renderApplications();
      } catch (err) {
        console.error('[BC] status update failed', err);
        select.value = select.dataset.saved;
        showToast('Could not save the status change. Is the app still running?', { error: true });
      }
    });
    statusCell.appendChild(select);

    tr.querySelector('.row-delete').addEventListener('click', () => deleteApplication(app));
    tr.querySelector('.row-edit').addEventListener('click', () => openEditDialog(app));

    tbody.appendChild(tr);
  }
}

async function updateApplication(id, patch) {
  const res = await fetch(`/api/applications/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  const updated = await res.json();
  applications = applications.map((a) => (a.id === id ? updated : a));
}

// Delete hides the row at once and offers Undo; the server DELETE only goes out when the
// undo window closes (or the page is closed), so Undo never has to recreate a record.
const UNDO_MS = 6000;

function deleteApplication(app) {
  const timer = setTimeout(() => commitDelete(app.id), UNDO_MS);
  pendingDeletes.set(app.id, timer);
  renderApplications();
  showToast(`Deleted ${app.company}`, {
    actionLabel: 'Undo',
    duration: UNDO_MS,
    onAction: () => {
      clearTimeout(pendingDeletes.get(app.id));
      pendingDeletes.delete(app.id);
      renderApplications();
    }
  });
}

async function commitDelete(id, { keepalive = false } = {}) {
  try {
    const res = await fetch(`/api/applications/${id}`, { method: 'DELETE', keepalive });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    applications = applications.filter((a) => a.id !== id);
  } catch (err) {
    console.error('[BC] delete failed', err);
    if (!keepalive) showToast('Could not delete. Is the app still running?', { error: true });
  } finally {
    pendingDeletes.delete(id);
    if (!keepalive) renderApplications();
  }
}

window.addEventListener('pagehide', () => {
  for (const [id, timer] of pendingDeletes) {
    clearTimeout(timer);
    commitDelete(id, { keepalive: true });
  }
});

document.querySelectorAll('#apps-table th[data-sort]').forEach((th) => {
  th.querySelector('.sort-btn').addEventListener('click', () => {
    const key = th.dataset.sort;
    sortDir = sortKey === key ? -sortDir : 1;
    sortKey = key;
    renderApplications();
  });
});

searchInput.addEventListener('input', renderApplications);

// ---- Add / edit application dialog ----
// The same dialog and form serve both: `editingId` is null while adding a brand-new
// entry, or the id of the row being edited — the submit handler branches on that alone
// rather than duplicating the dialog markup.
const addDialog = document.getElementById('add-app-dialog');
const addForm = document.getElementById('add-app-form');
const dialogTitle = document.getElementById('app-dialog-title');
const addDialogMsg = document.getElementById('add-app-msg');
const dialogSubmit = document.getElementById('save-add-app');
let editingId = null;

function openAddDialog() {
  editingId = null;
  dialogTitle.textContent = 'Add application';
  dialogSubmit.textContent = 'Add application';
  addForm.reset();
  addForm.elements.dateApplied.value = new Date().toLocaleDateString('en-CA');
  addDialogMsg.textContent = '';
  addDialog.showModal();
}
document.getElementById('add-app-btn').addEventListener('click', openAddDialog);
document.getElementById('cancel-add-app').addEventListener('click', () => addDialog.close());

function openEditDialog(app) {
  editingId = app.id;
  dialogTitle.textContent = 'Edit application';
  dialogSubmit.textContent = 'Save changes';
  addForm.reset();
  addDialogMsg.textContent = '';
  for (const [key, value] of Object.entries(app)) {
    const field = addForm.elements[key];
    if (field && typeof value === 'string') field.value = value;
  }
  addDialog.showModal();
}

// preventDefault overrides the form's native method="dialog" auto-close so a failed save
// (app not running, a server error) can keep the dialog open with your entered data intact
// and a visible error — instead of the dialog silently closing as if it worked while
// nothing was actually written to disk.
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(addForm);
  const body = Object.fromEntries(formData.entries());

  dialogSubmit.disabled = true;
  try {
    if (editingId) {
      await updateApplication(editingId, body);
      editingId = null;
    } else {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const created = await res.json();
      applications.unshift(created);
    }
    renderApplications();
    addDialog.close();
  } catch (err) {
    console.error('[BC] application save failed', err);
    addDialogMsg.textContent = 'Could not save. Is the app still running? Your entries are unchanged, so try again.';
    addDialogMsg.classList.add('save-msg-error');
  } finally {
    dialogSubmit.disabled = false;
  }
});

// ---- Profile ----
const profileForm = document.getElementById('profile-form');
const saveBar = profileForm.querySelector('.save-bar');
const profileSaveBtn = document.getElementById('profile-save-btn');
let currentProfile = null;
let profileDirty = false;

function setProfileDirty(dirty) {
  profileDirty = dirty;
  saveBar.classList.toggle('dirty', dirty);
}
// Typing anywhere in the profile (including the dynamic cards) marks it unsaved; the
// add/remove buttons for cards and skills call setProfileDirty(true) themselves.
profileForm.addEventListener('input', (e) => {
  if (!e.target.closest('.upload-row')) setProfileDirty(true);
});
window.addEventListener('beforeunload', (e) => {
  if (profileDirty) e.preventDefault();
});

async function loadProfile() {
  const res = await fetch('/api/profile');
  currentProfile = await res.json();
  for (const [key, value] of Object.entries(currentProfile)) {
    const field = profileForm.elements[key];
    if (field && typeof value === 'string') field.value = value;
  }
  renderDocList('cv-list', currentProfile.cvFiles || [], 'cv');
  renderDocList('cover-list', currentProfile.coverLetterFiles || [], 'coverLetter');
  renderExperienceList(currentProfile.workExperience || []);
  renderSkillsList(currentProfile.skills || []);
  renderLanguageList(currentProfile.languages || []);
  renderEducationList(currentProfile.education || []);
}

function educationCardTemplate(edu, index) {
  return `
    <div class="experience-card" data-index="${index}">
      <div class="experience-card-header">
        <strong>Education ${index + 1}</strong>
        <button type="button" class="btn-link danger remove-education">Remove</button>
      </div>
      <div class="grid">
        <label>Institution <input class="edu-institution" placeholder="Durham University" value="${escapeAttr(edu.institution)}" /></label>
        <label>Type
          <select class="edu-institutionType">
            <option value="University" ${edu.institutionType === 'University' ? 'selected' : ''}>University</option>
            <option value="School" ${edu.institutionType === 'School' ? 'selected' : ''}>School</option>
            <option value="Other" ${edu.institutionType === 'Other' ? 'selected' : ''}>Other</option>
          </select>
        </label>
        <label>Degree / qualification <input class="edu-degree" placeholder="BSc, A-Levels, IB…" value="${escapeAttr(edu.degree)}" /></label>
        <label>Field of study <input class="edu-fieldOfStudy" value="${escapeAttr(edu.fieldOfStudy)}" /></label>
        <label>GPA / grade / classification <input class="edu-gpaOrClassification" value="${escapeAttr(edu.gpaOrClassification)}" /></label>
        <label>Start month <input class="edu-startMonth" placeholder="09" value="${escapeAttr(edu.startMonth)}" /></label>
        <label>Start year <input class="edu-startYear" placeholder="2025" value="${escapeAttr(edu.startYear)}" /></label>
        <label>Graduation month <input class="edu-graduationMonth" placeholder="06" value="${escapeAttr(edu.graduationMonth)}" /></label>
        <label>Graduation year <input class="edu-graduationYear" placeholder="2028" value="${escapeAttr(edu.graduationYear)}" /></label>
      </div>
    </div>
  `;
}

function renderEducationList(education) {
  const container = document.getElementById('education-list');
  container.innerHTML = education.map(educationCardTemplate).join('');
  container.querySelectorAll('.remove-education').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      currentProfile.education.splice(i, 1);
      renderEducationList(currentProfile.education);
      setProfileDirty(true);
    });
  });
}

document.getElementById('add-education-btn').addEventListener('click', () => {
  currentProfile.education = currentProfile.education || [];
  currentProfile.education.push({
    institution: '',
    institutionType: 'University',
    degree: '',
    fieldOfStudy: '',
    gpaOrClassification: '',
    startMonth: '',
    startYear: '',
    graduationMonth: '',
    graduationYear: ''
  });
  renderEducationList(currentProfile.education);
  setProfileDirty(true);
});

function collectEducationFromForm() {
  return Array.from(document.querySelectorAll('#education-list .experience-card')).map((card) => ({
    institution: card.querySelector('.edu-institution').value,
    institutionType: card.querySelector('.edu-institutionType').value,
    degree: card.querySelector('.edu-degree').value,
    fieldOfStudy: card.querySelector('.edu-fieldOfStudy').value,
    gpaOrClassification: card.querySelector('.edu-gpaOrClassification').value,
    startMonth: card.querySelector('.edu-startMonth').value,
    startYear: card.querySelector('.edu-startYear').value,
    graduationMonth: card.querySelector('.edu-graduationMonth').value,
    graduationYear: card.querySelector('.edu-graduationYear').value
  }));
}

function renderSkillsList(skills) {
  const ul = document.getElementById('skills-list');
  ul.innerHTML = '';
  skills.forEach((skill, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(skill)}</span>`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-link danger';
    del.textContent = '×';
    del.setAttribute('aria-label', `Remove ${skill}`);
    del.addEventListener('click', () => {
      currentProfile.skills.splice(i, 1);
      renderSkillsList(currentProfile.skills);
      setProfileDirty(true);
    });
    li.appendChild(del);
    ul.appendChild(li);
  });
}

document.getElementById('add-skill-btn').addEventListener('click', () => {
  const input = document.getElementById('skill-input');
  const value = input.value.trim();
  if (!value) return;
  currentProfile.skills = currentProfile.skills || [];
  currentProfile.skills.push(value);
  input.value = '';
  renderSkillsList(currentProfile.skills);
  setProfileDirty(true);
});

document.getElementById('skill-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('add-skill-btn').click();
  }
});

function languageCardTemplate(lang, index) {
  return `
    <div class="experience-card" data-index="${index}">
      <div class="experience-card-header">
        <strong>Language ${index + 1}</strong>
        <button type="button" class="btn-link danger remove-language">Remove</button>
      </div>
      <div class="grid">
        <label>Language <input class="lang-language" value="${escapeAttr(lang.language)}" /></label>
        <label>Speaking <input class="lang-speaking" placeholder="Native, Fluent…" value="${escapeAttr(lang.speaking)}" /></label>
        <label>Writing <input class="lang-writing" placeholder="Native, Fluent…" value="${escapeAttr(lang.writing)}" /></label>
        <label>Reading <input class="lang-reading" placeholder="Native, Fluent…" value="${escapeAttr(lang.reading)}" /></label>
      </div>
    </div>
  `;
}

function renderLanguageList(languages) {
  const container = document.getElementById('languages-list');
  container.innerHTML = languages.map(languageCardTemplate).join('');
  container.querySelectorAll('.remove-language').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      currentProfile.languages.splice(i, 1);
      renderLanguageList(currentProfile.languages);
      setProfileDirty(true);
    });
  });
}

document.getElementById('add-language-btn').addEventListener('click', () => {
  currentProfile.languages = currentProfile.languages || [];
  currentProfile.languages.push({ language: '', speaking: '', writing: '', reading: '' });
  renderLanguageList(currentProfile.languages);
  setProfileDirty(true);
});

function collectLanguagesFromForm() {
  return Array.from(document.querySelectorAll('#languages-list .experience-card')).map((card) => ({
    language: card.querySelector('.lang-language').value,
    speaking: card.querySelector('.lang-speaking').value,
    writing: card.querySelector('.lang-writing').value,
    reading: card.querySelector('.lang-reading').value
  }));
}

function experienceCardTemplate(exp, index) {
  return `
    <div class="experience-card" data-index="${index}">
      <div class="experience-card-header">
        <strong>Experience ${index + 1}</strong>
        <button type="button" class="btn-link danger remove-experience">Remove</button>
      </div>
      <div class="grid">
        <label>Job title <input class="exp-jobTitle" value="${escapeAttr(exp.jobTitle)}" /></label>
        <label>Company <input class="exp-company" value="${escapeAttr(exp.company)}" /></label>
        <label>Location <input class="exp-location" value="${escapeAttr(exp.location)}" /></label>
        <label>Start month <input class="exp-startMonth" placeholder="06" value="${escapeAttr(exp.startMonth)}" /></label>
        <label>Start year <input class="exp-startYear" placeholder="2025" value="${escapeAttr(exp.startYear)}" /></label>
        <label>End month <input class="exp-endMonth" placeholder="08" value="${escapeAttr(exp.endMonth)}" /></label>
        <label>End year <input class="exp-endYear" placeholder="2025" value="${escapeAttr(exp.endYear)}" /></label>
        <label class="checkbox-label"><input type="checkbox" class="exp-currentlyWorkHere" ${exp.currentlyWorkHere ? 'checked' : ''} /> I currently work here</label>
        <label class="span-2">Role description <textarea class="exp-roleDescription" rows="2">${escapeHtml(exp.roleDescription)}</textarea></label>
      </div>
    </div>
  `;
}

function renderExperienceList(experiences) {
  const container = document.getElementById('experience-list');
  container.innerHTML = experiences.map(experienceCardTemplate).join('');
  container.querySelectorAll('.remove-experience').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      currentProfile.workExperience.splice(i, 1);
      renderExperienceList(currentProfile.workExperience);
      setProfileDirty(true);
    });
  });
}

document.getElementById('add-experience-btn').addEventListener('click', () => {
  currentProfile.workExperience = currentProfile.workExperience || [];
  currentProfile.workExperience.push({
    jobTitle: '',
    company: '',
    location: '',
    currentlyWorkHere: false,
    startMonth: '',
    startYear: '',
    endMonth: '',
    endYear: '',
    roleDescription: ''
  });
  renderExperienceList(currentProfile.workExperience);
  setProfileDirty(true);
});

function collectExperienceFromForm() {
  return Array.from(document.querySelectorAll('#experience-list .experience-card')).map((card) => ({
    jobTitle: card.querySelector('.exp-jobTitle').value,
    company: card.querySelector('.exp-company').value,
    location: card.querySelector('.exp-location').value,
    currentlyWorkHere: card.querySelector('.exp-currentlyWorkHere').checked,
    startMonth: card.querySelector('.exp-startMonth').value,
    startYear: card.querySelector('.exp-startYear').value,
    endMonth: card.querySelector('.exp-endMonth').value,
    endYear: card.querySelector('.exp-endYear').value,
    roleDescription: card.querySelector('.exp-roleDescription').value
  }));
}

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('profile-save-msg');
  const formData = new FormData(profileForm);
  const body = {
    ...currentProfile,
    ...Object.fromEntries(formData.entries()),
    workExperience: collectExperienceFromForm(),
    languages: collectLanguagesFromForm(),
    education: collectEducationFromForm()
  };
  profileSaveBtn.disabled = true;
  // A silent failure here (app not running, a network hiccup, a server error) would
  // otherwise look EXACTLY like the just-typed data being "deleted": the form still shows
  // it, nothing visibly goes wrong, but nothing was actually written to disk — so the
  // next time the app is opened, the profile is back to whatever it was before. Always
  // show something, and never overwrite the form with a blank/error response.
  try {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    currentProfile = await res.json();
    renderExperienceList(currentProfile.workExperience || []);
    renderLanguageList(currentProfile.languages || []);
    renderEducationList(currentProfile.education || []);
    setProfileDirty(false);
    msg.textContent = 'Saved';
    msg.classList.remove('save-msg-error');
    setTimeout(() => {
      if (msg.textContent === 'Saved') msg.textContent = '';
    }, 2000);
  } catch (err) {
    console.error('[BC] profile save failed', err);
    msg.textContent = 'Could not save. Is the app (npm start) still running? Nothing was written, and your changes are still in this form.';
    msg.classList.add('save-msg-error');
    // Left visible (no timeout) until the next successful save clears it — an error the
    // user might miss for a few seconds is worse than one that lingers.
  } finally {
    profileSaveBtn.disabled = false;
  }
});

// After an upload/remove, refresh only the document lists so any unsaved typing elsewhere
// in the profile form isn't overwritten by a full loadProfile().
async function refreshDocs() {
  const res = await fetch('/api/profile');
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  const fresh = await res.json();
  currentProfile.cvFiles = fresh.cvFiles;
  currentProfile.coverLetterFiles = fresh.coverLetterFiles;
  renderDocList('cv-list', currentProfile.cvFiles || [], 'cv');
  renderDocList('cover-list', currentProfile.coverLetterFiles || [], 'coverLetter');
}

function renderDocList(elId, files, kind) {
  const ul = document.getElementById(elId);
  ul.innerHTML = '';
  for (const f of files) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(f.name)} <small>(${escapeHtml(f.originalName)})</small></span>`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-link danger';
    del.textContent = 'Remove';
    del.setAttribute('aria-label', `Remove ${f.name}`);
    del.addEventListener('click', async () => {
      try {
        const res = await fetch(`/api/profile/cv/${kind}/${f.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        await refreshDocs();
      } catch (err) {
        console.error('[BC] document delete failed', err);
        showToast('Could not remove the file. Is the app still running?', { error: true });
      }
    });
    li.appendChild(del);
    ul.appendChild(li);
  }
}

async function uploadDoc(kind, nameInputId, fileInputId, msgId) {
  const nameInput = document.getElementById(nameInputId);
  const fileInput = document.getElementById(fileInputId);
  const msg = document.getElementById(msgId);
  msg.textContent = '';
  if (!fileInput.files[0]) {
    msg.textContent = 'Choose a file to upload first.';
    fileInput.focus();
    return;
  }
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('name', nameInput.value || fileInput.files[0].name);
  formData.append('kind', kind);
  try {
    const res = await fetch('/api/profile/cv', { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    nameInput.value = '';
    fileInput.value = '';
    await refreshDocs();
  } catch (err) {
    console.error('[BC] upload failed', err);
    msg.textContent = 'Upload failed. Is the app still running? Try again.';
  }
}

document.getElementById('cv-upload-btn').addEventListener('click', () =>
  uploadDoc('cv', 'cv-name', 'cv-file', 'cv-upload-msg')
);
document.getElementById('cover-upload-btn').addEventListener('click', () =>
  uploadDoc('coverLetter', 'cover-name', 'cover-file', 'cover-upload-msg')
);

// ---- Helpers ----
function escapeHtml(value) {
  return (value ?? '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

// ---- Autofill insights ----
async function loadInsights() {
  const res = await fetch('/api/flags');
  const rows = await res.json();
  const tbody = document.getElementById('insights-tbody');
  const empty = document.getElementById('insights-empty');
  tbody.innerHTML = '';
  empty.hidden = rows.length > 0;
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(row.label)}</td>
      <td class="num">${escapeHtml(row.count)}</td>
      <td class="date-cell">${escapeHtml(new Date(row.lastSeenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}</td>
    `;
    tbody.appendChild(tr);
  }
}

loadApplications();
loadProfile();
selectTab(location.hash.slice(1));
