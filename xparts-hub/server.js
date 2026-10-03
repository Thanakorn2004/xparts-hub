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
    writeUsers([{ email: email, password: hashPassword(pass) }]);
    console.log('Seeded default admin -> ' + email + ' / ' + pass + '  (change ASAP)');
  }
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
  res.json({ email: s.email });
});

/* ---------- admin account management (must already be logged in) ---------- */
app.get('/api/admins', requireAuth, (req, res) => {
  res.json(readUsers().map(u => ({ email: u.email })));
});
app.post('/api/admins', requireAuth, (req, res) => {
  const email = String((req.body && req.body.email) || '').toLowerCase().trim();
  const password = String((req.body && req.body.password) || '');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'อีเมลไม่ถูกต้อง' });
  if (password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  const users = readUsers();
  if (users.some(u => u.email === email)) return res.status(400).json({ error: 'อีเมลนี้เป็นแอดมินอยู่แล้ว' });
  users.push({ email: email, password: hashPassword(password) });
  writeUsers(users);
  res.status(201).json({ email: email });
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
