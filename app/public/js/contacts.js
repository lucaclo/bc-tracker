// Contact rendering shared by the Applications table's Contacts dropdown and the Contacts tab.
// Loaded before app.js; uses its escapeHtml/escapeAttr/showToast at call time.
/* global escapeHtml, escapeAttr, showToast, formatDate, loadApplications */
/* exported renderContactList, renderContactDetail, CONTACT_STATUSES, loadContactsTab */

const CONTACT_STATUSES = [
  ['to-contact', 'To contact'],
  ['messaged', 'Messaged'],
  ['replied', 'Replied'],
  ['call-done', 'Call done'],
  ['not-relevant', 'Not relevant']
];

// Only real web links become clickable, so a captured "javascript:" href can never run.
function safeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch (_) {
    return '';
  }
}

async function saveContact(id, patch) {
  const res = await fetch(`/api/contacts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  if (!res.ok) throw new Error(`Server responded ${res.status}`);
  return res.json();
}

function contactFactsHtml(c) {
  const link = (url, label) => {
    const href = safeUrl(url);
    return href ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener">${label} ↗</a>` : '';
  };
  const email = c.email && /^[^\s@]+@[^\s@]+$/.test(c.email)
    ? `<a href="mailto:${escapeAttr(c.email)}">${escapeHtml(c.email)}</a>`
    : escapeHtml(c.email);
  const facts = [
    ['Title', escapeHtml(c.title)],
    ['Company', escapeHtml(c.company)],
    ['Team', escapeHtml(c.team)],
    ['Location', escapeHtml(c.location)],
    ['Links', [link(c.linkedinUrl, 'LinkedIn'), link(c.profileUrl, 'Profile')].filter(Boolean).join(' · ')],
    ['Email', email],
    ['Source group', escapeHtml(c.sourceGroup)],
    ['School', escapeHtml(c.school)],
    ['Grad year', escapeHtml(c.gradYear)],
    ['Society', escapeHtml(c.society)]
  ];
  return `<dl class="contact-facts">${facts
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value || '<span class="muted">—</span>'}</dd></div>`)
    .join('')}</dl>`;
}

// The full record for one contact, with status / last contacted / notes editable in place.
// Every change saves straight away; onSaved(updated) lets the caller refresh its own copy.
function renderContactDetail(container, contact, { onSaved } = {}) {
  const uid = `c-${contact.id}`;
  container.innerHTML = `
    ${contactFactsHtml(contact)}
    <div class="contact-edit">
      <label>Status
        <select class="contact-status">${CONTACT_STATUSES
          .map(([v, l]) => `<option value="${v}"${v === contact.status ? ' selected' : ''}>${l}</option>`)
          .join('')}</select>
      </label>
      <label>Last contacted <input type="date" class="contact-last" value="${escapeAttr(contact.lastContacted)}" /></label>
      <label class="contact-notes-label" for="${uid}-notes">Notes</label>
      <textarea id="${uid}-notes" class="contact-notes" rows="2">${escapeHtml(contact.notes)}</textarea>
    </div>`;

  let current = contact;
  const bind = (selector, field, event) => {
    const el = container.querySelector(selector);
    el.addEventListener(event, async () => {
      if (el.value === (current[field] || '')) return;
      try {
        current = await saveContact(current.id, { [field]: el.value });
        showToast(`Saved ${current.name}`, { duration: 2500 });
        onSaved?.(current);
      } catch (err) {
        console.error('[BC] contact save failed', err);
        el.value = current[field] || '';
        showToast(`Could not save ${current.name}. Is the app still running? Nothing was changed.`, { error: true, duration: 8000 });
      }
    });
  };
  bind('.contact-status', 'status', 'change');
  bind('.contact-last', 'lastContacted', 'change');
  bind('.contact-notes', 'notes', 'change');
}

// A list of names; clicking (or Enter/Space on) a name expands that person's details below it.
function renderContactList(container, contacts, { onSaved } = {}) {
  container.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'contact-list';
  for (const contact of contacts) {
    const li = document.createElement('li');
    const detailId = `contact-detail-${contact.id}`;
    li.innerHTML = `
      <button type="button" class="contact-name" aria-expanded="false" aria-controls="${detailId}">
        <span class="contact-name-text">${escapeHtml(contact.name)}</span>
        <span class="contact-sub">${escapeHtml(contact.title)}</span>
      </button>
      <div id="${detailId}" class="contact-detail" hidden></div>`;
    const btn = li.querySelector('.contact-name');
    const detail = li.querySelector('.contact-detail');
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      detail.hidden = !open;
      if (open && !detail.childElementCount) {
        renderContactDetail(detail, contact, {
          onSaved: (updated) => {
            Object.assign(contact, updated);
            li.querySelector('.contact-sub').textContent = updated.title || '';
            onSaved?.(updated);
          }
        });
      }
    });
    ul.appendChild(li);
  }
  container.appendChild(ul);
}

// ---- Contacts tab ----
// Every contact in one table: search, filters, manual add/edit/delete, the Unassigned review
// list and delete-by-source. Loaded each time the tab is opened (selectTab in app.js).
let allContacts = [];
let unassignedContacts = [];
const openContactRows = new Set();
// Deleted but still inside the undo window: hidden here, not yet sent to the server.
const pendingContactDeletes = new Map();
const CONTACT_UNDO_MS = 6000;
const statusLabel = (v) => (CONTACT_STATUSES.find(([s]) => s === v) || [v, v])[1];

const contactsTbody = document.getElementById('contacts-tbody');
const contactSearch = document.getElementById('contact-search');
const companyFilter = document.getElementById('contact-filter-company');
const sourceFilter = document.getElementById('contact-filter-source');
const statusFilter = document.getElementById('contact-filter-status');

statusFilter.insertAdjacentHTML('beforeend', CONTACT_STATUSES
  .map(([v, l]) => `<option value="${v}">${l}</option>`).join(''));

async function loadContactsTab() {
  try {
    const [all, unassigned, apps] = await Promise.all(
      ['/api/contacts', '/api/contacts/unassigned', '/api/applications'].map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        return res.json();
      })
    );
    allContacts = all;
    unassignedContacts = unassigned;
    fillDatalist('company-options', apps.map((a) => a.company));
  } catch (err) {
    console.error('[BC] could not load contacts', err);
    showToast('Could not load contacts. Is the app (npm start) running?', { error: true, duration: 10000 });
  }
  renderContactsTab();
}

function fillDatalist(id, values) {
  const unique = [...new Set(values.map((v) => (v || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  document.getElementById(id).innerHTML = unique.map((v) => `<option value="${escapeAttr(v)}"></option>`).join('');
}

// Keeps the chosen option if it still exists after the list of companies/sources changes.
function fillFilter(select, allLabel, options) {
  const keep = select.value;
  select.innerHTML = `<option value="">${allLabel}</option>` +
    options.map(([v, l]) => `<option value="${escapeAttr(v)}">${escapeHtml(l)}</option>`).join('');
  select.value = options.some(([v]) => v === keep) ? keep : '';
}

function visibleContacts() {
  return allContacts.filter((c) => !pendingContactDeletes.has(c.id));
}

function renderContactsTab() {
  const contacts = visibleContacts();
  document.getElementById('contacts-count').textContent = contacts.length || '';

  // One company option per firm (by key), labelled with the first spelling seen.
  const companies = new Map();
  for (const c of contacts) if (c.companyKey && !companies.has(c.companyKey)) companies.set(c.companyKey, c.company);
  fillFilter(companyFilter, 'All companies', [...companies].sort((a, b) => a[1].localeCompare(b[1])));
  const sources = [...new Set(contacts.map((c) => c.sourceGroup).filter(Boolean))].sort();
  fillFilter(sourceFilter, 'All sources', sources.map((s) => [s, s]));
  fillDatalist('source-options', sources);

  renderUnassigned();

  const term = contactSearch.value.trim().toLowerCase();
  const rows = contacts
    .filter((c) =>
      (!term || c.name.toLowerCase().includes(term)) &&
      (!companyFilter.value || c.companyKey === companyFilter.value) &&
      (!sourceFilter.value || c.sourceGroup === sourceFilter.value) &&
      (!statusFilter.value || c.status === statusFilter.value))
    .sort((a, b) => a.name.localeCompare(b.name));

  contactsTbody.innerHTML = '';
  const empty = document.getElementById('contacts-empty');
  const emptyAction = document.getElementById('contacts-empty-action');
  empty.hidden = rows.length > 0;
  if (!rows.length) {
    const filtered = contacts.length > 0;
    document.getElementById('contacts-empty-text').textContent = filtered
      ? 'No contacts match this search or filter.'
      : 'No contacts yet. There are three ways to add them:';
    document.getElementById('contacts-empty-ways').hidden = filtered;
    emptyAction.textContent = filtered ? 'Clear filters' : 'Add contact';
    emptyAction.onclick = filtered
      ? () => {
          contactSearch.value = '';
          companyFilter.value = sourceFilter.value = statusFilter.value = '';
          renderContactsTab();
        }
      : () => openContactDialog();
  }

  for (const c of rows) {
    const tr = document.createElement('tr');
    const detailId = `contact-row-detail-${c.id}`;
    const open = openContactRows.has(c.id);
    tr.innerHTML = `
      <td class="company-cell">
        <button type="button" class="contact-name contact-row-toggle" aria-expanded="${open}" aria-controls="${detailId}">
          <span class="contact-name-text">${escapeHtml(c.name)}</span>
        </button>
      </td>
      <td>${escapeHtml(c.title)}</td>
      <td>${escapeHtml(c.company) || '<span class="muted">—</span>'}</td>
      <td>${escapeHtml(c.sourceGroup) || '<span class="muted">—</span>'}</td>
      <td>${escapeHtml(statusLabel(c.status))}</td>
      <td class="date-cell">${c.lastContacted ? formatDate(c.lastContacted) : '<span class="muted">—</span>'}</td>
      <td class="actions-col">
        <div class="row-actions">
          <button type="button" class="btn-link row-edit" aria-label="Edit ${escapeAttr(c.name)}">Edit</button>
          <button type="button" class="btn-link danger row-delete" aria-label="Delete ${escapeAttr(c.name)}">Delete</button>
        </div>
      </td>`;
    const detailRow = document.createElement('tr');
    detailRow.className = 'contacts-row';
    detailRow.hidden = !open;
    detailRow.innerHTML = `<td colspan="7"><div id="${detailId}" class="contacts-panel contact-detail"></div></td>`;
    const panel = detailRow.querySelector('.contacts-panel');
    const draw = () => renderContactDetail(panel, c, {
      onSaved: (updated) => {
        Object.assign(c, updated);
        tr.children[4].textContent = statusLabel(updated.status);
        tr.children[5].innerHTML = updated.lastContacted ? formatDate(updated.lastContacted) : '<span class="muted">—</span>';
      }
    });
    if (open) draw();

    const toggle = tr.querySelector('.contact-row-toggle');
    toggle.addEventListener('click', () => {
      const nowOpen = !openContactRows.has(c.id);
      if (nowOpen) openContactRows.add(c.id);
      else openContactRows.delete(c.id);
      toggle.setAttribute('aria-expanded', String(nowOpen));
      detailRow.hidden = !nowOpen;
      if (nowOpen && !panel.childElementCount) draw();
    });
    tr.querySelector('.row-edit').addEventListener('click', () => openContactDialog(c));
    tr.querySelector('.row-delete').addEventListener('click', () => deleteContact(c));
    contactsTbody.append(tr, detailRow);
  }
}

[contactSearch].forEach((el) => el.addEventListener('input', renderContactsTab));
[companyFilter, sourceFilter, statusFilter].forEach((el) => el.addEventListener('change', renderContactsTab));

function renderUnassigned() {
  const list = unassignedContacts.filter((c) => !pendingContactDeletes.has(c.id));
  const panel = document.getElementById('unassigned-panel');
  panel.hidden = list.length === 0;
  document.getElementById('unassigned-count').textContent = list.length || '';
  const ul = document.getElementById('unassigned-list');
  ul.innerHTML = '';
  for (const c of list) {
    const li = document.createElement('li');
    const inputId = `assign-${c.id}`;
    li.innerHTML = `
      <div class="unassigned-who">
        <strong>${escapeHtml(c.name)}</strong>
        <span class="muted">${c.company ? `“${escapeHtml(c.company)}”` : 'no company captured'}</span>
      </div>
      <form class="assign-form">
        <label class="visually-hidden" for="${inputId}">Company for ${escapeAttr(c.name)}</label>
        <input id="${inputId}" name="company" list="company-options" placeholder="Which company is this?" required />
        <button type="submit" class="btn btn-secondary">Assign</button>
      </form>`;
    li.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const company = e.target.elements.company.value.trim();
      if (!company) return;
      try {
        const res = await fetch(`/api/contacts/${c.id}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company })
        });
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        showToast(c.company ? `“${c.company}” now counts as ${company}` : `${c.name} assigned to ${company}`);
        await loadContactsTab();
        loadApplications(); // contact counts on the Applications tab
      } catch (err) {
        console.error('[BC] assign failed', err);
        showToast(`Could not assign ${c.name}. Is the app still running?`, { error: true });
      }
    });
    ul.appendChild(li);
  }
}

// Same undo pattern as applications: hidden at once, DELETE sent when the undo window closes.
function deleteContact(c) {
  const timer = setTimeout(() => commitContactDelete(c.id), CONTACT_UNDO_MS);
  pendingContactDeletes.set(c.id, timer);
  renderContactsTab();
  showToast(`Deleted ${c.name}`, {
    actionLabel: 'Undo',
    duration: CONTACT_UNDO_MS,
    onAction: () => {
      clearTimeout(pendingContactDeletes.get(c.id));
      pendingContactDeletes.delete(c.id);
      renderContactsTab();
    }
  });
}

async function commitContactDelete(id, { keepalive = false } = {}) {
  try {
    const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE', keepalive });
    if (!res.ok && res.status !== 404) throw new Error(`Server responded ${res.status}`);
    allContacts = allContacts.filter((c) => c.id !== id);
    unassignedContacts = unassignedContacts.filter((c) => c.id !== id);
  } catch (err) {
    console.error('[BC] contact delete failed', err);
    if (!keepalive) showToast('Could not delete. Is the app still running?', { error: true });
  } finally {
    pendingContactDeletes.delete(id);
    if (!keepalive) renderContactsTab();
  }
}

window.addEventListener('pagehide', () => {
  for (const [id, timer] of pendingContactDeletes) {
    clearTimeout(timer);
    commitContactDelete(id, { keepalive: true });
  }
});

// ---- Add / edit contact dialog ----
const contactDialog = document.getElementById('contact-dialog');
const contactForm = document.getElementById('contact-form');
const contactMsg = document.getElementById('contact-msg');
const saveContactBtn = document.getElementById('save-contact');
let editingContactId = null;

contactForm.elements.status.innerHTML = CONTACT_STATUSES
  .map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

function openContactDialog(contact = null) {
  editingContactId = contact ? contact.id : null;
  document.getElementById('contact-dialog-title').textContent = contact ? 'Edit contact' : 'Add contact';
  saveContactBtn.textContent = contact ? 'Save changes' : 'Add contact';
  contactForm.reset();
  contactMsg.textContent = '';
  contactMsg.classList.remove('save-msg-error');
  for (const [key, value] of Object.entries(contact || {})) {
    const field = contactForm.elements[key];
    if (field && typeof value === 'string') field.value = value;
  }
  contactDialog.showModal();
}
document.getElementById('add-contact-btn').addEventListener('click', () => openContactDialog());
document.getElementById('cancel-contact').addEventListener('click', () => contactDialog.close());

contactForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(contactForm).entries());
  saveContactBtn.disabled = true;
  try {
    const res = await fetch(editingContactId ? `/api/contacts/${editingContactId}` : '/api/contacts', {
      method: editingContactId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const saved = await res.json();
    // A new contact that matched someone already saved was merged into them, not added.
    if (!editingContactId && res.status === 200) showToast(`${saved.name} was already saved, so the two were merged`);
    contactDialog.close();
    await loadContactsTab();
    loadApplications();
  } catch (err) {
    console.error('[BC] contact save failed', err);
    contactMsg.textContent = 'Could not save. Is the app still running? Your entries are unchanged, so try again.';
    contactMsg.classList.add('save-msg-error');
  } finally {
    saveContactBtn.disabled = false;
  }
});

// ---- Delete by source ----
const deleteSourceDialog = document.getElementById('delete-source-dialog');
const deleteSourceSelect = document.getElementById('delete-source-select');
const confirmDeleteSource = document.getElementById('confirm-delete-source');

function updateDeleteSourceLabel() {
  const n = allContacts.filter((c) => c.sourceGroup === deleteSourceSelect.value).length;
  confirmDeleteSource.textContent = `Delete ${n} contact${n === 1 ? '' : 's'}`;
  confirmDeleteSource.disabled = n === 0;
}

document.getElementById('delete-source-btn').addEventListener('click', () => {
  const sources = [...new Set(allContacts.map((c) => c.sourceGroup).filter(Boolean))].sort();
  if (!sources.length) {
    showToast('No contacts have a source group yet.');
    return;
  }
  deleteSourceSelect.innerHTML = sources.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
  if (sourceFilter.value) deleteSourceSelect.value = sourceFilter.value;
  document.getElementById('delete-source-msg').textContent = '';
  updateDeleteSourceLabel();
  deleteSourceDialog.showModal();
});
deleteSourceSelect.addEventListener('change', updateDeleteSourceLabel);
document.getElementById('cancel-delete-source').addEventListener('click', () => deleteSourceDialog.close());

document.getElementById('delete-source-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const group = deleteSourceSelect.value;
  confirmDeleteSource.disabled = true;
  try {
    const res = await fetch(`/api/contacts?sourceGroup=${encodeURIComponent(group)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const { deleted } = await res.json();
    deleteSourceDialog.close();
    showToast(`Deleted ${deleted} contact${deleted === 1 ? '' : 's'} from ${group}`);
    if (sourceFilter.value === group) sourceFilter.value = '';
    await loadContactsTab();
    loadApplications();
  } catch (err) {
    console.error('[BC] delete by source failed', err);
    const msg = document.getElementById('delete-source-msg');
    msg.textContent = 'Could not delete. Is the app still running? Nothing was removed.';
    msg.classList.add('save-msg-error');
    confirmDeleteSource.disabled = false;
  }
});
