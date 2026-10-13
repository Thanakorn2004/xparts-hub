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
    var out = {
      name: String(d.name || '').trim(),
      type: d.type ? String(d.type).toUpperCase() : '',
      weight: d.weight === '' || d.weight == null ? null : Number(d.weight),
      image: d.image || '',
      description: String(d.description || '').trim()
    };
    // Pass these through only when the caller actually supplied them, so
    // collections that don't use them (beys, blades, categories...) stay clean.
    if (d.points !== undefined) out.points = d.points === '' || d.points == null ? null : Number(d.points);
    if (d.sectionId !== undefined) out.sectionId = d.sectionId === '' || d.sectionId == null ? null : Number(d.sectionId);
    if (d.productCode !== undefined) out.productCode = String(d.productCode || '').trim();
    if (d.color !== undefined) out.color = String(d.color || '').trim();
    if (d.metalCoat !== undefined) out.metalCoat = !!d.metalCoat;
    if (d.partsCategory !== undefined) out.partsCategory = String(d.partsCategory || '').trim();
    if (d.spin !== undefined) out.spin = String(d.spin || '').trim();
    return out;
  }

  // For edits: normalize, then keep only the keys the caller actually passed,
  // so untouched fields (and the existing image) are left alone.
  function partial(d) {
    var full = normalize(d), out = {};
    Object.keys(d).forEach(function (k) { if (k in full && !(k === 'image' && d.image === undefined)) out[k] = full[k]; });
    return out;
  }

  function col(name) {
    var KEY = 'xparts_' + name + '_v1';
    function lsLoad() { try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
    function lsSave(r) { localStorage.setItem(KEY, JSON.stringify(r)); fire(); }

    if (useApi) return {
      all: function () { return fetch('/api/' + name).then(function (r) { return r.json(); }).then(sortDesc); },
      add: function (d) { return fetch('/api/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(normalize(d)) }).then(function (r) { return r.json().then(function (v) { if (!r.ok) throw new Error(v.error || 'save failed'); fire(); return v; }); }); },
      update: function (id, d) { return fetch('/api/' + name + '/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partial(d)) }).then(function (r) { return r.json().then(function (v) { if (!r.ok) throw new Error(v.error || 'save failed'); fire(); return v; }); }); },
      remove: function (id) { return fetch('/api/' + name + '/' + id, { method: 'DELETE' }).then(function () { fire(); }); },
      clear: function () { return fetch('/api/' + name, { method: 'DELETE' }).then(function () { fire(); }); }
    };
    return {
      all: function () { return Promise.resolve(sortDesc(lsLoad())); },
      add: function (d) { var rows = lsLoad(); var rec = normalize(d); rec.id = Date.now(); rec.createdAt = new Date().toISOString(); rows.push(rec); lsSave(rows); return Promise.resolve(rec); },
      update: function (id, d) {
        var rows = lsLoad(); var p = partial(d); var hit = null;
        rows.forEach(function (x) { if (String(x.id) === String(id)) { Object.keys(p).forEach(function (k) { x[k] = p[k]; }); x.updatedAt = new Date().toISOString(); hit = x; } });
        lsSave(rows); return Promise.resolve(hit);
      },
      remove: function (id) { lsSave(lsLoad().filter(function (x) { return String(x.id) !== String(id); })); return Promise.resolve(); },
      clear: function () { lsSave([]); return Promise.resolve(); }
    };
  }

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Standard card used by catalog pages: full (uncropped) image + every field that was filled in.
  function card(x, badge) {
    var b = badge || x.type;
    var rows = [];
    function add(label, val) { if (val !== undefined && val !== null && String(val).trim() !== '') rows.push([label, val]); }
    add('WEIGHT', x.weight ? x.weight + ' g' : '');
    add('PRODUCT CODE', x.productCode);
    add('COLOR', x.color);
    add('PARTS', x.partsCategory);
    if (x.partsCategory !== 'Lock Chip') add('SPIN', x.spin);
    add('POINTS', x.points);
    var details = rows.map(function (r) {
      return '<div class="min-w-0"><dt class="text-[10px] font-bold tracking-wider text-zinc-400">' + esc(r[0]) + '</dt>' +
        '<dd class="text-sm font-bold text-black break-words">' + esc(r[1]) + '</dd></div>';
    }).join('');
    var metal = x.metalCoat ? '<span class="inline-block bg-x-green text-black border-2 border-black px-2 py-0.5 text-xs font-bold">METAL COAT</span>' : '';
    var hasImg = !!x.image;
    return '<article class="card-x bg-white border-[3px] border-black box-cut overflow-hidden flex flex-col">' +
      '<div class="bg-zinc-100 border-b-2 border-zinc-200 flex items-center justify-center">' +
      '<img src="' + esc(x.image || PLACEHOLDER) + '" onerror="this.src=window.XPartsDB.placeholder" ' + (hasImg ? 'data-zoom="1" title="คลิกเพื่อดูรูปเต็ม" ' : '') +
      'class="w-full aspect-square object-contain p-2 ' + (hasImg ? 'cursor-zoom-in' : '') + '" alt="' + esc(x.name || 'ไม่ระบุชื่อ') + '"></div>' +
      '<div class="p-4 flex-1 flex flex-col"><div class="flex justify-between gap-3 items-start">' +
      '<h4 class="font-x text-2xl text-black break-words min-w-0">' + esc(x.name || 'ไม่ระบุชื่อ') + '</h4>' +
      (b ? '<span class="bg-black text-x-green px-2 py-1 text-xs font-bold whitespace-nowrap">' + esc(b) + '</span>' : '') +
      '</div><p class="text-sm text-zinc-600 mt-2 break-words whitespace-pre-line">' + esc(x.description || 'ไม่มีรายละเอียด') + '</p>' +
      (details || metal ? '<div class="mt-auto pt-3"><div class="mt-4 pt-3 border-t-2 border-zinc-200">' +
        (details ? '<dl class="grid grid-cols-2 gap-x-4 gap-y-2">' + details + '</dl>' : '') +
        (metal ? '<div class="mt-3">' + metal + '</div>' : '') + '</div></div>' : '') +
      '</div></article>';
  }
  function empty(msg) {
    return '<div class="col-span-full bg-white border-[3px] border-black box-cut p-8 text-center">' +
      '<p class="font-x text-3xl">NO DATA</p><p class="text-zinc-500 mt-2">' + esc(msg || 'ยังไม่มีข้อมูลในระบบ') + '</p></div>';
  }

  // Click a card image to see it full size (click / Esc to close).
  document.addEventListener('click', function (e) {
    var img = e.target.closest && e.target.closest('img[data-zoom]');
    if (!img || img.getAttribute('src') === PLACEHOLDER) return;
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;padding:16px;cursor:zoom-out';
    ov.innerHTML = '<img src="' + esc(img.getAttribute('src')) + '" style="max-width:100%;max-height:100%;object-fit:contain" alt="">' +
      '<span style="position:absolute;top:10px;right:20px;color:#fff;font:700 34px Arial">&times;</span>';
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
    ov.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
  });

  return { col: col, placeholder: PLACEHOLDER, esc: esc, card: card, empty: empty };
})();
