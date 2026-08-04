// Thin fetch wrapper. Always hits the same host/port the page was loaded
// from, so this works identically whether you're on the server machine
// itself or on a phone at http://<lan-ip>:4000.
const API = {
  base: '/api',
  token: localStorage.getItem('plastpos_token') || null,
  user: JSON.parse(localStorage.getItem('plastpos_user') || 'null'),

  setSession(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem('plastpos_token', token);
    localStorage.setItem('plastpos_user', JSON.stringify(user));
  },
  clearSession() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('plastpos_token');
    localStorage.removeItem('plastpos_user');
  },

  // A page fires several requests at once (Promise.all); if the session
  // died they'd all hit 401 together and each try to re-render - this
  // makes only the first one actually do it.
  _loggedOutOnce: false,
  _handleExpired() {
    this.clearSession();
    if (this._loggedOutOnce) return;
    this._loggedOutOnce = true;
    renderApp();
    setTimeout(() => { this._loggedOutOnce = false; }, 500);
  },

  async req(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new Error('Cannot reach the server. Check you are connected to the shop WiFi.');
    }
    if (res.status === 401) {
      this._handleExpired();
      throw new Error('Session expired, please log in again.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  get(path) { return this.req('GET', path); },
  post(path, body) { return this.req('POST', path, body); },
  put(path, body) { return this.req('PUT', path, body); },
  del(path) { return this.req('DELETE', path); },

  // For endpoints that take a photo (multipart/form-data) - deliberately
  // separate from req() since it must NOT set a JSON content-type header.
  async postForm(path, formData, method) {
    const headers = {};
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    let res;
    try {
      res = await fetch(this.base + path, { method: method || 'POST', headers, body: formData });
    } catch (err) {
      throw new Error('Cannot reach the server. Check you are connected to the shop WiFi.');
    }
    if (res.status === 401) {
      this._handleExpired();
      throw new Error('Session expired, please log in again.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
};
