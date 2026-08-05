// PlastPOS frontend - plain JS, no build step. Every page is a function
// that returns an HTML string; `actions.*` functions (called from inline
// onclick handlers) do the work and re-render. Deliberately framework-free
// so the whole app is just static files a browser can load with zero setup.

const state = { settings: {}, cart: [], usersList: [], pickedUserId: null };
const app = document.getElementById('app');

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function money(n) { const cur = state.settings.currency || 'KES'; return `${cur} ${Number(n || 0).toFixed(2)}`; }
function dt(s) { if (!s) return ''; return String(s).replace('T', ' ').slice(0, 16); }
function packLabel(m) { return (m && m.pack_unit_label) ? m.pack_unit_label : 'sack'; }
function shortDay(s) { return String(s).slice(5); } // "2026-08-04" -> "08-04"

// Tips are recomputed fresh from live data on every fetch (nothing stored
// server-side), so "dismiss" just means "hide this exact message for me
// until it changes" - a stable key per browser+login, kept in localStorage.
// If the same situation comes back with the same message, it reappears;
// dismissing is not the same as fixing the underlying thing.
function tipKeyOf(t) {
  const s = t.area + '::' + t.message;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}
function dismissedTipsStorageKey() { return 'plastpos_dismissed_tips_' + (API.user ? API.user.id : 'anon'); }
function getDismissedTipKeys() {
  try { return new Set(JSON.parse(localStorage.getItem(dismissedTipsStorageKey()) || '[]')); }
  catch (e) { return new Set(); }
}
function renderTips(tips) {
  const dismissed = getDismissedTipKeys();
  return tips.filter(t => t.area !== 'orders' && !dismissed.has(tipKeyOf(t))).map(t => `
    <div class="tip ${t.level === 'warning' ? 'warning' : ''}">
      <span>${esc(t.message)}</span>
      <button class="tip-dismiss" title="Dismiss" onclick="actions.dismissTip('${tipKeyOf(t)}', this)">&times;</button>
    </div>`).join('');
}

// Hand-rolled inline SVG line chart - no charting library, so the app stays
// fully self-contained and works offline with zero dependencies. `series`
// is an array of objects; `key` is the numeric field to plot.
function svgLineChart(series, key, opts = {}) {
  const w = opts.width || 600, h = opts.height || 140, pad = 28;
  if (!series.length) return `<p style="color:var(--muted)">No data yet</p>`;
  const values = series.map(d => Number(d[key]) || 0);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = (max - min) || 1;
  const stepX = series.length > 1 ? (w - pad * 2) / (series.length - 1) : 0;
  const yFor = (v) => h - pad - ((v - min) / range) * (h - pad * 2);
  const zeroY = yFor(0);
  const points = values.map((v, i) => `${pad + i * stepX},${yFor(v)}`).join(' ');
  const color = opts.color || '#0f766e';
  const labels = series.map((d, i) => {
    if (series.length > 10 && i % Math.ceil(series.length / 8) !== 0) return '';
    return `<text x="${pad + i * stepX}" y="${h - 6}" font-size="9" fill="#64748b" text-anchor="middle">${esc(opts.labelFn ? opts.labelFn(d) : shortDay(d.day))}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="overflow:visible">
    <line x1="${pad}" y1="${zeroY}" x2="${w - pad}" y2="${zeroY}" stroke="#e2e8f0" stroke-width="1"/>
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5"/>
    ${values.map((v, i) => `<circle cx="${pad + i * stepX}" cy="${yFor(v)}" r="3" fill="${color}"><title>${esc(opts.labelFn ? opts.labelFn(series[i]) : series[i].day)}: ${v}</title></circle>`).join('')}
    ${labels}
  </svg>`;
}

async function boot() {
  let status;
  try { status = await API.get('/auth/status'); }
  catch (e) { app.innerHTML = `<div class="login-screen"><div class="card"><p>${esc(e.message)}</p><button class="btn" onclick="boot()">Retry</button></div></div>`; return; }

  if (!status.isSetup) return renderSetup();

  state.settings = await API.get('/auth/settings').catch(() => ({}));

  if (!API.token) return renderLogin();
  renderApp();
}

window.addEventListener('hashchange', () => { if (API.token) renderApp(); });

// Changing location.hash fires 'hashchange' asynchronously, which would
// call renderApp() a second time on top of an explicit call below it -
// a race that can silently drop things like the one-time welcome banner.
// Route every navigation through here so there's ever only one render.
function navigate(hash) {
  if (location.hash === hash) renderApp();
  else location.hash = hash;
}

// ---------------- Setup wizard ----------------
// This is the screen where the business name / industry gets entered,
// exactly once, the first time the app is opened after install.
function renderSetup() {
  app.innerHTML = `
  <div class="login-screen"><div class="login-card card">
    <h2>Set up your business</h2>
    <p style="color:var(--muted);font-size:13px">This runs once, right after install. It appears on every receipt and report.</p>
    <div id="setupMsg"></div>
    <label>Business name *</label>
    <input id="s_name" placeholder="e.g. Mwangi Plastic Bags Ltd">
    <label>Industry</label>
    <input id="s_industry" value="Plastic bag manufacturing">
    <label>Address</label>
    <input id="s_address" placeholder="Plant location">
    <label>Phone</label>
    <input id="s_phone" placeholder="07xx xxx xxx">
    <label>Currency code</label>
    <input id="s_currency" value="KES">
    <hr style="margin:14px 0;border:none;border-top:1px solid var(--border)">
    <label>Your name (first admin account) *</label>
    <input id="s_admin" placeholder="Owner/manager name">
    <label>Choose a 4-digit PIN *</label>
    <input id="s_pin" type="password" inputmode="numeric" maxlength="6" placeholder="PIN">
    <button class="btn block" style="margin-top:14px" onclick="actions.submitSetup()">Finish setup</button>
  </div></div>`;
}

const actions = {};
actions.dismissTip = (key, btn) => {
  const set = getDismissedTipKeys();
  set.add(key);
  localStorage.setItem(dismissedTipsStorageKey(), JSON.stringify([...set]));
  const el = btn.closest('.tip');
  if (el) el.remove();
};
actions.submitSetup = async () => {
  const body = {
    businessName: document.getElementById('s_name').value.trim(),
    industry: document.getElementById('s_industry').value.trim(),
    address: document.getElementById('s_address').value.trim(),
    phone: document.getElementById('s_phone').value.trim(),
    currency: document.getElementById('s_currency').value.trim() || 'KES',
    adminName: document.getElementById('s_admin').value.trim(),
    adminPin: document.getElementById('s_pin').value.trim(),
  };
  if (!body.businessName || !body.adminName || !body.adminPin) {
    document.getElementById('setupMsg').innerHTML = `<div class="msg error">Business name, your name and a PIN are required.</div>`;
    return;
  }
  try {
    const data = await API.post('/auth/setup', body);
    API.setSession(data.token, data.user);
    state.pendingWelcome = { name: data.user.name, firstLogin: true };
    boot();
  } catch (e) {
    document.getElementById('setupMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};

// ---------------- Login ----------------
async function renderLogin() {
  let users = [];
  try { users = await API.get('/auth/users'); } catch (e) {}
  state.usersList = users;
  app.innerHTML = `
  <div class="login-screen"><div class="login-card card">
    <h2>${esc(state.settings.business_name || 'PlastPOS')}</h2>
    <p style="color:var(--muted);font-size:13px">Tap your name. Type your PIN. Tap Log in.</p>
    <div id="loginMsg"></div>
    <div class="user-pick">
      ${users.map(u => `<button id="u_${u.id}" onclick="actions.pickUser(${u.id})">${esc(u.name)} <span style="color:var(--muted);font-size:11px">(${u.role})</span></button>`).join('')}
    </div>
    <label>PIN</label>
    <input id="l_pin" type="password" inputmode="numeric" maxlength="6" placeholder="PIN">
    <button class="btn block" style="margin-top:14px" onclick="actions.doLogin()">Log in</button>
    <button class="btn secondary block" style="margin-top:8px" onclick="actions.forgotPin()">I forgot my PIN / it's wrong</button>
  </div></div>`;
}
actions.pickUser = (id) => {
  state.pickedUserId = id;
  state.usersList.forEach(u => document.getElementById('u_' + u.id).classList.toggle('active', u.id === id));
};
actions.doLogin = async () => {
  const pin = document.getElementById('l_pin').value.trim();
  if (!state.pickedUserId) { document.getElementById('loginMsg').innerHTML = `<div class="msg error">Tap your name first.</div>`; return; }
  try {
    const data = await API.post('/auth/login', { userId: state.pickedUserId, pin });
    API.setSession(data.token, data.user);
    state.pendingWelcome = { name: data.user.name, firstLogin: data.firstLogin };
    navigate(LANDING[data.user.role] || '#/dashboard');
  } catch (e) {
    document.getElementById('loginMsg').innerHTML = `<div class="msg error">Wrong PIN. Try again, or tap "I forgot my PIN" below.</div>`;
  }
};
actions.forgotPin = async () => {
  if (!state.pickedUserId) { document.getElementById('loginMsg').innerHTML = `<div class="msg error">Tap your name first.</div>`; return; }
  try {
    await API.post('/auth/request-pin-reset', { userId: state.pickedUserId });
    document.getElementById('loginMsg').innerHTML = `<div class="msg ok">Done. The admin has been told. Ask them to give you a new PIN.</div>`;
  } catch (e) {
    document.getElementById('loginMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};
actions.logout = async () => {
  try { await API.post('/auth/logout'); } catch (e) {}
  API.clearSession();
  renderLogin();
};

// ---------------- App shell + router ----------------
// Each role lands on the screen that matches their actual job - a cashier
// hitting the till, an input operator logging beads, etc. Admin alone sees
// the full oversight dashboard.
const LANDING = { admin: '#/dashboard', input: '#/input', cutting: '#/manufacturing', picking: '#/picking', distribution: '#/dispatch' };

const NAV = [
  { path: '#/dashboard', label: 'Dashboard', roles: ['admin', 'input', 'cutting', 'picking', 'distribution'] },
  { path: '#/input', label: 'Plant Operator', roles: ['admin', 'input'] },
  { path: '#/manufacturing', label: 'Packaging', roles: ['admin', 'cutting'] },
  { path: '#/picking', label: 'Picking', roles: ['admin', 'picking'] },
  { path: '#/dispatch', label: 'Delivery', roles: ['admin', 'distribution'] },
  { path: '#/inventory', label: 'Inventory', roles: ['admin'] },
  { path: '#/purchases', label: 'Purchases', roles: ['admin'] },
  { path: '#/customers', label: 'Customers', roles: ['admin'] },
  { path: '#/cashbook', label: 'Cash Book', roles: ['admin'] },
  { path: '#/payroll', label: 'Payroll', roles: ['admin'] },
  { path: '#/reports', label: 'Reports', roles: ['admin'] },
  { path: '#/settings', label: 'Settings', roles: ['admin'] },
];

async function renderApp() {
  if (!API.token || !API.user) return renderLogin();
  const user = API.user;
  if (['input', 'cutting', 'picking', 'distribution', 'cashier'].includes(user.role)) startShiftAlarm();
  const route = location.hash || '#/dashboard';
  const navHtml = NAV.filter(n => n.roles.includes(user.role))
    .map(n => `<a href="${n.path}" class="${route.startsWith(n.path) ? 'active' : ''}">${n.label}</a>`).join('');

  // Orders that can't be filled from current stock - shown as a loud alert
  // at the top of every page (not buried in the tips card), to whoever can
  // actually fix it: admin and Packaging (the only ones who can make more).
  let alertHtml = '';
  if (['admin', 'cutting', 'input'].includes(user.role)) {
    try {
      const tipsData = await API.get('/tips');
      const orderAlerts = (tipsData.tips || []).filter(t => t.area === 'orders');
      if (orderAlerts.length) {
        alertHtml = `<div class="overhead-alert">${orderAlerts.map(t => `<div class="tip warning">${esc(t.message)}</div>`).join('')}</div>`;
      }
    } catch (e) { /* not logged in yet or offline - the page below will handle it */ }
  }

  app.innerHTML = `
    <div class="header">
      <div><h1>${esc(state.settings.business_name || 'PlastPOS')}</h1><div class="sub">${esc(user.name)} · ${esc(user.role)}</div></div>
      <button onclick="actions.logout()">Log out</button>
    </div>
    <div class="nav">${navHtml}</div>
    ${alertHtml}
    <div class="main" id="main"><p style="color:var(--muted)">Loading...</p></div>
  `;

  const main = document.getElementById('main');
  try {
    if (route.startsWith('#/pos')) main.innerHTML = await pagePOS();
    else if (route.startsWith('#/inventory')) main.innerHTML = await pageInventory();
    else if (route.startsWith('#/manufacturing')) main.innerHTML = await pageManufacturing();
    else if (route.startsWith('#/input')) main.innerHTML = await pageStageInput();
    else if (route.startsWith('#/picking')) main.innerHTML = await pagePicking();
    else if (route.startsWith('#/dispatch')) main.innerHTML = await pageDispatch();
    else if (route.startsWith('#/purchases')) main.innerHTML = await pagePurchases();
    else if (route.startsWith('#/customers')) main.innerHTML = await pageCustomers();
    else if (route.startsWith('#/cashbook')) main.innerHTML = await pageCashbook();
    else if (route.startsWith('#/payroll')) main.innerHTML = await pagePayroll();
    else if (route.startsWith('#/reports')) main.innerHTML = await pageReports();
    else if (route.startsWith('#/settings')) main.innerHTML = await pageSettings();
    else if (route.startsWith('#/receipt/')) main.innerHTML = await pageReceipt(route.split('/')[2]);
    else if (route.startsWith('#/delivery-receipt/')) main.innerHTML = await pageDeliveryReceipt(route.split('/')[2]);
    else main.innerHTML = await pageDashboard();
  } catch (e) {
    main.innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }

  // Shown once, right after a login action - never again on later page
  // changes within the same session, so it can't get spammy.
  if (state.pendingWelcome) {
    main.innerHTML = welcomeBanner(state.pendingWelcome) + main.innerHTML;
    state.pendingWelcome = null;
  }
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function guessShift() {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return 'Morning';
  if (h >= 14 && h < 22) return 'Afternoon';
  return 'Night';
}
function welcomeBanner(w) {
  return `
  <div class="card" style="border:1px solid var(--teal);background:#f0fdfa">
    ${w.firstLogin ? `<p style="margin:0 0 4px;font-weight:700">Hello ${esc(w.name)}, welcome to ${esc(state.settings.industry || state.settings.business_name || 'the team')}!</p>` : ''}
    <p style="margin:0 0 4px;font-weight:700">${timeGreeting()}, ${esc(w.name)}</p>
    <p style="margin:0;color:var(--muted)">${esc(state.settings.welcome_tagline || 'JITUME MZEE... MUKUCHU NDIO FORM ... To God be the glory')}</p>
  </div>`;
}

// ---------------- Dashboard ----------------
async function pageDashboard() {
  if (API.user.role === 'admin') return pageAdminDashboard();
  return pageWorkerDashboard();
}

function aggregateSeries(series, view) {
  if (view === 'daily') return series.slice(-14);
  const buckets = {};
  for (const d of series) {
    let key;
    if (view === 'weekly') {
      const date = new Date(d.day + 'T00:00:00');
      const dow = date.getDay() || 7;
      const monday = new Date(date);
      monday.setDate(date.getDate() - dow + 1);
      key = monday.toISOString().slice(0, 10);
    } else {
      key = d.day.slice(0, 7); // YYYY-MM
    }
    if (!buckets[key]) buckets[key] = { day: key, produced: 0, dispatched: 0, revenue: 0, cogs: 0, expenses: 0, profit: 0 };
    buckets[key].produced += d.produced;
    buckets[key].dispatched += d.dispatched;
    buckets[key].revenue += d.revenue;
    buckets[key].cogs += d.cogs;
    buckets[key].expenses += d.expenses;
    buckets[key].profit += d.profit;
  }
  return Object.values(buckets).sort((a, b) => a.day.localeCompare(b.day)).slice(-12);
}

async function pageAdminDashboard() {
  const view = state.chartView || 'daily';
  const daysNeeded = view === 'daily' ? 14 : view === 'weekly' ? 90 : 366;
  const [tipsData, lowStock, cash, status, dailyRaw, disputes, shiftsToday, pinRequests, runningCosts, netInfo] = await Promise.all([
    API.get('/tips').catch(() => ({ tips: [] })),
    API.get('/inventory/low-stock').catch(() => ({ products: [], materials: [] })),
    API.get('/cashbook/summary').catch(() => null),
    API.get('/stages/today-status').catch(() => ({ stages: [] })),
    API.get(`/reports/daily?days=${daysNeeded}`).catch(() => ({ series: [] })),
    API.get('/payroll/disputes').catch(() => []),
    API.get('/shifts/today').catch(() => []),
    API.get('/auth/pin-reset-requests').catch(() => []),
    API.get('/reports/running-costs').catch(() => null),
    API.get('/auth/network-info').catch(() => ({ urls: [] })),
  ]);
  window.__loginUrls = netInfo.urls || [];
  const daily = { series: aggregateSeries(dailyRaw.series, view) };
  const chartLabelFn = view === 'monthly' ? (d => d.day) : (d => shortDay(d.day));

  function activityLine(role, e) {
    if (role === 'input') return `${esc(e.operator_name || '?')} used ${e.input_qty}${esc(e.input_unit || '')} ${esc(e.input_material_name)} -> produced ${e.output_qty}${esc(e.output_unit || '')} ${esc(e.output_material_name)} <span style="color:var(--muted)">(${dt(e.created_at)})</span>`;
    if (role === 'cutting') return `${esc(e.operator_name || '?')} (${esc(e.shift || 'shift n/a')}) packed ${e.qty_produced} x ${esc(e.product_name)} <span style="color:var(--muted)">(${dt(e.produced_at)})</span>`;
    if (role === 'picking') return `${esc(e.operator_name || '?')} collected ${e.qty} x ${esc(e.product_name)} from Packaging <span style="color:var(--muted)">(${dt(e.created_at)})</span>`;
    if (role === 'distribution') return `${esc(e.operator_name || '?')} took ${e.qty} x ${esc(e.product_name)} to ${esc(e.destination_person || e.destination_place || '?')} <span style="color:var(--muted)">(${dt(e.dispatched_at)})</span>`;
    return '';
  }

  return `
  <div class="card">
    <h3>Login link for staff phones</h3>
    ${netInfo.urls && netInfo.urls.length ? `
      <p style="color:var(--muted);font-size:13px;margin:0 0 8px">Share this with anyone who needs to log in from their phone - their phone must be on the same WiFi.</p>
      ${netInfo.urls.map(u => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        <input readonly value="${esc(u)}" style="flex:1;font-family:monospace" onclick="this.select()">
        <button class="btn secondary" onclick="actions.shareLoginLink('${esc(u)}')">Share</button>
      </div>`).join('')}
    ` : `<p style="color:var(--muted);font-size:13px;margin:0">Could not detect a WiFi/LAN address on this computer. Make sure it's connected to the router (not just this device).</p>`}
  </div>

  ${disputes.length ? `
  <div class="card" style="border:1px solid var(--danger)">
    <h3 style="color:var(--danger)">Pay disputes needing attention</h3>
    ${disputes.map(d => `<div class="tip warning">${esc(d.user_name)} (${esc(d.role)}) says they weren't paid ${money(d.amount)} from ${dt(d.paid_at)}: "${esc(d.dispute_note)}"
      <div style="margin-top:6px"><button class="btn secondary" onclick="actions.resolveDispute(${d.id})">Mark resolved (after you've followed up)</button></div></div>`).join('')}
  </div>` : ''}

  <div class="card">
    <h3>Offline tips</h3>
    ${renderTips(tipsData.tips)}
  </div>

  <div class="stat-row">
    <div class="stat ${cash && cash.cash_in_hand < 0 ? 'flash-red' : cash && cash.cash_in_hand > 0 ? 'flash-green' : ''}"><div class="value">${money(cash ? cash.cash_in_hand : 0)}</div><div class="label">Cash in hand</div></div>
    <div class="stat"><div class="value">${money(cash ? cash.today_in : 0)}</div><div class="label">Today in</div></div>
    <div class="stat"><div class="value">${money(cash ? cash.today_out : 0)}</div><div class="label">Today out</div></div>
  </div>

  <div class="card">
    <h3>Today's activity by section</h3>
    <div class="grid cols-2">
      ${status.stages.map(s => `<div class="stat">
        <div class="value">${s.today_count}</div>
        <div class="label">${esc(s.label)}</div>
        ${s.today_count === 0 ? '<span class="pill warn">Nothing logged today</span>' : '<span class="pill ok">Active today</span>'}
      </div>`).join('')}
    </div>
  </div>

  <div class="card">
    <h3>Recent activity, all sections</h3>
    ${(() => {
      const all = status.stages.flatMap(s => s.latest.map(e => ({ role: s.role, e })))
        .sort((a, b) => new Date(b.e.created_at || b.e.produced_at || b.e.dispatched_at || b.e.sold_at) - new Date(a.e.created_at || a.e.produced_at || a.e.dispatched_at || a.e.sold_at));
      const page = state.activityPage || 1;
      const shown = all.slice(0, page * 10);
      return (shown.map(({ role, e }) => `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">${activityLine(role, e)}</div>`).join('')
        || '<p style="color:var(--muted)">Nothing logged yet</p>')
        + (all.length > shown.length ? `<button class="btn secondary block" style="margin-top:8px" onclick="actions.showMoreActivity()">Show more (${all.length - shown.length} more)</button>` : '');
    })()}
  </div>

  <div class="card">
    <h3>Shifts today</h3>
    <p style="color:var(--muted);font-size:12px;margin-top:-4px">Who is on shift, and if they have logged any work yet. A shift closes itself after 12 hours if nobody clocks out.</p>
    ${shiftsToday.length ? (() => {
      const page = state.shiftsPage || 1;
      const shown = shiftsToday.slice(0, page * 10);
      return `<div class="table-wrap"><table><tr><th>Name</th><th>Section</th><th>Clocked in</th><th>Clocked out</th><th>Worked?</th></tr>
      ${shown.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(ROLE_LABELS[s.role] || s.role)}</td><td>${dt(s.clock_in)}</td>
        <td>${s.clock_out ? dt(s.clock_out) : '<span class="pill ok">Still in</span>'}</td>
        <td>${s.worked ? '<span class="pill ok">Yes</span>' : '<span class="pill warn">Not yet</span>'}</td></tr>`).join('')}
      </table></div>
      ${shiftsToday.length > shown.length ? `<button class="btn secondary block" style="margin-top:8px" onclick="actions.showMoreShifts()">Show more (${shiftsToday.length - shown.length} more)</button>` : ''}`;
    })() : '<p style="color:var(--muted)">Nobody has clocked in today</p>'}
    ${shiftsToday.some(s => !s.worked) ? `<div class="tip warning" style="margin-top:10px">${shiftsToday.filter(s => !s.worked).map(s => esc(s.name)).join(', ')} clocked in but has not logged any work yet today.</div>` : ''}
  </div>

  <div class="card">
    <h3>Production per day</h3>
    <div class="grid cols-3" style="margin-bottom:10px">
      <button class="btn ${view === 'daily' ? '' : 'secondary'}" onclick="actions.setChartView('daily')">Daily</button>
      <button class="btn ${view === 'weekly' ? '' : 'secondary'}" onclick="actions.setChartView('weekly')">Weekly</button>
      <button class="btn ${view === 'monthly' ? '' : 'secondary'}" onclick="actions.setChartView('monthly')">Monthly</button>
    </div>
    ${svgLineChart(daily.series, 'produced', { color: '#0f766e', labelFn: chartLabelFn })}
  </div>

  <div class="card">
    <h3>Money made vs money spent</h3>
    ${svgLineChart(daily.series, 'profit', { color: '#dc2626', labelFn: chartLabelFn })}
    <p style="color:var(--muted);font-size:11px;margin-top:6px">This line is: money from sales, minus what the bags cost to make, minus other spending. It is a close number, not an exact accountant's number.</p>
  </div>

  <div class="card">
    <h3>What it cost to run the plant today</h3>
    ${runningCosts ? `
    <div class="stat-row">
      <div class="stat"><div class="value">${money(runningCosts.materials)}</div><div class="label">Materials used</div></div>
      <div class="stat"><div class="value">${money(runningCosts.wages)}</div><div class="label">Wages paid</div></div>
      <div class="stat"><div class="value">${money(runningCosts.electricity)}</div><div class="label">Electricity</div></div>
      <div class="stat"><div class="value">${money(runningCosts.expenses)}</div><div class="label">Other spending</div></div>
    </div>
    <p style="margin-top:10px;font-weight:700">Total today: ${money(runningCosts.total)}</p>
    ` : '<p style="color:var(--muted)">No data yet</p>'}
  </div>

  ${pinRequests.length ? `
  <div class="card" style="border:1px solid var(--warn)">
    <h3 style="color:var(--warn)">People who need a new PIN</h3>
    ${pinRequests.map(r => `<div class="tip warning">${esc(r.name)} (${esc(ROLE_LABELS[r.role] || r.role)}) cannot log in.
      <div style="margin-top:6px"><button class="btn secondary" onclick="actions.resetUserPin(${r.user_id},'${esc(r.name)}')">Give them a new PIN</button></div></div>`).join('')}
  </div>` : ''}

  <div class="card">
    <h3>Low stock - finished goods</h3>
    ${lowStock.products.length ? lowStock.products.map(p => `<div>${esc(p.name)} (${esc(p.size)}) - ${p.stock_qty} left</div>`).join('') : '<p style="color:var(--muted)">None</p>'}
  </div>
  <div class="card">
    <h3>Low stock - raw materials</h3>
    ${lowStock.materials.length ? lowStock.materials.map(m => `<div>${esc(m.name)} - ${m.stock_qty}${esc(m.unit)} left</div>`).join('') : '<p style="color:var(--muted)">None</p>'}
  </div>`;
}
actions.setChartView = (view) => { state.chartView = view; renderApp(); };
actions.showMoreActivity = () => { state.activityPage = (state.activityPage || 1) + 1; renderApp(); };
actions.showMoreShifts = () => { state.shiftsPage = (state.shiftsPage || 1) + 1; renderApp(); };
actions.resetUserPin = async (userId, name) => {
  const pin = prompt(`New PIN for ${name} (4 numbers is easiest):`);
  if (!pin) return;
  await API.put(`/auth/users/${userId}/reset-pin`, { pin });
  alert(`Done. Tell ${name} their new PIN is ${pin}.`);
  renderApp();
};

async function pageWorkerDashboard() {
  const [tipsData, me, shift] = await Promise.all([
    API.get('/tips').catch(() => ({ tips: [] })),
    API.get('/payroll/me').catch(() => null),
    API.get('/shifts/status').catch(() => null),
  ]);

  return `
  <div class="card">
    <h3>Your shift</h3>
    ${shift ? `
      <p>${shift.clockedIn ? `Clocked in since <b>${dt(shift.current.clock_in)}</b>` : 'Not clocked in'}
      ${shift.shift_start || shift.shift_end ? ` — scheduled ${esc(shift.shift_start || '?')} to ${esc(shift.shift_end || '?')}` : ''}</p>
      <div class="grid cols-2">
        <button class="btn ${shift.clockedIn ? 'secondary' : ''}" ${shift.clockedIn ? 'disabled' : ''} onclick="actions.clockIn()">Clock in</button>
        <button class="btn ${!shift.clockedIn ? 'secondary' : ''}" ${!shift.clockedIn ? 'disabled' : ''} onclick="actions.clockOut()">Clock out</button>
      </div>
      <button class="btn secondary block" style="margin-top:8px" onclick="actions.enableAlarm()">Enable shift alarm on this phone</button>
      <p style="color:var(--muted);font-size:11px;margin-top:6px">The alarm only rings while this app is open in the browser on this phone (screen on or this tab active) - it can't wake the phone from fully closed, since that needs internet push and this app works offline.</p>
      <h3 style="margin-top:14px">Your clock / alarm time</h3>
      <p style="color:var(--muted);font-size:12px">Set this yourself - you don't need to ask admin.</p>
      <label>Alarm start</label><input id="my_shift_start" type="time" value="${esc(shift.shift_start || '')}">
      <label>Alarm end</label><input id="my_shift_end" type="time" value="${esc(shift.shift_end || '')}">
      <div id="myScheduleMsg"></div>
      <button class="btn secondary block" style="margin-top:8px" onclick="actions.saveMySchedule()">Save my clock times</button>
    ` : ''}
  </div>

  <div class="card">
    <h3>Tips</h3>
    ${renderTips(tipsData.tips)}
  </div>

  ${me ? (() => { const unit = me.pay_unit || 'unit'; const isCount = unit !== 'unit'; return `
  <div class="stat-row">
    <div class="stat"><div class="value">${me.today_qty}</div><div class="label">${isCount ? `${unit}${me.today_qty === 1 ? '' : 's'} today` : 'Done today'}</div></div>
    <div class="stat"><div class="value">${me.week_qty}</div><div class="label">${isCount ? `${unit}${me.week_qty === 1 ? '' : 's'} this week` : 'Done this week'}</div></div>
    <div class="stat ${me.unpaid_amount > 0 ? 'flash-green' : ''}"><div class="value">${money(me.unpaid_amount)}</div><div class="label">Owed to you</div></div>
  </div>`; })() : ''}

  ${me ? `

  <div class="card">
    <h3>Your output, last 7 days</h3>
    ${svgLineChart(me.daily, 'qty', { color: '#0f766e', labelFn: d => shortDay(d.day) })}
  </div>

  <div class="card">
    <h3>Pay status</h3>
    ${me.last_payment ? `
      <p>Last paid <b>${money(me.last_payment.amount)}</b> on ${dt(me.last_payment.paid_at)}${me.last_payment.notes ? ` — "${esc(me.last_payment.notes)}"` : ''}</p>
      ${me.last_payment.photo_path ? `<img src="/uploads/${esc(me.last_payment.photo_path)}" style="max-width:200px;border-radius:8px;border:1px solid var(--border)">` : ''}
      ${me.last_payment.disputed ? `<p class="msg error">You flagged this as not received. The admin has been notified.</p>` :
        `<button class="btn secondary" style="margin-top:8px" onclick="actions.disputePayment(${me.last_payment.id})">I wasn't paid this</button>`}
    ` : `<p style="color:var(--muted)">No payments recorded yet. You have ${money(me.unpaid_amount)} owed for ${me.unpaid_qty} units since you started.</p>`}
  </div>` : ''}`;
}
actions.clockIn = async () => { try { await API.post('/shifts/clock-in'); renderApp(); } catch (e) { alert(e.message); } };
actions.clockOut = async () => { try { await API.post('/shifts/clock-out'); renderApp(); } catch (e) { alert(e.message); } };

// Locks a work page behind "on shift" - a worker must press Start shift
// before they can log anything, and End shift closes it again. Admin sees
// exactly when each person started and stopped (Dashboard > Shifts today).
async function withShiftGate(contentFn) {
  const shift = await API.get('/shifts/status').catch(() => null);
  if (shift && !shift.clockedIn) {
    return `<div class="card">
      <h2>You are not on shift yet</h2>
      <p style="color:var(--muted)">Press the button below when you start work. The admin will see the time you started.</p>
      <button class="btn block" onclick="actions.clockIn()">Start my shift</button>
    </div>`;
  }
  const bar = shift ? `<div class="card" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
    <span>On shift since ${dt(shift.current.clock_in)}</span>
    <button class="btn secondary" onclick="actions.clockOut()">End my shift</button>
  </div>` : '';
  return bar + await contentFn();
}
actions.enableAlarm = async () => {
  if (!('Notification' in window)) { alert('Notifications are not supported on this browser.'); return; }
  const perm = await Notification.requestPermission();
  alert(perm === 'granted' ? 'Alarm enabled. Keep this app open (or in a background tab) on this phone for it to ring.' : 'Notifications were not allowed - the alarm will still beep on-screen while the app is open, just without a phone notification.');
};

// On-WiFi shift alarm: beeps + notifies while this tab is open, checking
// once every 30s. No internet/push involved - it only works because the
// phone's browser has this page open, which is the honest limit of a
// fully offline app (no cloud push server to wake a closed app).
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    o.start();
    o.stop(ctx.currentTime + 0.6);
    setTimeout(() => { try { ctx.close(); } catch (e) {} }, 900);
  } catch (e) { /* audio not available - notification/alert still fire */ }
}
function startShiftAlarm() {
  if (state.alarmStarted) return;
  state.alarmStarted = true;
  state.alarmedToday = {};
  setInterval(async () => {
    if (!API.token || !['input', 'cutting', 'picking', 'distribution', 'cashier'].includes(API.user.role)) return;
    let status;
    try { status = await API.get('/shifts/status'); } catch (e) { return; }
    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5);
    const todayKey = now.toISOString().slice(0, 10);
    for (const [label, time, msg] of [
      ['start', status.shift_start, 'Your shift is starting now.'],
      ['end', status.shift_end, 'Your shift is ending - remember to clock out.'],
    ]) {
      if (!time) continue;
      const key = `${todayKey}-${label}`;
      if (time === hhmm && !state.alarmedToday[key]) {
        state.alarmedToday[key] = true;
        beep();
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('PlastPOS', { body: msg });
        } else {
          alert(msg);
        }
      }
    }
  }, 30000);
}

actions.resolveDispute = async (id) => {
  const note = prompt('Resolution note (e.g. how you confirmed payment):') || '';
  await API.put(`/payroll/resolve/${id}`, { note });
  renderApp();
};
actions.disputePayment = async (id) => {
  const note = prompt('Briefly explain (e.g. "M-Pesa shows nothing received"):') || '';
  await API.post(`/payroll/dispute/${id}`, { note });
  renderApp();
};

// ---------------- POS ----------------
async function pagePOS() {
  if (API.user.role !== 'admin') return withShiftGate(pagePOSInner);
  return pagePOSInner();
}
async function pagePOSInner() {
  const products = await API.get('/inventory/products');
  const customers = await API.get('/customers').catch(() => []);
  return `
  <div class="grid pos-layout">
    <div>
      <div class="card">
        <h3>Bags</h3>
        <div class="grid cols-3">
          ${products.map(p => `
            <div class="product-btn ${p.stock_qty <= p.low_stock_threshold ? 'low' : ''}" onclick="actions.addToCart(${p.id})">
              <div class="name">${esc(p.name)}</div>
              <div class="price">${money(p.unit_price)}</div>
              <div class="price">Stock: ${p.stock_qty}</div>
            </div>`).join('')}
        </div>
      </div>
    </div>
    <div>
      <div class="card">
        <h3>Cart</h3>
        <div id="cartBox">${renderCartRows(products)}</div>
        <label>Customer (optional, for credit sales)</label>
        <select id="pos_customer">
          <option value="">Walk-in / cash</option>
          ${customers.map(c => `<option value="${c.id}">${esc(c.name)} (owes ${money(c.balance)})</option>`).join('')}
        </select>
        <label>Amount paid</label>
        <input id="pos_paid" type="number" step="0.01" value="${cartTotal(products).toFixed(2)}">
        <label>Payment method</label>
        <select id="pos_method">
          <option value="cash">Cash</option>
          <option value="mpesa">Mobile money</option>
          <option value="bank">Bank</option>
        </select>
        <div id="posMsg"></div>
        <button class="btn block" style="margin-top:10px" onclick="actions.checkout()">Complete sale</button>
      </div>
    </div>
  </div>`;
}
function cartTotal(products) {
  return state.cart.reduce((sum, line) => {
    const p = products.find(x => x.id === line.product_id);
    return sum + (p ? p.unit_price * line.qty : 0);
  }, 0);
}
function renderCartRows(products) {
  if (state.cart.length === 0) return `<p style="color:var(--muted)">Tap a bag to add it</p>`;
  return state.cart.map(line => {
    const p = products.find(x => x.id === line.product_id);
    if (!p) return '';
    return `<div class="cart-row">
      <div>${esc(p.name)}<br><span style="color:var(--muted)">${money(p.unit_price)} x ${line.qty}</span></div>
      <div class="qty-ctl">
        <button onclick="actions.changeQty(${p.id}, -1)">-</button>
        <span>${line.qty}</span>
        <button onclick="actions.changeQty(${p.id}, 1)">+</button>
      </div>
    </div>`;
  }).join('') + `<div class="cart-row"><b>Total</b><b>${money(cartTotal(products))}</b></div>`;
}
actions.addToCart = async (productId) => {
  const line = state.cart.find(l => l.product_id === productId);
  if (line) line.qty += 1; else state.cart.push({ product_id: productId, qty: 1 });
  const products = await API.get('/inventory/products');
  document.getElementById('cartBox').innerHTML = renderCartRows(products);
  document.getElementById('pos_paid').value = cartTotal(products).toFixed(2);
};
actions.changeQty = async (productId, delta) => {
  const line = state.cart.find(l => l.product_id === productId);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) state.cart = state.cart.filter(l => l.product_id !== productId);
  const products = await API.get('/inventory/products');
  document.getElementById('cartBox').innerHTML = renderCartRows(products);
  document.getElementById('pos_paid').value = cartTotal(products).toFixed(2);
};
actions.checkout = async () => {
  if (state.cart.length === 0) return;
  const body = {
    items: state.cart,
    customer_id: document.getElementById('pos_customer').value || null,
    amount_paid: Number(document.getElementById('pos_paid').value),
    payment_method: document.getElementById('pos_method').value,
  };
  try {
    const sale = await API.post('/sales', body);
    state.cart = [];
    navigate('#/receipt/' + sale.id);
  } catch (e) {
    document.getElementById('posMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};

// ---------------- Receipt (print / share) ----------------
async function pageReceipt(id) {
  const sale = await API.get('/sales/' + id);
  const biz = state.settings;
  const lines = sale.items.map(i => `${i.product_name} (${i.size}) x${i.qty} .... ${money(i.subtotal)}`).join('\n');
  const balanceDue = sale.total_amount - sale.amount_paid;
  const shareText = `${biz.business_name}\n${biz.phone || ''}\nReceipt: ${sale.receipt_no}\n${dt(sale.sold_at)}\n\n${lines}\n\nTotal: ${money(sale.total_amount)}\nPaid: ${money(sale.amount_paid)}${balanceDue > 0 ? `\nBalance due: ${money(balanceDue)}` : ''}\n\nThank you!`;

  setTimeout(() => { window.__receiptShareText = shareText; }, 0);

  return `
  <div class="receipt" id="receiptBox">
    <div style="text-align:center">
      <b>${esc(biz.business_name || '')}</b><br>
      ${esc(biz.address || '')}<br>
      ${esc(biz.phone || '')}
    </div>
    <div class="line"></div>
    Receipt: ${esc(sale.receipt_no)}<br>
    Date: ${dt(sale.sold_at)}<br>
    ${sale.customer_name ? `Customer: ${esc(sale.customer_name)}<br>` : ''}
    <div class="line"></div>
    ${sale.items.map(i => `<div class="row"><span>${esc(i.product_name)} (${esc(i.size)}) x${i.qty}</span><span>${money(i.subtotal)}</span></div>`).join('')}
    <div class="line"></div>
    <div class="row"><b>Total</b><b>${money(sale.total_amount)}</b></div>
    <div class="row"><span>Paid</span><span>${money(sale.amount_paid)}</span></div>
    ${balanceDue > 0 ? `<div class="row"><span>Balance due</span><span>${money(balanceDue)}</span></div>` : ''}
    <div class="line"></div>
    <div style="text-align:center">Thank you!</div>
  </div>
  <div class="no-print" style="max-width:320px;margin:12px auto;display:flex;gap:8px">
    <button class="btn secondary" style="flex:1" onclick="window.print()">Print</button>
    <button class="btn" style="flex:1" onclick="actions.shareReceipt()">Share (WhatsApp/SMS)</button>
  </div>
  <div class="no-print" style="max-width:320px;margin:0 auto"><a href="#/pos" class="btn secondary block">New sale</a></div>`;
}
actions.shareReceipt = async () => {
  const text = window.__receiptShareText || '';
  if (navigator.share) {
    try { await navigator.share({ title: 'Receipt', text }); return; } catch (e) { /* user cancelled */ return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    alert('Sharing is not supported on this browser - receipt text copied instead, paste it into WhatsApp.');
  } catch (e) {
    alert(text);
  }
};

// Delivery slip for Picking - same idea as the sale receipt, but for a
// delivery instead of a shop sale, so the driver has something to show.
async function pageDeliveryReceipt(id) {
  const d = await API.get('/stages/dispatch/' + id);
  const biz = state.settings;
  const shareText = `${biz.business_name}\n${biz.phone || ''}\nDelivery slip\n${dt(d.dispatched_at)}\n\n${d.qty} x ${d.product_name} (${d.size})\nTo: ${d.destination_person || ''} ${d.destination_place ? '- ' + d.destination_place : ''}\n${d.vehicle ? `Vehicle: ${d.vehicle}\n` : ''}${d.amount_collected > 0 ? `Collected: ${money(d.amount_collected)} (${d.payment_method || ''})\n` : 'Not paid yet\n'}`;
  setTimeout(() => { window.__receiptShareText = shareText; }, 0);

  return `
  <div class="receipt" id="receiptBox">
    <div style="text-align:center">
      <b>${esc(biz.business_name || '')}</b><br>
      ${esc(biz.address || '')}<br>
      ${esc(biz.phone || '')}
    </div>
    <div class="line"></div>
    Delivery slip<br>
    Date: ${dt(d.dispatched_at)}<br>
    Taken by: ${esc(d.operator_name || '')}<br>
    <div class="line"></div>
    <div class="row"><span>${esc(d.product_name)} (${esc(d.size)})</span><span>x${d.qty}</span></div>
    To: ${esc(d.destination_person || '')}<br>
    ${d.destination_place ? `Place: ${esc(d.destination_place)}<br>` : ''}
    ${d.vehicle ? `Vehicle: ${esc(d.vehicle)}<br>` : ''}
    <div class="line"></div>
    ${d.amount_collected > 0
      ? `<div class="row"><span>Collected</span><span>${money(d.amount_collected)} ${esc(d.payment_method || '')}</span></div>`
      : `<div style="text-align:center">Not paid yet</div>`}
    <div class="line"></div>
    <div style="text-align:center">Thank you!</div>
  </div>
  <div class="no-print" style="max-width:320px;margin:12px auto;display:flex;gap:8px">
    <button class="btn secondary" style="flex:1" onclick="window.print()">Print</button>
    <button class="btn" style="flex:1" onclick="actions.shareReceipt()">Share (WhatsApp/SMS)</button>
  </div>
  <div class="no-print" style="max-width:320px;margin:0 auto"><a href="#/dispatch" class="btn secondary block">Back to deliveries</a></div>`;
}

// ---------------- Inventory ----------------
async function pageInventory() {
  const [products, materials] = await Promise.all([API.get('/inventory/products'), API.get('/inventory/materials')]);
  const isAdmin = API.user.role === 'admin';
  return `
  <div class="card">
    <h2>Finished bags</h2>
    <div class="table-wrap"><table>
      <tr><th>Product</th><th>Size</th><th>Price</th><th>In stock</th>${isAdmin ? '<th></th>' : ''}</tr>
      ${products.map(p => `<tr>
        <td>${esc(p.name)}</td><td>${esc(p.size)}</td><td>${money(p.unit_price)}</td>
        <td>${p.stock_qty <= p.low_stock_threshold ? `<span class="pill warn">${p.stock_qty}</span>` : p.stock_qty}${p.pack_qty ? ` <span style="color:var(--muted)">(${(p.stock_qty / p.pack_qty).toFixed(1)} ${esc(p.pack_unit_label || 'packet')}s)</span>` : ''}</td>
        ${isAdmin ? `<td><button class="btn secondary" onclick="actions.editProduct(${p.id})">Edit</button></td>` : ''}
      </tr>`).join('')}
    </table></div>
    <div id="prodEditBox"></div>
    ${isAdmin ? `<button class="btn secondary" style="margin-top:10px" onclick="actions.showNewProductForm()">Add a new bag size</button><div id="newProdBox"></div>` : ''}
  </div>
  <div class="card">
    <h2>Raw materials</h2>
    <p style="color:var(--muted);font-size:13px">Press Edit to type in how much you have and what it cost - no popup boxes.</p>
    <div class="table-wrap"><table>
      <tr><th>Material</th><th>Unit</th><th>In stock</th><th>Cost each</th>${isAdmin ? '<th></th>' : ''}</tr>
      ${materials.map(m => `<tr>
        <td>${esc(m.name)}</td><td>${esc(m.unit)}</td>
        <td>${m.stock_qty <= m.low_stock_threshold ? `<span class="pill warn">${m.stock_qty}</span>` : m.stock_qty}${m.sack_weight_kg ? ` <span style="color:var(--muted)">(${(m.stock_qty / m.sack_weight_kg).toFixed(1)} sacks)</span>` : ''}</td>
        <td>${money(m.avg_cost)}</td>
        ${isAdmin ? `<td><button class="btn secondary" onclick="actions.editMaterial(${m.id})">Edit</button></td>` : ''}
      </tr>`).join('')}
    </table></div>
    <div id="matEditBox"></div>
    ${isAdmin ? `<button class="btn secondary" style="margin-top:10px" onclick="actions.showNewMaterialForm()">Add a new material</button><div id="newMatBox"></div>` : ''}
  </div>
  ${isAdmin ? `<div class="card"><h2>How much material each bag uses</h2>
    <p style="color:var(--muted);font-size:13px">This is how the app knows how much material to take away, and what each bag costs, every time Packaging logs a batch.</p>
    <label>Bag size</label>
    <select id="bom_product" onchange="actions.loadBom()">${products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    <div id="bomBox"></div>
  </div>` : ''}`;
}
actions.showNewProductForm = () => {
  document.getElementById('newProdBox').innerHTML = `<div class="card">
    <label>Name (e.g. Paper Bag 1kg)</label><input id="np_name">
    <label>Size label (e.g. 1kg)</label><input id="np_size">
    <label>Selling price (per piece)</label><input id="np_price" type="number" step="0.01">
    <label>Packed into units for counting? What's each one called (e.g. packet, bale) - leave blank if counted piece by piece</label><input id="np_pack_label" oninput="actions.onNewProdPackChange()" placeholder="e.g. packet">
    <label>Usual pieces per unit (leave blank if not)</label><input id="np_pack_qty" type="number" step="1" oninput="actions.onNewProdPackChange()" placeholder="e.g. 100">
    <div id="np_low_wrap"><label>Warn when stock falls below</label><input id="np_low" type="number" step="0.01" value="0"></div>
    <div id="npMsg"></div>
    <button class="btn block" style="margin-top:8px" onclick="actions.newProduct()">Save</button>
  </div>`;
};
actions.onNewProdPackChange = () => {
  const qty = Number(document.getElementById('np_pack_qty').value) || 0;
  const label = document.getElementById('np_pack_label').value.trim() || 'packet';
  document.getElementById('np_low_wrap').innerHTML = qty
    ? `<label>Warn when stock falls below (in ${esc(label)}s)</label><input id="np_low" type="number" step="0.01" value="0">`
    : `<label>Warn when stock falls below</label><input id="np_low" type="number" step="0.01" value="0">`;
};
actions.newProduct = async () => {
  const name = document.getElementById('np_name').value.trim();
  const size = document.getElementById('np_size').value.trim();
  const unit_price = Number(document.getElementById('np_price').value) || 0;
  const pack_qty = Number(document.getElementById('np_pack_qty').value) || 0;
  const lowInput = Number(document.getElementById('np_low').value) || 0;
  const low_stock_threshold = pack_qty ? lowInput * pack_qty : lowInput;
  const pack_unit_label = document.getElementById('np_pack_label').value.trim() || null;
  if (!name) { document.getElementById('npMsg').innerHTML = `<div class="msg error">Type a name.</div>`; return; }
  try {
    await API.post('/inventory/products', { name, size, unit_price, low_stock_threshold, pack_qty: pack_qty || null, pack_unit_label });
    renderApp();
  } catch (e) { document.getElementById('npMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`; }
};
actions.editProduct = async (id) => {
  const p = (await API.get('/inventory/products')).find(x => x.id === id);
  if (!p) return;
  window.__editProduct = p;
  document.getElementById('prodEditBox').innerHTML = `<div class="card">
    <h3>Edit ${esc(p.name)}</h3>
    <label>Name</label><input id="ep_name" value="${esc(p.name)}">
    <label>Size label</label><input id="ep_size" value="${esc(p.size)}">
    <label>Selling price (per piece)</label><input id="ep_price" type="number" step="0.01" value="${p.unit_price}">
    <label>Packed into units for counting? What's each one called (e.g. packet, bale) - leave blank if counted piece by piece</label><input id="ep_pack_label" value="${esc(p.pack_unit_label || '')}" oninput="actions.onEditProdPackChange()" placeholder="e.g. packet">
    <label>Usual pieces per unit (leave blank if not)</label><input id="ep_pack_qty" type="number" step="1" value="${p.pack_qty || ''}" oninput="actions.onEditProdPackChange()" placeholder="e.g. 100">
    <div id="ep_stock_wrap"></div>
    <div id="ep_low_wrap"></div>
    <div id="epMsg"></div>
    <div class="grid cols-2" style="margin-top:8px">
      <button class="btn" onclick="actions.saveProduct(${id})">Save</button>
      <button class="btn secondary" onclick="document.getElementById('prodEditBox').innerHTML=''">Cancel</button>
    </div>
  </div>`;
  actions.onEditProdPackChange();
};
actions.onEditProdPackChange = () => {
  const p = window.__editProduct;
  const label = document.getElementById('ep_pack_label').value.trim() || 'packet';
  const qty = Number(document.getElementById('ep_pack_qty').value) || 0;
  if (qty) {
    const stockUnits = p.stock_qty / qty;
    const lowUnits = p.low_stock_threshold / qty;
    document.getElementById('ep_stock_wrap').innerHTML = `
      <label>How many ${esc(label)}s in stock right now</label>
      <input id="ep_stock" type="number" step="0.01" value="${stockUnits.toFixed(2)}" oninput="actions.updateEditProdPieceHint()">
      <p id="ep_stock_hint" style="color:var(--muted);font-size:12px;margin:2px 0 0">= ${p.stock_qty} pieces</p>`;
    document.getElementById('ep_low_wrap').innerHTML = `
      <label>Warn when stock falls below (in ${esc(label)}s)</label>
      <input id="ep_low" type="number" step="0.01" value="${lowUnits.toFixed(2)}">`;
  } else {
    document.getElementById('ep_stock_wrap').innerHTML = `
      <label>How many are in stock right now</label><input id="ep_stock" type="number" step="1" value="${p.stock_qty}">`;
    document.getElementById('ep_low_wrap').innerHTML = `
      <label>Warn when stock falls below</label><input id="ep_low" type="number" step="1" value="${p.low_stock_threshold}">`;
  }
};
actions.updateEditProdPieceHint = () => {
  const qty = Number(document.getElementById('ep_pack_qty').value) || 0;
  const units = Number(document.getElementById('ep_stock').value) || 0;
  const hint = document.getElementById('ep_stock_hint');
  if (hint) hint.textContent = `= ${(units * qty).toFixed(1)} pieces`;
};
actions.saveProduct = async (id) => {
  const packQty = Number(document.getElementById('ep_pack_qty').value) || 0;
  const stockInput = Number(document.getElementById('ep_stock').value) || 0;
  const lowInput = Number(document.getElementById('ep_low').value) || 0;
  const body = {
    name: document.getElementById('ep_name').value,
    size: document.getElementById('ep_size').value,
    unit_price: Number(document.getElementById('ep_price').value),
    stock_qty: packQty ? stockInput * packQty : stockInput,
    low_stock_threshold: packQty ? lowInput * packQty : lowInput,
    pack_qty: packQty || null,
    pack_unit_label: document.getElementById('ep_pack_label').value.trim() || null,
  };
  try {
    await API.put('/inventory/products/' + id, body);
    renderApp();
  } catch (e) { document.getElementById('epMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`; }
};
actions.showNewMaterialForm = () => {
  document.getElementById('newMatBox').innerHTML = `<div class="card">
    <label>Name</label><input id="nm_name">
    <label>Unit (kg, roll, litre...)</label><input id="nm_unit" value="kg">
    <label>Packed in units? What's each one called (e.g. sack, roll, bag, drum) - leave blank if not packed in units</label><input id="nm_pack_label" oninput="actions.onNewMatSackChange()" placeholder="e.g. sack">
    <label>Usual weight per unit in kg (leave blank if not - this is just a starting suggestion, each purchase/input can use a different weight for that supplier/batch)</label><input id="nm_sack" type="number" step="0.01" oninput="actions.onNewMatSackChange()" placeholder="e.g. 50">
    <div id="nm_low_wrap"><label>Warn when stock falls below</label><input id="nm_low" type="number" step="0.01" value="0"></div>
    <div id="nmMsg"></div>
    <button class="btn block" style="margin-top:8px" onclick="actions.newMaterial()">Save</button>
  </div>`;
};
actions.onNewMatSackChange = () => {
  const weight = Number(document.getElementById('nm_sack').value) || 0;
  const label = document.getElementById('nm_pack_label').value.trim() || 'sack';
  document.getElementById('nm_low_wrap').innerHTML = weight
    ? `<label>Warn when stock falls below (in ${esc(label)}s)</label><input id="nm_low" type="number" step="0.01" value="0">`
    : `<label>Warn when stock falls below</label><input id="nm_low" type="number" step="0.01" value="0">`;
};
actions.newMaterial = async () => {
  const name = document.getElementById('nm_name').value.trim();
  const unit = document.getElementById('nm_unit').value.trim() || 'kg';
  const sackVal = document.getElementById('nm_sack').value;
  const weight = sackVal ? Number(sackVal) : 0;
  const lowInput = Number(document.getElementById('nm_low').value) || 0;
  const low_stock_threshold = weight ? lowInput * weight : lowInput;
  const pack_unit_label = document.getElementById('nm_pack_label').value.trim() || null;
  if (!name) { document.getElementById('nmMsg').innerHTML = `<div class="msg error">Type a name.</div>`; return; }
  try {
    await API.post('/inventory/materials', { name, unit, low_stock_threshold, sack_weight_kg: weight || null, pack_unit_label });
    renderApp();
  } catch (e) { document.getElementById('nmMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`; }
};
actions.editMaterial = async (id) => {
  const m = (await API.get('/inventory/materials')).find(x => x.id === id);
  if (!m) return;
  window.__editMaterial = m;
  document.getElementById('matEditBox').innerHTML = `<div class="card">
    <h3>Edit ${esc(m.name)}</h3>
    <label>Name</label><input id="em_name" value="${esc(m.name)}">
    <label>Unit</label><input id="em_unit" value="${esc(m.unit)}">
    <label>Packed in units? What's each one called (e.g. sack, roll, bag, drum) - leave blank if not packed in units</label><input id="em_pack_label" value="${esc(m.pack_unit_label || '')}" oninput="actions.onEditSackChange()" placeholder="e.g. sack">
    <label>Usual weight per unit in kg (leave blank if not)</label><input id="em_sack" type="number" step="0.01" value="${m.sack_weight_kg || ''}" oninput="actions.onEditSackChange()" placeholder="e.g. 50">
    <div id="em_stock_wrap"></div>
    <div id="em_cost_wrap"></div>
    <div id="em_low_wrap"></div>
    <div id="emMsg"></div>
    <div class="grid cols-2" style="margin-top:8px">
      <button class="btn" onclick="actions.saveMaterial(${id})">Save</button>
      <button class="btn secondary" onclick="document.getElementById('matEditBox').innerHTML=''">Cancel</button>
    </div>
  </div>`;
  actions.onEditSackChange();
};
// Once a material is packed in units (sack/roll/whatever), the admin thinks
// in units, not kg - so stock, the low-stock warning, and cost all switch to
// unit-based entry here too (not just Purchases/Input), converting to/from
// the kg the system tracks internally under the hood.
actions.onEditSackChange = () => {
  const m = window.__editMaterial;
  const label = document.getElementById('em_pack_label').value.trim() || 'sack';
  const weight = Number(document.getElementById('em_sack').value) || 0;

  if (weight) {
    const stockUnits = m.stock_qty / weight;
    const lowUnits = m.low_stock_threshold / weight;
    const costPerUnit = m.avg_cost * weight;
    document.getElementById('em_stock_wrap').innerHTML = `
      <label>How many ${esc(label)}s in stock right now</label>
      <input id="em_stock" type="number" step="0.01" value="${stockUnits.toFixed(2)}" oninput="actions.updateEditKgHint()">
      <p id="em_stock_hint" style="color:var(--muted);font-size:12px;margin:2px 0 0">= ${m.stock_qty}kg</p>`;
    document.getElementById('em_cost_wrap').innerHTML = `
      <label>Cost per</label>
      <div style="display:flex;gap:14px;align-items:center;margin:4px 0 6px">
        <label style="width:auto;font-weight:normal;display:flex;gap:4px;align-items:center"><input type="radio" name="em_cost_unit" value="unit" checked style="width:auto" onchange="actions.onEditCostUnitChange()"> ${esc(label)}</label>
        <label style="width:auto;font-weight:normal;display:flex;gap:4px;align-items:center"><input type="radio" name="em_cost_unit" value="kg" style="width:auto" onchange="actions.onEditCostUnitChange()"> kg</label>
      </div>
      <input id="em_cost" type="number" step="0.01" value="${costPerUnit.toFixed(2)}">`;
    document.getElementById('em_low_wrap').innerHTML = `
      <label>Warn when stock falls below (in ${esc(label)}s)</label>
      <input id="em_low" type="number" step="0.01" value="${lowUnits.toFixed(2)}">`;
  } else {
    document.getElementById('em_stock_wrap').innerHTML = `
      <label>How much is in stock right now (in ${esc(m.unit)})</label>
      <input id="em_stock" type="number" step="0.01" value="${m.stock_qty}">`;
    document.getElementById('em_cost_wrap').innerHTML = `
      <label>Cost, per ${esc(m.unit)}</label><input id="em_cost" type="number" step="0.01" value="${m.avg_cost}">`;
    document.getElementById('em_low_wrap').innerHTML = `
      <label>Warn when stock falls below</label><input id="em_low" type="number" step="0.01" value="${m.low_stock_threshold}">`;
  }
};
actions.updateEditKgHint = () => {
  const weight = Number(document.getElementById('em_sack').value) || 0;
  const units = Number(document.getElementById('em_stock').value) || 0;
  const hint = document.getElementById('em_stock_hint');
  if (hint) hint.textContent = `= ${(units * weight).toFixed(1)}kg`;
};
actions.onEditCostUnitChange = () => {
  const m = window.__editMaterial;
  const weight = Number(document.getElementById('em_sack').value) || 0;
  const unit = document.querySelector('input[name="em_cost_unit"]:checked').value;
  document.getElementById('em_cost').value = unit === 'unit' ? (m.avg_cost * weight).toFixed(2) : m.avg_cost;
};
actions.saveMaterial = async (id) => {
  const m = window.__editMaterial;
  const sackVal = document.getElementById('em_sack').value;
  const weight = sackVal ? Number(sackVal) : 0;
  const stockInput = Number(document.getElementById('em_stock').value) || 0;
  const lowInput = Number(document.getElementById('em_low').value) || 0;
  const costInput = Number(document.getElementById('em_cost').value) || 0;

  let stock_qty, low_stock_threshold, avg_cost;
  if (weight) {
    stock_qty = stockInput * weight;
    low_stock_threshold = lowInput * weight;
    const costRadio = document.querySelector('input[name="em_cost_unit"]:checked');
    avg_cost = (costRadio && costRadio.value === 'kg') ? costInput : costInput / weight;
  } else {
    stock_qty = stockInput;
    low_stock_threshold = lowInput;
    avg_cost = costInput;
  }

  const body = {
    name: document.getElementById('em_name').value,
    unit: document.getElementById('em_unit').value,
    stock_qty, avg_cost, low_stock_threshold,
    sack_weight_kg: weight || null,
    pack_unit_label: document.getElementById('em_pack_label').value.trim() || null,
  };
  try {
    await API.put('/inventory/materials/' + id, body);
    renderApp();
  } catch (e) { document.getElementById('emMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`; }
};
actions.loadBom = async () => {
  const productId = document.getElementById('bom_product').value;
  const [lines, materials] = await Promise.all([API.get('/inventory/bom/' + productId), API.get('/inventory/materials')]);
  document.getElementById('bomBox').innerHTML = `
    <table><tr><th>Material</th><th>Qty per bag</th><th></th></tr>
    ${lines.map(l => `<tr><td>${esc(l.material_name)}</td><td>${l.qty_per_unit}${esc(l.unit)}</td>
      <td><button class="btn secondary" onclick="actions.deleteBom(${l.id})">Remove</button></td></tr>`).join('')}
    </table>
    <label>Add material</label>
    <select id="bom_material">${materials.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
    <label>Qty per bag</label>
    <input id="bom_qty" type="number" step="0.0001">
    <button class="btn secondary" style="margin-top:8px" onclick="actions.addBom(${productId})">Add to BOM</button>`;
};
actions.addBom = async (productId) => {
  const material_id = document.getElementById('bom_material').value;
  const qty_per_unit = Number(document.getElementById('bom_qty').value);
  if (!qty_per_unit) return;
  await API.post('/inventory/bom', { product_id: productId, material_id, qty_per_unit });
  actions.loadBom();
};
actions.deleteBom = async (id) => { await API.del('/inventory/bom/' + id); actions.loadBom(); };

// ---------------- Manufacturing ----------------
async function pageManufacturing() {
  if (API.user.role !== 'admin') return withShiftGate(pageManufacturingInner);
  return pageManufacturingInner();
}
async function pageManufacturingInner() {
  const [products, batches] = await Promise.all([API.get('/inventory/products'), API.get('/production')]);
  setTimeout(() => { if (document.getElementById('prod_product')) actions.onProdProductChange(); }, 0);
  return `
  <div class="card">
    <h2>Packaging: log bags produced from rolls</h2>
    <label>Product / bag size</label>
    <select id="prod_product" onchange="actions.onProdProductChange()">${products.map(p => `<option value="${p.id}" data-pack="${p.pack_qty || ''}" data-label="${esc(p.pack_unit_label || 'packet')}">${esc(p.name)} (${esc(p.size)})</option>`).join('')}</select>
    <label><input type="checkbox" id="prod_use_pack" style="width:auto;display:inline-block;vertical-align:middle" onchange="actions.toggleProdPackFields()"> Measure this in <span id="prod_pack_label">packets</span></label>
    <div id="prod_pack_field" style="display:none">
      <label>How many <span id="prod_pack_label2">packets</span></label>
      <input id="prod_packs" type="number" step="1">
      <label>Pieces per <span id="prod_pack_label3">packet</span></label>
      <input id="prod_pack_qty" type="number" step="1" placeholder="e.g. 100">
    </div>
    <div id="prod_qty_field">
      <label>Quantity produced (pieces)</label>
      <input id="prod_qty" type="number" step="1">
    </div>
    <label>Shift (guessed from this computer's clock - change it if it's wrong)</label>
    <select id="prod_shift">${['Morning', 'Afternoon', 'Night'].map(s => `<option ${s === guessShift() ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <label>Notes</label>
    <input id="prod_notes" placeholder="optional">
    <label>Photo of the packed bags (optional)</label>
    <input id="prod_photo" type="file" accept="image/*" capture="environment">
    <div id="prodMsg"></div>
    <button class="btn block" style="margin-top:10px" onclick="actions.logProduction()">Save production run</button>
  </div>
  <div class="card">
    <h2>Recent batches</h2>
    <div class="table-wrap"><table>
      <tr><th>Date</th><th>Product</th><th>Qty</th><th>Shift</th><th>Operator</th><th>Material cost</th><th>Photo</th></tr>
      ${batches.map(b => `<tr><td>${dt(b.produced_at)}</td><td>${esc(b.product_name)} (${esc(b.size)})</td>
        <td>${b.qty_produced}${b.pack_qty ? ` <span style="color:var(--muted)">(${(b.qty_produced / b.pack_qty).toFixed(1)} ${esc(b.pack_unit_label || 'packet')}s)</span>` : ''}</td>
        <td>${esc(b.shift)}</td><td>${esc(b.operator_name || '')}</td><td>${money(b.material_cost)}</td>
        <td>${b.photo_path ? `<a href="/uploads/${esc(b.photo_path)}" target="_blank">view</a>` : ''}</td></tr>`).join('')}
    </table></div>
  </div>`;
}
actions.onProdProductChange = () => {
  const opt = document.getElementById('prod_product').selectedOptions[0];
  const defaultPack = opt ? Number(opt.dataset.pack) : 0;
  const label = opt ? opt.dataset.label : 'packet';
  document.getElementById('prod_pack_qty').value = defaultPack || '';
  document.getElementById('prod_use_pack').checked = !!defaultPack;
  document.getElementById('prod_pack_label').textContent = label + 's';
  document.getElementById('prod_pack_label2').textContent = label + 's';
  document.getElementById('prod_pack_label3').textContent = label;
  actions.toggleProdPackFields();
};
actions.toggleProdPackFields = () => {
  const usePack = document.getElementById('prod_use_pack').checked;
  document.getElementById('prod_pack_field').style.display = usePack ? '' : 'none';
  document.getElementById('prod_qty_field').style.display = usePack ? 'none' : '';
};
actions.logProduction = async () => {
  const usePack = document.getElementById('prod_use_pack').checked;
  let qty_produced;
  if (usePack) {
    const packs = Number(document.getElementById('prod_packs').value) || 0;
    const packQty = Number(document.getElementById('prod_pack_qty').value) || 0;
    if (!packs || !packQty) { document.getElementById('prodMsg').innerHTML = `<div class="msg error">Type how many ${document.getElementById('prod_pack_label2').textContent} and pieces per one.</div>`; return; }
    qty_produced = packs * packQty;
  } else {
    qty_produced = document.getElementById('prod_qty').value;
  }
  const form = new FormData();
  form.append('product_id', document.getElementById('prod_product').value);
  form.append('qty_produced', qty_produced);
  form.append('shift', document.getElementById('prod_shift').value);
  form.append('notes', document.getElementById('prod_notes').value);
  const photoInput = document.getElementById('prod_photo');
  if (photoInput.files[0]) form.append('photo', photoInput.files[0]);
  try {
    await API.postForm('/production', form);
    renderApp();
  } catch (e) {
    document.getElementById('prodMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};

// ---------------- Plant Operator: beads in, rolls out ----------------
async function pageStageInput() {
  if (API.user.role !== 'admin') return withShiftGate(pageStageInputInner);
  return pageStageInputInner();
}
async function pageStageInputInner() {
  const [materials, conversions, machines, elecLogs] = await Promise.all([
    API.get('/inventory/materials'), API.get('/stages/input'), API.get('/machines'), API.get('/stages/electricity'),
  ]);
  setTimeout(() => { if (document.getElementById('in_material')) { actions.onInputMaterialChange(); actions.onInputOutMaterialChange(); } }, 0);
  return `
  <div class="card">
    <h2>What did you feed the machine, and what came out?</h2>
    <label>Which machine</label>
    <select id="in_machine">${machines.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
    <label>What you put in (e.g. Plastic Beads)</label>
    <select id="in_material" onchange="actions.onInputMaterialChange()">${materials.map(m => `<option value="${m.id}" data-sack="${m.sack_weight_kg || ''}" data-label="${esc(packLabel(m))}">${esc(m.name)} (${esc(m.unit)}) - ${m.stock_qty} left${m.sack_weight_kg ? ` / ${(m.stock_qty / m.sack_weight_kg).toFixed(1)} ${esc(packLabel(m))}s` : ''}</option>`).join('')}</select>
    <label><input type="checkbox" id="in_use_sacks" style="width:auto;display:inline-block;vertical-align:middle" onchange="actions.toggleInputSackFields()"> Measure this in <span id="in_sack_label">sacks</span></label>
    <div id="in_sack_field" style="display:none">
      <label>How many <span id="in_sack_label2">sacks</span></label>
      <input id="in_sacks" type="number" step="1">
      <label>Weight per <span id="in_sack_label3">sack</span> (kg) - this supplier's size</label>
      <input id="in_sack_weight" type="number" step="0.01" placeholder="e.g. 50">
    </div>
    <div id="in_qty_field">
      <label>How much you put in (kg)</label>
      <input id="in_qty" type="number" step="0.01">
    </div>
    <label>What came out (e.g. Plastic Roll)</label>
    <select id="in_out_material" onchange="actions.onInputOutMaterialChange()">${materials.map(m => `<option value="${m.id}" data-sack="${m.sack_weight_kg || ''}" data-label="${esc(packLabel(m))}">${esc(m.name)} (${esc(m.unit)})</option>`).join('')}</select>
    <label><input type="checkbox" id="in_out_use_sacks" style="width:auto;display:inline-block;vertical-align:middle" onchange="actions.toggleInputOutSackFields()"> Measure this in <span id="in_out_sack_label">sacks</span></label>
    <div id="in_out_sack_field" style="display:none">
      <label>How many <span id="in_out_sack_label2">sacks</span> came out</label>
      <input id="in_out_sacks" type="number" step="1">
      <label>Weight per <span id="in_out_sack_label3">sack</span> (kg)</label>
      <input id="in_out_sack_weight" type="number" step="0.01" placeholder="e.g. 25">
    </div>
    <div id="in_out_qty_field">
      <label>How much came out (kg)</label>
      <input id="in_out_qty" type="number" step="0.01">
    </div>
    <label>Where the material came from (optional)</label>
    <input id="in_source" placeholder="e.g. ABC Polymers">
    <label>Notes</label>
    <input id="in_notes" placeholder="optional">
    <label>Take a photo</label>
    <input id="in_photo" type="file" accept="image/*" capture="environment">
    <div id="inMsg"></div>
    <button class="btn block" style="margin-top:10px" onclick="actions.logInput()">Save</button>
  </div>

  <div class="card">
    <h2>Today's electricity</h2>
    <p style="color:var(--muted);font-size:13px">Read the meter and type the number here, once a day.</p>
    <label>Units used (kWh)</label>
    <input id="elec_kwh" type="number" step="0.01">
    <div id="elecMsg"></div>
    <button class="btn secondary block" style="margin-top:10px" onclick="actions.logElectricity()">Save electricity reading</button>
    <div class="table-wrap" style="margin-top:12px"><table><tr><th>Date</th><th>kWh</th><th>Cost</th></tr>
      ${elecLogs.slice(0, 7).map(e => `<tr><td>${esc(e.log_date)}</td><td>${e.kwh}</td><td>${money(e.cost)}</td></tr>`).join('')}
    </table></div>
  </div>

  <div class="card">
    <h2>What you have logged</h2>
    <div class="table-wrap"><table>
      <tr><th>Date</th><th>Machine</th><th>Put in</th><th>Came out</th><th>From</th><th>Photo</th></tr>
      ${conversions.map(c => `<tr><td>${dt(c.created_at)}</td><td>${esc(c.machine_name || '')}</td>
        <td>${c.input_qty}${esc(c.input_unit)} ${esc(c.input_material_name)}</td>
        <td>${c.output_qty}${esc(c.output_unit)} ${esc(c.output_material_name)}</td>
        <td>${esc(c.source_company || '')}</td>
        <td>${c.photo_path ? `<a href="/uploads/${esc(c.photo_path)}" target="_blank">view</a>` : ''}</td></tr>`).join('')}
    </table></div>
  </div>`;
}
actions.onInputMaterialChange = () => {
  const opt = document.getElementById('in_material').selectedOptions[0];
  const defaultSack = opt ? Number(opt.dataset.sack) : 0;
  const label = opt ? opt.dataset.label : 'sack';
  document.getElementById('in_sack_weight').value = defaultSack || '';
  document.getElementById('in_use_sacks').checked = !!defaultSack;
  document.getElementById('in_sack_label').textContent = label + 's';
  document.getElementById('in_sack_label2').textContent = label + 's';
  document.getElementById('in_sack_label3').textContent = label;
  actions.toggleInputSackFields();
};
actions.toggleInputSackFields = () => {
  const useSacks = document.getElementById('in_use_sacks').checked;
  document.getElementById('in_sack_field').style.display = useSacks ? '' : 'none';
  document.getElementById('in_qty_field').style.display = useSacks ? 'none' : '';
};
actions.onInputOutMaterialChange = () => {
  const opt = document.getElementById('in_out_material').selectedOptions[0];
  const defaultSack = opt ? Number(opt.dataset.sack) : 0;
  const label = opt ? opt.dataset.label : 'sack';
  document.getElementById('in_out_sack_weight').value = defaultSack || '';
  document.getElementById('in_out_use_sacks').checked = !!defaultSack;
  document.getElementById('in_out_sack_label').textContent = label + 's';
  document.getElementById('in_out_sack_label2').textContent = label + 's';
  document.getElementById('in_out_sack_label3').textContent = label;
  actions.toggleInputOutSackFields();
};
actions.toggleInputOutSackFields = () => {
  const useSacks = document.getElementById('in_out_use_sacks').checked;
  document.getElementById('in_out_sack_field').style.display = useSacks ? '' : 'none';
  document.getElementById('in_out_qty_field').style.display = useSacks ? 'none' : '';
};
actions.logInput = async () => {
  const inputMat = document.getElementById('in_material').value;
  const outputMat = document.getElementById('in_out_material').value;
  if (inputMat === outputMat) {
    document.getElementById('inMsg').innerHTML = `<div class="msg error">"What you put in" and "what came out" must be different.</div>`;
    return;
  }
  const useSacks = document.getElementById('in_use_sacks').checked;
  let inputQty;
  if (useSacks) {
    const sacks = Number(document.getElementById('in_sacks').value) || 0;
    const sackWeight = Number(document.getElementById('in_sack_weight').value) || 0;
    if (!sacks || !sackWeight) { document.getElementById('inMsg').innerHTML = `<div class="msg error">Type how many ${document.getElementById('in_sack_label2').textContent} and the weight per one.</div>`; return; }
    inputQty = sacks * sackWeight;
  } else {
    inputQty = document.getElementById('in_qty').value;
  }
  const useOutSacks = document.getElementById('in_out_use_sacks').checked;
  let outputQty;
  if (useOutSacks) {
    const sacks = Number(document.getElementById('in_out_sacks').value) || 0;
    const sackWeight = Number(document.getElementById('in_out_sack_weight').value) || 0;
    if (!sacks || !sackWeight) { document.getElementById('inMsg').innerHTML = `<div class="msg error">Type how many ${document.getElementById('in_out_sack_label2').textContent} came out and the weight per one.</div>`; return; }
    outputQty = sacks * sackWeight;
  } else {
    outputQty = document.getElementById('in_out_qty').value;
  }
  const form = new FormData();
  form.append('machine_id', document.getElementById('in_machine').value);
  form.append('input_material_id', inputMat);
  form.append('input_qty', inputQty);
  form.append('output_material_id', outputMat);
  form.append('output_qty', outputQty);
  form.append('source_company', document.getElementById('in_source').value);
  form.append('notes', document.getElementById('in_notes').value);
  const photoInput = document.getElementById('in_photo');
  if (photoInput.files[0]) form.append('photo', photoInput.files[0]);
  try {
    await API.postForm('/stages/input', form);
    renderApp();
  } catch (e) {
    document.getElementById('inMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};
actions.logElectricity = async () => {
  const kwh = Number(document.getElementById('elec_kwh').value);
  if (!kwh) { document.getElementById('elecMsg').innerHTML = `<div class="msg error">Type how many units were used.</div>`; return; }
  try {
    await API.post('/stages/electricity', { kwh });
    renderApp();
  } catch (e) {
    document.getElementById('elecMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};

// ---------------- Picking: collects packed packets from Packaging ----------------
// Different job from Delivery below - internal handoff, not the vehicle
// run to a customer. Doesn't move stock (Packaging already did) - it's a
// confirmation/traceability record and the basis for Picking's pay.
async function pagePicking() {
  if (API.user.role !== 'admin') return withShiftGate(pagePickingInner);
  return pagePickingInner();
}
async function pagePickingInner() {
  const [products, logs] = await Promise.all([API.get('/inventory/products'), API.get('/stages/picking')]);
  setTimeout(() => { if (document.getElementById('pk_product')) actions.onPkProductChange(); }, 0);
  return `
  <div class="card">
    <h2>Log what you collected from Packaging</h2>
    <label>Bag size</label>
    <select id="pk_product" onchange="actions.onPkProductChange()">${products.map(p => `<option value="${p.id}" data-pack="${p.pack_qty || ''}" data-label="${esc(p.pack_unit_label || 'packet')}">${esc(p.name)} (${esc(p.size)})</option>`).join('')}</select>
    <label><input type="checkbox" id="pk_use_pack" style="width:auto;display:inline-block;vertical-align:middle" onchange="actions.togglePkPackFields()"> Measure this in <span id="pk_pack_label">packets</span></label>
    <div id="pk_pack_field" style="display:none">
      <label>How many <span id="pk_pack_label2">packets</span></label>
      <input id="pk_packs" type="number" step="1">
      <label>Pieces per <span id="pk_pack_label3">packet</span></label>
      <input id="pk_pack_qty" type="number" step="1" placeholder="e.g. 100">
    </div>
    <div id="pk_qty_field">
      <label>How many pieces</label>
      <input id="pk_qty" type="number" step="1">
    </div>
    <label>Notes</label>
    <input id="pk_notes" placeholder="optional">
    <label>Take a photo</label>
    <input id="pk_photo" type="file" accept="image/*" capture="environment">
    <div id="pkMsg"></div>
    <button class="btn block" style="margin-top:10px" onclick="actions.logPicking()">Save</button>
  </div>
  <div class="card">
    <h2>What you have collected</h2>
    <div class="table-wrap"><table>
      <tr><th>Date</th><th>Product</th><th>Qty</th><th>Photo</th></tr>
      ${logs.map(l => `<tr><td>${dt(l.created_at)}</td><td>${esc(l.product_name)} (${esc(l.size)})</td><td>${l.qty}</td>
        <td>${l.photo_path ? `<a href="/uploads/${esc(l.photo_path)}" target="_blank">view</a>` : ''}</td></tr>`).join('')}
    </table></div>
  </div>`;
}
actions.onPkProductChange = () => {
  const opt = document.getElementById('pk_product').selectedOptions[0];
  const defaultPack = opt ? Number(opt.dataset.pack) : 0;
  const label = opt ? opt.dataset.label : 'packet';
  document.getElementById('pk_pack_qty').value = defaultPack || '';
  document.getElementById('pk_use_pack').checked = !!defaultPack;
  document.getElementById('pk_pack_label').textContent = label + 's';
  document.getElementById('pk_pack_label2').textContent = label + 's';
  document.getElementById('pk_pack_label3').textContent = label;
  actions.togglePkPackFields();
};
actions.togglePkPackFields = () => {
  const usePack = document.getElementById('pk_use_pack').checked;
  document.getElementById('pk_pack_field').style.display = usePack ? '' : 'none';
  document.getElementById('pk_qty_field').style.display = usePack ? 'none' : '';
};
actions.logPicking = async () => {
  const usePack = document.getElementById('pk_use_pack').checked;
  let qty;
  if (usePack) {
    const packs = Number(document.getElementById('pk_packs').value) || 0;
    const packQty = Number(document.getElementById('pk_pack_qty').value) || 0;
    if (!packs || !packQty) { document.getElementById('pkMsg').innerHTML = `<div class="msg error">Type how many ${document.getElementById('pk_pack_label2').textContent} and pieces per one.</div>`; return; }
    qty = packs * packQty;
  } else {
    qty = document.getElementById('pk_qty').value;
  }
  const form = new FormData();
  form.append('product_id', document.getElementById('pk_product').value);
  form.append('qty', qty);
  form.append('notes', document.getElementById('pk_notes').value);
  const photoInput = document.getElementById('pk_photo');
  if (photoInput.files[0]) form.append('photo', photoInput.files[0]);
  try {
    await API.postForm('/stages/picking', form);
    renderApp();
  } catch (e) {
    document.getElementById('pkMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};

// ---------------- Delivery (role: distribution): packets out to a person/place ----------------
async function pageDispatch() {
  if (API.user.role !== 'admin') return withShiftGate(pageDispatchInner);
  return pageDispatchInner();
}
async function pageDispatchInner() {
  const [products, dispatches, pendingOrders] = await Promise.all([
    API.get('/inventory/products'), API.get('/stages/dispatch'), API.get('/orders?status=pending'),
  ]);
  return `
  ${pendingOrders.length ? `
  <div class="card">
    <h2>Customers waiting for delivery</h2>
    ${pendingOrders.map(o => `<div class="tip ${o.qty > o.product_stock ? 'warning' : ''}">
      <b>${esc(o.customer_name)}</b> wants ${o.qty} x ${esc(o.product_name)} (${esc(o.size)})
      ${o.qty > o.product_stock ? ` - only ${o.product_stock} ready, wait for more to be made` : ' - ready now'}
      <div style="margin-top:6px"><button class="btn secondary" onclick="actions.fillOrderIntoDispatch(${o.id},${o.product_id},${o.qty},'${esc(o.customer_name)}','${esc(o.customer_location || '')}')" ${o.qty > o.product_stock ? 'disabled' : ''}>Fill in delivery form</button></div>
    </div>`).join('')}
  </div>` : ''}

  <div class="card">
    <h2>Log bags you are taking out for delivery</h2>
    <input type="hidden" id="di_order_id" value="">
    <label>Product / bag size</label>
    <select id="di_product">${products.map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.size)}) - ${p.stock_qty} ready</option>`).join('')}</select>
    <label>How many packets</label>
    <input id="di_qty" type="number" step="1">
    <label>Who is getting it</label>
    <input id="di_person" placeholder="e.g. John Kamau">
    <label>Place</label>
    <input id="di_place" placeholder="e.g. Kawangware market">
    <label>Vehicle</label>
    <input id="di_vehicle" placeholder="e.g. KDA 123X Probox">
    <label>Money collected now (leave 0 if they pay later)</label>
    <input id="di_amount" type="number" step="0.01" value="0">
    <label>How they paid</label>
    <select id="di_method"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="bank">Bank / Equity</option></select>
    <label><input type="checkbox" id="di_paid" style="width:auto;display:inline-block;vertical-align:middle"> Paid in full</label>
    <label>Notes</label>
    <input id="di_notes" placeholder="optional">
    <label>Take a photo</label>
    <input id="di_photo" type="file" accept="image/*" capture="environment">
    <div id="diMsg"></div>
    <button class="btn block" style="margin-top:10px" onclick="actions.logDispatch()">Save</button>
  </div>
  <div class="card">
    <h2>What you have delivered</h2>
    <div class="table-wrap"><table>
      <tr><th>Date</th><th>Product</th><th>Qty</th><th>To</th><th>Place</th><th>Vehicle</th><th>Collected</th><th>Status</th><th>Photo</th><th></th></tr>
      ${dispatches.map(d => `<tr><td>${dt(d.dispatched_at)}</td><td>${esc(d.product_name)} (${esc(d.size)})</td>
        <td>${d.qty}</td><td>${esc(d.destination_person || '')}</td><td>${esc(d.destination_place || '')}</td>
        <td>${esc(d.vehicle || '')}</td><td>${money(d.amount_collected)} ${esc(d.payment_method || '')}</td>
        <td>${d.paid ? '<span class="pill ok">Paid</span>' : '<span class="pill warn">Pending</span>'}</td>
        <td>${d.photo_path ? `<a href="/uploads/${esc(d.photo_path)}" target="_blank">view</a>` : ''}</td>
        <td>${!d.paid ? `<button class="btn secondary" onclick="actions.collectDispatch(${d.id},'${esc(d.destination_person || d.destination_place)}')">Mark paid</button>` : ''}</td>
      </tr>`).join('')}
    </table></div>
  </div>`;
}
actions.fillOrderIntoDispatch = (orderId, productId, qty, customerName, customerLocation) => {
  document.getElementById('di_order_id').value = orderId;
  document.getElementById('di_product').value = productId;
  document.getElementById('di_qty').value = qty;
  document.getElementById('di_person').value = customerName;
  if (customerLocation) document.getElementById('di_place').value = customerLocation;
  document.getElementById('di_qty').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
actions.logDispatch = async () => {
  const form = new FormData();
  form.append('product_id', document.getElementById('di_product').value);
  form.append('qty', document.getElementById('di_qty').value);
  form.append('destination_person', document.getElementById('di_person').value);
  form.append('destination_place', document.getElementById('di_place').value);
  form.append('vehicle', document.getElementById('di_vehicle').value);
  form.append('amount_collected', document.getElementById('di_amount').value);
  form.append('payment_method', document.getElementById('di_method').value);
  form.append('paid', document.getElementById('di_paid').checked ? 'true' : '');
  form.append('notes', document.getElementById('di_notes').value);
  const orderId = document.getElementById('di_order_id').value;
  if (orderId) form.append('order_id', orderId);
  const photoInput = document.getElementById('di_photo');
  if (photoInput.files[0]) form.append('photo', photoInput.files[0]);
  try {
    const result = await API.postForm('/stages/dispatch', form);
    navigate('#/delivery-receipt/' + result.id);
  } catch (e) {
    document.getElementById('diMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};
actions.collectDispatch = async (id, who) => {
  const amount = prompt(`Amount collected from ${who}:`);
  if (!amount) return;
  const method = prompt('Payment method (cash / mpesa / bank):', 'cash') || 'cash';
  const paid = confirm('Is this now fully settled? OK = yes, Cancel = partial payment');
  try {
    await API.put(`/stages/dispatch/${id}/collect`, { amount_collected: Number(amount), payment_method: method, paid });
    renderApp();
  } catch (e) { alert(e.message); }
};

// ---------------- Purchases & Suppliers ----------------
async function pagePurchases() {
  const [purchases, suppliers, materials] = await Promise.all([
    API.get('/purchases'), API.get('/purchases/suppliers'), API.get('/inventory/materials'),
  ]);
  setTimeout(() => { if (document.getElementById('pu_material')) actions.onPurchaseMaterialChange(); }, 0);
  return `
  <div class="card">
    <h2>Record a purchase (raw material intake)</h2>
    <label>Material</label>
    <select id="pu_material" onchange="actions.onPurchaseMaterialChange()">${materials.map(m => `<option value="${m.id}" data-sack="${m.sack_weight_kg || ''}" data-label="${esc(packLabel(m))}" data-unit="${esc(m.unit)}">${esc(m.name)} (${esc(m.unit)})</option>`).join('')}</select>
    <label>Supplier</label>
    <select id="pu_supplier"><option value="">(none)</option>${suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>

    <label><input type="checkbox" id="pu_use_sacks" style="width:auto;display:inline-block;vertical-align:middle" onchange="actions.togglePurchaseSackFields()"> Measure this purchase in <span id="pu_sack_label">sacks</span></label>
    <div id="pu_sack_fields" style="display:none">
      <label>Number of <span id="pu_sack_label2">sacks</span></label>
      <input id="pu_sacks" type="number" step="1">
      <label>Weight per <span id="pu_sack_label3">sack</span> (kg) - this supplier's size</label>
      <input id="pu_sack_weight" type="number" step="0.01" placeholder="e.g. 50">
      <label>Cost per <span id="pu_sack_label4">sack</span></label>
      <input id="pu_sack_cost" type="number" step="0.01">
      <p style="color:var(--muted);font-size:12px">This works out the kg and cost per kg for you.</p>
    </div>
    <div id="pu_plain_fields">
      <label>Quantity (kg)</label>
      <input id="pu_qty" type="number" step="0.01">
      <label>Unit cost (per kg)</label>
      <input id="pu_cost" type="number" step="0.01">
    </div>

    <label>Amount paid now (leave blank if paid in full)</label>
    <input id="pu_paid" type="number" step="0.01">
    <div id="puMsg"></div>
    <button class="btn block" style="margin-top:10px" onclick="actions.logPurchase()">Save purchase</button>
    <button class="btn secondary block" style="margin-top:8px" onclick="actions.newSupplier()">Add new supplier</button>
  </div>
  <div class="card">
    <h2>Recent purchases</h2>
    <div class="table-wrap"><table>
      <tr><th>Date</th><th>Material</th><th>Supplier</th><th>Qty</th><th>Unit cost</th><th>Total</th><th>Paid</th></tr>
      ${purchases.map(p => `<tr><td>${dt(p.purchase_date)}</td><td>${esc(p.material_name)}</td><td>${esc(p.supplier_name || '-')}</td>
        <td>${p.qty}${esc(p.unit)}</td><td>${money(p.unit_cost)}</td><td>${money(p.total_cost)}</td><td>${money(p.paid_amount)}</td></tr>`).join('')}
    </table></div>
  </div>`;
}
actions.newSupplier = async () => {
  const name = prompt('Supplier name:'); if (!name) return;
  const phone = prompt('Phone (optional):') || '';
  await API.post('/purchases/suppliers', { name, phone });
  renderApp();
};
actions.onPurchaseMaterialChange = () => {
  const opt = document.getElementById('pu_material').selectedOptions[0];
  const defaultSack = opt ? Number(opt.dataset.sack) : 0;
  const label = opt ? opt.dataset.label : 'sack';
  document.getElementById('pu_sack_weight').value = defaultSack || '';
  document.getElementById('pu_use_sacks').checked = !!defaultSack;
  document.getElementById('pu_sack_label').textContent = label + 's';
  document.getElementById('pu_sack_label2').textContent = label + 's';
  document.getElementById('pu_sack_label3').textContent = label;
  document.getElementById('pu_sack_label4').textContent = label;
  actions.togglePurchaseSackFields();
};
actions.togglePurchaseSackFields = () => {
  const useSacks = document.getElementById('pu_use_sacks').checked;
  document.getElementById('pu_sack_fields').style.display = useSacks ? '' : 'none';
  document.getElementById('pu_plain_fields').style.display = useSacks ? 'none' : '';
};
actions.logPurchase = async () => {
  const paidVal = document.getElementById('pu_paid').value;
  const useSacks = document.getElementById('pu_use_sacks').checked;

  let qty, unit_cost;
  if (useSacks) {
    const sacks = Number(document.getElementById('pu_sacks').value) || 0;
    const sackWeight = Number(document.getElementById('pu_sack_weight').value) || 0;
    const sackCost = Number(document.getElementById('pu_sack_cost').value) || 0;
    if (!sacks || !sackWeight) { document.getElementById('puMsg').innerHTML = `<div class="msg error">Type how many ${document.getElementById('pu_sack_label2').textContent} and the weight per one.</div>`; return; }
    qty = sacks * sackWeight;
    unit_cost = sackCost / sackWeight;
  } else {
    qty = Number(document.getElementById('pu_qty').value);
    unit_cost = Number(document.getElementById('pu_cost').value);
  }

  const body = {
    material_id: document.getElementById('pu_material').value,
    supplier_id: document.getElementById('pu_supplier').value || null,
    qty, unit_cost,
    paid_amount: paidVal === '' ? undefined : Number(paidVal),
  };
  try {
    await API.post('/purchases', body);
    renderApp();
  } catch (e) {
    document.getElementById('puMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};

// ---------------- Customers ----------------
async function pageCustomers() {
  const [customers, products, orders] = await Promise.all([
    API.get('/customers'), API.get('/inventory/products'), API.get('/orders'),
  ]);
  return `
  <div class="card">
    <h2>Customers</h2>
    <div class="table-wrap"><table>
      <tr><th>Name</th><th>Phone</th><th>Location</th><th>Owes</th><th></th></tr>
      ${customers.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone || '')}</td><td>${esc(c.location || '')}</td>
        <td>${c.balance > 0 ? `<span class="pill warn">${money(c.balance)}</span>` : money(c.balance)}</td>
        <td>${c.balance > 0 ? `<button class="btn secondary" onclick="actions.payCustomer(${c.id},'${esc(c.name)}')">Record payment</button>` : ''}</td></tr>`).join('')}
    </table></div>
    <h3 style="margin-top:14px">Add a customer</h3>
    <label>Name</label><input id="nc_name">
    <label>Phone (optional)</label><input id="nc_phone">
    <label>Location (where to deliver to)</label><input id="nc_location" placeholder="e.g. Kawangware market, shop 12">
    <div id="ncMsg"></div>
    <button class="btn secondary block" style="margin-top:8px" onclick="actions.newCustomer()">Save customer</button>
  </div>

  <div class="card">
    <h2>Take an order</h2>
    <p style="color:var(--muted);font-size:13px">A customer wants bags now but you will deliver later. This tells Picking what to bring, and tells Packaging if there is not enough made yet.</p>
    <label>Customer</label>
    <select id="or_customer">${customers.map(c => `<option value="${c.id}">${esc(c.name)}${c.location ? ' - ' + esc(c.location) : ''}</option>`).join('')}</select>
    <label>Bag size</label>
    <select id="or_product">${products.map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.size)}) - ${p.stock_qty} ready now</option>`).join('')}</select>
    <label>How many</label>
    <input id="or_qty" type="number" step="1">
    <div id="orMsg"></div>
    <button class="btn secondary block" style="margin-top:10px" onclick="actions.newOrder()">Take this order</button>
  </div>

  <div class="card">
    <h2>Orders</h2>
    <div class="table-wrap"><table><tr><th>Date</th><th>Customer</th><th>Wants</th><th>Status</th><th></th></tr>
      ${orders.map(o => `<tr><td>${dt(o.created_at)}</td><td>${esc(o.customer_name)}</td><td>${o.qty} x ${esc(o.product_name)} (${esc(o.size)})</td>
        <td>${o.status === 'pending' ? '<span class="pill warn">Waiting</span>' : o.status === 'fulfilled' ? '<span class="pill ok">Delivered</span>' : '<span class="pill">Cancelled</span>'}</td>
        <td>${o.status === 'pending' ? `<button class="btn secondary" onclick="actions.cancelOrder(${o.id})">Cancel</button>` : ''}</td></tr>`).join('')}
    </table></div>
  </div>`;
}
actions.newCustomer = async () => {
  const name = document.getElementById('nc_name').value.trim();
  const phone = document.getElementById('nc_phone').value.trim();
  const location = document.getElementById('nc_location').value.trim();
  if (!name) { document.getElementById('ncMsg').innerHTML = `<div class="msg error">Type a name.</div>`; return; }
  try {
    await API.post('/customers', { name, phone, location });
    renderApp();
  } catch (e) { document.getElementById('ncMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`; }
};
actions.newOrder = async () => {
  const customer_id = document.getElementById('or_customer').value;
  const product_id = document.getElementById('or_product').value;
  const qty = Number(document.getElementById('or_qty').value);
  if (!qty) { document.getElementById('orMsg').innerHTML = `<div class="msg error">Type how many bags.</div>`; return; }
  try {
    await API.post('/orders', { customer_id, product_id, qty });
    renderApp();
  } catch (e) {
    document.getElementById('orMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};
actions.cancelOrder = async (id) => {
  if (!confirm('Cancel this order?')) return;
  await API.put(`/orders/${id}/cancel`, {});
  renderApp();
};
actions.payCustomer = async (id, name) => {
  const amount = Number(prompt(`Payment amount from ${name}:`) || 0);
  if (!amount) return;
  await API.post(`/customers/${id}/payment`, { amount });
  renderApp();
};

// ---------------- Cash Book ----------------
async function pageCashbook() {
  const [txns, summary] = await Promise.all([API.get('/cashbook'), API.get('/cashbook/summary')]);
  return `
  <div class="stat-row">
    <div class="stat"><div class="value">${money(summary.cash_in_hand)}</div><div class="label">Cash in hand</div></div>
    <div class="stat"><div class="value">${money(summary.today_in)}</div><div class="label">Today in</div></div>
    <div class="stat"><div class="value">${money(summary.today_out)}</div><div class="label">Today out</div></div>
  </div>
  <div class="card">
    <h2>Record expense / other income</h2>
    <div class="grid cols-2">
      <button class="btn danger" onclick="actions.addCash('expense')">+ Add expense</button>
      <button class="btn" onclick="actions.addCash('income')">+ Add other income</button>
    </div>
  </div>
  <div class="card">
    <h2>Transactions</h2>
    <div class="table-wrap"><table>
      <tr><th>Date</th><th>Type</th><th>Category</th><th>Amount</th><th>Description</th><th>By</th></tr>
      ${txns.map(t => `<tr><td>${dt(t.recorded_at)}</td>
        <td><span class="pill ${t.type === 'in' ? 'ok' : 'danger'}">${t.type}</span></td>
        <td>${esc(t.category)}</td><td>${money(t.amount)}</td><td>${esc(t.description || '')}</td><td>${esc(t.recorded_by_name || '')}</td></tr>`).join('')}
    </table></div>
  </div>`;
}
actions.addCash = async (kind) => {
  const amount = Number(prompt('Amount:') || 0); if (!amount) return;
  const description = prompt('Description (e.g. rent, wages, fuel):') || '';
  const category = prompt('Category label:', kind === 'expense' ? 'expense' : 'other') || kind;
  await API.post(`/cashbook/${kind}`, { amount, description, category });
  renderApp();
};

// ---------------- Reports ----------------
async function pageReports() {
  const [sales, production, stock, cashflow, topCustomers, credit] = await Promise.all([
    API.get('/reports/sales-summary'), API.get('/reports/production-summary'), API.get('/reports/stock-levels'),
    API.get('/reports/cashflow'), API.get('/reports/top-customers'), API.get('/reports/outstanding-credit'),
  ]);
  return `
  <div class="card"><h2>Sales (last 30 days)</h2>
    <div class="stat-row">
      <div class="stat"><div class="value">${sales.totals.sale_count}</div><div class="label">Sales</div></div>
      <div class="stat"><div class="value">${money(sales.totals.revenue)}</div><div class="label">Revenue</div></div>
      <div class="stat"><div class="value">${money(sales.totals.collected)}</div><div class="label">Collected</div></div>
    </div>
    <div class="table-wrap" style="margin-top:10px"><table><tr><th>Product</th><th>Qty sold</th><th>Revenue</th></tr>
      ${sales.byProduct.map(p => `<tr><td>${esc(p.name)} (${esc(p.size)})</td><td>${p.qty_sold}</td><td>${money(p.revenue)}</td></tr>`).join('')}
    </table></div>
  </div>
  <div class="card"><h2>Production (last 30 days)</h2>
    <table><tr><th>Product</th><th>Qty produced</th><th>Material cost</th></tr>
      ${production.byProduct.map(p => `<tr><td>${esc(p.name)} (${esc(p.size)})</td><td>${p.qty_produced}</td><td>${money(p.material_cost)}</td></tr>`).join('')}
    </table>
  </div>
  <div class="card"><h2>Stock levels</h2>
    <h3>Finished goods</h3>
    <table><tr><th>Product</th><th>Stock</th></tr>${stock.products.map(p => `<tr><td>${esc(p.name)} (${esc(p.size)})</td><td>${p.stock_qty}</td></tr>`).join('')}</table>
    <h3 style="margin-top:10px">Raw materials</h3>
    <table><tr><th>Material</th><th>Stock</th></tr>${stock.materials.map(m => `<tr><td>${esc(m.name)}</td><td>${m.stock_qty}${esc(m.unit)}</td></tr>`).join('')}</table>
  </div>
  <div class="card"><h2>Cash flow (last 30 days)</h2>
    <table><tr><th>Type</th><th>Category</th><th>Total</th></tr>
      ${cashflow.byCategory.map(c => `<tr><td>${c.type}</td><td>${esc(c.category)}</td><td>${money(c.total)}</td></tr>`).join('')}
    </table>
  </div>
  <div class="card"><h2>Top customers</h2>
    <table><tr><th>Name</th><th>Sales</th><th>Revenue</th><th>Owes</th></tr>
      ${topCustomers.map(c => `<tr><td>${esc(c.name)}</td><td>${c.sale_count}</td><td>${money(c.revenue)}</td><td>${money(c.balance)}</td></tr>`).join('')}
    </table>
  </div>
  <div class="card"><h2>Outstanding credit</h2>
    ${credit.length ? `<table><tr><th>Name</th><th>Phone</th><th>Owes</th></tr>
      ${credit.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone || '')}</td><td>${money(c.balance)}</td></tr>`).join('')}
    </table>` : '<p style="color:var(--muted)">Nobody owes anything</p>'}
  </div>`;
}

// ---------------- Settings ----------------
const ROLE_LABELS = { admin: 'Admin', input: 'Plant Operator', cutting: 'Packaging', picking: 'Picking', distribution: 'Delivery' };

async function pageSettings() {
  const [users, lock, sessionsList, machines] = await Promise.all([
    API.get('/auth/users/detailed'), API.get('/auth/lock'), API.get('/auth/sessions'), API.get('/machines'),
  ]);
  const s = state.settings;
  return `
  <div class="card">
    <h2>Business details</h2>
    <p style="color:var(--muted);font-size:13px">This shows on receipts and at the top of the app.</p>
    <label>Business name</label><input id="set_name" value="${esc(s.business_name)}">
    <label>What kind of business</label><input id="set_industry" value="${esc(s.industry)}">
    <label>Address</label><input id="set_address" value="${esc(s.address)}">
    <label>Phone</label><input id="set_phone" value="${esc(s.phone)}">
    <label>Money (currency code)</label><input id="set_currency" value="${esc(s.currency)}">
    <label>Cost of electricity, per kWh (used to work out running costs)</label>
    <input id="set_elec_rate" type="number" step="0.01" value="${esc(s.electricity_rate_per_kwh || '0')}">
    <label>Welcome message shown after login</label>
    <input id="set_tagline" value="${esc(s.welcome_tagline || '')}">
    <div id="setMsg"></div>
    <button class="btn block" style="margin-top:10px" onclick="actions.saveSettings()">Save</button>
  </div>

  <div class="card">
    <h2>Lock the app / see who is on it</h2>
    <p style="color:var(--muted);font-size:13px">Lock stops everyone except you from using the app right now - for end of day, or if something looks wrong. It does not touch the WiFi router.</p>
    <button class="btn ${lock.locked ? 'danger' : ''} block" onclick="actions.toggleLock(${!lock.locked})">${lock.locked ? 'Unlock the app' : 'Lock the app (only you can use it)'}</button>
    <h3 style="margin-top:16px">People logged in right now</h3>
    <div class="table-wrap"><table><tr><th>Name</th><th>Section</th><th>Since</th><th></th></tr>
      ${sessionsList.map(sn => `<tr><td>${esc(sn.name)}</td><td>${esc(ROLE_LABELS[sn.role] || sn.role)}</td><td>${dt(sn.loginAt)}</td>
        <td><button class="btn secondary" onclick="actions.kickSession('${sn.tokenFull}')">Log them out</button></td></tr>`).join('')}
    </table></div>
  </div>

  <div class="card">
    <h2>Machines</h2>
    <p style="color:var(--muted);font-size:13px">The Plant Operator picks one of these when they log work. Add every machine you have.</p>
    <div class="table-wrap"><table><tr><th>Machine name</th><th></th></tr>
      ${machines.map(m => `<tr><td>${esc(m.name)}</td><td><button class="btn secondary" onclick="actions.removeMachine(${m.id})">Remove</button></td></tr>`).join('')}
    </table></div>
    <button class="btn secondary block" style="margin-top:10px" onclick="actions.newMachine()">Add a machine</button>
  </div>

  <div class="card">
    <h2>Add a person</h2>
    <p style="color:var(--muted);font-size:13px">Each person gets their own login and only sees their own work. Leave PIN blank and one will be made up for you to share with them.</p>
    <label>Name</label><input id="nu_name">
    <label>What they do</label>
    <select id="nu_role" onchange="actions.onNewRoleChange()">
      <option value="input">Plant Operator (runs the machine)</option>
      <option value="cutting">Packaging (cuts and packs bags)</option>
      <option value="picking">Picking (collects packed bags)</option>
      <option value="distribution">Delivery (takes bags to customers)</option>
      <option value="admin">Admin (sees everything)</option>
    </select>
    <label>PIN (leave blank to make one automatically)</label><input id="nu_pin" type="password" inputmode="numeric" maxlength="6">
    <label>How they are paid</label>
    <select id="nu_pay_type" onchange="actions.onNewRoleChange()">
      <option value="piece">Per unit made/handled</option>
      <option value="shift">Flat rate per shift worked</option>
      <option value="trip">Flat rate per delivery trip</option>
      <option value="monthly">Fixed monthly salary</option>
    </select>
    <label id="nu_rate_label">Pay per unit (0 if fixed wage)</label><input id="nu_rate" type="number" step="0.01" value="0">
    <label>Shift starts at (optional)</label><input id="nu_shift_start" type="time">
    <label>Shift ends at (optional)</label><input id="nu_shift_end" type="time">
    <div id="nuMsg"></div>
    <button class="btn secondary block" style="margin-top:10px" onclick="actions.newUser()">Add this person</button>
  </div>

  <div class="card">
    <h2>Everyone with a login</h2>
    <div class="table-wrap"><table><tr><th>Name</th><th>Does</th><th>Pay rate</th><th>Shift</th><th></th></tr>
      ${users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(ROLE_LABELS[u.role] || u.role)}</td><td>${u.piece_rate != null ? money(u.piece_rate) : '-'}</td>
        <td>${u.shift_start || u.shift_end ? `${esc(u.shift_start || '?')}-${esc(u.shift_end || '?')}` : '-'}</td>
        <td>${u.id !== API.user.id ? `<button class="btn secondary" onclick="actions.editUser(${u.id},'${esc(u.name)}')">Edit</button>
          <button class="btn secondary" onclick="actions.removeUser(${u.id})">Remove</button>` : '(you)'}</td></tr>`).join('')}
    </table></div>
  </div>

  <div class="card">
    <h2>Save a copy of all the data</h2>
    <p style="color:var(--muted);font-size:13px">Downloads everything in the app to one file. Keep copies on a USB drive, away from this computer.</p>
    <a class="btn block" href="/api/backup/download" target="_blank">Download a copy now</a>
  </div>`;
}
actions.saveSettings = async () => {
  const body = {
    business_name: document.getElementById('set_name').value,
    industry: document.getElementById('set_industry').value,
    address: document.getElementById('set_address').value,
    phone: document.getElementById('set_phone').value,
    currency: document.getElementById('set_currency').value,
    electricity_rate_per_kwh: document.getElementById('set_elec_rate').value,
    welcome_tagline: document.getElementById('set_tagline').value,
  };
  try {
    await API.put('/auth/settings', body);
    state.settings = await API.get('/auth/settings');
    document.getElementById('setMsg').innerHTML = `<div class="msg ok">Saved.</div>`;
  } catch (e) {
    document.getElementById('setMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};
actions.toggleLock = async (locked) => {
  await API.put('/auth/lock', { locked });
  renderApp();
};
actions.kickSession = async (token) => {
  await API.del('/auth/sessions/' + token);
  renderApp();
};
actions.newMachine = async () => {
  const name = prompt('Machine name (e.g. "Machine A - new"):'); if (!name) return;
  await API.post('/machines', { name });
  renderApp();
};
actions.removeMachine = async (id) => {
  if (!confirm('Remove this machine from the list?')) return;
  await API.del('/machines/' + id);
  renderApp();
};
actions.onNewRoleChange = () => {
  const payType = document.getElementById('nu_pay_type').value;
  const label = document.getElementById('nu_rate_label');
  const labels = {
    piece: 'Pay per unit made/handled (0 if fixed wage)',
    shift: 'Pay per shift worked (0 if fixed wage)',
    trip: 'Pay per delivery trip (0 if fixed wage)',
    monthly: 'Fixed salary per month',
  };
  label.textContent = labels[payType] || labels.piece;
};
actions.newUser = async () => {
  const name = document.getElementById('nu_name').value.trim();
  const role = document.getElementById('nu_role').value;
  const pin = document.getElementById('nu_pin').value.trim();
  const pay_type = document.getElementById('nu_pay_type').value;
  const piece_rate = Number(document.getElementById('nu_rate').value) || 0;
  const shift_start = document.getElementById('nu_shift_start').value || null;
  const shift_end = document.getElementById('nu_shift_end').value || null;
  if (!name) { document.getElementById('nuMsg').innerHTML = `<div class="msg error">Type their name first.</div>`; return; }
  try {
    const created = await API.post('/auth/users', { name, role, pin: pin || undefined, piece_rate, pay_type });
    if (shift_start || shift_end) await API.put(`/auth/users/${created.id}`, { shift_start, shift_end });
    document.getElementById('nuMsg').innerHTML = newStaffPinCard(created);
    document.getElementById('nu_name').value = '';
    document.getElementById('nu_pin').value = '';
  } catch (e) {
    document.getElementById('nuMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};
function newStaffPinCard(u) {
  const loginUrl = (window.__loginUrls && window.__loginUrls[0]) || null;
  window.__lastNewStaffShareText = `${esc(state.settings.business_name || '')}\nYour PlastPOS login\nName: ${u.name}\nPIN: ${u.pin}\n${loginUrl ? `Open this on your phone (same WiFi): ${loginUrl}` : 'Ask the admin how to reach the app on the WiFi.'}`;
  return `<div class="msg ok">
    <b>${esc(u.name)}</b> was added. Their PIN is <b style="font-size:16px">${esc(u.pin || '(kept the one you typed)')}</b>.
    ${u.pin ? `
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn secondary" style="flex:1" onclick="actions.shareNewStaffPin()">Share (WhatsApp/SMS)</button>
      <button class="btn" style="flex:1" onclick="renderApp()">Done</button>
    </div>` : `<div style="margin-top:8px"><button class="btn" onclick="renderApp()">Done</button></div>`}
  </div>`;
}
actions.shareLoginLink = async (url) => {
  const text = `${state.settings.business_name || 'PlastPOS'} login link: ${url}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'PlastPOS login link', text }); return; } catch (e) { return; }
  }
  try { await navigator.clipboard.writeText(text); alert('Copied. Paste it into WhatsApp.'); }
  catch (e) { alert(text); }
};
actions.shareNewStaffPin = async () => {
  const text = window.__lastNewStaffShareText || '';
  if (navigator.share) {
    try { await navigator.share({ title: 'PlastPOS login', text }); return; } catch (e) { return; }
  }
  try { await navigator.clipboard.writeText(text); alert('Copied. Paste it into WhatsApp.'); }
  catch (e) { alert(text); }
};
actions.removeUser = async (id) => {
  if (!confirm('Remove this staff account?')) return;
  await API.del('/auth/users/' + id);
  renderApp();
};
actions.editUser = async (id, name) => {
  const payTypeAns = prompt(`How is ${name} paid? Type one: unit / shift / trip / monthly`, 'unit');
  if (payTypeAns === null) return;
  const answer = payTypeAns.trim().toLowerCase();
  const pay_type = ['shift', 'trip', 'monthly'].includes(answer) ? answer : 'piece';
  const rateLabel = { piece: 'per unit', shift: 'per shift', trip: 'per trip', monthly: 'per month' }[pay_type];
  const piece_rate = prompt(`Pay rate ${rateLabel} for ${name} (0 = fixed wage):`);
  if (piece_rate === null) return;
  const shift_start = prompt('Shift start HH:MM (blank = none):') || null;
  const shift_end = prompt('Shift end HH:MM (blank = none):') || null;
  try {
    await API.put(`/auth/users/${id}`, { piece_rate: Number(piece_rate) || 0, pay_type, shift_start, shift_end });
    renderApp();
  } catch (e) { alert(e.message); }
};

// ---------------- Payroll (admin) ----------------
async function pagePayroll() {
  const summary = await API.get('/payroll/summary');
  return `
  <div class="card">
    <h2>Team performance & pay</h2>
    <p style="color:var(--muted);font-size:13px">Output-based pay per worker. "Owed" is everything logged since their last payment x their rate.</p>
    <div class="table-wrap"><table>
      <tr><th>Name</th><th>Section</th><th>Today</th><th>This week</th><th>Rate</th><th>Owed</th><th></th></tr>
      ${summary.map(w => { const unit = w.pay_unit || 'unit'; return `<tr>
        <td>${esc(w.name)}</td><td>${esc(ROLE_LABELS[w.role] || w.role)}</td>
        <td>${w.today_qty} ${unit}${w.today_qty === 1 ? '' : 's'}</td><td>${w.week_qty} ${unit}${w.week_qty === 1 ? '' : 's'}</td>
        <td>${money(w.piece_rate)} / ${unit}</td>
        <td><b>${money(w.unpaid_amount)}</b></td>
        <td>${w.unpaid_amount > 0 ? `<button class="btn secondary" onclick="actions.payWorker(${w.userId},'${esc(w.name)}',${w.unpaid_amount})">Pay</button>` : '<span class="pill ok">Paid</span>'}</td>
      </tr>`; }).join('')}
    </table></div>
  </div>`;
}
actions.payWorker = async (userId, name, suggested) => {
  const amount = prompt(`Amount to pay ${name}:`, suggested.toFixed(2));
  if (!amount) return;
  const notes = prompt('Note (optional, e.g. "week 1 wages"):') || '';
  try {
    await API.postForm(`/payroll/pay/${userId}`, (() => {
      const f = new FormData(); f.append('amount', amount); f.append('notes', notes); return f;
    })());
    renderApp();
  } catch (e) { alert(e.message); }
};

boot();
