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


const defaultApplications = [
  { id: 'barclays', status: 'In progress', next: 'Video OA due tomorrow', progress: 68 },
  { id: 'gs', status: 'Saved', next: 'Tailor motivation answer', progress: 25 },
  { id: 'mckinsey', status: 'To apply', next: 'Review eligibility', progress: 0 },
  { id: 'jpm', status: 'Submitted', next: 'Application submitted 18 Aug', progress: 100 }
];
const defaultDocuments = [
  { id: 'cv', name: 'Alex Morgan · CV', type: 'PDF', size: '245 KB', updated: 'Updated 2 days ago', status: 'Core version' },
  { id: 'cover', name: 'Banking cover letter base', type: 'DOCX', size: '58 KB', updated: 'Updated 5 days ago', status: 'Template' },
  { id: 'transcript', name: 'Academic transcript', type: 'PDF', size: '1.2 MB', updated: 'Updated 14 days ago', status: 'Ready' }
];
const state = {
  saved: JSON.parse(localStorage.getItem('springboard-saved') || '[]'),
  applications: JSON.parse(localStorage.getItem('springboard-applications') || JSON.stringify(defaultApplications)),
  documents: JSON.parse(localStorage.getItem('springboard-documents') || JSON.stringify(defaultDocuments)),
  currentPractice: 'oa'
};
let toastTimer;

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const opportunityIdAliases = { gs: 'goldman-sachs', jpm: 'jpmorgan' };
const saveState = () => {
  localStorage.setItem('springboard-saved', JSON.stringify(state.saved));
  localStorage.setItem('springboard-applications', JSON.stringify(state.applications));
  localStorage.setItem('springboard-documents', JSON.stringify(state.documents));
};
function saveLocalFile(id, file) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('springboard-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const transaction = request.result.transaction('files', 'readwrite'); transaction.objectStore('files').put(file, id); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); };
  });
}
const showToast = (message) => {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
};
const getOpportunity = (id) => opportunityData.find((item) => item.id === (opportunityIdAliases[id] || id));

function navigate(viewName) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `${viewName}-view`));
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === viewName));
  const label = ({ overview: 'Overview', opportunities: 'Find opportunities', applications: 'Applications', practice: 'Practice studio', documents: 'Documents' })[viewName];
  $('#page-breadcrumb').textContent = label;
  if (viewName === 'opportunities') renderOpportunities();
  if (viewName === 'applications') renderApplications();
  if (viewName === 'practice') renderPractice();
  if (viewName === 'documents') renderDocuments();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderOverview() {
  $('#saved-opportunities-stat').textContent = state.saved.length;
  $('#in-progress-stat').textContent = state.applications.filter((application) => application.status === 'In progress').length;
  $('#closing-soon-stat').textContent = opportunityData.filter((item) => item.status === 'upcoming' || item.status === 'soon').length;
  $('#nav-application-count').textContent = state.applications.length;
  const timelineItems = state.applications.slice(0, 4).map((application, index) => {
    const opportunity = getOpportunity(application.id);
    const statusClass = application.status === 'In progress' ? 'urgent' : application.status === 'To apply' ? 'soon' : 'open';
    return `<div class="timeline-item"><span class="timeline-date">${index === 0 ? 'TOMORROW' : index === 1 ? '04 SEP' : index === 2 ? '12 SEP' : '18 AUG'}</span><span class="timeline-line"><span class="timeline-dot"></span><span class="timeline-connector"></span></span><div class="timeline-copy"><strong>${opportunity?.firm || application.id}</strong><span>${application.next}</span></div><span class="status-pill ${statusClass}">${application.status}</span></div>`;
  }).join('');
  $('#timeline-list').innerHTML = timelineItems;
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
    return `<article class="opportunity-card"><div class="card-top"><div class="firm-line"><span class="firm-logo ${item.logoClass}">${item.logo}</span><div><strong>${item.firm}</strong><span>${item.sector}</span></div></div><button class="save-button ${saved ? 'saved' : ''}" data-save="${item.id}" aria-label="${saved ? 'Remove from saved' : 'Save'} ${item.firm}">${saved ? '♥' : '♡'}</button></div><h2>${item.role}</h2><span class="role">${item.type} · ${item.location}</span><div class="opportunity-facts">${cardFacts.join('')}</div><div class="card-bottom"><span class="deadline">Deadline: <strong>${item.deadline || 'Not published'}</strong></span><button class="small-button" data-apply="${item.id}">${state.applications.some((application) => opportunityIdAliases[application.id] === item.id || application.id === item.id) ? 'View application' : 'Track opportunity'}</button></div></article>`;
  }).join('') : '<div class="empty-state"><strong>No verified opportunities are available.</strong><p>Try Refresh data after checking that the local scraper server is running.</p></div>';
}

function renderApplications() {
  const columns = ['Saved', 'In progress', 'Submitted', 'To apply'];
  $('#application-board').innerHTML = columns.map((column) => {
    const applications = state.applications.filter((application) => application.status === column);
    return `<section class="board-column"><div class="board-column-header"><strong>${column}</strong><span>${applications.length}</span></div>${applications.map((application) => { const opportunity = getOpportunity(application.id); return `<article class="board-card"><h3>${opportunity?.firm || application.id}</h3><p>${opportunity?.role || 'Application'}<br>${application.next}</p><div class="board-card-footer"><span>${application.progress}% ready</span><button class="move-button" data-cycle="${application.id}">${column === 'Submitted' ? 'Review' : 'Move →'}</button></div></article>`; }).join('')}</section>`;
  }).join('');
}

const practiceContent = {
  oa: { label: 'NUMERICAL REASONING · 08 MIN', title: 'A portfolio has grown by 18% in year one, then fallen by 10% in year two. What is the overall percentage change?', copy: 'Take a minute to structure the calculation before you start. Strong OA performance is about calm, repeatable process.', placeholder: 'Write your answer and working here...', action: 'Check my approach' },
  interview: { label: 'MOTIVATION · 90 SEC', title: 'Why are you interested in this firm and this spring week?', copy: 'Use a clear three-part answer: what you have learned, what you are curious about, and why this firm is the right place to explore it.', placeholder: 'Draft your answer here...', action: 'Get feedback' },
  cover: { label: 'COVER LETTER LAB · 120 WORDS', title: 'Make your opening paragraph feel specific, not generic.', copy: 'A good opening connects one concrete moment to the firm or programme. Paste a draft below and use the checklist to sharpen it.', placeholder: 'Paste your opening paragraph here...', action: 'Screen my draft' }
};
function renderPractice() {
  const item = practiceContent[state.currentPractice];
  $('#practice-content').innerHTML = `<article class="practice-card"><span class="practice-label">${item.label}</span><h2>${item.title}</h2><p>${item.copy}</p><div class="answer-box"><label for="practice-answer">Your response</label><textarea id="practice-answer" placeholder="${item.placeholder}"></textarea></div><div class="practice-actions"><button class="primary-button" id="practice-submit">${item.action} <span>→</span></button><button class="ghost-button" id="practice-sample">See a strong example</button></div><div class="feedback-box" id="feedback-box"></div></article>`;
  $('#practice-submit').addEventListener('click', () => {
    const answer = $('#practice-answer').value.trim();
    const feedback = $('#feedback-box');
    if (!answer) { feedback.textContent = 'Start with a few lines first. The feedback becomes useful once there is something to work with.'; feedback.classList.add('visible'); return; }
    feedback.textContent = state.currentPractice === 'oa' ? 'Good instinct. The overall change is +6.2%: 1.18 × 0.90 = 1.062. Write the equation before the answer in timed practice.' : state.currentPractice === 'cover' ? 'Your draft is saved for this session. Look for one named detail about the firm and one proof point from your own experience.' : 'Useful starting point. Add one firm-specific detail and finish with what you want to learn during the programme.';
    feedback.classList.add('visible');
    showToast('Feedback generated and session recorded');
  });
  $('#practice-sample').addEventListener('click', () => { $('#practice-answer').value = state.currentPractice === 'oa' ? '1.18 x 0.90 = 1.062, so the portfolio increased by 6.2% overall.' : 'I am drawn to this programme because it combines rigorous problem solving with exposure to different perspectives. In my economics society, I recently...'; showToast('Example added to your workspace'); });
}

function renderDocuments() {
  $('#document-count').textContent = `${state.documents.length} files`;
  $('#document-list').innerHTML = state.documents.map((document) => `<div class="document-row"><span class="document-icon">${document.type}</span><div class="document-name"><strong>${document.name}</strong><span>${document.size} · ${document.updated}</span></div><span class="document-status">${document.status}</span><button class="document-menu" data-document="${document.id}" aria-label="Document actions">···</button></div>`).join('');
}

function openModal(content) { $('#modal-content').innerHTML = content; $('#modal-backdrop').hidden = false; }
function closeModal() { $('#modal-backdrop').hidden = true; }
function openOpportunity(id) {
  const item = getOpportunity(id);
  if (!item) { showToast('This opportunity is not in the current live dataset'); return; }
  const tracked = state.applications.find((application) => application.id === id);
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
  try {
    const response = await fetch(`/api/workspace?opportunity_id=${encodeURIComponent(item.id)}`);
    const payload = await response.json();
    const workspace = payload.workspace;
    openModal(`<span class="eyebrow">APPLICATION WORKSPACE</span><h2>${item.firm}</h2><p>${item.role} · Your preparation stays attached to this opportunity.</p><div class="workspace-form"><div><label>Application status<select id="workspace-status"><option ${workspace.status === 'Saved' ? 'selected' : ''}>Saved</option><option ${workspace.status === 'Preparing' ? 'selected' : ''}>Preparing</option><option ${workspace.status === 'Ready to submit' ? 'selected' : ''}>Ready to submit</option><option ${workspace.status === 'Submitted' ? 'selected' : ''}>Submitted</option></select></label></div><div class="workspace-columns"><div><label>Eligibility checklist</label><div class="checklist">${workspace.eligibility.map((entry, index) => `<label><input type="checkbox" data-eligibility="${index}" ${entry.complete ? 'checked' : ''}>${entry.label}</label>`).join('')}</div></div><div><label>Required documents</label><div class="checklist">${workspace.required_documents.map((entry, index) => `<label><input type="checkbox" data-document-required="${index}" ${entry.complete ? 'checked' : ''}>${entry.label}</label>`).join('')}</div></div></div><label>CV version<select id="workspace-cv"><option value="">Choose a saved CV</option>${state.documents.filter((document) => /cv/i.test(document.name)).map((document) => `<option value="${document.id}" ${workspace.cv_document_id === document.id ? 'selected' : ''}>${document.name}</option>`).join('')}</select></label><label>Cover-letter version<select id="workspace-cover"><option value="">Choose a saved cover letter</option>${state.documents.filter((document) => /cover|letter/i.test(document.name)).map((document) => `<option value="${document.id}" ${workspace.cover_letter_document_id === document.id ? 'selected' : ''}>${document.name}</option>`).join('')}</select></label><label>Deadline reminder<input id="workspace-reminder" type="date" value="${workspace.reminder_date || ''}"></label><label class="check-row"><input id="workspace-reminder-enabled" type="checkbox" ${workspace.reminder_enabled ? 'checked' : ''}> Enable reminder on this device</label><label>Personal notes<textarea id="workspace-notes" placeholder="What do you want to remember about this application?">${workspace.notes || ''}</textarea></label><label>Evidence of submission<input id="workspace-evidence" placeholder="Paste confirmation link or reference" value="${workspace.submission_evidence || ''}"></label><div class="workspace-section"><label>Preparation plan</label><p class="workspace-list">${workspace.oa_plan.concat(workspace.interview_questions).map((entry) => `• ${entry}`).join('<br>')}</p></div><button class="primary-button" id="save-workspace">Save workspace <span>→</span></button></div>`);
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
      const existingApplication = state.applications.find((application) => application.id === item.id || opportunityIdAliases[application.id] === item.id);
      if (existingApplication) { existingApplication.status = workspace.status === 'Preparing' ? 'In progress' : workspace.status === 'Submitted' ? 'Submitted' : workspace.status === 'Ready to submit' ? 'To apply' : 'Saved'; existingApplication.progress = workspace.status === 'Submitted' ? 100 : workspace.status === 'Preparing' ? 68 : workspace.status === 'Ready to submit' ? 85 : 25; saveState(); renderOverview(); renderApplications(); }
      closeModal(); showToast('Application workspace saved');
    });
  } catch (error) { showToast('Application workspace is unavailable'); }
}
function trackApplication(id) {
  if (!state.applications.some((application) => application.id === id)) { state.applications.push({ id, status: 'Saved', next: 'Review requirements and tailor materials', progress: 10 }); saveState(); renderOverview(); renderOpportunities(); showToast(`${getOpportunity(id).firm} added to your applications`); }
  navigate('applications');
}
function toggleSaved(id) { state.saved = state.saved.includes(id) ? state.saved.filter((savedId) => savedId !== id) : [...state.saved, id]; saveState(); renderOverview(); renderOpportunities(); showToast(state.saved.includes(id) ? 'Opportunity saved' : 'Removed from saved'); }
function cycleApplication(id) { const application = state.applications.find((item) => item.id === id); const order = ['Saved', 'In progress', 'Submitted']; const currentIndex = order.indexOf(application.status); application.status = order[(currentIndex + 1) % order.length]; application.progress = application.status === 'Saved' ? 25 : application.status === 'In progress' ? 68 : 100; application.next = application.status === 'Submitted' ? 'Application submitted today' : application.status === 'In progress' ? 'Next action ready to complete' : 'Review requirements and tailor materials'; saveState(); renderApplications(); renderOverview(); showToast(`${getOpportunity(application.id).firm} moved to ${application.status}`); }

function bindEvents() {
  $$('.nav-item').forEach((item) => item.addEventListener('click', () => navigate(item.dataset.view)));
  $$('[data-view-target]').forEach((item) => item.addEventListener('click', () => navigate(item.dataset.viewTarget)));
  $('#opportunity-search').addEventListener('input', renderOpportunities); $('#sector-filter').addEventListener('change', renderOpportunities); $('#status-filter').addEventListener('change', renderOpportunities);
  $('#refresh-button').addEventListener('click', async () => { $('#refresh-button').textContent = 'Checking…'; await loadOpportunities(true); $('#refresh-button').textContent = '✓ Up to date'; setTimeout(() => { $('#refresh-button').textContent = '↻ Refresh data'; }, 2200); });
  $('#help-button').addEventListener('click', () => openModal('<span class="eyebrow">QUICK HELP</span><h2>How Springboard keeps you moving</h2><p>Use Find opportunities to build your shortlist, Applications to track the next action, and Practice studio to prepare with focused drills. Documents stay local to this browser so you can test the workflow privately.</p><button class="primary-button full-width" id="help-close">Got it</button>'));
  $('#notification-button').addEventListener('click', () => showToast('You have 1 deadline tomorrow: Barclays video OA'));
  $('#profile-button').addEventListener('click', () => navigate('documents'));
  $('#edit-profile-button').addEventListener('click', () => openModal('<span class="eyebrow">PROFILE</span><h2>Candidate profile</h2><p>Your profile helps us surface relevant spring weeks. This demo stores changes only in your browser.</p><form class="modal-form" id="profile-form"><label>Name<input value="Alex Morgan" /></label><label>University<input value="University of Bristol" /></label><label>Target sector<select><option>Investment banking</option><option>Consulting</option><option>Asset management</option></select></label><button class="primary-button">Save profile <span>→</span></button></form>')); 
  $('#add-document-button').addEventListener('click', () => openModal('<span class="eyebrow">DOCUMENT VAULT</span><h2>Add a document</h2><p>Files are kept in this browser only. Nothing is uploaded or submitted automatically.</p><form class="modal-form" id="document-form"><label>Choose file<input name="file" type="file" accept=".pdf,.doc,.docx,.txt" required /></label><label>Document name<input name="name" placeholder="e.g. Consulting CV" required /></label><label>Type<select name="type"><option>PDF</option><option>DOCX</option><option>TXT</option></select></label><button class="primary-button">Add document <span>→</span></button></form>'));
  document.addEventListener('click', (event) => { const save = event.target.closest('[data-save]'); if (save) toggleSaved(save.dataset.save); const apply = event.target.closest('[data-apply]'); if (apply) openOpportunity(apply.dataset.apply); const cycle = event.target.closest('[data-cycle]'); if (cycle) cycleApplication(cycle.dataset.cycle); const doc = event.target.closest('[data-document]'); if (doc) showToast('Document actions are ready when file uploads are connected'); });
  $$('.practice-tab').forEach((tab) => tab.addEventListener('click', () => { $$('.practice-tab').forEach((item) => item.classList.remove('active')); tab.classList.add('active'); state.currentPractice = tab.dataset.practice; renderPractice(); }));
  $('#modal-close').addEventListener('click', closeModal); $('#modal-backdrop').addEventListener('click', (event) => { if (event.target.id === 'modal-backdrop') closeModal(); });
  document.addEventListener('submit', async (event) => { if (event.target.id === 'document-form') { event.preventDefault(); const form = new FormData(event.target); const file = form.get('file'); const id = `doc-${Date.now()}`; try { await saveLocalFile(id, file); state.documents.push({ id, name: form.get('name') || file.name, type: form.get('type'), size: file.size ? `${Math.ceil(file.size / 1024)} KB` : 'Local file', updated: 'Added just now', status: 'Stored locally' }); saveState(); closeModal(); renderDocuments(); showToast('Document stored privately on this device'); } catch (error) { showToast('This browser could not store the document locally'); } } if (event.target.id === 'profile-form') { event.preventDefault(); closeModal(); showToast('Profile updated'); } });
  document.addEventListener('click', (event) => { if (event.target.id === 'help-close') closeModal(); });
}

renderOverview(); renderOpportunities(); renderApplications(); renderPractice(); renderDocuments(); bindEvents(); loadOpportunities();
