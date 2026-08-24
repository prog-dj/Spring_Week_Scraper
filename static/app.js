let opportunityData = [];
let dataCheckedAt = null;
let dataLoading = true;
let opportunitiesAuthenticated = true;
let opportunitiesTotalCount = 0;
/* The opportunity list is loaded from the API. No fallback records are fabricated here.
   Signed-out visitors only get a preview slice server-side -- see the "authenticated"/
   "totalCount" fields, used to render the locked/blurred remainder. */
async function loadOpportunities() {
  dataLoading = true;
  renderOpportunities();
  try {
    const response = await fetch('/api/opportunities');
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const payload = await response.json();
    opportunityData = payload.opportunities || [];
    dataCheckedAt = payload.checkedAt || null;
    opportunitiesAuthenticated = payload.authenticated !== false;
    opportunitiesTotalCount = payload.totalCount ?? opportunityData.length;
    $('#source-note').innerHTML = `<span>✓</span> Sources checked ${formatCheckedAt(dataCheckedAt)} · Official-page results only. Unknown fields stay unknown.`;
  } catch (error) {
    opportunityData = [];
    $('#source-note').innerHTML = `<span>!</span> Live source check failed. Please try again shortly.`;
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
  const adminUsersStat = $('#admin-users-stat');
  if (adminUsersStat) adminUsersStat.hidden = !user?.isAdmin;

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
  const applicationsTabToggle = $('#applications-tab-toggle');
  if (applicationsTabToggle) applicationsTabToggle.hidden = !user;
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

async function loadAdminStats() {
  try {
    const response = await fetch('/api/admin/stats');
    if (!response.ok) return;
    const stats = await response.json();
    $('#total-users-stat').textContent = stats.userCount ?? 0;
    $('#admin-stat-meta').textContent = `${stats.opportunityCount ?? 0} opportunities · ${stats.applicationCount ?? 0} applications · ${stats.documentCount ?? 0} documents`;
  } catch (error) { /* admin-only widget -- fail silently, not worth a toast */ }
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

const VALID_VIEWS = ['overview', 'opportunities', 'applications', 'practice', 'documents'];

function navigate(viewName, { scroll = true } = {}) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `${viewName}-view`));
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === viewName));
  const mobileNavSelect = $('#mobile-nav-select');
  if (mobileNavSelect) mobileNavSelect.value = viewName;
  const label = ({ overview: 'Overview', opportunities: 'Find opportunities', applications: 'Applications', practice: 'Practice studio', documents: 'Documents' })[viewName];
  $('#page-breadcrumb').textContent = label;
  if (viewName === 'opportunities') renderOpportunities();
  if (viewName === 'applications') renderApplications();
  if (viewName === 'documents') renderDocuments();
  // Persist the current tab in the URL hash so a refresh (or a shared link)
  // lands back on the same view instead of always resetting to Overview.
  // replaceState avoids piling up back-button history entries for every click.
  history.replaceState(null, '', viewName === 'overview' ? window.location.pathname : `#${viewName}`);
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Mirrors worker/src/db/applications.ts VALID_STATUSES -- keep in sync.
const ALL_APPLICATION_STATUSES = ['Saved', 'Applied', 'Online Assessment', 'Interview', 'Offer', 'Rejected', 'No Response', 'Withdrawn'];
const ACTIVE_APPLICATION_STATUSES = ['Applied', 'Online Assessment', 'Interview'];
function statusPillClass(status) {
  if (status === 'Offer') return 'open';
  if (status === 'Online Assessment' || status === 'Interview') return 'soon';
  if (status === 'Rejected' || status === 'No Response' || status === 'Withdrawn') return 'urgent';
  return 'neutral';
}

function daysUntilDeadline(dateStr) {
  const target = new Date(`${dateStr}T00:00:00Z`);
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target.getTime() - todayUtc) / 86400000);
}

function renderOverview() {
  $('#saved-opportunities-stat').textContent = state.saved.length;
  $('#in-progress-stat').textContent = state.applications.filter((application) => ACTIVE_APPLICATION_STATUSES.includes(application.status)).length;
  $('#closing-soon-stat').textContent = opportunityData.filter((item) => item.deadline && daysUntilDeadline(item.deadline) >= 0 && daysUntilDeadline(item.deadline) <= 14).length;
  $('#nav-application-count').textContent = state.applications.length;
  const timelineItems = state.applications.slice(0, 4).map((application) => {
    const opportunity = getOpportunity(application.opportunity_id);
    return `<div class="timeline-item"><span class="timeline-date">${application.deadline || 'No deadline'}</span><span class="timeline-line"><span class="timeline-dot"></span><span class="timeline-connector"></span></span><div class="timeline-copy"><strong>${opportunity?.firm || application.company || application.opportunity_id}</strong><span>${application.next_action || 'Review requirements'}</span></div><span class="status-pill ${statusPillClass(application.status)}">${application.status}</span></div>`;
  }).join('');
  $('#timeline-list').innerHTML = timelineItems || '<p class="empty-state">No applications tracked yet.</p>';
  $('#recommended-list').innerHTML = opportunityData.slice(0, 3).map((item) => `<article class="opportunity-mini"><div class="firm-line"><span class="firm-logo ${item.logoClass}">${item.logo}</span><div><strong>${item.firm}</strong><span>${item.sector}</span></div></div><h3>${item.role}</h3><span class="mini-meta">${item.location} · Closes ${item.deadline || 'not published'}</span></article>`).join('');
}

let opportunityViewMode = 'cards';
try { opportunityViewMode = localStorage.getItem('springr_opportunity_view') || 'cards'; } catch (error) { /* private mode etc -- default to cards */ }

function setOpportunityViewMode(mode) {
  opportunityViewMode = mode;
  try { localStorage.setItem('springr_opportunity_view', mode); } catch (error) { /* nothing we can do if storage is blocked */ }
  $$('[data-opportunity-view]').forEach((button) => button.classList.toggle('active', button.dataset.opportunityView === mode));
  renderOpportunities();
}

function opportunityStatusLabel(item) {
  return item.status === 'open' ? 'Open now' : item.status === 'upcoming' ? 'Upcoming' : item.status === 'closed' ? 'Closed' : item.status === 'finished' ? 'Finished' : 'Status unknown';
}

function renderOpportunities() {
  $$('[data-opportunity-view]').forEach((button) => button.classList.toggle('active', button.dataset.opportunityView === opportunityViewMode));
  $('#opportunity-grid').hidden = opportunityViewMode !== 'cards';
  $('#opportunity-table-wrap').hidden = opportunityViewMode !== 'table';

  if (dataLoading) {
    $('#opportunity-grid').innerHTML = '<div class="empty-state">Checking official career pages…</div>';
    $('#opportunity-table-body').innerHTML = '';
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
  const lockedRemainder = opportunitiesAuthenticated ? 0 : Math.max(0, opportunitiesTotalCount - opportunityData.length);

  if (opportunityViewMode === 'table') {
    renderOpportunityTable(filtered, lockedRemainder);
  } else {
    renderOpportunityCards(filtered, lockedRemainder);
  }
}

function renderOpportunityCards(filtered, lockedRemainder) {
  const lockedHtml = lockedRemainder ? renderLockedOpportunityCards(lockedRemainder) : '';
  $('#opportunity-grid').innerHTML = (filtered.length ? filtered.map((item) => {
    const saved = state.saved.includes(item.id);
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
    cardFacts.push(`<div class="fact"><label>Application</label><span>${opportunityStatusLabel(item)}</span></div>`);
    const subline = item.location ? `${item.type} · ${item.location}` : item.type;
    return `<article class="opportunity-card"><div class="card-top"><div class="firm-line"><span class="firm-logo ${item.logoClass}">${item.logo}</span><div><strong>${item.firm}</strong><span>${item.sector}</span></div></div><button class="save-button ${saved ? 'saved' : ''}" data-save="${item.id}" aria-label="${saved ? 'Remove from saved' : 'Save'} ${item.firm}">${saved ? '♥' : '♡'}</button></div><h2>${item.role}</h2><span class="role">${subline}</span><div class="opportunity-facts">${cardFacts.join('')}</div><div class="card-bottom"><span class="deadline">Deadline: <strong>${item.deadline || 'Not published'}</strong></span><button class="small-button" data-apply="${item.id}">${state.applications.some((application) => application.opportunity_id === item.id) ? 'View application' : 'Track opportunity'}</button></div></article>`;
  }).join('') : '<div class="empty-state"><strong>No verified opportunities are available.</strong><p>Try Refresh data after checking that the local scraper server is running.</p></div>') + lockedHtml;
}

function renderOpportunityTable(filtered, lockedRemainder) {
  const rows = filtered.length ? filtered.map((item) => {
    const saved = state.saved.includes(item.id);
    return `<tr><td><span class="firm-logo ${item.logoClass}">${item.logo}</span>${item.firm}</td><td>${item.role}</td><td>${item.sector || '—'}</td><td>${item.location || '—'}</td><td>${item.deadline || 'Not published'}</td><td><span class="status-pill ${item.status === 'open' ? 'open' : item.status === 'upcoming' ? 'soon' : 'neutral'}">${opportunityStatusLabel(item)}</span></td><td><div class="row-actions"><button class="save-button ${saved ? 'saved' : ''}" data-save="${item.id}" aria-label="${saved ? 'Remove from saved' : 'Save'} ${item.firm}">${saved ? '♥' : '♡'}</button><button class="small-button" data-apply="${item.id}">${state.applications.some((application) => application.opportunity_id === item.id) ? 'View' : 'Track'}</button></div></td></tr>`;
  }).join('') : '<tr><td colspan="7"><div class="empty-state"><strong>No verified opportunities are available.</strong><p>Try Refresh data after checking that the local scraper server is running.</p></div></td></tr>';
  const lockedRows = lockedRemainder ? renderLockedOpportunityRows(lockedRemainder) : '';
  $('#opportunity-table-body').innerHTML = rows + lockedRows;
}

function renderLockedOpportunityCards(count) {
  const placeholders = Array.from({ length: Math.min(count, 6) }, () => `<article class="opportunity-card locked" aria-hidden="true"><div class="card-top"><div class="firm-line"><span class="firm-logo">••</span><div><strong>Firm name</strong><span>Sector</span></div></div></div><h2>Programme name</h2><span class="role">Location</span><div class="opportunity-facts"><div class="fact"><label>Deadline</label><span>••• •••</span></div><div class="fact"><label>Application</label><span>••••••</span></div></div></article>`).join('');
  return placeholders + opportunityLockBanner();
}

function renderLockedOpportunityRows(count) {
  const placeholders = Array.from({ length: Math.min(count, 6) }, () => `<tr class="locked" aria-hidden="true"><td><span class="firm-logo">••</span>Firm name</td><td>Programme name</td><td>Sector</td><td>Location</td><td>••• •••</td><td>••••••</td><td></td></tr>`).join('');
  return `${placeholders}<tr><td colspan="7">${opportunityLockBanner()}</td></tr>`;
}

function opportunityLockBanner() {
  return `<div class="opportunity-lock-banner"><h3>Sign in to see all ${opportunitiesTotalCount} opportunities</h3><p>Free with Google sign-in -- no card, no catch.</p><a class="primary-button" href="/auth/login">Sign in with Google <span>→</span></a></div>`;
}

function renderApplications() {
  $('#application-board').innerHTML = ALL_APPLICATION_STATUSES.map((column) => {
    const applications = state.applications.filter((application) => application.status === column);
    return `<section class="board-column"><div class="board-column-header"><strong>${column}</strong><span>${applications.length}</span></div>${applications.map((application) => {
      const opportunity = getOpportunity(application.opportunity_id);
      const options = ALL_APPLICATION_STATUSES.map((s) => `<option value="${s}" ${s === application.status ? 'selected' : ''}>${s}</option>`).join('');
      return `<article class="board-card"><h3>${opportunity?.firm || application.company || application.opportunity_id}</h3><p>${opportunity?.role || application.programme || 'Application'}<br>${application.next_action || 'Review requirements and tailor materials'}</p><div class="board-card-footer"><span>${application.progress || 0}% ready</span><select class="status-select" data-status-select="${application.opportunity_id}">${options}</select></div></article>`;
    }).join('')}</section>`;
  }).join('');
}

// --- Application outcomes (Sankey) ------------------------------------------
let applicationsTab = 'board';

function setApplicationsTab(tab) {
  applicationsTab = tab;
  $$('[data-applications-tab]').forEach((button) => button.classList.toggle('active', button.dataset.applicationsTab === tab));
  $('#application-board').hidden = tab !== 'board';
  $('#outcomes-panel').hidden = tab !== 'outcomes';
  if (tab === 'outcomes') loadAndRenderOutcomes();
}

async function loadAndRenderOutcomes() {
  $('#outcomes-summary').textContent = 'Loading…';
  $('#sankey-wrap').innerHTML = '';
  try {
    const response = await fetch('/api/applications/outcomes');
    if (!response.ok) throw new Error('failed to load outcomes');
    renderOutcomes(await response.json());
  } catch (error) {
    $('#outcomes-summary').textContent = 'Could not load your application outcomes.';
  }
}

function sankeyStatusColor(status) {
  if (status === 'Offer') return 'var(--green)';
  if (status === 'Online Assessment' || status === 'Interview') return 'var(--amber)';
  if (status === 'Rejected' || status === 'No Response' || status === 'Withdrawn') return 'var(--red)';
  return 'var(--accent)';
}

function renderOutcomes(data) {
  if (!data.totalApplications) {
    $('#outcomes-summary').textContent = 'No applications tracked yet -- track one from Find opportunities to see your outcomes here.';
    $('#sankey-wrap').innerHTML = '';
    return;
  }
  const offerCount = data.byStatus.find((s) => s.status === 'Offer')?.count || 0;
  $('#outcomes-summary').innerHTML = `<strong>${data.totalApplications}</strong> application${data.totalApplications === 1 ? '' : 's'} tracked · <strong>${offerCount}</strong> offer${offerCount === 1 ? '' : 's'}`;

  const rootNode = { id: 'root', label: 'Applications', value: data.totalApplications, color: 'var(--ink-secondary)' };
  const statusNodes = data.byStatus.map((s) => ({ id: `status:${s.status}`, label: s.status, value: s.count, color: sankeyStatusColor(s.status) }));
  const levels = [[rootNode], statusNodes];
  const links = data.byStatus.map((s) => ({ source: 'root', target: `status:${s.status}`, value: s.count, color: sankeyStatusColor(s.status) }));

  if (data.offersByCompany.length) {
    const companyNodes = data.offersByCompany.map((o) => ({ id: `company:${o.company}`, label: o.company, value: o.count, color: 'var(--green)' }));
    levels.push(companyNodes);
    data.offersByCompany.forEach((o) => links.push({ source: 'status:Offer', target: `company:${o.company}`, value: o.count, color: 'var(--green)' }));
  }

  renderSankey($('#sankey-wrap'), levels, links);
}

// A small hand-rolled Sankey renderer (no charting library -- keeps the app
// dependency-free and CSP-simple). `levels` is an array of node arrays, one
// per column; `links` connect node ids across adjacent columns.
function renderSankey(container, levels, links) {
  const nodeWidth = 14;
  const columnGap = 170;
  const leftPad = 20;
  const rightPad = 170;
  const gap = 10;
  const minHeight = 20;
  const columnHeight = Math.max(260, ...levels.map((lvl) => lvl.length * (minHeight + gap)));
  const totalWidth = leftPad + levels.length * nodeWidth + (levels.length - 1) * columnGap + rightPad;

  const nodeById = {};
  levels.forEach((levelNodes, levelIndex) => {
    const totalValue = levelNodes.reduce((sum, n) => sum + n.value, 0) || 1;
    const availableHeight = columnHeight - gap * Math.max(0, levelNodes.length - 1);
    const heights = levelNodes.map((n) => Math.max(minHeight, (n.value / totalValue) * availableHeight));
    const totalHeight = heights.reduce((sum, h) => sum + h, 0) + gap * Math.max(0, levelNodes.length - 1);
    let cursor = totalHeight > columnHeight ? 0 : (columnHeight - totalHeight) / 2;
    levelNodes.forEach((n, i) => {
      const positioned = { ...n, x: leftPad + levelIndex * (nodeWidth + columnGap), y: cursor, height: heights[i] };
      nodeById[n.id] = positioned;
      cursor += heights[i] + gap;
    });
  });

  const outCursor = {};
  const inCursor = {};
  const linkPaths = links.map((link) => {
    const source = nodeById[link.source];
    const target = nodeById[link.target];
    if (!source || !target || !link.value) return '';
    const sThick = (link.value / source.value) * source.height;
    const tThick = (link.value / target.value) * target.height;
    const sy0 = source.y + (outCursor[link.source] || 0);
    outCursor[link.source] = (outCursor[link.source] || 0) + sThick;
    const ty0 = target.y + (inCursor[link.target] || 0);
    inCursor[link.target] = (inCursor[link.target] || 0) + tThick;
    const sx = source.x + nodeWidth;
    const tx = target.x;
    const midX = (sx + tx) / 2;
    const sy1 = sy0 + sThick;
    const ty1 = ty0 + tThick;
    return `<path d="M${sx},${sy0} C${midX},${sy0} ${midX},${ty0} ${tx},${ty0} L${tx},${ty1} C${midX},${ty1} ${midX},${sy1} ${sx},${sy1} Z" fill="${link.color || 'var(--muted)'}" fill-opacity="0.32"></path>`;
  }).join('');

  const nodeMarkup = Object.values(nodeById).map((n) => {
    const labelX = n.x + nodeWidth + 8;
    return `<rect x="${n.x}" y="${n.y}" width="${nodeWidth}" height="${Math.max(n.height, 1)}" rx="2" fill="${n.color || 'var(--accent)'}"></rect><text x="${labelX}" y="${n.y + n.height / 2 + 4}" class="sankey-node-label">${n.label} <tspan class="sankey-node-value">(${n.value})</tspan></text>`;
  }).join('');

  container.innerHTML = `<svg width="${totalWidth}" height="${columnHeight + 20}" viewBox="0 0 ${totalWidth} ${columnHeight + 20}">${linkPaths}${nodeMarkup}</svg>`;
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
      // The workspace's own status field only tracks pre-submission prep
      // (Saved/Preparing/Ready to submit/Submitted) -- it only ever flips the
      // tracked application to "Applied" once truly submitted, and never
      // downgrades a status that's already progressed further (Online
      // Assessment/Interview/Offer/Rejected/etc.), which is only ever set via
      // the status dropdown on the Applications board.
      const existingApplication = state.applications.find((application) => application.opportunity_id === item.id);
      const advancedStatuses = ['Online Assessment', 'Interview', 'Offer', 'Rejected', 'No Response', 'Withdrawn'];
      if (!existingApplication || !advancedStatuses.includes(existingApplication.status)) {
        const applicationStatus = workspace.status === 'Submitted' ? 'Applied' : 'Saved';
        const progress = workspace.status === 'Submitted' ? 100 : workspace.status === 'Preparing' ? 60 : workspace.status === 'Ready to submit' ? 85 : 20;
        try {
          await upsertApplication(item.id, { status: applicationStatus, progress, next_action: workspace.notes || null });
          renderOverview();
          renderApplications();
        } catch (error) { /* application tracking is best-effort here; workspace itself already saved */ }
      }
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

const STATUS_PROGRESS = { Saved: 10, Applied: 40, 'Online Assessment': 55, Interview: 75, Offer: 100, Rejected: 100, 'No Response': 100, Withdrawn: 100 };
const STATUS_NEXT_ACTION = {
  Saved: 'Review requirements and tailor materials',
  Applied: 'Awaiting a response',
  'Online Assessment': 'Complete the online assessment',
  Interview: 'Prepare for your interview',
  Offer: 'Respond to your offer',
  Rejected: 'Application closed',
  'No Response': 'No response yet -- consider following up',
  Withdrawn: 'Application withdrawn',
};

async function handleStatusSelectChange(opportunityId, nextStatus) {
  try {
    await upsertApplication(opportunityId, {
      status: nextStatus,
      progress: STATUS_PROGRESS[nextStatus] ?? 0,
      next_action: STATUS_NEXT_ACTION[nextStatus] || null,
    });
    renderApplications();
    renderOverview();
    showToast(`${getOpportunity(opportunityId)?.firm || 'Application'} moved to ${nextStatus}`);
  } catch (error) {
    showToast('Could not update this application');
    renderApplications();
  }
}

function bindEvents() {
  $$('.nav-item').forEach((item) => item.addEventListener('click', () => navigate(item.dataset.view)));
  $$('[data-view-target]').forEach((item) => item.addEventListener('click', () => navigate(item.dataset.viewTarget)));
  $('#mobile-nav-select').addEventListener('change', (event) => navigate(event.target.value));
  $('#opportunity-search').addEventListener('input', renderOpportunities); $('#sector-filter').addEventListener('change', renderOpportunities); $('#status-filter').addEventListener('change', renderOpportunities);
  $$('[data-opportunity-view]').forEach((button) => button.addEventListener('click', () => setOpportunityViewMode(button.dataset.opportunityView)));
  $$('[data-applications-tab]').forEach((button) => button.addEventListener('click', () => setApplicationsTab(button.dataset.applicationsTab)));
  document.addEventListener('change', (event) => {
    const statusSelect = event.target.closest('[data-status-select]');
    if (statusSelect) handleStatusSelectChange(statusSelect.dataset.statusSelect, statusSelect.value);
  });
  $('#help-button').addEventListener('click', () => openModal('<span class="eyebrow">QUICK HELP</span><h2>How Springr keeps you moving</h2><p>Use Find opportunities to build your shortlist, Applications to track the next action, and Documents to keep your materials ready.</p><button class="primary-button full-width" id="help-close">Got it</button>'));
  $('#profile-button').addEventListener('click', () => navigate('documents'));
  $('#logout-button').addEventListener('click', () => { window.location.href = '/auth/logout'; });
  $('#add-document-button').addEventListener('click', () => {
    if (!requireLogin('Sign in to store documents.')) return;
    openModal('<span class="eyebrow">DOCUMENT VAULT</span><h2>Add a document</h2><p>Files are uploaded and stored securely on your account (PDF, DOC, or DOCX only, max 2MB).</p><form class="modal-form" id="document-form"><label>File<label class="upload-dropzone" id="upload-dropzone" for="document-file"><input id="document-file" name="file" type="file" accept=".pdf,.doc,.docx" required hidden /><span class="upload-icon">⇧</span><span class="upload-text" id="upload-text"><strong>Click to choose a file</strong><small>or drag it here · PDF, DOC, or DOCX, up to 2MB</small></span></label></label><label>Document name<input name="name" placeholder="e.g. Consulting CV" required /></label><label>Type<select name="doc_type"><option>PDF</option><option>DOCX</option><option>DOC</option></select></label><button class="primary-button full-width">Add document <span>→</span></button></form>');
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
    const practiceModule = event.target.closest('[data-practice-module]'); if (practiceModule) startPracticeModule(practiceModule.dataset.practiceModule);
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
  $('#practice-exit-button').addEventListener('click', exitPracticeModule);
  $('#practice-results-exit-button').addEventListener('click', exitPracticeModule);
  $('#practice-again-button').addEventListener('click', () => beginPracticeSession(practiceState.durationSeconds));
  $$('[data-practice-duration]').forEach((button) => button.addEventListener('click', () => beginPracticeSession(Number(button.dataset.practiceDuration))));
  $('#practice-submit-button').addEventListener('click', handlePracticeSubmit);
  $('#practice-skip-button').addEventListener('click', () => { if (practiceState.finished) return; practiceState.streak = 0; renderPracticeStats(); nextPracticeQuestion(); });
  $('#practice-reveal-button').addEventListener('click', handlePracticeReveal);
  $('#practice-next-prompt-button').addEventListener('click', () => nextPracticeQuestion());
  $('#practice-answer-input').addEventListener('input', handlePracticeAnswerInput);
  $('#practice-answer-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); handlePracticeSubmit(); } });
  $('#export-data-button').addEventListener('click', exportAccountData);
  $('#delete-account-button').addEventListener('click', confirmDeleteAccount);
  $('#cookie-ack-button').addEventListener('click', dismissCookieBanner);
}

// --- GDPR: account export / deletion ---------------------------------------
async function exportAccountData() {
  try {
    const response = await fetch('/api/account/export');
    if (!response.ok) throw new Error('export failed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'springr-account-export.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showToast('Could not export your data right now');
  }
}

function confirmDeleteAccount() {
  openModal('<span class="eyebrow">DELETE ACCOUNT</span><h2>This permanently deletes your account.</h2><p>Every saved opportunity, tracked application, workspace note, and uploaded document tied to your account will be permanently deleted. This cannot be undone.</p><div class="modal-form"><button class="primary-button full-width" id="confirm-delete-account" style="background:var(--red)">Yes, delete everything</button><button class="secondary-button full-width" id="cancel-delete-account">Cancel</button></div>');
  $('#cancel-delete-account').addEventListener('click', closeModal);
  $('#confirm-delete-account').addEventListener('click', async () => {
    try {
      const response = await fetch('/api/account', { method: 'DELETE' });
      if (!response.ok) throw new Error('delete failed');
      window.location.href = '/';
    } catch (error) {
      showToast('Could not delete your account right now');
    }
  });
}

// --- Cookie notice ----------------------------------------------------------
const COOKIE_ACK_KEY = 'springr_cookie_ack';
function initCookieBanner() {
  let acknowledged = false;
  try { acknowledged = localStorage.getItem(COOKIE_ACK_KEY) === '1'; } catch (error) { /* private mode etc -- just show the banner every visit */ }
  $('#cookie-banner').hidden = acknowledged;
}
function dismissCookieBanner() {
  $('#cookie-banner').hidden = true;
  try { localStorage.setItem(COOKIE_ACK_KEY, '1'); } catch (error) { /* nothing we can do if storage is blocked */ }
}

// --- Practice Studio: randomly generated quant/finance drills, entirely client-side --------
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[randInt(0, arr.length - 1)];
const roundTo = (num, decimals = 0) => { const f = 10 ** decimals; return Math.round(num * f) / f; };
const formatNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
function factorial(n) { let r = 1; for (let i = 2; i <= n; i += 1) r *= i; return r; }
function comb(n, k) { return factorial(n) / (factorial(k) * factorial(n - k)); }

// Ranges follow Zetamac's default arithmetic settings (zetamac.com/arithmetic):
// addition/subtraction operands 2-100, multiplication 2-12 by 2-100,
// division divisor 2-12 with quotient 2-100 (dividend built from those two).
function genArithmetic() {
  const op = pick(['+', '−', '×', '÷']);
  let a, b, answer;
  if (op === '+') { a = randInt(2, 100); b = randInt(2, 100); answer = a + b; }
  else if (op === '−') { a = randInt(3, 100); b = randInt(2, a - 1); answer = a - b; }
  else if (op === '×') { a = randInt(2, 12); b = randInt(2, 100); answer = a * b; }
  else { b = randInt(2, 12); answer = randInt(2, 100); a = b * answer; }
  return {
    prompt: `${a} ${op} ${b} = ?`,
    checkAnswer: (input) => Math.round(Number(input)) === answer,
    answerDisplay: String(answer),
  };
}

const PERCENT_VALUES = [5, 10, 12.5, 15, 20, 25, 30, 33, 40, 50, 60, 66, 70, 75, 80, 90];
function genPercentages() {
  const kind = pick(['of', 'change', 'compound']);
  if (kind === 'of') {
    const pct = pick(PERCENT_VALUES);
    const base = randInt(4, 500) * 4;
    const answer = roundTo((base * pct) / 100, 1);
    return {
      prompt: `What is ${pct}% of ${base}?`,
      checkAnswer: (input) => Math.abs(Number(input) - answer) <= Math.max(1, Math.abs(answer) * 0.02),
      answerDisplay: formatNum(answer),
    };
  }
  if (kind === 'change') {
    const start = randInt(40, 600);
    const pct = pick([-50, -40, -30, -25, -20, -15, -10, -5, 5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100]);
    const end = Math.round(start * (1 + pct / 100));
    const answer = roundTo(((end - start) / start) * 100, 0);
    return {
      prompt: `A metric moves from ${start} to ${end}. What's the percentage change? (nearest whole %, use − for a decrease)`,
      checkAnswer: (input) => Math.abs(Number(input) - answer) <= 1,
      answerDisplay: `${answer > 0 ? '+' : ''}${answer}%`,
    };
  }
  const price = randInt(20, 300);
  const upPct = pick([5, 10, 15, 20, 25, 30]);
  const downPct = pick([5, 10, 15, 20, 25, 30]);
  const final = roundTo(price * (1 + upPct / 100) * (1 - downPct / 100), 2);
  return {
    prompt: `A stock trading at $${price} rises ${upPct}%, then falls ${downPct}%. What's the final price? (nearest dollar is fine)`,
    checkAnswer: (input) => Math.abs(Number(input) - final) <= Math.max(1, final * 0.01),
    answerDisplay: `$${formatNum(final)}`,
  };
}

const DICE_SUM_COUNTS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const CARD_SCENARIOS = [
  { label: 'a King', count: 4 },
  { label: 'a heart', count: 13 },
  { label: 'a red card', count: 26 },
  { label: 'a face card (J, Q, or K)', count: 12 },
  { label: 'an Ace', count: 4 },
  { label: 'a black Queen', count: 2 },
];
function genProbability() {
  const kind = pick(['dice', 'coins', 'cards', 'ev']);
  if (kind === 'dice') {
    const sum = randInt(2, 12);
    const answer = roundTo((DICE_SUM_COUNTS[sum] / 36) * 100, 1);
    return {
      prompt: `You roll two fair six-sided dice. What's the probability their sum equals ${sum}? (as a %, nearest whole number is fine)`,
      checkAnswer: (input) => Math.abs(Number(input) - answer) <= 1,
      answerDisplay: `${answer}% (${DICE_SUM_COUNTS[sum]}/36)`,
    };
  }
  if (kind === 'coins') {
    const n = pick([3, 4, 5]);
    const k = randInt(Math.ceil(n / 2), n);
    let favourable = 0;
    for (let h = k; h <= n; h += 1) favourable += comb(n, h);
    const answer = roundTo((favourable / 2 ** n) * 100, 1);
    return {
      prompt: `You flip a fair coin ${n} times. What's the probability of getting at least ${k} heads? (as a %, nearest whole number is fine)`,
      checkAnswer: (input) => Math.abs(Number(input) - answer) <= 1,
      answerDisplay: `${answer}%`,
    };
  }
  if (kind === 'cards') {
    const scenario = pick(CARD_SCENARIOS);
    const answer = roundTo((scenario.count / 52) * 100, 1);
    return {
      prompt: `You draw one card from a standard 52-card deck. What's the probability it's ${scenario.label}? (as a %, nearest whole number is fine)`,
      checkAnswer: (input) => Math.abs(Number(input) - answer) <= 1,
      answerDisplay: `${answer}% (${scenario.count}/52)`,
    };
  }
  const win = randInt(10, 200);
  const lose = randInt(10, 200);
  const probPct = pick([10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90]);
  const ev = roundTo((probPct / 100) * win - (1 - probPct / 100) * lose, 2);
  return {
    prompt: `A game pays $${win} with probability ${probPct}%, and otherwise costs you $${lose}. What's the expected value? (use − for a negative EV)`,
    checkAnswer: (input) => Math.abs(Number(input) - ev) <= Math.max(1, Math.abs(ev) * 0.05 + 0.5),
    answerDisplay: `$${formatNum(ev)}`,
  };
}

function genSequence() {
  const kind = pick(['arithmetic', 'geometric', 'quadratic', 'fibonacci']);
  let terms = [];
  let next;
  if (kind === 'arithmetic') {
    const start = randInt(1, 20);
    const d = pick([-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8]);
    terms = Array.from({ length: 5 }, (_, i) => start + d * i);
    next = start + d * 5;
  } else if (kind === 'geometric') {
    const start = randInt(1, 5);
    const r = pick([2, 3, -2]);
    terms = Array.from({ length: 5 }, (_, i) => start * r ** i);
    next = start * r ** 5;
  } else if (kind === 'quadratic') {
    const start = randInt(1, 10);
    let diff = randInt(1, 5);
    const step = randInt(1, 4);
    terms = [start];
    for (let i = 1; i < 5; i += 1) { terms.push(terms[i - 1] + diff); diff += step; }
    next = terms[4] + diff;
  } else {
    terms = [randInt(1, 6), randInt(1, 6)];
    for (let i = 2; i < 5; i += 1) terms.push(terms[i - 1] + terms[i - 2]);
    next = terms[4] + terms[3];
  }
  return {
    prompt: `${terms.join(', ')}, ?`,
    checkAnswer: (input) => Number(input) === next,
    answerDisplay: String(next),
  };
}

const SIZING_PROMPTS = [
  { prompt: 'Estimate the number of piano tuners in New York City.', worked: 'NYC population ≈ 8.5M → ≈ 3.3M households (2.5 people/household). Assume ≈ 2% own a piano → ≈ 66,000 pianos. Each is tuned about once a year, and one tuner can service ≈ 250 pianos/year → ≈ 66,000 / 250 ≈ 260 piano tuners.' },
  { prompt: 'How many golf balls would fit inside a school bus?', worked: 'Usable interior volume ≈ 6m × 2m × 2m × 60% (seats/aisle) ≈ 14.4 m³. A golf ball is ≈ 42cm³, and sphere packing fills ≈ 65% of space → ≈ 0.65 × 1,000,000 / 42 ≈ 15,500 balls per m³ → ≈ 14.4 × 15,500 ≈ 220,000 golf balls.' },
  { prompt: 'Estimate the annual revenue of a mid-sized Starbucks in central London.', worked: 'Assume ≈ 300 customers/day, average spend ≈ £4.50 → daily revenue ≈ £1,350 → annual revenue ≈ £1,350 × 365 ≈ £490,000.' },
  { prompt: 'How many weddings take place in the UK each year?', worked: 'UK population ≈ 67M. Assume a marriage rate of ≈ 9 people per 1,000 per year → ≈ 600,000 people marrying → ≈ 300,000 weddings (2 people each).' },
  { prompt: 'Estimate the number of Ubers operating in London on a Friday night.', worked: "London population ≈ 9M. Assume ≈ 1 in 500 people is an active driver on the road at peak → ≈ 18,000 total ride-hail cars, of which Uber has ≈ 70% share → ≈ 12,500 active Uber cars." },
  { prompt: 'How many pizzas are ordered in the UK on a Saturday night?', worked: 'UK population ≈ 67M. Assume ≈ 30% order a takeaway on a Saturday night, ≈ 25% of those choose pizza, and the average order covers 2 people → ≈ 67M × 0.3 × 0.25 / 2 ≈ 2.5M pizzas.' },
  { prompt: 'Estimate the size of the UK online food-delivery market.', worked: 'Assume ≈ 30M adults order online food delivery regularly, spending ≈ £15/order and ordering ≈ 1.5 times/month → annual spend/user ≈ £270 → market size ≈ 30M × £270 ≈ £8.1bn.' },
  { prompt: 'How many smartphones are sold globally each year?', worked: 'World population ≈ 8bn. Assume ≈ 60% own a smartphone and the average replacement cycle is ≈ 2.5 years → sold/year ≈ 8bn × 0.6 / 2.5 ≈ 1.9bn.' },
  { prompt: 'Estimate the number of petrol stations in the UK.', worked: 'UK has ≈ 30M licensed vehicles. Assume each station serves a catchment of ≈ 4,000 vehicles → ≈ 30M / 4,000 ≈ 7,500 petrol stations.' },
  { prompt: 'How many people fly through Heathrow Airport in a year?', worked: 'Assume ≈ 1,300 flights/day at an average of ≈ 150 passengers each → ≈ 195,000 passenger movements/day → ≈ 195,000 × 365 ≈ 71M/year, rounding to ≈ 75-80M given peak-season loading.' },
  { prompt: 'Estimate the number of investment bankers working in the City of London.', worked: "City + Canary Wharf financial-services workforce ≈ 350,000. Assume ≈ 6% are specifically in investment-banking roles (as opposed to insurance, retail banking, asset management, etc.) → ≈ 21,000." },
  { prompt: 'How many books are sold in the UK each year?', worked: 'UK population ≈ 67M. Assume ≈ 40% buy books regularly, averaging ≈ 6 books/year → ≈ 67M × 0.4 × 6 ≈ 160M books/year.' },
  { prompt: 'Estimate the number of coffee cups sold daily in central London.', worked: 'Central London footfall/workforce ≈ 1.5M people. Assume ≈ 40% buy a coffee out on a typical day, averaging ≈ 1.3 cups → ≈ 1.5M × 0.4 × 1.3 ≈ 780,000 cups/day.' },
  { prompt: 'How many cars are on the road in London at 8am on a weekday?', worked: 'London has ≈ 2.6M registered cars. Assume ≈ 15% are actively being driven during the morning peak hour → ≈ 390,000 cars.' },
  { prompt: 'Estimate the size of the UK private-tutoring market.', worked: 'UK has ≈ 9M school-age children. Assume ≈ 25% use private tutoring, spending ≈ £500/year on average → ≈ 9M × 0.25 × £500 ≈ £1.1bn.' },
];
const SIZING_FRAMEWORK = `1. Clarify scope -- geography, timeframe, definitions.
2. Pick an approach -- top-down (start from a known total, narrow down) or bottom-up (build from one unit, scale up).
3. Break it into 3-5 driving factors and state a reasonable assumption for each.
4. Work the maths step by step, out loud.
5. Sanity-check against something you know, and round to a sensible order of magnitude.
6. Give your answer as a range, and flag the assumption you're least sure about.`;
function genSizing() {
  const item = pick(SIZING_PROMPTS);
  return {
    prompt: item.prompt,
    reveal: `${SIZING_FRAMEWORK}\n\nIllustrative worked example (one reasonable set of assumptions -- yours can differ):\n${item.worked}`,
  };
}

const PRACTICE_MODULES = [
  { id: 'arithmetic', title: 'Mental Arithmetic', blurb: '+, −, ×, ÷ under pressure. No calculator.', type: 'numeric', generate: genArithmetic },
  { id: 'percentages', title: 'Percentages & Ratios', blurb: 'Percent-of, percent-change, and compounding moves.', type: 'numeric', generate: genPercentages },
  { id: 'probability', title: 'Probability & EV', blurb: 'Dice, coins, cards, and expected value.', type: 'numeric', generate: genProbability },
  { id: 'sequences', title: 'Number Sequences', blurb: 'Spot the pattern, name the next term.', type: 'numeric', generate: genSequence },
  { id: 'sizing', title: 'Market Sizing', blurb: 'Classic guesstimate prompts with a structuring framework.', type: 'reveal', generate: genSizing },
  { id: 'interview', title: 'Interview Practice', blurb: 'Record yourself answering real interview questions, HireVue-style, with feedback on delivery.', type: 'coming-soon', badge: 'Coming soon · Paid' },
];

let practiceState = { moduleId: null, question: null, score: 0, streak: 0, promptsReviewed: 0, durationSeconds: 60, remainingSeconds: 0, timerId: null, finished: false };

function renderPracticeModules() {
  $('#practice-modules').innerHTML = PRACTICE_MODULES.map((m) => `<article class="practice-module-card${m.type === 'coming-soon' ? ' coming-soon' : ''}" data-practice-module="${m.id}">${m.badge ? `<span class="practice-module-badge">${m.badge}</span>` : ''}<h3>${m.title}</h3><p>${m.blurb}</p><span class="text-button">${m.type === 'coming-soon' ? 'Notify me' : 'Start'} <span>→</span></span></article>`).join('');
}

function currentPracticeModule() {
  return PRACTICE_MODULES.find((m) => m.id === practiceState.moduleId);
}

function startPracticeModule(moduleId) {
  const module = PRACTICE_MODULES.find((m) => m.id === moduleId);
  if (module.type === 'coming-soon') {
    openModal(`<span class="eyebrow">COMING SOON · PAID FEATURE</span><h2>${module.title}</h2><p>${module.blurb}</p><p>We're building a HireVue-style simulated video interview -- record timed answers to real interview questions and get feedback on delivery, not just content. This will be a paid add-on once it launches.</p><button class="primary-button full-width" id="practice-coming-soon-close">Got it</button>`);
    $('#practice-coming-soon-close').addEventListener('click', closeModal);
    return;
  }
  clearInterval(practiceState.timerId);
  practiceState = { moduleId, question: null, score: 0, streak: 0, promptsReviewed: 0, durationSeconds: 60, remainingSeconds: 0, timerId: null, finished: false };
  $('#practice-modules').hidden = true;
  $('#practice-active').hidden = false;
  $('#practice-duration-picker').hidden = false;
  $('#practice-session').hidden = true;
  $('#practice-active-label').textContent = module.type === 'reveal' ? 'GUESSTIMATE' : 'DRILL';
  $('#practice-active-title').textContent = module.title;
}

function exitPracticeModule() {
  clearInterval(practiceState.timerId);
  $('#practice-active').hidden = true;
  $('#practice-modules').hidden = false;
}

function beginPracticeSession(durationSeconds) {
  clearInterval(practiceState.timerId);
  practiceState.durationSeconds = durationSeconds;
  practiceState.remainingSeconds = durationSeconds;
  practiceState.score = 0;
  practiceState.streak = 0;
  practiceState.promptsReviewed = 0;
  practiceState.finished = false;

  const module = currentPracticeModule();
  $('#practice-duration-picker').hidden = true;
  $('#practice-session').hidden = false;
  $('#practice-question-card').hidden = false;
  $('#practice-results').hidden = true;
  $('#practice-score-stat').hidden = module.type === 'reveal';
  $('#practice-streak-stat').hidden = module.type === 'reveal';
  $('#practice-prompts-stat').hidden = module.type !== 'reveal';

  renderPracticeTimer();
  practiceState.timerId = setInterval(() => {
    practiceState.remainingSeconds -= 1;
    renderPracticeTimer();
    if (practiceState.remainingSeconds <= 0) finishPracticeSession();
  }, 1000);

  nextPracticeQuestion();
}

function renderPracticeTimer() {
  const seconds = Math.max(0, practiceState.remainingSeconds);
  $('#practice-timer').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  $('.practice-stats').classList.toggle('time-low', seconds <= 10);
}

function nextPracticeQuestion() {
  if (practiceState.finished) return;
  const module = currentPracticeModule();
  practiceState.question = module.generate();
  $('#practice-question').textContent = practiceState.question.prompt;
  const feedback = $('#practice-feedback');
  feedback.textContent = '';
  feedback.className = 'practice-feedback';
  $('#practice-reveal').hidden = true;
  $('#practice-reveal').textContent = '';
  if (module.type === 'reveal') {
    practiceState.promptsReviewed += 1;
    $('#practice-answer-row').hidden = true;
    $('#practice-reveal-controls').hidden = false;
    const estimateInput = $('#practice-estimate-input');
    estimateInput.value = '';
    estimateInput.focus();
  } else {
    $('#practice-answer-row').hidden = false;
    $('#practice-reveal-controls').hidden = true;
    const input = $('#practice-answer-input');
    input.value = '';
    input.disabled = false;
    input.focus();
  }
  renderPracticeStats();
}

function renderPracticeStats() {
  $('#practice-score').textContent = String(practiceState.score);
  $('#practice-streak').textContent = String(practiceState.streak);
  $('#practice-prompts').textContent = String(practiceState.promptsReviewed);
}

// Checks the answer on every keystroke -- no Enter/Check click needed. A
// correct answer advances immediately; an incomplete or wrong one is left
// alone (no shake) since the user is still mid-type.
function handlePracticeAnswerInput() {
  if (practiceState.finished) return;
  const module = currentPracticeModule();
  if (module.type === 'reveal') return;
  const input = $('#practice-answer-input');
  const value = input.value.trim();
  if (!value) return;
  if (practiceState.question.checkAnswer(value)) {
    practiceState.score += 1;
    practiceState.streak += 1;
    renderPracticeStats();
    nextPracticeQuestion();
  }
}

function handlePracticeSubmit() {
  if (practiceState.finished) return;
  const input = $('#practice-answer-input');
  const value = input.value.trim();
  if (!value) { showToast('Enter an answer first'); return; }
  const correct = practiceState.question.checkAnswer(value);
  if (correct) {
    practiceState.score += 1;
    practiceState.streak += 1;
    renderPracticeStats();
    nextPracticeQuestion();
  } else {
    practiceState.streak = 0;
    renderPracticeStats();
    input.classList.remove('shake');
    void input.offsetWidth;
    input.classList.add('shake');
    input.value = '';
    input.focus();
  }
}

function handlePracticeReveal() {
  $('#practice-reveal').hidden = false;
  $('#practice-reveal').textContent = practiceState.question.reveal;
}

function finishPracticeSession() {
  clearInterval(practiceState.timerId);
  practiceState.finished = true;
  const module = currentPracticeModule();
  $('#practice-question-card').hidden = true;
  $('#practice-results').hidden = false;
  const minutes = practiceState.durationSeconds / 60;
  const durationLabel = minutes >= 1 ? `${minutes} minute${minutes === 1 ? '' : 's'}` : `${practiceState.durationSeconds} seconds`;
  $('#practice-results-summary').textContent = module.type === 'reveal'
    ? `You reviewed ${practiceState.promptsReviewed} prompt${practiceState.promptsReviewed === 1 ? '' : 's'} in ${durationLabel}.`
    : `You solved ${practiceState.score} problem${practiceState.score === 1 ? '' : 's'} in ${durationLabel}.`;
}

async function boot() {
  // Finding and browsing opportunities never requires an account -- only sign in
  // to load/show account-specific state (applications, saved, documents).
  const user = await loadSession();
  applyProfileToDom();
  if (user) await loadUserState();
  if (user?.isAdmin) loadAdminStats();
  renderOverview(); renderOpportunities(); renderApplications(); renderDocuments(); renderPracticeModules(); bindEvents();
  initCookieBanner();
  const requestedView = window.location.hash.slice(1);
  if (VALID_VIEWS.includes(requestedView)) navigate(requestedView, { scroll: false });
  loadOpportunities();
}

// Fires when the hash changes without a full reload -- e.g. a user editing
// the URL bar directly, or clicking a link elsewhere in the app that points
// at a hash (in-app tab switches use history.replaceState, which doesn't
// trigger this, so there's no double-navigate loop here).
window.addEventListener('hashchange', () => {
  const requestedView = window.location.hash.slice(1);
  navigate(VALID_VIEWS.includes(requestedView) ? requestedView : 'overview', { scroll: false });
});

boot();
