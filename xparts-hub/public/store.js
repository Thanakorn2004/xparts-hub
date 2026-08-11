/* XParts Hub - shared data layer. Server API when hosted, localStorage fallback when opened as a file. */
window.XPartsDB = (function () {
  var useApi = location.protocol === 'http:' || location.protocol === 'https:';
  var PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">' +
    '<rect width="600" height="600" fill="#e4e4e7"/><circle cx="300" cy="300" r="190" fill="#18181b"/>' +
    '<circle cx="300" cy="300" r="120" fill="#caff04"/>' +
    '<text x="300" y="325" text-anchor="middle" font-family="Arial Black" font-size="70" fill="#09090b">X</text></svg>');

  function fire() { window.dispatchEvent(new Event('xparts:changed')); }
  function sortDesc(rows) { return rows.slice().sort(function (a, b) { return Number(b.id) - Number(a.id); }); }
  function normalize(d) {
    return {
      name: String(d.name || '').trim(),
      type: d.type ? String(d.type).toUpperCase() : '',
      weight: d.weight === '' || d.weight == null ? null : Number(d.weight),
      image: d.image || '',
      description: String(d.description || '').trim()
    };
  }

  function col(name) {
    var KEY = 'xparts_' + name + '_v1';
    function lsLoad() { try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    function lsSave(r) { localStorage.setItem(KEY, JSON.stringify(r)); fire(); }

    if (useApi) return {
      all: function () { return fetch('/api/' + name).then(function (r) { return r.json(); }).then(sortDesc); },
      add: function (d) { return fetch('/api/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(normalize(d)) }).then(function (r) { return r.json().then(function (v) { if (!r.ok) throw new Error(v.error || 'save failed'); fire(); return v; }); }); },
      remove: function (id) { return fetch('/api/' + name + '/' + id, { method: 'DELETE' }).then(function () { fire(); }); },
      clear: function () { return fetch('/api/' + name, { method: 'DELETE' }).then(function () { fire(); }); }
    };
    return {
      all: function () { return Promise.resolve(sortDesc(lsLoad())); },
      add: function (d) { var rows = lsLoad(); var rec = normalize(d); rec.id = Date.now(); rec.createdAt = new Date().toISOString(); rows.push(rec); lsSave(rows); return Promise.resolve(rec); },
      remove: function (id) { lsSave(lsLoad().filter(function (x) { return String(x.id) !== String(id); })); return Promise.resolve(); },
      clear: function () { lsSave([]); return Promise.resolve(); }
    };
  }

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Standard card used by catalog pages.
  function card(x, badge) {
    var b = badge || x.type;
    return '<article class="card-x bg-white border-[3px] border-black box-cut overflow-hidden">' +
      '<img src="' + esc(x.image || PLACEHOLDER) + '" onerror="this.src=window.XPartsDB.placeholder" class="w-full aspect-square object-cover bg-zinc-100" alt="' + esc(x.name) + '">' +
      '<div class="p-4"><div class="flex justify-between gap-3 items-start">' +
      '<h4 class="font-x text-2xl text-black">' + esc(x.name) + '</h4>' +
      (b ? '<span class="bg-black text-x-green px-2 py-1 text-xs font-bold whitespace-nowrap">' + esc(b) + '</span>' : '') +
      '</div><p class="text-sm text-zinc-600 mt-2">' + esc(x.description || 'ไม่มีรายละเอียด') + '</p>' +
      '<div class="mt-4 pt-3 border-t-2 border-zinc-200 text-xs font-bold text-zinc-500">WEIGHT: ' + esc(x.weight || '-') + (x.weight ? ' g' : '') + '</div>' +
      '</div></article>';
  }
  function empty(msg) {
    return '<div class="col-span-full bg-white border-[3px] border-black box-cut p-8 text-center">' +
      '<p class="font-x text-3xl">NO DATA</p><p class="text-zinc-500 mt-2">' + esc(msg || 'ยังไม่มีข้อมูลในระบบ') + '</p></div>';
  }

  return { col: col, placeholder: PLACEHOLDER, esc: esc, card: card, empty: empty };
})();
