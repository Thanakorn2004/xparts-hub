/* XParts Hub - admin CRUD for all collections. */
(function () {
  var esc = window.XPartsDB.esc;
  var SECTIONS = [
    { col: 'beys', label: 'BEYBLADE', kind: 'full', hint: 'เช่น Dran Sword 3-60F' },
    { col: 'blades', label: 'BLADE', kind: 'full', hint: 'เช่น Dran Sword' },
    { col: 'ratchets', label: 'RATCHET', kind: 'basic', hint: 'เช่น 3-60' },
    { col: 'bits', label: 'BIT', kind: 'basic', hint: 'เช่น F (Flat)' },
    { col: 'categories', label: 'CATEGORY', kind: 'name', hint: 'เช่น ATTACK' },
    { col: 'rules', label: 'RULES', kind: 'rules', hint: 'เช่น Spin Finish' },
    { col: 'about', label: 'ABOUT', kind: 'about', hint: 'เช่น เจเนอเรชันที่ 4' }
  ];
  var current = SECTIONS[0];
  var typeOptions = ['ATTACK', 'DEFENSE', 'STAMINA', 'BALANCE'];
  var tabs = document.getElementById('admin-tabs');
  var root = document.getElementById('admin-root');

  function drawTabs() {
    tabs.innerHTML = SECTIONS.map(function (s) {
      var active = s.col === current.col;
      return '<button data-tab="' + s.col + '" class="slanted font-x text-lg px-4 pt-2 pb-1 border-2 ' +
        (active ? 'bg-x-green text-black border-black' : 'bg-zinc-800 text-white border-transparent hover:bg-zinc-700') +
        ' transition-colors">' + s.label + '</button>';
    }).join('');
  }

  /* ---- fields shown in the add/edit form, per section kind ---- */
  function formHtml(s) {
    var f = '<label class="block font-bold text-sm">ชื่อ<input name="name" required maxlength="80" class="field mt-1 w-full border-2 border-black p-3" placeholder="' + esc(s.hint) + '"></label>';

    if (s.kind === 'full') {
      f += '<label class="block font-bold text-sm">ประเภท<select name="type" class="field mt-1 w-full border-2 border-black p-3 bg-white">' +
        typeOptions.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></label>';
    }
    if (s.kind === 'rules') {
      f += '<label class="block font-bold text-sm">คะแนน (Point)<input name="points" type="number" min="1" max="5" class="field mt-1 w-full border-2 border-black p-3" placeholder="1"></label>';
    }
    if (s.kind === 'full' || s.kind === 'basic') {
      f += '<label class="block font-bold text-sm">น้ำหนัก (g)<input name="weight" type="number" min="0" step="0.01" class="field mt-1 w-full border-2 border-black p-3" placeholder="35.2"></label>';
    }
    if (s.kind === 'full' || s.kind === 'basic' || s.kind === 'rules') {
      f += '<label class="block font-bold text-sm">URL รูปภาพ' + (s.kind === 'rules' ? ' (จำเป็น - ต้องเป็นลิงก์รูปที่ใช้งานได้จริง)' : '') +
        '<input name="image" type="url" ' + (s.kind === 'rules' ? 'required ' : '') +
        'class="field mt-1 w-full border-2 border-black p-3" placeholder="https://..."></label>';
    }
    if (s.kind !== 'name') {
      f += '<label class="block font-bold text-sm">' + (s.kind === 'about' ? 'เนื้อหา (ข้อความ)' : 'รายละเอียด') +
        '<textarea name="description" rows="' + (s.kind === 'about' ? 5 : 3) + '" maxlength="' + (s.kind === 'about' ? 800 : 500) + '" ' +
        (s.kind === 'about' ? 'required ' : '') + 'class="field mt-1 w-full border-2 border-black p-3"></textarea></label>';
    }
    return f;
  }

  /* ---- table columns, per kind (NAME and ACTION are always present) ---- */
  function extraHeaders(s) {
    if (s.kind === 'full') return ['TYPE', 'WEIGHT'];
    if (s.kind === 'basic') return ['WEIGHT'];
    if (s.kind === 'rules') return ['POINTS'];
    return []; // name, about
  }
  function nameCell(s, x) {
    if (s.kind === 'name') return '<strong>' + esc(x.name) + '</strong>';
    if (s.kind === 'about') return '<div><strong>' + esc(x.name) + '</strong><p class="text-xs text-zinc-500 max-w-md truncate">' + esc(x.description || '-') + '</p></div>';
    return '<div class="flex items-center gap-3"><img class="thumb border-2 border-black" src="' + esc(x.image || window.XPartsDB.placeholder) + '" onerror="this.src=window.XPartsDB.placeholder">' +
      '<div><strong>' + esc(x.name) + '</strong><p class="text-xs text-zinc-500 max-w-xs truncate">' + esc(x.description || '-') + '</p></div></div>';
  }
  function extraCells(s, x) {
    if (s.kind === 'full') return ['<span class="bg-black text-x-green px-3 py-1 text-xs font-bold">' + esc(x.type || '-') + '</span>', esc(x.weight || '-') + (x.weight ? ' g' : '')];
    if (s.kind === 'basic') return [esc(x.weight || '-') + (x.weight ? ' g' : '')];
    if (s.kind === 'rules') return [esc(x.points || '-') + (x.points ? 'P' : '')];
    return [];
  }
  function rowHtml(s, x) {
    var cells = [nameCell(s, x)].concat(extraCells(s, x));
    return '<tr class="border-b-2 border-zinc-200">' + cells.map(function (c) { return '<td class="p-4">' + c + '</td>'; }).join('') +
      '<td class="p-4"><button data-delete="' + x.id + '" class="bg-red-600 text-white border-2 border-black px-4 py-2 font-bold hover:bg-black">DELETE</button></td></tr>';
  }

  function drawSection() {
    var s = current;
    var extra = extraHeaders(s);
    var cols = 2 + extra.length;
    root.innerHTML =
      '<div class="grid lg:grid-cols-[380px_minmax(0,1fr)] gap-7 items-start">' +
      '<section class="bg-white border-[3px] border-black box-cut shadow-[7px_7px_0_0_#caff04] p-6">' +
      '<h2 class="font-x text-3xl border-b-[3px] border-black pb-2">+ ADD ' + s.label + '</h2>' +
      '<form id="add-form" class="space-y-4 mt-5">' + formHtml(s) +
      '<button class="w-full bg-x-green text-black border-[3px] border-black font-x text-2xl py-3 box-cut hover:bg-black hover:text-x-green transition-colors">SAVE TO DATABASE</button></form>' +
      '<p id="notice" class="hidden mt-4 bg-black text-x-green p-3 font-bold text-sm"></p></section>' +
      '<section class="min-w-0"><div class="flex justify-between items-end gap-4 mb-4">' +
      '<h2 class="font-x text-3xl md:text-4xl">ALL ' + s.label + ' <span id="count" class="c-x-red"></span></h2>' +
      '<button id="delete-all" class="hidden bg-red-600 text-white px-4 py-2 border-2 border-black font-bold">ลบทั้งหมด</button></div>' +
      '<div class="overflow-x-auto bg-white border-[3px] border-black box-cut shadow-[7px_7px_0_0_#09090b]">' +
      '<table class="w-full text-left" style="min-width:640px"><thead class="bg-black text-white font-x text-lg"><tr>' +
      '<th class="p-4">NAME</th>' + extra.map(function (l) { return '<th class="p-4">' + l + '</th>'; }).join('') +
      '<th class="p-4">ACTION</th></tr></thead><tbody id="rows"></tbody></table></div></section></div>';

    var form = document.getElementById('add-form');
    var rowsEl = document.getElementById('rows');
    var notice = document.getElementById('notice');

    function render() {
      window.XPartsDB.col(s.col).all().then(function (rows) {
        document.getElementById('count').textContent = '(' + rows.length + ')';
        document.getElementById('delete-all').classList.toggle('hidden', !rows.length);
        rowsEl.innerHTML = rows.length ? rows.map(function (x) { return rowHtml(s, x); }).join('')
          : '<tr><td colspan="' + cols + '" class="p-12 text-center"><div class="font-x text-3xl">NO DATA</div><p class="text-zinc-500 mt-2">เพิ่มข้อมูลจากแบบฟอร์มด้านซ้าย</p></td></tr>';
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = {}; new FormData(form).forEach(function (v, k) { d[k] = v; });
      if (!d.name || !d.name.trim()) return;
      window.XPartsDB.col(s.col).add(d).then(function () {
        form.reset();
        notice.textContent = 'บันทึกข้อมูลแล้ว - หน้าเว็บจะอัปเดตอัตโนมัติ';
        notice.classList.remove('hidden');
        setTimeout(function () { notice.classList.add('hidden'); }, 2500);
        render();
      }).catch(function (err) {
        notice.textContent = err.message || 'บันทึกไม่สำเร็จ';
        notice.classList.remove('hidden');
      });
    });
    rowsEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-delete]');
      if (b && confirm('ยืนยันการลบข้อมูลนี้?')) window.XPartsDB.col(s.col).remove(b.getAttribute('data-delete')).then(render);
    });
    document.getElementById('delete-all').addEventListener('click', function () {
      if (confirm('ยืนยันการลบข้อมูลทั้งหมดในหมวดนี้?')) window.XPartsDB.col(s.col).clear().then(render);
    });
    render();
  }

  tabs.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (!b) return;
    current = SECTIONS.filter(function (s) { return s.col === b.getAttribute('data-tab'); })[0];
    drawTabs();
    drawSection();
  });

  window.XPartsDB.col('categories').all().then(function (c) {
    if (c.length) typeOptions = c.map(function (x) { return String(x.name).toUpperCase(); });
  }).catch(function () {}).then(function () { drawTabs(); drawSection(); });
})();
