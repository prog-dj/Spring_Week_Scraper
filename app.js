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

/* const opportunityData = [
  { id: 'gs', firm: 'Goldman Sachs', logo: 'GS', logoClass: '', sector: 'Investment Banking', role: 'Spring Week 2027', location: 'London', type: 'Insight programme', deadline: '12 Sep 2026', deadlineDate: '2026-09-12', rate: 'Not published', source: 'Official careers page', status: 'open', perks: 'Desk shadowing · Networking · Mentoring' },
  { id: 'barclays', firm: 'Barclays', logo: 'B', logoClass: 'blue', sector: 'Investment Banking', role: 'Spring Insight Programme', location: 'London', type: 'Paid programme', deadline: '04 Sep 2026', deadlineDate: '2026-09-04', rate: 'Not published', source: 'Official careers page', status: 'soon', perks: 'Paid placement · Skills workshops · Buddy scheme' },
  { id: 'jpm', firm: 'J.P. Morgan', logo: 'JPM', logoClass: 'green', sector: 'Asset Management', role: 'Women in Finance Insight', location: 'London', type: 'Insight programme', deadline: '20 Sep 2026', deadlineDate: '2026-09-20', rate: 'Not published', source: 'Official careers page', status: 'open', perks: 'Senior speakers · Case study · Community' },
  { id: 'mckinsey', firm: 'McKinsey & Company', logo: 'M', logoClass: 'coral', sector: 'Consulting', role: 'Freshman Insight Programme', location: 'London', type: 'Insight programme', deadline: '28 Aug 2026', deadlineDate: '2026-08-28', rate: 'Not published', source: 'Official careers page', status: 'soon', perks: 'Client project · Coaching · Alumni network' },
  { id: 'pwc', firm: 'PwC', logo: 'pwc', logoClass: 'yellow', sector: 'Consulting', role: 'Flying Start Degree', location: 'Multiple UK', type: 'Paid placement', deadline: 'Rolling', deadlineDate: '2026-12-31', rate: 'Not published', source: 'Official careers page', status: 'open', perks: 'Paid placement · Professional qualification' },
  { id: 'aos', firm: 'Allen & Overy Shearman', logo: 'A&O', logoClass: 'purple', sector: 'Law', role: 'Winter Internship', location: 'London', type: 'Insight programme', deadline: '05 Oct 2026', deadlineDate: '2026-10-05', rate: 'Not published', source: 'Official careers page', status: 'open', perks: 'Taster sessions · Trainee buddy · Socials' },
  { id: 'blackrock', firm: 'BlackRock', logo: 'BLK', logoClass: 'blue', sector: 'Asset Management', role: 'Spring Insight Week', location: 'London', type: 'Insight programme', deadline: '18 Sep 2026', deadlineDate: '2026-09-18', rate: 'Not published', source: 'Official careers page', status: 'open', perks: 'Investment roundtables · Mentoring · Networking' },
  { id: 'google', firm: 'Google', logo: 'G', logoClass: 'green', sector: 'Technology', role: 'STEP / Business Insight', location: 'London', type: 'Insight programme', deadline: 'Rolling', deadlineDate: '2026-12-31', rate: 'Not published', source: 'Official careers page', status: 'open', perks: 'Product deep dives · Speaker series · Community' }
]; */

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
  $('#closing-soon-stat').textContent = opportunityData.filter((item) => item.status === 'soon').length;
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
    const sectorMatch = sector === 'all' || item.sector === sector;
    const statusMatch = status === 'all' || item.status === status || (status === 'saved' && state.saved.includes(item.id));
    return textMatch && sectorMatch && statusMatch;
  });
  $('#opportunity-grid').innerHTML = filtered.length ? filtered.map((item) => {
    const saved = state.saved.includes(item.id);
    const statusLabel = item.status === 'soon' ? 'Closing soon' : item.status === 'open' ? 'Open now' : 'Status unknown';
    return `<article class="opportunity-card"><div class="card-top"><div class="firm-line"><span class="firm-logo ${item.logoClass}">${item.logo}</span><div><strong>${item.firm}</strong><span>${item.sector}</span></div></div><button class="save-button ${saved ? 'saved' : ''}" data-save="${item.id}" aria-label="${saved ? 'Remove from saved' : 'Save'} ${item.firm}">${saved ? '♥' : '♡'}</button></div><h2>${item.role}</h2><span class="role">${item.type} · ${item.location}</span><div class="opportunity-facts"><div class="fact"><label>Acceptance rate</label><span class="unknown">${item.rate || 'Not published'}</span></div><div class="fact"><label>Data status</label><span>${item.source}</span></div><div class="fact"><label>Future perks</label><span>${item.perks || 'Not stated on source page'}</span></div><div class="fact"><label>Application</label><span>${statusLabel}</span></div></div><div class="card-bottom"><span class="deadline">Deadline: <strong>${item.deadline || 'Not published'}</strong></span><button class="small-button" data-apply="${item.id}">${state.applications.some((application) => opportunityIdAliases[application.id] === item.id || application.id === item.id) ? 'View application' : 'Track opportunity'}</button></div></article>`;
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
  const tracked = state.applications.find((application) => application.id === id);
  openModal(`<span class="eyebrow">${item.sector.toUpperCase()}</span><h2>${item.firm}: ${item.role}</h2><p>${item.type} in ${item.location}. This record is based on the ${item.source.toLowerCase()}. Acceptance rate: <strong>${(item.rate || 'not published').toLowerCase()}</strong>. We will never infer a rate from unrelated data.</p><div class="modal-form"><div class="fact"><label>Future perks</label><span>${item.perks || 'Not stated on source page'}</span></div><div class="fact"><label>Application deadline</label><span>${item.deadline || 'Not published'}</span></div><a class="secondary-button" href="${item.url}" target="_blank" rel="noreferrer">Open official source ↗</a><button class="primary-button" id="modal-track">${tracked ? 'Open in applications' : 'Add to applications'} <span>→</span></button></div>`);
  $('#modal-track').addEventListener('click', () => { closeModal(); if (tracked) navigate('applications'); else trackApplication(id); });
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
  $('#add-document-button').addEventListener('click', () => openModal('<span class="eyebrow">DOCUMENT VAULT</span><h2>Add a document</h2><p>Keep a named placeholder for your CV, cover letter, transcript, or other application material.</p><form class="modal-form" id="document-form"><label>Document name<input name="name" placeholder="e.g. Consulting CV" required /></label><label>Type<select name="type"><option>PDF</option><option>DOCX</option><option>TXT</option></select></label><button class="primary-button">Add document <span>→</span></button></form>'));
  document.addEventListener('click', (event) => { const save = event.target.closest('[data-save]'); if (save) toggleSaved(save.dataset.save); const apply = event.target.closest('[data-apply]'); if (apply) openOpportunity(apply.dataset.apply); const cycle = event.target.closest('[data-cycle]'); if (cycle) cycleApplication(cycle.dataset.cycle); const doc = event.target.closest('[data-document]'); if (doc) showToast('Document actions are ready when file uploads are connected'); });
  $$('.practice-tab').forEach((tab) => tab.addEventListener('click', () => { $$('.practice-tab').forEach((item) => item.classList.remove('active')); tab.classList.add('active'); state.currentPractice = tab.dataset.practice; renderPractice(); }));
  $('#modal-close').addEventListener('click', closeModal); $('#modal-backdrop').addEventListener('click', (event) => { if (event.target.id === 'modal-backdrop') closeModal(); });
  document.addEventListener('submit', (event) => { if (event.target.id === 'document-form') { event.preventDefault(); const form = new FormData(event.target); state.documents.push({ id: `doc-${Date.now()}`, name: form.get('name'), type: form.get('type'), size: 'Local file', updated: 'Added just now', status: 'Ready' }); saveState(); closeModal(); renderDocuments(); showToast('Document added to your vault'); } if (event.target.id === 'profile-form') { event.preventDefault(); closeModal(); showToast('Profile updated'); } });
  document.addEventListener('click', (event) => { if (event.target.id === 'help-close') closeModal(); });
}

renderOverview(); renderOpportunities(); renderApplications(); renderPractice(); renderDocuments(); bindEvents(); loadOpportunities();
