// PlastPOS frontend - plain JS, no build step. Every page is a function
// that returns an HTML string; `actions.*` functions (called from inline
// onclick handlers) do the work and re-render. Deliberately framework-free
// so the whole app is just static files a browser can load with zero setup.

const state = { settings: {}, cart: [], usersList: [], pickedUserId: null };
const app = document.getElementById('app');

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function money(n) { const cur = state.settings.currency || 'KES'; return `${cur} ${Number(n || 0).toFixed(2)}`; }
function dt(s) { if (!s) return ''; return String(s).replace('T', ' ').slice(0, 16); }

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
    location.hash = '#/dashboard';
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
    <p style="color:var(--muted);font-size:13px">Pick your name, enter your PIN.</p>
    <div id="loginMsg"></div>
    <div class="user-pick">
      ${users.map(u => `<button id="u_${u.id}" onclick="actions.pickUser(${u.id})">${esc(u.name)} <span style="color:var(--muted);font-size:11px">(${u.role})</span></button>`).join('')}
    </div>
    <label>PIN</label>
    <input id="l_pin" type="password" inputmode="numeric" maxlength="6" placeholder="PIN">
    <button class="btn block" style="margin-top:14px" onclick="actions.doLogin()">Log in</button>
  </div></div>`;
}
actions.pickUser = (id) => {
  state.pickedUserId = id;
  state.usersList.forEach(u => document.getElementById('u_' + u.id).classList.toggle('active', u.id === id));
};
actions.doLogin = async () => {
  const pin = document.getElementById('l_pin').value.trim();
  if (!state.pickedUserId) { document.getElementById('loginMsg').innerHTML = `<div class="msg error">Pick your name first.</div>`; return; }
  try {
    const data = await API.post('/auth/login', { userId: state.pickedUserId, pin });
    API.setSession(data.token, data.user);
    location.hash = '#/dashboard';
    renderApp();
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
const NAV = [
  { path: '#/dashboard', label: 'Dashboard', roles: ['admin', 'cashier', 'production'] },
  { path: '#/pos', label: 'POS', roles: ['admin', 'cashier'] },
  { path: '#/inventory', label: 'Inventory', roles: ['admin', 'production'] },
  { path: '#/manufacturing', label: 'Manufacturing', roles: ['admin', 'production'] },
  { path: '#/purchases', label: 'Purchases', roles: ['admin'] },
  { path: '#/customers', label: 'Customers', roles: ['admin', 'cashier'] },
  { path: '#/cashbook', label: 'Cash Book', roles: ['admin'] },
  { path: '#/reports', label: 'Reports', roles: ['admin'] },
  { path: '#/settings', label: 'Settings', roles: ['admin'] },
];

async function renderApp() {
  const user = API.user;
  const route = location.hash || '#/dashboard';
  const navHtml = NAV.filter(n => n.roles.includes(user.role))
    .map(n => `<a href="${n.path}" class="${route.startsWith(n.path) ? 'active' : ''}">${n.label}</a>`).join('');

  app.innerHTML = `
    <div class="header">
      <div><h1>${esc(state.settings.business_name || 'PlastPOS')}</h1><div class="sub">${esc(user.name)} · ${esc(user.role)}</div></div>
      <button onclick="actions.logout()">Log out</button>
    </div>
    <div class="nav">${navHtml}</div>
    <div class="main" id="main"><p style="color:var(--muted)">Loading...</p></div>
  `;

  const main = document.getElementById('main');
  try {
    if (route.startsWith('#/pos')) main.innerHTML = await pagePOS();
    else if (route.startsWith('#/inventory')) main.innerHTML = await pageInventory();
    else if (route.startsWith('#/manufacturing')) main.innerHTML = await pageManufacturing();
    else if (route.startsWith('#/purchases')) main.innerHTML = await pagePurchases();
    else if (route.startsWith('#/customers')) main.innerHTML = await pageCustomers();
    else if (route.startsWith('#/cashbook')) main.innerHTML = await pageCashbook();
    else if (route.startsWith('#/reports')) main.innerHTML = await pageReports();
    else if (route.startsWith('#/settings')) main.innerHTML = await pageSettings();
    else if (route.startsWith('#/receipt/')) main.innerHTML = await pageReceipt(route.split('/')[2]);
    else main.innerHTML = await pageDashboard();
  } catch (e) {
    main.innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
}

// ---------------- Dashboard ----------------
async function pageDashboard() {
  const [tipsData, lowStock] = await Promise.all([
    API.get('/tips').catch(() => ({ tips: [] })),
    API.get('/inventory/low-stock').catch(() => ({ products: [], materials: [] })),
  ]);
  let cash = null;
  if (API.user.role === 'admin') cash = await API.get('/cashbook/summary').catch(() => null);

  return `
  <div class="card">
    <h3>Offline tips</h3>
    ${tipsData.tips.map(t => `<div class="tip ${t.level === 'warning' ? 'warning' : ''}">${esc(t.message)}</div>`).join('')}
  </div>
  ${cash ? `
  <div class="stat-row">
    <div class="stat"><div class="value">${money(cash.cash_in_hand)}</div><div class="label">Cash in hand</div></div>
    <div class="stat"><div class="value">${money(cash.today_in)}</div><div class="label">Today in</div></div>
    <div class="stat"><div class="value">${money(cash.today_out)}</div><div class="label">Today out</div></div>
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

// ---------------- POS ----------------
async function pagePOS() {
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
    location.hash = '#/receipt/' + sale.id;
    renderApp();
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

// ---------------- Inventory ----------------
async function pageInventory() {
  const [products, materials] = await Promise.all([API.get('/inventory/products'), API.get('/inventory/materials')]);
  const isAdmin = API.user.role === 'admin';
  return `
  <div class="card">
    <h2>Finished goods</h2>
    <div class="table-wrap"><table>
      <tr><th>Product</th><th>Size</th><th>Price</th><th>Stock</th>${isAdmin ? '<th>Adjust</th>' : ''}</tr>
      ${products.map(p => `<tr>
        <td>${esc(p.name)}</td><td>${esc(p.size)}</td><td>${money(p.unit_price)}</td>
        <td>${p.stock_qty <= p.low_stock_threshold ? `<span class="pill warn">${p.stock_qty}</span>` : p.stock_qty}</td>
        ${isAdmin ? `<td><button class="btn secondary" onclick="actions.adjustStock('product',${p.id},'${esc(p.name)}')">+/-</button></td>` : ''}
      </tr>`).join('')}
    </table></div>
    ${isAdmin ? `<button class="btn secondary" style="margin-top:10px" onclick="actions.newProduct()">Add product</button>` : ''}
  </div>
  <div class="card">
    <h2>Raw materials</h2>
    <div class="table-wrap"><table>
      <tr><th>Material</th><th>Unit</th><th>Stock</th><th>Avg cost</th>${isAdmin ? '<th>Adjust</th>' : ''}</tr>
      ${materials.map(m => `<tr>
        <td>${esc(m.name)}</td><td>${esc(m.unit)}</td>
        <td>${m.stock_qty <= m.low_stock_threshold ? `<span class="pill warn">${m.stock_qty}</span>` : m.stock_qty}</td>
        <td>${money(m.avg_cost)}</td>
        ${isAdmin ? `<td><button class="btn secondary" onclick="actions.adjustStock('material',${m.id},'${esc(m.name)}')">+/-</button></td>` : ''}
      </tr>`).join('')}
    </table></div>
    ${isAdmin ? `<button class="btn secondary" style="margin-top:10px" onclick="actions.newMaterial()">Add material</button>` : ''}
  </div>
  ${isAdmin ? `<div class="card"><h2>Bill of Materials</h2>
    <p style="color:var(--muted);font-size:13px">How much raw material each bag size consumes. Used to auto-deduct stock and cost each production run.</p>
    <label>Product</label>
    <select id="bom_product" onchange="actions.loadBom()">${products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    <div id="bomBox"></div>
  </div>` : ''}`;
}
actions.newProduct = async () => {
  const name = prompt('Product name (e.g. Paper Bag 1kg):'); if (!name) return;
  const size = prompt('Size label (e.g. 1kg):') || '';
  const unit_price = Number(prompt('Selling price:') || 0);
  const low_stock_threshold = Number(prompt('Low-stock alert threshold:') || 0);
  await API.post('/inventory/products', { name, size, unit_price, low_stock_threshold });
  renderApp();
};
actions.newMaterial = async () => {
  const name = prompt('Material name:'); if (!name) return;
  const unit = prompt('Unit (kg, roll, litre...):') || 'kg';
  const low_stock_threshold = Number(prompt('Low-stock alert threshold:') || 0);
  await API.post('/inventory/materials', { name, unit, low_stock_threshold });
  renderApp();
};
actions.adjustStock = async (type, id, name) => {
  const change = Number(prompt(`Stock adjustment for ${name} (use negative to reduce):`) || 0);
  if (!change) return;
  const reason = prompt('Reason (e.g. damaged, recount):') || 'adjustment';
  await API.post(`/inventory/${type === 'product' ? 'products' : 'materials'}/${id}/adjust`, { change_qty: change, reason });
  renderApp();
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
  const [products, batches] = await Promise.all([API.get('/inventory/products'), API.get('/production')]);
  return `
  <div class="card">
    <h2>Log a production run</h2>
    <label>Product</label>
    <select id="prod_product">${products.map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.size)})</option>`).join('')}</select>
    <label>Quantity produced</label>
    <input id="prod_qty" type="number" step="1">
    <label>Shift</label>
    <select id="prod_shift"><option>Morning</option><option>Afternoon</option><option>Night</option></select>
    <label>Notes</label>
    <input id="prod_notes" placeholder="optional">
    <div id="prodMsg"></div>
    <button class="btn block" style="margin-top:10px" onclick="actions.logProduction()">Save production run</button>
  </div>
  <div class="card">
    <h2>Recent batches</h2>
    <div class="table-wrap"><table>
      <tr><th>Date</th><th>Product</th><th>Qty</th><th>Shift</th><th>Operator</th><th>Material cost</th></tr>
      ${batches.map(b => `<tr><td>${dt(b.produced_at)}</td><td>${esc(b.product_name)} (${esc(b.size)})</td>
        <td>${b.qty_produced}</td><td>${esc(b.shift)}</td><td>${esc(b.operator_name || '')}</td><td>${money(b.material_cost)}</td></tr>`).join('')}
    </table></div>
  </div>`;
}
actions.logProduction = async () => {
  const body = {
    product_id: document.getElementById('prod_product').value,
    qty_produced: Number(document.getElementById('prod_qty').value),
    shift: document.getElementById('prod_shift').value,
    notes: document.getElementById('prod_notes').value,
  };
  try {
    await API.post('/production', body);
    renderApp();
  } catch (e) {
    document.getElementById('prodMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};

// ---------------- Purchases & Suppliers ----------------
async function pagePurchases() {
  const [purchases, suppliers, materials] = await Promise.all([
    API.get('/purchases'), API.get('/purchases/suppliers'), API.get('/inventory/materials'),
  ]);
  return `
  <div class="card">
    <h2>Record a purchase (raw material intake)</h2>
    <label>Material</label>
    <select id="pu_material">${materials.map(m => `<option value="${m.id}">${esc(m.name)} (${esc(m.unit)})</option>`).join('')}</select>
    <label>Supplier</label>
    <select id="pu_supplier"><option value="">(none)</option>${suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    <label>Quantity</label>
    <input id="pu_qty" type="number" step="0.01">
    <label>Unit cost</label>
    <input id="pu_cost" type="number" step="0.01">
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
actions.logPurchase = async () => {
  const paidVal = document.getElementById('pu_paid').value;
  const body = {
    material_id: document.getElementById('pu_material').value,
    supplier_id: document.getElementById('pu_supplier').value || null,
    qty: Number(document.getElementById('pu_qty').value),
    unit_cost: Number(document.getElementById('pu_cost').value),
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
  const customers = await API.get('/customers');
  return `
  <div class="card">
    <h2>Customers</h2>
    <button class="btn secondary" onclick="actions.newCustomer()">Add customer</button>
    <div class="table-wrap" style="margin-top:10px"><table>
      <tr><th>Name</th><th>Phone</th><th>Owes</th><th></th></tr>
      ${customers.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone || '')}</td>
        <td>${c.balance > 0 ? `<span class="pill warn">${money(c.balance)}</span>` : money(c.balance)}</td>
        <td>${c.balance > 0 ? `<button class="btn secondary" onclick="actions.payCustomer(${c.id},'${esc(c.name)}')">Record payment</button>` : ''}</td></tr>`).join('')}
    </table></div>
  </div>`;
}
actions.newCustomer = async () => {
  const name = prompt('Customer name:'); if (!name) return;
  const phone = prompt('Phone (optional):') || '';
  await API.post('/customers', { name, phone });
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
async function pageSettings() {
  const users = await API.get('/auth/users');
  const s = state.settings;
  return `
  <div class="card">
    <h2>Business profile</h2>
    <label>Business name</label><input id="set_name" value="${esc(s.business_name)}">
    <label>Industry</label><input id="set_industry" value="${esc(s.industry)}">
    <label>Address</label><input id="set_address" value="${esc(s.address)}">
    <label>Phone</label><input id="set_phone" value="${esc(s.phone)}">
    <label>Currency</label><input id="set_currency" value="${esc(s.currency)}">
    <div id="setMsg"></div>
    <button class="btn block" style="margin-top:10px" onclick="actions.saveSettings()">Save</button>
  </div>
  <div class="card">
    <h2>Staff accounts</h2>
    <table><tr><th>Name</th><th>Role</th><th></th></tr>
      ${users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.role)}</td>
        <td>${u.id !== API.user.id ? `<button class="btn secondary" onclick="actions.removeUser(${u.id})">Remove</button>` : '(you)'}</td></tr>`).join('')}
    </table>
    <button class="btn secondary" style="margin-top:10px" onclick="actions.newUser()">Add staff</button>
  </div>
  <div class="card">
    <h2>Backup</h2>
    <p style="color:var(--muted);font-size:13px">Download a full backup of the database. Keep copies on a USB drive off the machine.</p>
    <a class="btn block" href="/api/backup/download" target="_blank">Download backup (.db)</a>
  </div>`;
}
actions.saveSettings = async () => {
  const body = {
    business_name: document.getElementById('set_name').value,
    industry: document.getElementById('set_industry').value,
    address: document.getElementById('set_address').value,
    phone: document.getElementById('set_phone').value,
    currency: document.getElementById('set_currency').value,
  };
  try {
    await API.put('/auth/settings', body);
    state.settings = await API.get('/auth/settings');
    document.getElementById('setMsg').innerHTML = `<div class="msg ok">Saved.</div>`;
  } catch (e) {
    document.getElementById('setMsg').innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
  }
};
actions.newUser = async () => {
  const name = prompt('Staff name:'); if (!name) return;
  const role = prompt('Role (admin / cashier / production):', 'cashier'); if (!role) return;
  const pin = prompt('4-digit PIN for this person:'); if (!pin) return;
  try { await API.post('/auth/users', { name, role, pin }); renderApp(); }
  catch (e) { alert(e.message); }
};
actions.removeUser = async (id) => {
  if (!confirm('Remove this staff account?')) return;
  await API.del('/auth/users/' + id);
  renderApp();
};

boot();
