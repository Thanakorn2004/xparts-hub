/* Shared catalog grid with optional type filter. */
window.initCatalog = function (colName, opts) {
  opts = opts || {};
  var grid = document.getElementById('catalog-grid');
  var filterWrap = document.getElementById('catalog-filters');
  var params = new URLSearchParams(location.search);
  var current = params.get('type') ? params.get('type').toUpperCase() : 'ALL';
  var types = ['ATTACK', 'DEFENSE', 'STAMINA', 'BALANCE'];

  function drawFilters() {
    if (!filterWrap) return;
    var all = ['ALL'].concat(types);
    filterWrap.innerHTML = all.map(function (t) {
      var active = t === current;
      return '<button data-type="' + t + '" class="slanted font-x text-lg px-4 pt-2 pb-1 border-2 ' +
        (active ? 'bg-x-green text-black border-black' : 'bg-zinc-800 text-white border-transparent hover:bg-zinc-700') +
        ' transition-colors">' + t + '</button>';
    }).join('');
  }
  function render() {
    window.XPartsDB.col(colName).all().then(function (rows) {
      if (opts.useFilter && current !== 'ALL') rows = rows.filter(function (x) { return String(x.type).toUpperCase() === current; });
      grid.innerHTML = rows.length
        ? rows.map(function (x) { return window.XPartsDB.card(x, opts.badge || x.type); }).join('')
        : window.XPartsDB.empty(opts.emptyMsg || 'ยังไม่มีข้อมูล — เพิ่มได้จากหน้า Admin');
    });
  }
  if (opts.useFilter && filterWrap) {
    window.XPartsDB.col('categories').all().then(function (c) {
      if (c.length) types = c.map(function (x) { return String(x.name).toUpperCase(); });
      drawFilters();
    }).catch(drawFilters);
    filterWrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-type]');
      if (!b) return;
      current = b.getAttribute('data-type');
      drawFilters();
      render();
    });
    drawFilters();
  }
  render();
  window.addEventListener('xparts:changed', render);
  window.addEventListener('storage', render);
};
