// XParts Hub backend - Express + JSON file storage + login auth + image uploads.
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');
// The original seeded account: can't be deleted by anyone, and no one but
// this account itself can view its password (everything else about it -
// role changes, resetting ITS password from another super admin - is
// still allowed).
const PROTECTED_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Collections stored as JSON files next to server.js
const COLLECTIONS = {
  beys: 'beys.json',
  blades: 'blades.json',
  ratchets: 'ratchets.json',
  bits: 'bits.json',
  categories: 'categories.json',
  rules_sections: 'rules_sections.json',   // banner blocks on the rules page
  rules_cards: 'rules_cards.json',         // finish-type cards, each belongs to a section (sectionId) - image required
  about_sections: 'about_sections.json',   // banner blocks on the about page
  about_cards: 'about_cards.json'          // title+content cards, each belongs to a section (sectionId) - image optional
};
// Collections whose cards require sectionId + belong to a "sections" collection
const BLOCK_CARD_COLS = { rules_cards: 'rules_sections', about_cards: 'about_sections' };
const BLOCK_SECTION_COLS = { rules_sections: 'rules_cards', about_sections: 'about_cards' };

const SECRET = process.env.SESSION_SECRET || 'change-me-xparts-secret';
const SESSION_HOURS = 8;

app.use(cors());
app.use(express.json());
app.use(require('cookie-parser')());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- data helpers ---------- */
function fileOf(col) { return path.join(__dirname, COLLECTIONS[col]); }
function readCol(col) {
  try { const v = JSON.parse(fs.readFileSync(fileOf(col), 'utf8')); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function writeCol(col, rows) { fs.writeFileSync(fileOf(col), JSON.stringify(rows, null, 2)); }

/* ---------- password hashing (scrypt, built-in crypto) ---------- */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}
function verifyPassword(password, stored) {
  const parts = String(stored).split(':');
  if (parts.length !== 2) return false;
  const test = crypto.scryptSync(password, parts[0], 64).toString('hex');
  const a = Buffer.from(parts[1], 'hex'), b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
/* ---------- reversible copy (AES-256-GCM), ONLY so the primary admin can
   view an admin's current password from the panel. Login still checks the
   one-way hash above; this is a separate, additional copy. Accounts that
   existed before this feature have no encrypted copy and can't be viewed,
   only reset. ---------- */
const ENC_KEY = crypto.createHash('sha256').update(SECRET + '::xparts-pw-view').digest();
function encryptPassword(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') };
}
function decryptPassword(enc) {
  if (!enc || !enc.iv || !enc.tag || !enc.data) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(enc.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(enc.tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(enc.data, 'hex')), decipher.final()]).toString('utf8');
  } catch (e) { return null; }
}

/* ---------- users: seed default admin on first run ---------- */
function readUsers() {
  try { const v = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function writeUsers(rows) { fs.writeFileSync(USERS_FILE, JSON.stringify(rows, null, 2)); }
(function seedAdmin() {
  if (readUsers().length === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
    const pass = process.env.ADMIN_PASSWORD || 'admin1234';
    writeUsers([{ email: email, password: hashPassword(pass), passwordEnc: encryptPassword(pass), role: 'super' }]);
    console.log('Seeded default admin -> ' + email + ' / ' + pass + '  (change ASAP)');
  }
})();
// One-time migration for accounts created before roles existed: the very
// first account on record becomes the primary (super) admin, everyone else
// becomes a regular admin, unless a super admin is already present.
(function migrateRoles() {
  const users = readUsers();
  if (!users.length) return;
  const hasSuper = users.some(u => u.role === 'super');
  let changed = false;
  users.forEach((u, i) => {
    if (!u.role) { u.role = (!hasSuper && i === 0) ? 'super' : 'admin'; changed = true; }
  });
  if (changed) writeUsers(users);
})();

/* ---------- signed session token ---------- */
function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return data + '.' + sig;
}
function unsign(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}
function requireAuth(req, res, next) {
  const s = unsign(req.cookies && req.cookies.xp_session);
  if (!s) return res.status(401).json({ error: 'unauthorized' });
  req.user = s;
  next();
}
// Looks up the signed-in user's CURRENT role from users.json (never trusts the
// session cookie for this), so a role change takes effect immediately and a
// deleted account can't keep acting through an old session.
function currentRole(email) {
  const u = readUsers().find(x => x.email === email);
  return u ? (u.role || 'admin') : null;
}
function requireSuperAdmin(req, res, next) {
  if (currentRole(req.user.email) !== 'super') {
    return res.status(403).json({ error: 'ต้องเป็นแอดมินหลักเท่านั้น' });
  }
  next();
}

/* ---------- auth routes ---------- */
app.post('/api/login', (req, res) => {
  const email = String((req.body && req.body.email) || '').toLowerCase().trim();
  const password = String((req.body && req.body.password) || '');
  const user = readUsers().find(u => u.email === email);
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  }
  const token = sign({ email: user.email, exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
  res.cookie('xp_session', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_HOURS * 3600 * 1000 });
  res.json({ ok: true, email: user.email });
});
app.post('/api/logout', (req, res) => { res.clearCookie('xp_session'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => {
  const s = unsign(req.cookies && req.cookies.xp_session);
  if (!s) return res.status(401).json({ error: 'unauthorized' });
  res.json({ email: s.email, role: currentRole(s.email) || 'admin' });
});

/* ---------- admin account management ----------
   Any logged-in admin can SEE the admin list (read-only for a regular
   admin). Only the primary ("super") admin can create, edit the role of,
   reset the password of, or delete an admin account. A super admin can
   never delete their own account or demote/remove the last super admin,
   so the panel can't lock everyone out. */
app.get('/api/admins', requireAuth, (req, res) => {
  res.json(readUsers().map(u => ({ email: u.email, role: u.role || 'admin', protected: u.email === PROTECTED_EMAIL })));
});
app.post('/api/admins', requireAuth, requireSuperAdmin, (req, res) => {
  const email = String((req.body && req.body.email) || '').toLowerCase().trim();
  const password = String((req.body && req.body.password) || '');
  const role = req.body && req.body.role === 'super' ? 'super' : 'admin';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'อีเมลไม่ถูกต้อง' });
  if (password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  const users = readUsers();
  if (users.some(u => u.email === email)) return res.status(400).json({ error: 'อีเมลนี้เป็นแอดมินอยู่แล้ว' });
  users.push({ email: email, password: hashPassword(password), passwordEnc: encryptPassword(password), role: role });
  writeUsers(users);
  res.status(201).json({ email: email, role: role });
});
app.get('/api/admins/:email/password', requireAuth, requireSuperAdmin, (req, res) => {
  const target = String(req.params.email || '').toLowerCase().trim();
  if (target === PROTECTED_EMAIL && req.user.email !== PROTECTED_EMAIL) {
    return res.status(403).json({ error: 'ไม่สามารถดูรหัสผ่านของบัญชีนี้ได้' });
  }
  const user = readUsers().find(u => u.email === target);
  if (!user) return res.status(404).json({ error: 'ไม่พบแอดมินนี้' });
  const plain = decryptPassword(user.passwordEnc);
  if (plain == null) return res.status(404).json({ error: 'บัญชีนี้ถูกสร้างก่อนมีฟีเจอร์นี้ ดูรหัสเดิมไม่ได้ กรุณารีเซ็ตรหัสผ่านใหม่' });
  res.json({ email: user.email, password: plain });
});
app.put('/api/admins/:email', requireAuth, requireSuperAdmin, (req, res) => {
  const target = String(req.params.email || '').toLowerCase().trim();
  const users = readUsers();
  const user = users.find(u => u.email === target);
  if (!user) return res.status(404).json({ error: 'ไม่พบแอดมินนี้' });
  if (target === PROTECTED_EMAIL && req.user.email !== PROTECTED_EMAIL) {
    return res.status(403).json({ error: 'ไม่สามารถแก้ไขบัญชีนี้ได้' });
  }

  const body = req.body || {};
  if (body.role !== undefined) {
    if (body.role !== 'super' && body.role !== 'admin') return res.status(400).json({ error: 'ระดับแอดมินไม่ถูกต้อง' });
    if (user.email === req.user.email && body.role !== 'super') {
      return res.status(400).json({ error: 'ไม่สามารถลดระดับบัญชีของตัวเองได้' });
    }
    const otherSupers = users.filter(u => u.email !== target && u.role === 'super').length;
    if ((user.role || 'admin') === 'super' && body.role !== 'super' && otherSupers === 0) {
      return res.status(400).json({ error: 'ต้องมีแอดมินหลักเหลืออย่างน้อย 1 คน' });
    }
    user.role = body.role;
  }
  if (body.password !== undefined && body.password !== '') {
    if (String(body.password).length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
    user.password = hashPassword(String(body.password));
    user.passwordEnc = encryptPassword(String(body.password));
  }
  writeUsers(users);
  res.json({ email: user.email, role: user.role || 'admin' });
});
app.delete('/api/admins/:email', requireAuth, requireSuperAdmin, (req, res) => {
  const target = String(req.params.email || '').toLowerCase().trim();
  if (target === req.user.email) return res.status(400).json({ error: 'ไม่สามารถลบบัญชีของตัวเองได้' });
  if (target === PROTECTED_EMAIL) return res.status(400).json({ error: 'ไม่สามารถลบบัญชีนี้ได้' });
  const users = readUsers();
  const user = users.find(u => u.email === target);
  if (!user) return res.status(404).json({ error: 'ไม่พบแอดมินนี้' });
  const otherSupers = users.filter(u => u.email !== target && u.role === 'super').length;
  if ((user.role || 'admin') === 'super' && otherSupers === 0) {
    return res.status(400).json({ error: 'ต้องมีแอดมินหลักเหลืออย่างน้อย 1 คน' });
  }
  writeUsers(users.filter(u => u.email !== target));
  res.json({ ok: true });
});

/* ---------- image upload (admin only) ---------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
      cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('อนุญาตเฉพาะไฟล์รูปภาพเท่านั้น'));
  }
});
app.post('/api/upload', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'อัปโหลดไม่สำเร็จ' });
    if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์ที่อัปโหลด' });
    res.status(201).json({ url: '/uploads/' + req.file.filename });
  });
});

/* ---------- generic collection CRUD (reads public, writes protected) ---------- */
function validCol(req, res, next) {
  if (!COLLECTIONS[req.params.col]) return res.status(404).json({ error: 'unknown collection' });
  next();
}
app.get('/api/:col', validCol, (req, res) => res.json(readCol(req.params.col)));

app.post('/api/:col', validCol, requireAuth, (req, res) => {
  const b = req.body || {};
  const col = req.params.col;
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (col === 'rules_cards' && !String(b.image || '').trim()) {
    return res.status(400).json({ error: 'image is required for rules cards' });
  }
  if (BLOCK_CARD_COLS[col]) {
    if (col === 'about_cards' && !String(b.description || '').trim()) {
      return res.status(400).json({ error: 'description is required for about cards' });
    }
    if (b.sectionId == null || b.sectionId === '') return res.status(400).json({ error: 'sectionId is required' });
  }
  const rows = readCol(col);
  const rec = {
    id: Date.now(),
    name: name,
    type: b.type ? String(b.type).toUpperCase() : '',
    weight: b.weight === '' || b.weight == null ? null : Number(b.weight),
    points: b.points === '' || b.points == null ? null : Number(b.points),
    image: b.image || '',
    description: String(b.description || '').trim(),
    sectionId: b.sectionId === '' || b.sectionId == null ? null : Number(b.sectionId),
    createdAt: new Date().toISOString()
  };
  rows.push(rec);
  writeCol(col, rows);
  res.status(201).json(rec);
});

app.delete('/api/:col/:id', validCol, requireAuth, (req, res) => {
  const col = req.params.col;
  writeCol(col, readCol(col).filter(x => String(x.id) !== String(req.params.id)));
  // deleting a "section" (banner block) cascades to its cards
  if (BLOCK_SECTION_COLS[col]) {
    const cardCol = BLOCK_SECTION_COLS[col];
    writeCol(cardCol, readCol(cardCol).filter(x => String(x.sectionId) !== String(req.params.id)));
  }
  res.json({ ok: true });
});
app.delete('/api/:col', validCol, requireAuth, (req, res) => {
  writeCol(req.params.col, []);
  if (BLOCK_SECTION_COLS[req.params.col]) writeCol(BLOCK_SECTION_COLS[req.params.col], []);
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`XParts Hub running on port ${PORT}`);
});
