// Quiz results admin dashboard.
//
// Data flow: every number shown here is read live from the `quiz_results`
// table via the Supabase client configured in js/supabase-config.js — nothing
// is hardcoded. The seven category percentages are used exactly as stored by
// the public quiz (quality-system-quiz.html); "Overall Score" is only ever a
// dashboard-side average of those seven values, never a second scoring system.

// Column order matches quality-system-quiz.html's `categories` array exactly,
// so a participant's breakdown here always matches what they saw on screen.
const CATEGORY_FIELDS = ['document_control', 'capa_ncrs', 'audit_readiness', 'training', 'change_management', 'reporting', 'user_adoption'];
const CATEGORY_LABELS = ['Document Control', 'CAPA & NCRs', 'Audit Readiness', 'Training', 'Change Mgmt', 'Reporting', 'User Adoption'];
const SELECT_COLUMNS = ['id', 'email', ...CATEGORY_FIELDS, 'created_at'].join(',');

// Safety caps so the dashboard never pulls an unbounded dataset into the
// browser. Search/date filters run server-side first to narrow the table
// query; these caps are a backstop on top of that.
const TABLE_FETCH_CAP = 500;
const ANALYTICS_FETCH_CAP = 5000;
const PAGE_SIZE = 20;

function overallScore(row) {
  const sum = CATEGORY_FIELDS.reduce((s, f) => s + (row[f] || 0), 0);
  return Math.round(sum / CATEGORY_FIELDS.length);
}

// Same red/gold/green thresholds the public quiz uses for its own pain-point
// bars, so a score means the same thing here as it does to the participant.
function scoreColor(score) {
  if (score >= 67) return 'var(--color-danger)';
  if (score >= 34) return 'var(--color-warning)';
  return 'var(--color-success)';
}
function scoreClass(score) {
  if (score >= 67) return 'score-high';
  if (score >= 34) return 'score-mid';
  return 'score-low';
}
function scoreBand(score) {
  if (score >= 75) return '75-100';
  if (score >= 50) return '50-74';
  if (score >= 25) return '25-49';
  return '0-24';
}

function startOfDayISO(daysAgo) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatShortDate(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ── State ──────────────────────────────────────────────────────────────
const state = {
  page: 1,
  search: '',
  scoreBand: '',
  dateFilter: 'all',
  customFrom: '',
  customTo: '',
  sortBy: 'created_at',
  sortDir: 'desc',
};

let allTableRows = [];       // server-filtered (search + date), capped at TABLE_FETCH_CAP
let rowsById = new Map();
let searchDebounceTimer = null;

// ── Boot ───────────────────────────────────────────────────────────────
(async function init() {
  if (adminConfigMissing()) {
    document.getElementById('dashboard-loading').style.display = 'none';
    document.getElementById('dashboard-config-error').style.display = 'flex';
    return;
  }

  const session = await getAdminSession();
  if (!session) {
    redirectToLogin();
    return;
  }

  // If the session ends (logout in another tab, token revoked, etc.) bounce
  // back to the login screen — RLS would already block queries at that
  // point, this just keeps the UI honest.
  supabaseClient.auth.onAuthStateChange((event, newSession) => {
    if (event === 'SIGNED_OUT' || !newSession) redirectToLogin();
  });

  document.getElementById('admin-user-email').textContent = session.user.email;
  document.getElementById('logout-btn').addEventListener('click', adminLogout);

  const sidebar = document.getElementById('admin-sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const menuToggle = document.getElementById('menu-toggle');
  const navOverlay = document.getElementById('nav-overlay');
  const desktopMq = window.matchMedia('(min-width: 1024px)');

  function setDrawerOpen(open) {
    sidebar.classList.toggle('is-open', open);
    navOverlay.classList.toggle('is-open', open);
    navOverlay.hidden = !open;
    document.body.classList.toggle('drawer-open', open);
    if (menuToggle) menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    sidebar.setAttribute('aria-hidden', desktopMq.matches ? 'false' : (open ? 'false' : 'true'));
  }

  if (sidebar && sidebarToggle) {
    const collapsed = localStorage.getItem('inglasia-admin-sidebar') === 'collapsed';
    sidebar.classList.toggle('is-collapsed', collapsed);
    sidebarToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

    sidebarToggle.addEventListener('click', () => {
      const isCollapsed = sidebar.classList.toggle('is-collapsed');
      sidebarToggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
      localStorage.setItem('inglasia-admin-sidebar', isCollapsed ? 'collapsed' : 'open');
    });
  }

  if (sidebar && menuToggle && navOverlay) {
    setDrawerOpen(false);
    menuToggle.addEventListener('click', () => setDrawerOpen(!sidebar.classList.contains('is-open')));
    navOverlay.addEventListener('click', () => setDrawerOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('is-open')) setDrawerOpen(false);
    });
    desktopMq.addEventListener('change', () => setDrawerOpen(false));
  }

  document.getElementById('dashboard-loading').style.display = 'none';
  document.getElementById('dashboard-app').hidden = false;

  wireControls();
  await Promise.all([loadStatsAndAnalytics(), loadTableData()]);
})();

// ── Controls ───────────────────────────────────────────────────────────
function wireControls() {
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.search = searchInput.value;
      loadTableData();
    }, 350);
  });

  document.getElementById('score-filter').addEventListener('change', (e) => {
    state.scoreBand = e.target.value;
    state.page = 1;
    renderTable();
  });

  const dateFilterEl = document.getElementById('date-filter');
  const customRangeEl = document.getElementById('custom-date-range');
  dateFilterEl.addEventListener('change', (e) => {
    state.dateFilter = e.target.value;
    customRangeEl.style.display = state.dateFilter === 'custom' ? 'flex' : 'none';
    if (state.dateFilter !== 'custom') loadTableData();
  });
  document.getElementById('custom-from').addEventListener('change', (e) => {
    state.customFrom = e.target.value;
    if (state.customFrom && state.customTo) loadTableData();
  });
  document.getElementById('custom-to').addEventListener('change', (e) => {
    state.customTo = e.target.value;
    if (state.customFrom && state.customTo) loadTableData();
  });

  document.getElementById('sort-by').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    renderTable();
  });
  document.getElementById('sort-dir-btn').addEventListener('click', () => {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    document.getElementById('sort-dir-btn').textContent = state.sortDir === 'asc' ? '↑ Asc' : '↓ Desc';
    renderTable();
  });

  document.getElementById('retry-table-btn').addEventListener('click', loadTableData);
  document.getElementById('retry-stats-btn').addEventListener('click', loadStatsAndAnalytics);

  document.getElementById('modal-close').addEventListener('click', closeDetail);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeDetail();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });
}

function clearFilters() {
  state.search = '';
  state.scoreBand = '';
  state.dateFilter = 'all';
  state.customFrom = '';
  state.customTo = '';
  document.getElementById('search-input').value = '';
  document.getElementById('score-filter').value = '';
  document.getElementById('date-filter').value = 'all';
  document.getElementById('custom-date-range').style.display = 'none';
  loadTableData();
}

function getDateRange() {
  switch (state.dateFilter) {
    case 'today': return [startOfDayISO(0), null];
    case '7d': return [startOfDayISO(6), null];
    case '30d': return [startOfDayISO(29), null];
    case 'custom': {
      const from = state.customFrom ? new Date(state.customFrom + 'T00:00:00').toISOString() : null;
      const to = state.customTo ? new Date(state.customTo + 'T23:59:59').toISOString() : null;
      return [from, to];
    }
    default: return [null, null];
  }
}

// ── Summary cards + analytics (global, unaffected by table filters) ─────
async function loadStatsAndAnalytics() {
  const statsErrorEl = document.getElementById('stats-error');
  statsErrorEl.style.display = 'none';

  try {
    const [totalRes, todayRes, analyticsRes] = await Promise.all([
      supabaseClient.from('quiz_results').select('id', { count: 'exact', head: true }),
      supabaseClient.from('quiz_results').select('id', { count: 'exact', head: true }).gte('created_at', startOfDayISO(0)),
      supabaseClient.from('quiz_results').select(CATEGORY_FIELDS.join(',') + ',created_at').order('created_at', { ascending: false }).limit(ANALYTICS_FETCH_CAP),
    ]);
    if (totalRes.error) throw totalRes.error;
    if (todayRes.error) throw todayRes.error;
    if (analyticsRes.error) throw analyticsRes.error;

    renderSummaryCards(totalRes.count || 0, todayRes.count || 0, analyticsRes.data || []);
    renderCategoryChart(analyticsRes.data || []);
    renderTimeChart(analyticsRes.data || []);
  } catch (err) {
    console.warn('Failed to load dashboard analytics:', err);
    statsErrorEl.style.display = 'block';
  }
}

function renderSummaryCards(total, today, rows) {
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-today').textContent = today;
  document.getElementById('stat-total-meta').textContent = today > 0 ? `+${today} today` : '';
  document.getElementById('stat-today-meta').textContent = total > 0 ? `${Math.round((today / total) * 100)}% of total` : '';

  if (!rows.length) {
    document.getElementById('stat-average').textContent = '—';
    document.getElementById('stat-latest').textContent = '—';
    document.getElementById('stat-latest-meta').textContent = '';
    return;
  }
  const avg = Math.round(rows.reduce((s, r) => s + overallScore(r), 0) / rows.length);
  document.getElementById('stat-average').textContent = avg + '%';

  const latest = new Date(rows[0].created_at); // already ordered desc
  document.getElementById('stat-latest').textContent = latest.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  document.getElementById('stat-latest-meta').textContent = latest.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function renderCategoryChart(rows) {
  const container = document.getElementById('category-chart');
  if (!rows.length) {
    container.innerHTML = '<p class="chart-empty">No submissions yet.</p>';
    return;
  }
  container.innerHTML = CATEGORY_FIELDS.map((field, i) => {
    const avg = Math.round(rows.reduce((s, r) => s + (r[field] || 0), 0) / rows.length);
    const tone = scoreClass(avg);
    const isZero = avg === 0;
    return `
      <div class="hbar-row${isZero ? ' is-zero' : ''}" title="${CATEGORY_LABELS[i]}: ${avg}%">
        <span class="hbar-label">${CATEGORY_LABELS[i]}</span>
        <span class="hbar-track"><span class="hbar-fill ${tone}" style="width:${avg}%"></span></span>
        <span class="hbar-value ${tone}">${avg}%</span>
      </div>`;
  }).join('');
}

function dayKey(d) { return d.toISOString().slice(0, 10); }
function weekKey(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Monday = 0
  date.setDate(date.getDate() - day);
  return date.toISOString().slice(0, 10);
}

function enumerateKeys(fromKey, toKey, stepDays) {
  const keys = [];
  let t = Date.parse(fromKey + 'T00:00:00.000Z');
  const end = Date.parse(toKey + 'T00:00:00.000Z');
  while (t <= end) {
    keys.push(new Date(t).toISOString().slice(0, 10));
    t += stepDays * 86400000;
  }
  return keys;
}

function shiftKey(key, days) {
  return new Date(Date.parse(key + 'T00:00:00.000Z') + days * 86400000).toISOString().slice(0, 10);
}

function renderTimeChart(rows) {
  const wrap = document.getElementById('time-chart');
  if (!rows.length) {
    wrap.innerHTML = '<p class="chart-empty">No submissions yet.</p>';
    return;
  }

  const dates = rows.map(r => new Date(r.created_at));
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));
  const spanDays = Math.max(1, Math.round((maxDate - minDate) / 86400000));
  const bucketByWeek = spanDays > 45;
  const stepDays = bucketByWeek ? 7 : 1;

  const buckets = new Map();
  rows.forEach(r => {
    const d = new Date(r.created_at);
    const key = bucketByWeek ? weekKey(d) : dayKey(d);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });

  let toKey = bucketByWeek ? weekKey(maxDate) : dayKey(maxDate);
  let fromKey = bucketByWeek ? weekKey(minDate) : dayKey(minDate);
  const paddedFrom = shiftKey(toKey, -stepDays * 6);
  if (fromKey > paddedFrom) fromKey = bucketByWeek ? weekKey(new Date(paddedFrom + 'T00:00:00.000Z')) : paddedFrom;

  const sortedKeys = enumerateKeys(fromKey, toKey, stepDays);
  const points = sortedKeys.map(k => buckets.get(k) || 0);
  const max = Math.max(...points, 1);

  const w = 640, h = 200, padL = 36, padR = 16, padT = 16, padB = 36;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const stepX = points.length === 1 ? 0 : plotW / (points.length - 1);
  const labelEvery = points.length <= 8 ? 1 : Math.ceil(points.length / 6);

  const coords = points.map((v, i) => {
    const x = padL + i * stepX;
    const y = padT + plotH - (v / max) * plotH;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  });

  let lineD = `M${coords[0][0]},${coords[0][1]}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[i + 1];
    const cpx = (x0 + x1) / 2;
    lineD += ` C${cpx},${y0} ${cpx},${y1} ${x1},${y1}`;
  }
  const last = coords[coords.length - 1];
  const areaD = `${lineD} L${last[0]},${padT + plotH} L${coords[0][0]},${padT + plotH} Z`;

  const gridY = [0, 0.5, 1].map((t) => {
    const y = padT + plotH - t * plotH;
    return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" class="time-grid" />`;
  }).join('');

  const circles = coords.map(([x, y], i) => {
    const d = new Date(sortedKeys[i] + 'T00:00:00');
    const label = bucketByWeek ? `Week of ${formatShortDate(d)}` : formatShortDate(d);
    return `
      <circle cx="${x}" cy="${y}" r="10" class="time-hit" data-label="${label}" data-count="${points[i]}"></circle>
      <circle cx="${x}" cy="${y}" r="3.5" class="time-point"></circle>`;
  }).join('');

  const xLabels = sortedKeys.map((key, i) => {
    if (i % labelEvery !== 0 && i !== points.length - 1) return '';
    const x = coords[i][0];
    const d = new Date(key + 'T00:00:00');
    return `<text x="${x}" y="${h - 10}" class="time-x-label" text-anchor="middle">${formatShortDate(d)}</text>`;
  }).join('');

  wrap.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" class="time-svg" role="img" aria-label="Submissions over time">
      <defs>
        <linearGradient id="time-area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--color-primary)" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="var(--color-primary)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridY}
      <text x="${padL - 8}" y="${padT + 4}" class="time-axis-label" text-anchor="end">${max}</text>
      <text x="${padL - 8}" y="${padT + plotH}" class="time-axis-label" text-anchor="end">0</text>
      <path d="${areaD}" class="time-area" />
      <path d="${lineD}" class="time-line" />
      ${circles}
      ${xLabels}
    </svg>
    <div class="time-tooltip" id="time-tooltip"></div>
    <div class="time-range-label">${formatShortDate(new Date(fromKey + 'T00:00:00'))} – ${formatShortDate(new Date(toKey + 'T00:00:00'))} · ${bucketByWeek ? 'weekly' : 'daily'} submissions</div>`;

  wireTimeChartTooltip(wrap);
}

function wireTimeChartTooltip(wrap) {
  const tooltip = wrap.querySelector('#time-tooltip');
  const svg = wrap.querySelector('.time-svg');
  wrap.querySelectorAll('.time-hit').forEach((point) => {
    point.addEventListener('mouseenter', () => {
      const count = point.dataset.count;
      tooltip.innerHTML = `<strong>${count}</strong> ${count === '1' ? 'participant' : 'participants'}<br>${point.dataset.label}`;
      tooltip.style.display = 'block';
      const rect = point.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      tooltip.style.left = `${rect.left - svgRect.left + rect.width / 2}px`;
      tooltip.style.top = `${rect.top - svgRect.top}px`;
    });
    point.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
  });
}

// ── Table data (search + date filters run server-side) ──────────────────
async function loadTableData() {
  const tableLoading = document.getElementById('table-loading');
  const tableError = document.getElementById('table-error');
  const tableEmpty = document.getElementById('table-empty');
  const tableWrap = document.getElementById('table-wrap');
  const pagination = document.getElementById('pagination');

  tableError.style.display = 'none';
  tableEmpty.style.display = 'none';
  tableWrap.style.display = 'none';
  pagination.style.display = 'none';
  tableLoading.style.display = 'block';

  try {
    let query = supabaseClient.from('quiz_results').select(SELECT_COLUMNS);

    const term = state.search.trim();
    if (term) query = query.ilike('email', `%${term}%`);

    const [from, to] = getDateRange();
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    // DB-level ordering/cap keeps the payload bounded; the final sort
    // (which can be by the client-computed overall score) and pagination
    // happen below over this already-narrowed set.
    query = query.order('created_at', { ascending: false }).limit(TABLE_FETCH_CAP);

    const { data, error } = await query;
    if (error) throw error;

    allTableRows = data || [];
    rowsById = new Map(allTableRows.map(r => [r.id, r]));
    state.page = 1;
    renderTable();
  } catch (err) {
    console.warn('Failed to load quiz results:', err);
    tableLoading.style.display = 'none';
    tableError.style.display = 'block';
  }
}

function getFilteredSortedRows() {
  let rows = allTableRows;
  if (state.scoreBand) {
    rows = rows.filter(r => scoreBand(overallScore(r)) === state.scoreBand);
  }
  rows = rows.slice().sort((a, b) => {
    let av, bv;
    if (state.sortBy === 'overall_score') { av = overallScore(a); bv = overallScore(b); }
    else if (state.sortBy === 'email') { av = a.email.toLowerCase(); bv = b.email.toLowerCase(); }
    else { av = a.created_at; bv = b.created_at; }
    if (av < bv) return state.sortDir === 'asc' ? -1 : 1;
    if (av > bv) return state.sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  return rows;
}

function renderTable() {
  const tableLoading = document.getElementById('table-loading');
  const tableError = document.getElementById('table-error');
  const tableEmpty = document.getElementById('table-empty');
  const tableWrap = document.getElementById('table-wrap');
  const tbody = document.getElementById('results-tbody');
  const pagination = document.getElementById('pagination');
  const capNotice = document.getElementById('table-cap-notice');

  tableLoading.style.display = 'none';
  tableError.style.display = 'none';

  if (allTableRows.length === 0) {
    tableWrap.style.display = 'none';
    pagination.style.display = 'none';
    tableEmpty.style.display = 'block';
    tableEmpty.textContent = 'No quiz submissions yet.';
    return;
  }

  const filtered = getFilteredSortedRows();

  if (filtered.length === 0) {
    tableWrap.style.display = 'none';
    pagination.style.display = 'none';
    tableEmpty.style.display = 'block';
    tableEmpty.innerHTML = 'No results match your search or filters. <button type="button" id="clear-filters-btn" class="link-btn">Clear filters</button>';
    document.getElementById('clear-filters-btn').addEventListener('click', clearFilters);
    return;
  }

  tableEmpty.style.display = 'none';
  tableWrap.style.display = 'block';

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.page = Math.min(state.page, totalPages);
  const pageRows = filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  tbody.innerHTML = pageRows.map(rowHTML).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => openDetail(tr.dataset.id));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(tr.dataset.id); }
    });
  });

  renderPagination(totalPages, filtered.length);
  capNotice.style.display = (allTableRows.length >= TABLE_FETCH_CAP) ? 'block' : 'none';
}

function rowHTML(r) {
  const score = overallScore(r);
  return `
    <tr data-id="${r.id}" tabindex="0">
      <td data-label="Participant">${escapeHTML(r.email)}</td>
      <td data-label="Overall Score"><span class="score-pill ${scoreClass(score)}">${score}%</span></td>
      ${CATEGORY_FIELDS.map((f, i) => `<td data-label="${CATEGORY_LABELS[i]}">${r[f]}%</td>`).join('')}
      <td data-label="Submitted">${formatDate(r.created_at)}</td>
    </tr>`;
}

function renderPagination(totalPages, totalCount) {
  const el = document.getElementById('pagination');
  el.style.display = 'flex';
  const start = (state.page - 1) * PAGE_SIZE + 1;
  const end = Math.min(state.page * PAGE_SIZE, totalCount);
  el.innerHTML = `
    <span class="pagination-info">${start}–${end} of ${totalCount}</span>
    <div class="pagination-btns">
      <button type="button" id="prev-page" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
      <span class="pagination-page">Page ${state.page} of ${totalPages}</span>
      <button type="button" id="next-page" ${state.page >= totalPages ? 'disabled' : ''}>Next →</button>
    </div>`;
  document.getElementById('prev-page').addEventListener('click', () => { state.page--; renderTable(); });
  document.getElementById('next-page').addEventListener('click', () => { state.page++; renderTable(); });
}

// ── Detail modal ──────────────────────────────────────────────────────
function openDetail(id) {
  const row = rowsById.get(id);
  if (!row) return;
  const score = overallScore(row);

  document.getElementById('modal-email').textContent = row.email;
  document.getElementById('modal-date').textContent = formatDate(row.created_at);
  document.getElementById('modal-score-value').textContent = score + '%';
  document.getElementById('modal-score-ring').style.setProperty('--score-color', scoreColor(score));

  document.getElementById('modal-breakdown').innerHTML = CATEGORY_FIELDS.map((f, i) => {
    const pct = row[f];
    const tone = scoreClass(pct);
    const isZero = pct === 0;
    return `
      <div class="breakdown-item${isZero ? ' is-zero' : ''}">
        <div class="breakdown-label">${CATEGORY_LABELS[i]}</div>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar-bg"><div class="breakdown-bar-fill ${tone}" style="width:${pct}%"></div></div>
          <span class="breakdown-pct">${pct}%</span>
        </div>
      </div>`;
  }).join('');

  document.getElementById('modal-overlay').classList.add('is-open');
  document.body.classList.add('modal-open');
  document.getElementById('modal-close').focus();
}

function closeDetail() {
  document.getElementById('modal-overlay').classList.remove('is-open');
  document.body.classList.remove('modal-open');
}
