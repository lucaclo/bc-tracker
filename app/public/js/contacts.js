// Contact rendering shared by the Applications table's Contacts dropdown and the Contacts tab.
// Loaded before app.js; uses its escapeHtml/escapeAttr/showToast at call time.
/* global escapeHtml, escapeAttr, showToast */
/* exported renderContactList, renderContactDetail, CONTACT_STATUSES */

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
