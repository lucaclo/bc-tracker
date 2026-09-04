const STATUSES = ['Bookmarked', 'Applying', 'Applied', 'Interviewing', 'Offer', 'Rejected'];

// ---- Tabs ----
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ---- Applications ----
let applications = [];
let sortKey = 'dateApplied';
let sortDir = -1;

const tbody = document.getElementById('apps-tbody');
const emptyState = document.getElementById('apps-empty');
const searchInput = document.getElementById('app-search');
const statusFilter = document.getElementById('app-status-filter');

for (const s of STATUSES) {
  const opt = document.createElement('option');
  opt.value = s;
  opt.textContent = s;
  statusFilter.appendChild(opt);
}

async function loadApplications() {
  const res = await fetch('/api/applications');
  applications = await res.json();
  renderApplications();
}

function renderApplications() {
  const term = searchInput.value.trim().toLowerCase();
  const statusVal = statusFilter.value;

  let rows = applications.filter((a) => {
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

  tbody.innerHTML = '';
  emptyState.hidden = rows.length > 0;

  for (const app of rows) {
    const tr = document.createElement('tr');

    const linkHtml = app.applicationLink
      ? `<a href="${escapeAttr(app.applicationLink)}" target="_blank" rel="noopener">Open</a>`
      : '';

    tr.innerHTML = `
      <td>${escapeHtml(app.company)}</td>
      <td>${escapeHtml(app.role)}</td>
      <td>${escapeHtml(app.region)}</td>
      <td>${escapeHtml(app.industry)}</td>
      <td></td>
      <td>${escapeHtml(app.dateApplied)}</td>
      <td>${escapeHtml(app.deadline)}</td>
      <td>${escapeHtml(app.source)}</td>
      <td class="link-cell">${linkHtml}</td>
      <td class="notes-cell" title="${escapeAttr(app.notes)}">${escapeHtml(app.notes)}</td>
      <td><button class="row-delete" data-id="${app.id}">Delete</button></td>
    `;

    const statusCell = tr.children[4];
    const select = document.createElement('select');
    select.className = `status-pill status-${app.status}`;
    for (const s of STATUSES) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      if (s === app.status) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', async () => {
      await updateApplication(app.id, { status: select.value });
      select.className = `status-pill status-${select.value}`;
    });
    statusCell.appendChild(select);

    tr.querySelector('.row-delete').addEventListener('click', () => deleteApplication(app.id));

    tbody.appendChild(tr);
  }
}

async function updateApplication(id, patch) {
  const res = await fetch(`/api/applications/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  const updated = await res.json();
  applications = applications.map((a) => (a.id === id ? updated : a));
}

async function deleteApplication(id) {
  if (!confirm('Delete this application?')) return;
  await fetch(`/api/applications/${id}`, { method: 'DELETE' });
  applications = applications.filter((a) => a.id !== id);
  renderApplications();
}

document.querySelectorAll('#apps-table th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    sortDir = sortKey === key ? -sortDir : 1;
    sortKey = key;
    renderApplications();
  });
});

searchInput.addEventListener('input', renderApplications);
statusFilter.addEventListener('change', renderApplications);

// ---- Add application dialog ----
const addDialog = document.getElementById('add-app-dialog');
const addForm = document.getElementById('add-app-form');

document.getElementById('add-app-btn').addEventListener('click', () => {
  addForm.reset();
  addDialog.showModal();
});
document.getElementById('cancel-add-app').addEventListener('click', () => addDialog.close());

addForm.addEventListener('submit', async (e) => {
  const formData = new FormData(addForm);
  const body = Object.fromEntries(formData.entries());
  const res = await fetch('/api/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const created = await res.json();
  applications.unshift(created);
  renderApplications();
});

// ---- Profile ----
const profileForm = document.getElementById('profile-form');
let currentProfile = null;

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
        <button type="button" class="remove-education">Remove</button>
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
    del.textContent = 'Remove';
    del.addEventListener('click', () => {
      currentProfile.skills.splice(i, 1);
      renderSkillsList(currentProfile.skills);
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
        <button type="button" class="remove-language">Remove</button>
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
    });
  });
}

document.getElementById('add-language-btn').addEventListener('click', () => {
  currentProfile.languages = currentProfile.languages || [];
  currentProfile.languages.push({ language: '', speaking: '', writing: '', reading: '' });
  renderLanguageList(currentProfile.languages);
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
        <button type="button" class="remove-experience">Remove</button>
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
  const formData = new FormData(profileForm);
  const body = {
    ...currentProfile,
    ...Object.fromEntries(formData.entries()),
    workExperience: collectExperienceFromForm(),
    languages: collectLanguagesFromForm(),
    education: collectEducationFromForm()
  };
  const res = await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  currentProfile = await res.json();
  renderExperienceList(currentProfile.workExperience || []);
  renderLanguageList(currentProfile.languages || []);
  renderEducationList(currentProfile.education || []);
  const msg = document.getElementById('profile-save-msg');
  msg.textContent = 'Saved';
  setTimeout(() => (msg.textContent = ''), 2000);
});

function renderDocList(elId, files, kind) {
  const ul = document.getElementById(elId);
  ul.innerHTML = '';
  for (const f of files) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(f.name)} <small>(${escapeHtml(f.originalName)})</small></span>`;
    const del = document.createElement('button');
    del.textContent = 'Remove';
    del.addEventListener('click', async () => {
      await fetch(`/api/profile/cv/${kind}/${f.id}`, { method: 'DELETE' });
      loadProfile();
    });
    li.appendChild(del);
    ul.appendChild(li);
  }
}

async function uploadDoc(kind, nameInputId, fileInputId) {
  const nameInput = document.getElementById(nameInputId);
  const fileInput = document.getElementById(fileInputId);
  if (!fileInput.files[0]) return alert('Choose a file first.');
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('name', nameInput.value || fileInput.files[0].name);
  formData.append('kind', kind);
  await fetch('/api/profile/cv', { method: 'POST', body: formData });
  nameInput.value = '';
  fileInput.value = '';
  loadProfile();
}

document.getElementById('cv-upload-btn').addEventListener('click', () =>
  uploadDoc('cv', 'cv-name', 'cv-file')
);
document.getElementById('cover-upload-btn').addEventListener('click', () =>
  uploadDoc('coverLetter', 'cover-name', 'cover-file')
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
      <td>${escapeHtml(row.count)}</td>
      <td>${escapeHtml(new Date(row.lastSeenAt).toLocaleDateString())}</td>
    `;
    tbody.appendChild(tr);
  }
}

document.querySelector('.tab-btn[data-tab="insights"]').addEventListener('click', loadInsights);

loadApplications();
loadProfile();
