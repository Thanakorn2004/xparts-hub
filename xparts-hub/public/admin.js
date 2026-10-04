/* XParts Hub - admin CRUD for all collections. */
(function () {
  var esc = window.XPartsDB.esc;
  var SECTIONS = [
    { col: 'beys', label: 'BEYBLADE', kind: 'full', hint: 'เช่น Dran Sword 3-60F' },
    { col: 'blades', label: 'BLADE', kind: 'full', hint: 'เช่น Dran Sword' },
    { col: 'ratchets', label: 'RATCHET', kind: 'basic', hint: 'เช่น 3-60' },
    { col: 'bits', label: 'BIT', kind: 'basic', hint: 'เช่น F (Flat)' },
    { col: 'categories', label: 'CATEGORY', kind: 'name', hint: 'เช่น ATTACK' },
    { col: 'rules', label: 'RULES', kind: 'rules-blocks', hint: '' },
    { col: 'about', label: 'ABOUT', kind: 'about-blocks', hint: '' },
    { col: 'admins', label: 'ADMINS', kind: 'admins-custom', hint: '' }
  ];
  var current = SECTIONS[0];
  var typeOptions = ['ATTACK', 'DEFENSE', 'STAMINA', 'BALANCE'];
  var myEmail = '';
  var myRole = 'admin'; // becomes 'super' once /api/me resolves, if that's who's logged in
  var tabs = document.getElementById('admin-tabs');
  var root = document.getElementById('admin-root');
  var IMAGE_KINDS = { full: 1, basic: 1 };

  function drawTabs() {
    tabs.innerHTML = SECTIONS.map(function (s) {
      var active = s.col === current.col;
      return '<button data-tab="' + s.col + '" class="slanted font-x text-lg px-4 pt-2 pb-1 border-2 ' +
        (active ? 'bg-x-green text-black border-black' : 'bg-zinc-800 text-white border-transparent hover:bg-zinc-700') +
        ' transition-colors">' + s.label + '</button>';
    }).join('');
  }

  // Wires every [data-toggle-pw] button within `scope` to flip its
  // preceding password input between hidden and visible text.
  function wirePasswordToggles(scope) {
    scope.querySelectorAll('[data-toggle-pw]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = btn.previousElementSibling;
        if (!input) return;
        var showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.textContent = showing ? '👁️' : '🙈';
        btn.setAttribute('aria-label', showing ? 'แสดงรหัสผ่าน' : 'ซ่อนรหัสผ่าน');
      });
    });
  }
  function passwordFieldHtml(opts) {
    opts = opts || {};
    return '<div class="relative mt-1">' +
      '<input name="' + (opts.name || 'password') + '" type="password" required minlength="6" class="field w-full border-2 border-black p-3 pr-12" placeholder="' + esc(opts.placeholder || 'อย่างน้อย 6 ตัวอักษร') + '">' +
      '<button type="button" data-toggle-pw class="absolute right-2 top-1/2 -translate-y-1/2 text-xl leading-none" aria-label="แสดงรหัสผ่าน">👁️</button>' +
      '</div>';
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  // Uploads the chosen file (server mode) or inlines it as a data URL (offline/local mode).
  function resolveImage(fileInput) {
    var file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) return Promise.resolve('');
    if (window.XPartsAuth.serverMode) {
      var fd = new FormData();
      fd.append('image', file);
      return fetch('/api/upload', { method: 'POST', body: fd })
        .then(function (r) { return r.json().then(function (v) { if (!r.ok) throw new Error(v.error || 'อัปโหลดรูปไม่สำเร็จ'); return v.url; }); });
    }
    return fileToDataUrl(file);
  }
  // Wraps a fetch to a JSON API endpoint: parses the body either way and
  // throws a real Error (with the server's message) on a non-2xx response,
  // instead of letting callers silently choke on an error object.
  function apiFetch(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (v) {
        if (!r.ok) throw new Error(v.error || ('คำขอล้มเหลว (HTTP ' + r.status + ')'));
        return v;
      });
    });
  }

  /* =========================================================
     Generic CRUD (beys, blades, ratchets, bits, categories)
     ========================================================= */
  function formHtml(s) {
    var f = '<label class="block font-bold text-sm">ชื่อ<input name="name" required maxlength="80" class="field mt-1 w-full border-2 border-black p-3" placeholder="' + esc(s.hint) + '"></label>';
    if (s.kind === 'full') {
      f += '<label class="block font-bold text-sm">ประเภท<select name="type" class="field mt-1 w-full border-2 border-black p-3 bg-white">' +
        typeOptions.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></label>';
    }
    if (s.kind === 'full' || s.kind === 'basic') {
      f += '<label class="block font-bold text-sm">น้ำหนัก (g)<input name="weight" type="number" min="0" step="0.01" class="field mt-1 w-full border-2 border-black p-3" placeholder="35.2"></label>';
    }
    if (IMAGE_KINDS[s.kind]) {
      f += '<label class="block font-bold text-sm">รูปภาพ (อัปโหลดจากเครื่อง)<input name="image_file" type="file" accept="image/*" class="field mt-1 w-full border-2 border-black p-2 bg-white"></label>';
    }
    if (s.kind !== 'name') {
      f += '<label class="block font-bold text-sm">รายละเอียด<textarea name="description" rows="3" maxlength="500" class="field mt-1 w-full border-2 border-black p-3"></textarea></label>';
    }
    return f;
  }
  function extraHeaders(s) {
    if (s.kind === 'full') return ['TYPE', 'WEIGHT'];
    if (s.kind === 'basic') return ['WEIGHT'];
    return [];
  }
  function nameCell(s, x) {
    if (s.kind === 'name') return '<strong>' + esc(x.name) + '</strong>';
    return '<div class="flex items-center gap-3"><img class="thumb border-2 border-black" src="' + esc(x.image || window.XPartsDB.placeholder) + '" onerror="this.src=window.XPartsDB.placeholder">' +
      '<div><strong>' + esc(x.name) + '</strong><p class="text-xs text-zinc-500 max-w-xs truncate">' + esc(x.description || '-') + '</p></div></div>';
  }
  function extraCells(s, x) {
    if (s.kind === 'full') return ['<span class="bg-black text-x-green px-3 py-1 text-xs font-bold">' + esc(x.type || '-') + '</span>', esc(x.weight || '-') + (x.weight ? ' g' : '')];
    if (s.kind === 'basic') return [esc(x.weight || '-') + (x.weight ? ' g' : '')];
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
    function showNotice(msg) { notice.textContent = msg; notice.classList.remove('hidden'); }

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
      var d = {};
      new FormData(form).forEach(function (v, k) { if (k !== 'image_file') d[k] = v; });
      if (!d.name || !d.name.trim()) return;
      var fileInput = form.querySelector('input[name="image_file"]');
      resolveImage(fileInput).then(function (url) {
        d.image = url;
        return window.XPartsDB.col(s.col).add(d);
      }).then(function () {
        form.reset();
        showNotice('บันทึกข้อมูลแล้ว - หน้าเว็บจะอัปเดตอัตโนมัติ');
        setTimeout(function () { notice.classList.add('hidden'); }, 2500);
        render();
      }).catch(function (err) { showNotice(err.message || 'บันทึกไม่สำเร็จ'); });
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

  /* =========================================================
     Block manager shared by ABOUT and RULES: banner "blocks"
     (a *_sections collection), each holding its own cards
     (a *_cards collection tied back via sectionId).
     cfg: { sectionCol, cardCol, cardNeedsImage, cardImageOptional }
     ========================================================= */
  function drawBlocks(cfg) {
    root.innerHTML =
      '<div id="blocks-wrap" class="space-y-8 mb-8"></div>' +
      '<section class="bg-white border-[3px] border-black box-cut shadow-[7px_7px_0_0_#caff04] p-6 max-w-xl">' +
      '<h2 class="font-x text-2xl border-b-[3px] border-black pb-2">+ เพิ่มบล็อกใหม่ (แถบหัวข้อ)</h2>' +
      '<form id="add-section-form" class="space-y-3 mt-4">' +
      '<label class="block font-bold text-sm">ข้อความบนแถบหัวข้อ<input name="name" required maxlength="120" class="field mt-1 w-full border-2 border-black p-3" placeholder="เช่น กติกาพิเศษ"></label>' +
      '<button class="w-full bg-x-green text-black border-[3px] border-black font-x text-xl py-2 box-cut hover:bg-black hover:text-x-green transition-colors">เพิ่มบล็อก</button></form>' +
      '<p id="block-notice" class="hidden mt-4 bg-black text-x-green p-3 font-bold text-sm"></p></section>';

    var wrap = document.getElementById('blocks-wrap');
    var notice = document.getElementById('block-notice');
    function showNotice(msg) { notice.textContent = msg; notice.classList.remove('hidden'); }
    var hasImageField = cfg.cardNeedsImage || cfg.cardImageOptional;

    function cardFieldsHtml() {
      var f = '<label class="block font-bold text-xs">หัวข้อ<input name="name" required maxlength="80" class="field mt-1 w-full border-2 border-black p-2"></label>';
      if (cfg.cardNeedsImage) {
        f += '<label class="block font-bold text-xs">คะแนน (Point)<input name="points" type="number" min="1" max="5" class="field mt-1 w-full border-2 border-black p-2"></label>';
      }
      if (hasImageField) {
        f += '<label class="block font-bold text-xs md:col-span-2">รูปภาพ' + (cfg.cardNeedsImage ? ' (จำเป็น - อัปโหลดจากเครื่อง)' : ' (ถ้ามี - อัปโหลดจากเครื่อง)') +
          '<input name="image_file" type="file" accept="image/*" ' + (cfg.cardNeedsImage ? 'required ' : '') +
          'class="field mt-1 w-full border-2 border-black p-2 bg-white"></label>';
      }
      f += '<label class="block font-bold text-xs md:col-span-2">เนื้อหา<textarea name="description" rows="2" ' + (cfg.cardNeedsImage ? '' : 'required ') + 'class="field mt-1 w-full border-2 border-black p-2"></textarea></label>';
      return f;
    }
    function cardDisplayHtml(c) {
      var thumb = hasImageField ? '<img class="thumb border-2 border-black" src="' + esc(c.image || window.XPartsDB.placeholder) + '" onerror="this.src=window.XPartsDB.placeholder">' : '';
      var pointsLine = cfg.cardNeedsImage ? '<p class="text-xs text-zinc-500 font-bold">คะแนน: ' + esc(c.points || '-') + '</p>' : '';
      return '<div class="bg-zinc-100 border-2 border-black p-4 flex gap-3">' + thumb +
        '<div class="flex-1"><div class="flex justify-between gap-2 items-start">' +
        '<strong class="font-x text-lg">' + esc(c.name) + '</strong>' +
        '<button data-delete-card="' + c.id + '" class="text-x-red font-bold text-xs hover:underline whitespace-nowrap">ลบ</button></div>' +
        pointsLine +
        '<p class="text-sm text-zinc-600 mt-1">' + esc(c.description || '-') + '</p></div></div>';
    }

    function blockHtml(sec, cards) {
      return '<div class="bg-white border-[3px] border-black box-cut overflow-hidden" data-section-block="' + sec.id + '">' +
        '<div class="bg-zinc-950 px-6 py-4 flex justify-between items-center gap-3 flex-wrap">' +
        '<h3 class="font-x text-2xl text-x-green">' + esc(sec.name) + '</h3>' +
        '<button data-delete-section="' + sec.id + '" class="bg-x-red text-white border-2 border-black px-3 py-1 text-xs font-bold hover:bg-black">ลบบล็อกนี้ (รวมการ์ดข้างใน)</button></div>' +
        '<div class="p-6 grid md:grid-cols-2 gap-4">' +
        (cards.length ? cards.map(cardDisplayHtml).join('') : '<p class="text-sm text-zinc-500 col-span-full">ยังไม่มีการ์ดในบล็อกนี้</p>') +
        '</div>' +
        '<form data-add-card="' + sec.id + '" class="p-6 pt-0 grid md:grid-cols-2 gap-3 md:items-end">' + cardFieldsHtml() +
        '<button class="bg-x-green border-2 border-black font-x text-lg px-4 py-2 h-fit md:col-span-2">+ เพิ่มการ์ด</button></form>' +
        '</div>';
    }

    function render() {
      Promise.all([window.XPartsDB.col(cfg.sectionCol).all(), window.XPartsDB.col(cfg.cardCol).all()]).then(function (r) {
        var sections = r[0], cards = r[1];
        wrap.innerHTML = sections.length ? sections.slice().reverse().map(function (sec) {
          return blockHtml(sec, cards.filter(function (c) { return String(c.sectionId) === String(sec.id); }));
        }).join('') : '<div class="bg-white border-[3px] border-black box-cut p-8 text-center"><p class="font-x text-2xl">NO DATA</p><p class="text-zinc-500 mt-2">เพิ่มบล็อกแรกจากแบบฟอร์มด้านล่าง</p></div>';
      });
    }

    document.getElementById('add-section-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = e.target.name.value.trim();
      if (!name) return;
      window.XPartsDB.col(cfg.sectionCol).add({ name: name }).then(function () {
        e.target.reset();
        showNotice('เพิ่มบล็อกแล้ว');
        setTimeout(function () { notice.classList.add('hidden'); }, 2000);
        render();
      }).catch(function (err) { showNotice(err.message || 'เพิ่มไม่สำเร็จ'); });
    });

    wrap.addEventListener('submit', function (e) {
      var f = e.target.closest('[data-add-card]');
      if (!f) return;
      e.preventDefault();
      var sectionId = f.getAttribute('data-add-card');
      var d = { name: f.name.value.trim(), description: (f.description ? f.description.value.trim() : ''), sectionId: sectionId };
      if (!d.name) return;
      if (f.points) d.points = f.points.value;
      var fileInput = f.querySelector('input[name="image_file"]');
      resolveImage(fileInput).then(function (url) {
        if (cfg.cardNeedsImage && !url) throw new Error('กรุณาเลือกรูปภาพ');
        if (url) d.image = url;
        return window.XPartsDB.col(cfg.cardCol).add(d);
      }).then(function () { f.reset(); render(); })
        .catch(function (err) { showNotice(err.message || 'เพิ่มการ์ดไม่สำเร็จ'); });
    });
    wrap.addEventListener('click', function (e) {
      var delSec = e.target.closest('[data-delete-section]');
      if (delSec && confirm('ลบบล็อกนี้ทั้งหมด (รวมการ์ดข้างใน)?')) {
        window.XPartsDB.col(cfg.sectionCol).remove(delSec.getAttribute('data-delete-section')).then(render);
        return;
      }
      var delCard = e.target.closest('[data-delete-card]');
      if (delCard && confirm('ลบการ์ดนี้?')) {
        window.XPartsDB.col(cfg.cardCol).remove(delCard.getAttribute('data-delete-card')).then(render);
      }
    });
    render();
  }

  /* =========================================================
     ADMINS: create additional admin accounts from the panel.
     Requires the real Node server - there is no local-storage
     fallback, since admin accounts only make sense server-side.
     ========================================================= */
  function roleLabel(r) { return r === 'super' ? 'แอดมินหลัก' : 'แอดมินรอง'; }
  function roleBadge(r) {
    return '<span class="inline-block whitespace-nowrap px-2 py-1 text-xs font-bold ' + (r === 'super' ? 'bg-x-green text-black' : 'bg-zinc-800 text-white') + '">' + roleLabel(r) + '</span>';
  }

  function drawAdmins() {
    if (!window.XPartsAuth.serverMode) {
      root.innerHTML = '<div class="bg-white border-[3px] border-black box-cut p-8 max-w-xl">' +
        '<p class="font-x text-3xl">ต้องรันผ่านเซิร์ฟเวอร์</p>' +
        '<p class="text-zinc-600 mt-3">การจัดการบัญชีแอดมินต้องเชื่อมกับฐานข้อมูลฝั่งเซิร์ฟเวอร์ ตอนนี้หน้านี้ถูกเปิดเป็นไฟล์โดยตรง (ไม่ได้รันผ่าน Node) จึงใช้ฟีเจอร์นี้ไม่ได้</p>' +
        '<p class="text-zinc-600 mt-2">วิธีแก้: เปิด terminal ในโฟลเดอร์โปรเจกต์ แล้วรัน <code class="bg-zinc-200 px-1">npm start</code> จากนั้นเข้าเว็บผ่าน <code class="bg-zinc-200 px-1">http://localhost:3000</code> (หรือโดเมนที่ deploy จริง) แทนการดับเบิลคลิกไฟล์ .html</p></div>';
      return;
    }

    var isSuper = myRole === 'super';
    var formSection = !isSuper ? '' :
      '<section class="bg-white border-[3px] border-black box-cut shadow-[7px_7px_0_0_#caff04] p-6">' +
      '<h2 class="font-x text-3xl border-b-[3px] border-black pb-2">+ เพิ่มแอดมินใหม่</h2>' +
      '<form id="add-admin-form" class="space-y-4 mt-5">' +
      '<label class="block font-bold text-sm">อีเมล<input name="email" type="email" required class="field mt-1 w-full border-2 border-black p-3" placeholder="admin2@example.com"></label>' +
      '<label class="block font-bold text-sm">รหัสผ่าน' + passwordFieldHtml() + '</label>' +
      '<label class="block font-bold text-sm">ระดับแอดมิน<select name="role" class="field mt-1 w-full border-2 border-black p-3 bg-white">' +
      '<option value="admin" selected>แอดมินรอง (จัดการข้อมูลได้ แต่แก้ไขบัญชีแอดมินไม่ได้)</option>' +
      '<option value="super">แอดมินหลัก (ทำได้ทุกอย่าง รวมถึงจัดการบัญชีแอดมิน)</option>' +
      '</select></label>' +
      '<button class="w-full bg-x-green text-black border-[3px] border-black font-x text-2xl py-3 box-cut hover:bg-black hover:text-x-green transition-colors">CREATE ADMIN</button></form>' +
      '<p id="admin-notice" class="hidden mt-4 p-3 font-bold text-sm"></p></section>';

    root.innerHTML =
      '<div class="grid lg:grid-cols-[380px_minmax(0,1fr)] gap-7 items-start">' +
      formSection +
      '<section class="min-w-0' + (isSuper ? '' : ' lg:col-span-2') + '">' +
      (isSuper ? '' : '<p class="bg-zinc-100 border-2 border-black p-4 font-bold text-sm mb-4">เฉพาะ "แอดมินหลัก" เท่านั้นที่เพิ่ม/ลบ/แก้ไขบัญชีแอดมินได้ คุณดูรายชื่อได้อย่างเดียว</p>') +
      '<h2 class="font-x text-3xl md:text-4xl mb-4">แอดมินทั้งหมด <span id="admin-count" class="c-x-red"></span></h2>' +
      '<div class="overflow-x-auto bg-white border-[3px] border-black box-cut shadow-[7px_7px_0_0_#09090b]">' +
      '<table class="w-full text-left"><thead class="bg-black text-white font-x text-lg"><tr><th class="p-4">EMAIL</th><th class="p-4">ระดับ</th>' +
      (isSuper ? '<th class="p-4">รหัสผ่าน</th><th class="p-4">ACTION</th>' : '') + '</tr></thead><tbody id="admin-rows"></tbody></table></div>' +
      '<p id="admin-list-error" class="hidden mt-3 bg-red-600 text-white p-3 font-bold text-sm"></p></section></div>';

    var form = document.getElementById('add-admin-form');
    var listError = document.getElementById('admin-list-error');
    var notice = document.getElementById('admin-notice');
    if (form) wirePasswordToggles(form);
    function showNotice(msg, ok) {
      if (!notice) { alert(msg); return; }
      notice.className = 'mt-4 p-3 font-bold text-sm ' + (ok ? 'bg-black text-x-green' : 'bg-red-600 text-white');
      notice.textContent = msg;
      notice.classList.remove('hidden');
    }

    function adminRowHtml(a) {
      var isSelf = a.email === myEmail;
      var canViewPw = !a.protected || isSelf; // only the protected account itself may reveal its own password
      var cells = '<td class="p-4 font-bold">' + esc(a.email) + (isSelf ? ' <span class="text-xs text-zinc-400">(คุณ)</span>' : '') + '</td>' +
        '<td class="p-4 whitespace-nowrap">' + roleBadge(a.role) + '</td>';
      if (isSuper) {
        cells += '<td class="p-4">' + (canViewPw ?
          '<span data-pw-cell="' + esc(a.email) + '" class="font-mono text-xs text-zinc-400">••••••••</span> ' +
          '<button data-view-pw="' + esc(a.email) + '" class="text-xs font-bold underline hover:text-x-red">ดูรหัส</button>' :
          '<span class="text-xs text-zinc-400">ซ่อนไว้</span>') + '</td>';
        var canManage = !a.protected || isSelf; // only the protected account itself may change its own role/password
        var actions = '';
        if (!isSelf && canManage) {
          actions += '<button data-toggle-role="' + esc(a.email) + '" data-role="' + a.role + '" class="bg-zinc-800 text-white border-2 border-black px-3 py-2 text-xs font-bold hover:bg-black mr-2">' +
            (a.role === 'super' ? 'ลดเป็นแอดมินรอง' : 'ตั้งเป็นแอดมินหลัก') + '</button>';
        }
        if (canManage) {
          actions += '<button data-reset-pw="' + esc(a.email) + '" class="bg-zinc-800 text-white border-2 border-black px-3 py-2 text-xs font-bold hover:bg-black mr-2">รีเซ็ตรหัสผ่าน</button>';
        }
        if (!isSelf && !a.protected) {
          actions += '<button data-delete-admin="' + esc(a.email) + '" class="bg-red-600 text-white border-2 border-black px-3 py-2 text-xs font-bold hover:bg-black">DELETE</button>';
        }
        if (!actions) actions = '<span class="text-xs text-zinc-400">แก้ไขได้เฉพาะเจ้าของบัญชีนี้</span>';
        cells += '<td class="p-4 whitespace-nowrap">' + actions + '</td>';
      }
      return '<tr class="border-b-2 border-zinc-200">' + cells + '</tr>';
    }

    function render() {
      listError.classList.add('hidden');
      apiFetch('/api/admins').then(function (rows) {
        document.getElementById('admin-count').textContent = '(' + rows.length + ')';
        document.getElementById('admin-rows').innerHTML = rows.length ? rows.map(adminRowHtml).join('')
          : '<tr><td colspan="' + (isSuper ? 4 : 2) + '" class="p-8 text-center text-zinc-500">ยังไม่มีข้อมูลแอดมิน</td></tr>';
      }).catch(function (err) {
        listError.textContent = 'โหลดรายชื่อแอดมินไม่สำเร็จ: ' + (err.message || 'unknown error');
        listError.classList.remove('hidden');
      });
    }

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = form.email.value.trim();
        var password = form.password.value;
        var role = form.role.value;
        apiFetch('/api/admins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: password, role: role }) })
          .then(function () {
            form.reset();
            showNotice('สร้างแอดมินใหม่แล้ว - ใช้อีเมล/รหัสผ่านนี้ล็อกอินได้ทันที', true);
            setTimeout(function () { notice.classList.add('hidden'); }, 3000);
            render();
          }).catch(function (err) { showNotice(err.message || 'สร้างไม่สำเร็จ', false); });
      });
    }

    document.getElementById('admin-rows').addEventListener('click', function (e) {
      var viewBtn = e.target.closest('[data-view-pw]');
      if (viewBtn) {
        var viewEmail = viewBtn.getAttribute('data-view-pw');
        var cell = document.querySelector('[data-pw-cell="' + viewEmail.replace(/"/g, '\\"') + '"]');
        if (viewBtn.getAttribute('data-shown') === '1') {
          if (cell) cell.textContent = '••••••••';
          viewBtn.textContent = 'ดูรหัส';
          viewBtn.setAttribute('data-shown', '0');
          return;
        }
        apiFetch('/api/admins/' + encodeURIComponent(viewEmail) + '/password').then(function (v) {
          if (cell) cell.textContent = v.password;
          viewBtn.textContent = 'ซ่อนรหัส';
          viewBtn.setAttribute('data-shown', '1');
        }).catch(function (err) { showNotice(err.message || 'ดูรหัสไม่สำเร็จ', false); });
        return;
      }
      var toggle = e.target.closest('[data-toggle-role]');
      if (toggle) {
        var email = toggle.getAttribute('data-toggle-role');
        var newRole = toggle.getAttribute('data-role') === 'super' ? 'admin' : 'super';
        if (!confirm((newRole === 'super' ? 'ตั้งให้ ' : 'ลดระดับ ') + email + (newRole === 'super' ? ' เป็นแอดมินหลัก?' : ' เป็นแอดมินรอง?'))) return;
        apiFetch('/api/admins/' + encodeURIComponent(email), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: newRole }) })
          .then(render).catch(function (err) { showNotice(err.message || 'แก้ไขไม่สำเร็จ', false); });
        return;
      }
      var resetBtn = e.target.closest('[data-reset-pw]');
      if (resetBtn) {
        var target = resetBtn.getAttribute('data-reset-pw');
        var pw = prompt('ตั้งรหัสผ่านใหม่ให้ ' + target + ' (อย่างน้อย 6 ตัวอักษร):');
        if (pw == null) return;
        if (pw.length < 6) { showNotice('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', false); return; }
        apiFetch('/api/admins/' + encodeURIComponent(target), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
          .then(function () { showNotice('เปลี่ยนรหัสผ่านของ ' + target + ' แล้ว', true); setTimeout(function () { notice.classList.add('hidden'); }, 3000); })
          .catch(function (err) { showNotice(err.message || 'แก้ไขไม่สำเร็จ', false); });
        return;
      }
      var delBtn = e.target.closest('[data-delete-admin]');
      if (delBtn) {
        var delEmail = delBtn.getAttribute('data-delete-admin');
        if (!confirm('ยืนยันลบแอดมิน ' + delEmail + '?')) return;
        apiFetch('/api/admins/' + encodeURIComponent(delEmail), { method: 'DELETE' })
          .then(render).catch(function (err) { showNotice(err.message || 'ลบไม่สำเร็จ', false); });
      }
    });
    render();
  }

  function drawCurrent() {
    if (current.kind === 'about-blocks') drawBlocks({ sectionCol: 'about_sections', cardCol: 'about_cards', cardNeedsImage: false, cardImageOptional: true });
    else if (current.kind === 'rules-blocks') drawBlocks({ sectionCol: 'rules_sections', cardCol: 'rules_cards', cardNeedsImage: true });
    else if (current.kind === 'admins-custom') drawAdmins();
    else drawSection();
  }

  tabs.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (!b) return;
    current = SECTIONS.filter(function (s) { return s.col === b.getAttribute('data-tab'); })[0];
    drawTabs();
    drawCurrent();
  });

  Promise.all([
    window.XPartsDB.col('categories').all().catch(function () { return []; }),
    window.XPartsAuth.me().catch(function () { return {}; })
  ]).then(function (r) {
    var c = r[0], me = r[1];
    if (c.length) typeOptions = c.map(function (x) { return String(x.name).toUpperCase(); });
    myEmail = me.email || '';
    myRole = me.role || 'admin';
    drawTabs();
    drawCurrent();
  });
})();
