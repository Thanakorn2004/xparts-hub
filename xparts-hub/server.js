// XParts Hub backend - Express + JSON file storage + login auth.
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');

// Collections stored as JSON files next to server.js
const COLLECTIONS = {
  beys: 'beys.json',
  blades: 'blades.json',
  ratchets: 'ratchets.json',
  bits: 'bits.json',
  categories: 'categories.json'
};

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
(function seedAdmin() {
  if (readUsers().length === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
    const pass = process.env.ADMIN_PASSWORD || 'admin1234';
    fs.writeFileSync(USERS_FILE, JSON.stringify([{ email: email, password: hashPassword(pass) }], null, 2));
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

/* ---------- generic collection CRUD (reads public, writes protected) ---------- */
function validCol(req, res, next) {
  if (!COLLECTIONS[req.params.col]) return res.status(404).json({ error: 'unknown collection' });
  next();
}
app.get('/api/:col', validCol, (req, res) => res.json(readCol(req.params.col)));

app.post('/api/:col', validCol, requireAuth, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const rows = readCol(req.params.col);
  const rec = {
    id: Date.now(),
    name: name,
    type: b.type ? String(b.type).toUpperCase() : '',
    weight: b.weight === '' || b.weight == null ? null : Number(b.weight),
    image: b.image || '',
    description: String(b.description || '').trim(),
    createdAt: new Date().toISOString()
  };
  rows.push(rec);
  writeCol(req.params.col, rows);
  res.status(201).json(rec);
});

app.delete('/api/:col/:id', validCol, requireAuth, (req, res) => {
  writeCol(req.params.col, readCol(req.params.col).filter(x => String(x.id) !== String(req.params.id)));
  res.json({ ok: true });
});
app.delete('/api/:col', validCol, requireAuth, (req, res) => { writeCol(req.params.col, []); res.json({ ok: true }); });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`XParts Hub running on port ${PORT}`);
});
