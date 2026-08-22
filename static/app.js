let opportunityData = [];
let dataCheckedAt = null;
let dataLoading = true;
/* The opportunity list is loaded from the local scraper API. No fallback records are fabricated here. */
async function loadOpportunities(force = false) {
  dataLoading = true;
  renderOpportunities();
  try {
    const response = await fetch(force ? '/api/opportunities/refresh' : '/api/opportunities');
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const payload = await response.json();
    opportunityData = payload.opportunities || [];
    dataCheckedAt = payload.checkedAt || null;
    $('#source-note').innerHTML = `<span>✓</span> Sources checked ${formatCheckedAt(dataCheckedAt)} · Official-page results only. Unknown fields stay unknown.`;
  } catch (error) {
    opportunityData = [];
    $('#source-note').innerHTML = `<span>!</span> Live source check failed. Start the Python server and try Refresh data again.`;
    showToast('Could not reach the live data service');
  } finally {
    dataLoading = false;
    renderOverview();
    renderOpportunities();
  }
}

function formatCheckedAt(value) {
  if (!value) return 'not available';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

const state = {
  user: null,
  saved: [],
  applications: [],
  documents: [],
};
let toastTimer;

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const showToast = (message) => {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
};
const getOpportunity = (id) => opportunityData.find((item) => item.id === id);

// --- Session / auth -------------------------------------------------------
async function loadSession() {
  try {
    const response = await fetch('/api/session');
    const payload = await response.json();
    state.user = payload.authenticated ? payload : null;
  } catch (error) {
    state.user = null;
  }
  return state.user;
}

function applyProfileToDom() {
  const user = state.user;
  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase() || '?';
  const avatar = $('#profile-avatar');
  if (avatar) avatar.textContent = initial;
  const name = $('#profile-name');
  if (name) name.textContent = user?.name || user?.email || 'Candidate';
  const email = $('#profile-email');
  if (email) email.textContent = user?.email || '';
  const panelName = $('#profile-panel-name');
  if (panelName) panelName.textContent = user?.name || user?.email || 'Candidate';
  const panelEmail = $('#profile-panel-email');
  if (panelEmail) panelEmail.textContent = user?.email || '';
  const greeting = $('#overview-greeting');
  if (greeting) greeting.textContent = user?.name ? `Your next move, ${user.name.split(' ')[0]}.` : 'Your next move.';
  const dateLabel = $('#overview-date');
  if (dateLabel) dateLabel.textContent = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
  const refreshButton = $('#refresh-button');
  if (refreshButton) refreshButton.hidden = !user?.isAdmin;

  // Opportunity discovery is public; account features (applications, documents,
  // saved) require sign-in. Toggle the sidebar identity and the locked-state panels
  // accordingly rather than gating the whole app behind login.
  $('#profile-button').hidden = !user;
  $('#logout-button').hidden = !user;
  $('#signin-link').hidden = !!user;
  const applicationsLocked = $('#applications-locked');
  if (applicationsLocked) applicationsLocked.hidden = !!user;
  const applicationBoard = $('#application-board');
  if (applicationBoard) applicationBoard.hidden = !user;
  const documentsLocked = $('#documents-locked');
  if (documentsLocked) documentsLocked.hidden = !!user;
  const documentsLayout = $('#documents-layout');
  if (documentsLayout) documentsLayout.hidden = !user;
}

/** Guards an account-only action. Returns true if the user is signed in; otherwise
 * prompts them to sign in and returns false. */
function requireLogin(message) {
  if (state.user) return true;
  openModal(`<span class="eyebrow">SIGN IN REQUIRED</span><h2>${message}</h2><p>Finding and browsing opportunities never requires an account, but this action saves to your profile, so you'll need to sign in first.</p><a class="primary-button full-width" href="/auth/login">Sign in with Google <span>→</span></a>`);
  return false;
}

// --- Server-backed state (applications / saved / documents) ---------------
async function loadUserState() {
  const [applicationsRes, savedRes, documentsRes] = await Promise.all([
    fetch('/api/applications').then((r) => (r.ok ? r.json() : { applications: [] })),
    fetch('/api/saved').then((r) => (r.ok ? r.json() : { saved: [] })),
    fetch('/api/documents').then((r) => (r.ok ? r.json() : { documents: [] })),
  ]);
  state.applications = applicationsRes.applications || [];
  state.saved = savedRes.saved || [];
  state.documents = documentsRes.documents || [];
}

async function upsertApplication(opportunityId, fields) {
  const response = await fetch('/api/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opportunity_id: opportunityId, ...fields }),
  });
  if (!response.ok) throw new Error('could not save application');
  const payload = await response.json();
  const index = state.applications.findIndex((application) => application.opportunity_id === opportunityId);
  if (index >= 0) state.applications[index] = { ...state.applications[index], ...payload.application };
  else state.applications.push(payload.application);
}

async function toggleSaved(opportunityId) {
  if (!requireLogin('Sign in to save opportunities.')) return;
  const isSaved = state.saved.includes(opportunityId);
  try {
    if (isSaved) {
      await fetch(`/api/saved/${encodeURIComponent(opportunityId)}`, { method: 'DELETE' });
      state.saved = state.saved.filter((id) => id !== opportunityId);
    } else {
      await fetch('/api/saved', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ opportunity_id: opportunityId }) });
      state.saved.push(opportunityId);
    }
    renderOverview();
    renderOpportunities();
    showToast(isSaved ? 'Removed from saved' : 'Opportunity saved');
  } catch (error) {
    showToast('Could not update saved opportunities');
  }
}

function navigate(viewName) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `${viewName}-view`));
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === viewName));
  const mobileNavSelect = $('#mobile-nav-select');
  if (mobileNavSelect) mobileNavSelect.value = viewName;
  const label = ({ overview: 'Overview', opportunities: 'Find opportunities', applications: 'Applications', practice: 'Practice studio', documents: 'Documents' })[viewName];
  $('#page-breadcrumb').textContent = label;
  if (viewName === 'opportunities') renderOpportunities();
  if (viewName === 'applications') renderApplications();
  if (viewName === 'documents') renderDocuments();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function daysUntilDeadline(dateStr) {
  const target = new Date(`${dateStr}T00:00:00Z`);
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target.getTime() - todayUtc) / 86400000);
}

function renderOverview() {
  $('#saved-opportunities-stat').textContent = state.saved.length;
  $('#in-progress-stat').textContent = state.applications.filter((application) => application.status === 'In progress').length;
  $('#closing-soon-stat').textContent = opportunityData.filter((item) => item.deadline && daysUntilDeadline(item.deadline) >= 0 && daysUntilDeadline(item.deadline) <= 14).length;
  $('#nav-application-count').textContent = state.applications.length;
  const timelineItems = state.applications.slice(0, 4).map((application) => {
    const opportunity = getOpportunity(application.opportunity_id);
    const statusClass = application.status === 'In progress' ? 'urgent' : application.status === 'To apply' ? 'soon' : 'open';
    return `<div class="timeline-item"><span class="timeline-date">${application.deadline || 'No deadline'}</span><span class="timeline-line"><span class="timeline-dot"></span><span class="timeline-connector"></span></span><div class="timeline-copy"><strong>${opportunity?.firm || application.company || application.opportunity_id}</strong><span>${application.next_action || 'Review requirements'}</span></div><span class="status-pill ${statusClass}">${application.status}</span></div>`;
  }).join('');
  $('#timeline-list').innerHTML = timelineItems || '<p class="empty-state">No applications tracked yet.</p>';
  $('#recommended-list').innerHTML = opportunityData.slice(0, 3).map((item) => `<article class="opportunity-mini"><div class="firm-line"><span class="firm-logo ${item.logoClass}">${item.logo}</span><div><strong>${item.firm}</strong><span>${item.sector}</span></div></div><h3>${item.role}</h3><span class="mini-meta">${item.location} · Closes ${item.deadline || 'not published'}</span></article>`).join('');
}

function renderOpportunities() {
  if (dataLoading) {
    $('#opportunity-grid').innerHTML = '<div class="empty-state">Checking official career pages…</div>';
    return;
  }
  const query = ($('#opportunity-search')?.value || '').toLowerCase();
  const sector = $('#sector-filter')?.value || 'all';
  const status = $('#status-filter')?.value || 'all';
  const filtered = opportunityData.filter((item) => {
    const textMatch = `${item.firm} ${item.sector} ${item.location} ${item.role}`.toLowerCase().includes(query);
    const sectorMatch = sector === 'all' || (item.sector || '').split(',').map((s) => s.trim()).includes(sector);
    const statusMatch = status === 'all' || item.status === status || (status === 'saved' && state.saved.includes(item.id));
    return textMatch && sectorMatch && statusMatch;
  });
  $('#opportunity-grid').innerHTML = filtered.length ? filtered.map((item) => {
    const saved = state.saved.includes(item.id);
    const statusLabel = item.status === 'open' ? 'Open now' : item.status === 'upcoming' ? 'Upcoming' : item.status === 'closed' ? 'Closed' : item.status === 'finished' ? 'Finished' : 'Status unknown';
    const cardFacts = [];
    if (Array.isArray(item.application_process) && item.application_process.length) {
      cardFacts.push(`<div class="fact" style="grid-column:1/-1"><label>Application process</label><span>${item.application_process.join(' → ')}</span></div>`);
    }
    if (Array.isArray(item.eligibility) && item.eligibility.length) {
      cardFacts.push(`<div class="fact" style="grid-column:1/-1"><label>Eligibility</label><span>${item.eligibility.join(' · ')}</span></div>`);
    }
    if (item.format) {
      cardFacts.push(`<div class="fact"><label>Format</label><span>${item.format}</span></div>`);
    }
    cardFacts.push(`<div class="fact"><label>Data status</label><span>${item.source}</span></div>`);
    cardFacts.push(`<div class="fact"><label>Application</label><span>${statusLabel}</span></div>`);
    const subline = item.location ? `${item.type} · ${item.location}` : item.type;
    return `<article class="opportunity-card"><div class="card-top"><div class="firm-line"><span class="firm-logo ${item.logoClass}">${item.logo}</span><div><strong>${item.firm}</strong><span>${item.sector}</span></div></div><button class="save-button ${saved ? 'saved' : ''}" data-save="${item.id}" aria-label="${saved ? 'Remove from saved' : 'Save'} ${item.firm}">${saved ? '♥' : '♡'}</button></div><h2>${item.role}</h2><span class="role">${subline}</span><div class="opportunity-facts">${cardFacts.join('')}</div><div class="card-bottom"><span class="deadline">Deadline: <strong>${item.deadline || 'Not published'}</strong></span><button class="small-button" data-apply="${item.id}">${state.applications.some((application) => application.opportunity_id === item.id) ? 'View application' : 'Track opportunity'}</button></div></article>`;
  }).join('') : '<div class="empty-state"><strong>No verified opportunities are available.</strong><p>Try Refresh data after checking that the local scraper server is running.</p></div>';
}

function renderApplications() {
  const columns = ['Saved', 'In progress', 'Submitted', 'To apply'];
  $('#application-board').innerHTML = columns.map((column) => {
    const applications = state.applications.filter((application) => application.status === column);
    return `<section class="board-column"><div class="board-column-header"><strong>${column}</strong><span>${applications.length}</span></div>${applications.map((application) => { const opportunity = getOpportunity(application.opportunity_id); return `<article class="board-card"><h3>${opportunity?.firm || application.company || application.opportunity_id}</h3><p>${opportunity?.role || application.programme || 'Application'}<br>${application.next_action || 'Review requirements and tailor materials'}</p><div class="board-card-footer"><span>${application.progress || 0}% ready</span><button class="move-button" data-cycle="${application.opportunity_id}">${column === 'Submitted' ? 'Review' : 'Move →'}</button></div></article>`; }).join('')}</section>`;
  }).join('');
}

function renderDocuments() {
  $('#document-count').textContent = `${state.documents.length} files`;
  $('#document-list').innerHTML = state.documents.length ? state.documents.map((document) => `<div class="document-row"><span class="document-icon">${document.doc_type}</span><div class="document-name"><strong>${document.name}</strong><span>${document.size_bytes ? `${Math.ceil(document.size_bytes / 1024)} KB` : ''} · Added ${new Date(document.created_at).toLocaleDateString()}</span></div><span class="document-status">${document.status || 'Stored'}</span><a class="document-menu" href="/api/documents/${document.id}/download" aria-label="Download document">↓</a><button class="document-menu" data-document-delete="${document.id}" aria-label="Delete document">✕</button></div>`).join('') : '<p class="empty-state">No documents yet. Add your CV or cover letter to get started.</p>';
}

function openModal(content) { $('#modal-content').innerHTML = content; $('#modal-backdrop').hidden = false; }
function closeModal() { $('#modal-backdrop').hidden = true; }
function openOpportunity(id) {
  const item = getOpportunity(id);
  if (!item) { showToast('This opportunity is not in the current live dataset'); return; }
  const tracked = state.applications.find((application) => application.opportunity_id === id);
  let tags = [];
  try { tags = JSON.parse(item.prep_tags || '[]'); } catch (error) { tags = []; }
  const modalFacts = [
    `<div class="fact"><label>Application status</label><span>${item.status} · ${item.confidence} confidence</span></div>`,
    `<div class="fact"><label>Application deadline</label><span>${item.deadline || 'Not published'}</span></div>`,
    `<div class="fact"><label>Programme dates</label><span>${item.programme_dates || 'Not published'}</span></div>`,
  ];
  if (Array.isArray(item.application_process) && item.application_process.length) {
    modalFacts.push(`<div class="fact"><label>Application process</label><span>${item.application_process.join(' → ')}</span></div>`);
  }
  if (Array.isArray(item.eligibility) && item.eligibility.length) {
    modalFacts.push(`<div class="fact"><label>Eligibility</label><span>${item.eligibility.join(' · ')}</span></div>`);
  }
  if (item.format) {
    modalFacts.push(`<div class="fact"><label>Format</label><span>${item.format}</span></div>`);
  }
  modalFacts.push(`<div class="fact"><label>Evidence</label><span>${item.evidence_excerpt || item.source}</span></div>`);
  modalFacts.push(`<div class="fact"><label>Suggested preparation</label><span>${tags.join(' · ') || 'General application preparation'}</span></div>`);
  openModal(`<span class="eyebrow">${item.sector.toUpperCase()} · ${String(item.source_type || 'unknown').toUpperCase()} SOURCE</span><h2>${item.firm}: ${item.role}</h2><p>${item.type} in ${item.location || 'Location not published'}.</p><div class="modal-form">${modalFacts.join('')}<a class="secondary-button" href="${item.url}" target="_blank" rel="noreferrer">Open official source ↗</a><button class="primary-button" id="modal-track">${tracked ? 'Open in applications' : 'Add to applications'} <span>→</span></button><button class="secondary-button" id="modal-workspace">Open application workspace</button><div class="fact" id="history-panel"><label>Status history</label><span>Loading history…</span></div></div>`);
  fetch(`/api/history?opportunity_id=${encodeURIComponent(item.id)}`).then((response) => response.json()).then((payload) => { const panel = $('#history-panel span'); if (panel) panel.textContent = payload.history?.length ? payload.history.map((entry) => `${entry.status} · ${new Date(entry.observed_at).toLocaleDateString()}`).join(' → ') : 'No previous status changes recorded'; }).catch(() => { const panel = $('#history-panel span'); if (panel) panel.textContent = 'History unavailable'; });
  $('#modal-track').addEventListener('click', () => { closeModal(); if (tracked) navigate('applications'); else trackApplication(id); });
  $('#modal-workspace').addEventListener('click', () => openWorkspace(item));
}

async function openWorkspace(item) {
  if (!requireLogin('Sign in to open your application workspace.')) return;
  try {
    const response = await fetch(`/api/workspace?opportunity_id=${encodeURIComponent(item.id)}`);
    const payload = await response.json();
    const workspace = payload.workspace;
    openModal(`<span class="eyebrow">APPLICATION WORKSPACE</span><h2>${item.firm}</h2><p>${item.role} · Your preparation stays attached to this opportunity.</p><div class="workspace-form"><div><label>Application status<select id="workspace-status"><option ${workspace.status === 'Saved' ? 'selected' : ''}>Saved</option><option ${workspace.status === 'Preparing' ? 'selected' : ''}>Preparing</option><option ${workspace.status === 'Ready to submit' ? 'selected' : ''}>Ready to submit</option><option ${workspace.status === 'Submitted' ? 'selected' : ''}>Submitted</option></select></label></div><div class="workspace-columns"><div><label>Eligibility checklist</label><div class="checklist">${workspace.eligibility.map((entry, index) => `<label><input type="checkbox" data-eligibility="${index}" ${entry.complete ? 'checked' : ''}>${entry.label}</label>`).join('')}</div></div><div><label>Required documents</label><div class="checklist">${workspace.required_documents.map((entry, index) => `<label><input type="checkbox" data-document-required="${index}" ${entry.complete ? 'checked' : ''}>${entry.label}</label>`).join('')}</div></div></div><label>CV version<select id="workspace-cv"><option value="">Choose a saved CV</option>${state.documents.filter((document) => /cv/i.test(document.name)).map((document) => `<option value="${document.id}" ${workspace.cv_document_id == document.id ? 'selected' : ''}>${document.name}</option>`).join('')}</select></label><label>Cover-letter version<select id="workspace-cover"><option value="">Choose a saved cover letter</option>${state.documents.filter((document) => /cover|letter/i.test(document.name)).map((document) => `<option value="${document.id}" ${workspace.cover_letter_document_id == document.id ? 'selected' : ''}>${document.name}</option>`).join('')}</select></label><label>Deadline reminder<input id="workspace-reminder" type="date" value="${workspace.reminder_date || ''}"></label><label class="check-row"><input id="workspace-reminder-enabled" type="checkbox" ${workspace.reminder_enabled ? 'checked' : ''}> Enable reminder on this device</label><label>Personal notes<textarea id="workspace-notes" placeholder="What do you want to remember about this application?">${workspace.notes || ''}</textarea></label><label>Evidence of submission<input id="workspace-evidence" placeholder="Paste confirmation link or reference" value="${workspace.submission_evidence || ''}"></label><div class="workspace-section"><label>Preparation plan</label><p class="workspace-list">${workspace.oa_plan.concat(workspace.interview_questions).map((entry) => `• ${entry}`).join('<br>')}</p></div><button class="primary-button" id="save-workspace">Save workspace <span>→</span></button></div>`);
    $('#save-workspace').addEventListener('click', async () => {
      workspace.status = $('#workspace-status').value;
      workspace.cv_document_id = $('#workspace-cv').value || null;
      workspace.cover_letter_document_id = $('#workspace-cover').value || null;
      workspace.reminder_date = $('#workspace-reminder').value || null;
      workspace.reminder_enabled = $('#workspace-reminder-enabled').checked;
      workspace.notes = $('#workspace-notes').value;
      workspace.submission_evidence = $('#workspace-evidence').value || null;
      workspace.eligibility = workspace.eligibility.map((entry, index) => ({ ...entry, complete: $(`[data-eligibility="${index}"]`).checked }));
      workspace.required_documents = workspace.required_documents.map((entry, index) => ({ ...entry, complete: $(`[data-document-required="${index}"]`).checked }));
      const saveResponse = await fetch('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(workspace) });
      if (!saveResponse.ok) { showToast('Workspace could not be saved'); return; }
      const applicationStatus = workspace.status === 'Preparing' ? 'In progress' : workspace.status === 'Submitted' ? 'Submitted' : workspace.status === 'Ready to submit' ? 'To apply' : 'Saved';
      const progress = workspace.status === 'Submitted' ? 100 : workspace.status === 'Preparing' ? 68 : workspace.status === 'Ready to submit' ? 85 : 25;
      try {
        await upsertApplication(item.id, { status: applicationStatus, progress, next_action: workspace.notes || null });
        renderOverview();
        renderApplications();
      } catch (error) { /* application tracking is best-effort here; workspace itself already saved */ }
      closeModal(); showToast('Application workspace saved');
    });
  } catch (error) { showToast('Application workspace is unavailable'); }
}

async function trackApplication(id) {
  if (!requireLogin('Sign in to track applications.')) return;
  if (!state.applications.some((application) => application.opportunity_id === id)) {
    try {
      await upsertApplication(id, { status: 'Saved', next_action: 'Review requirements and tailor materials', progress: 10 });
      renderOverview();
      renderOpportunities();
      showToast(`${getOpportunity(id)?.firm || 'Opportunity'} added to your applications`);
    } catch (error) {
      showToast('Could not track this application');
      return;
    }
  }
  navigate('applications');
}

async function cycleApplication(opportunityId) {
  const application = state.applications.find((item) => item.opportunity_id === opportunityId);
  if (!application) return;
  const order = ['Saved', 'In progress', 'Submitted'];
  const currentIndex = order.indexOf(application.status);
  const nextStatus = order[(currentIndex + 1) % order.length];
  const progress = nextStatus === 'Saved' ? 25 : nextStatus === 'In progress' ? 68 : 100;
  const nextAction = nextStatus === 'Submitted' ? 'Application submitted today' : nextStatus === 'In progress' ? 'Next action ready to complete' : 'Review requirements and tailor materials';
  try {
    await upsertApplication(opportunityId, { status: nextStatus, progress, next_action: nextAction });
    renderApplications();
    renderOverview();
    showToast(`${getOpportunity(opportunityId)?.firm || 'Application'} moved to ${nextStatus}`);
  } catch (error) {
    showToast('Could not update this application');
  }
}

function bindEvents() {
  $$('.nav-item').forEach((item) => item.addEventListener('click', () => navigate(item.dataset.view)));
  $$('[data-view-target]').forEach((item) => item.addEventListener('click', () => navigate(item.dataset.viewTarget)));
  $('#mobile-nav-select').addEventListener('change', (event) => navigate(event.target.value));
  $('#opportunity-search').addEventListener('input', renderOpportunities); $('#sector-filter').addEventListener('change', renderOpportunities); $('#status-filter').addEventListener('change', renderOpportunities);
  $('#refresh-button').addEventListener('click', async () => { $('#refresh-button').textContent = 'Checking…'; await loadOpportunities(true); $('#refresh-button').textContent = '✓ Up to date'; setTimeout(() => { $('#refresh-button').textContent = '↻ Refresh data'; }, 2200); });
  $('#help-button').addEventListener('click', () => openModal('<span class="eyebrow">QUICK HELP</span><h2>How Springr keeps you moving</h2><p>Use Find opportunities to build your shortlist, Applications to track the next action, and Documents to keep your materials ready.</p><button class="primary-button full-width" id="help-close">Got it</button>'));
  $('#profile-button').addEventListener('click', () => navigate('documents'));
  $('#logout-button').addEventListener('click', () => { window.location.href = '/auth/logout'; });
  $('#add-document-button').addEventListener('click', () => {
    if (!requireLogin('Sign in to store documents.')) return;
    openModal('<span class="eyebrow">DOCUMENT VAULT</span><h2>Add a document</h2><p>Files are uploaded and stored securely on your account (max 10MB).</p><form class="modal-form" id="document-form"><label>File<label class="upload-dropzone" id="upload-dropzone" for="document-file"><input id="document-file" name="file" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" required hidden /><span class="upload-icon">⇧</span><span class="upload-text" id="upload-text"><strong>Click to choose a file</strong><small>or drag it here · PDF, DOC, or DOCX</small></span></label></label><label>Document name<input name="name" placeholder="e.g. Consulting CV" required /></label><label>Type<select name="doc_type"><option>PDF</option><option>DOCX</option><option>DOC</option></select></label><button class="primary-button full-width">Add document <span>→</span></button></form>');
    const dropzone = $('#upload-dropzone');
    const fileInput = $('#document-file');
    const uploadText = $('#upload-text');
    const showFile = (file) => { uploadText.innerHTML = file ? `<strong>${file.name}</strong><small>${file.size ? `${Math.ceil(file.size / 1024)} KB` : ''} · Click to change</small>` : '<strong>Click to choose a file</strong><small>or drag it here · PDF, DOC, or DOCX</small>'; };
    fileInput.addEventListener('change', () => showFile(fileInput.files[0]));
    dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('drag-over');
      if (event.dataTransfer.files.length) { fileInput.files = event.dataTransfer.files; showFile(fileInput.files[0]); }
    });
  });
  document.addEventListener('click', (event) => {
    const save = event.target.closest('[data-save]'); if (save) toggleSaved(save.dataset.save);
    const apply = event.target.closest('[data-apply]'); if (apply) openOpportunity(apply.dataset.apply);
    const cycle = event.target.closest('[data-cycle]'); if (cycle) cycleApplication(cycle.dataset.cycle);
    const deleteDoc = event.target.closest('[data-document-delete]');
    if (deleteDoc) {
      const id = deleteDoc.dataset.documentDelete;
      fetch(`/api/documents/${id}`, { method: 'DELETE' }).then((response) => {
        if (!response.ok) throw new Error('delete failed');
        state.documents = state.documents.filter((document) => String(document.id) !== String(id));
        renderDocuments();
        showToast('Document deleted');
      }).catch(() => showToast('Could not delete this document'));
    }
  });
  $('#modal-close').addEventListener('click', closeModal); $('#modal-backdrop').addEventListener('click', (event) => { if (event.target.id === 'modal-backdrop') closeModal(); });
  document.addEventListener('submit', async (event) => {
    if (event.target.id === 'document-form') {
      event.preventDefault();
      const form = new FormData(event.target);
      try {
        const response = await fetch('/api/documents', { method: 'POST', body: form });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || 'save failed');
        }
        const payload = await response.json();
        state.documents.unshift(payload.document);
        closeModal(); renderDocuments(); showToast('Document uploaded');
      } catch (error) { showToast(error.message || 'This document could not be saved'); }
    }
  });
  document.addEventListener('click', (event) => { if (event.target.id === 'help-close') closeModal(); });
}

async function boot() {
  // Finding and browsing opportunities never requires an account -- only sign in
  // to load/show account-specific state (applications, saved, documents).
  const user = await loadSession();
  applyProfileToDom();
  if (user) await loadUserState();
  renderOverview(); renderOpportunities(); renderApplications(); renderDocuments(); bindEvents();
  loadOpportunities();
}

boot();
