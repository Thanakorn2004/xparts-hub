/* XParts Hub - client auth helper. */
window.XPartsAuth = (function () {
  var api = location.protocol === 'http:' || location.protocol === 'https:';
  return {
    serverMode: api,
    login: function (email, password) {
      if (!api) { sessionStorage.setItem('xp_local_auth', email || 'local-admin'); return Promise.resolve({ ok: true, email: email }); }
      return fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: password }) })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'login failed'); return d; }); });
    },
    logout: function () {
      if (!api) { sessionStorage.removeItem('xp_local_auth'); return Promise.resolve(); }
      return fetch('/api/logout', { method: 'POST' });
    },
    me: function () {
      if (!api) { var v = sessionStorage.getItem('xp_local_auth'); return v ? Promise.resolve({ email: v }) : Promise.reject(new Error('no')); }
      return fetch('/api/me').then(function (r) { if (!r.ok) throw new Error('no'); return r.json(); });
    },
    guard: function () { return this.me().catch(function () { location.href = 'login.html'; throw new Error('redirect'); }); }
  };
})();
