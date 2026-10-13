// XParts Hub backend - Express + MongoDB Atlas storage (data + images) + login auth.
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
// Bump this string whenever server.js changes - lets you confirm from the
// browser (GET /api/version) that the file actually running on Render is
// the one you just uploaded, instead of guessing after a restart.
const APP_VERSION = '2026-10-13.7-images-in-gridfs';

// ---------- MongoDB Atlas connection ----------
// Set MONGODB_URI in your environment (locally in a .env file loaded some
// other way, or as a Render environment variable) to your Atlas connection
// string, e.g.:
//   mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
// MONGODB_DB picks the database name inside that cluster (any name is fine,
// Atlas creates it automatically on first write).
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'xparts_hub';
if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI environment variable. Set it to your MongoDB Atlas connection string before starting the server.');
  process.exit(1);
}
let db; // set once main() connects, below
let bucket; // GridFSBucket for uploaded images, set once main() connects

// Legacy local uploads folder: no longer written to, kept only so images
// uploaded before this version (saved as /uploads/<file>) still load if the
// disk they're on is still around. New uploads go into MongoDB (GridFS).
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// The original seeded account: can't be deleted by anyone, and no one but
// this account itself can view its password (everything else about it -
// role changes, resetting ITS password from another super admin - is
// still allowed).
const PROTECTED_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();

// Mongo collection names mirror the old JSON filenames.
const COLLECTIONS = {
  beys: 'beys',
  blades: 'blades',
  ratchets: 'ratchets',
  bits: 'bits',
  categories: 'categories',
  rules_sections: 'rules_sections',   // banner blocks on the rules page
  rules_cards: 'rules_cards',         // finish-type cards, each belongs to a section (sectionId) - image required
  about_sections: 'about_sections',   // banner blocks on the about page
  about_cards: 'about_cards'          // title+content cards, each belongs to a section (sectionId) - image optional
};
// Collections whose cards require sectionId + belong to a "sections" collection
const BLOCK_CARD_COLS = { rules_cards: 'rules_sections', about_cards: 'about_sections' };
const BLOCK_SECTION_COLS = { rules_sections: 'rules_cards', about_sections: 'about_cards' };

// Seed data shipped in the repo (seed/*.json), loaded into Mongo only the
// very first time a collection is empty, so a brand-new Atlas database
// still starts with the sample content and later edits are never overwritten.
const SEED_DIR = path.join(__dirname, 'seed');

const SECRET = process.env.SESSION_SECRET || 'change-me-xparts-secret';
const SESSION_HOURS = 8;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(require('cookie-parser')());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- Mongo-backed collection helpers ----------
   Every document keeps the same shape as before (a numeric `id` field,
   created with Date.now()) so the frontend - which sorts/matches on x.id -
   needs no changes at all. Mongo's own _id is stripped from every read. */
function col(name) { return db.collection(COLLECTIONS[name] || name); }
async function readCol(name) {
  return col(name).find({}, { projection: { _id: 0 } }).toArray();
}
async function insertRow(name, rec) {
  await col(name).insertOne(rec);
  return rec;
}
async function findRow(name, id) {
  return col(name).findOne({ id: Number(id) }, { projection: { _id: 0 } });
}
async function updateRow(name, id, patch) {
  await col(name).updateOne({ id: Number(id) }, { $set: patch });
  return findRow(name, id);
}
async function deleteRow(name, id) {
  await col(name).deleteOne({ id: Number(id) });
}
async function clearCol(name) {
  await col(name).deleteMany({});
}
async function replaceCol(name, rows) {
  await col(name).deleteMany({});
  if (Array.isArray(rows) && rows.length) await col(name).insertMany(rows);
}

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

/* ---------- users (admin accounts), now a Mongo collection too ---------- */
async function readUsers() {
  return db.collection('users').find({}, { projection: { _id: 0 } }).toArray();
}
async function findUser(email) {
  return db.collection('users').findOne({ email }, { projection: { _id: 0 } });
}
async function insertUser(doc) { await db.collection('users').insertOne(doc); }
async function updateUser(email, patch) { await db.collection('users').updateOne({ email }, { $set: patch }); }
async function deleteUser(email) { await db.collection('users').deleteOne({ email }); }

async function seedAdmin() {
  const count = await db.collection('users').countDocuments();
  if (count === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
    const pass = process.env.ADMIN_PASSWORD || 'admin1234';
    await insertUser({ email, password: hashPassword(pass), passwordEnc: encryptPassword(pass), role: 'super' });
    console.log('Seeded default admin -> ' + email + ' / ' + pass + '  (change ASAP)');
  }
}
// One-time migration for accounts created before roles existed: the very
// first account on record becomes the primary (super) admin, everyone else
// becomes a regular admin, unless a super admin is already present.
async function migrateRoles() {
  const users = await readUsers();
  if (!users.length) return;
  const hasSuper = users.some(u => u.role === 'super');
  for (let i = 0; i < users.length; i++) {
    if (!users[i].role) await updateUser(users[i].email, { role: (!hasSuper && i === 0) ? 'super' : 'admin' });
  }
}
// Loads seed/*.json into Mongo for any collection that's still empty, so a
// freshly created Atlas database starts with the sample content.
async function seedCollections() {
  for (const name of Object.keys(COLLECTIONS)) {
    const count = await col(name).countDocuments();
    if (count > 0) continue;
    const seedFile = path.join(SEED_DIR, name + '.json');
    if (!fs.existsSync(seedFile)) continue;
    try {
      const rows = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
      if (Array.isArray(rows) && rows.length) await col(name).insertMany(rows);
    } catch (e) { console.error('seed failed for ' + name + ':', e.message); }
  }
}

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
// Looks up the signed-in user's CURRENT role from the database (never trusts
// the session cookie for this), so a role change takes effect immediately
// and a deleted account can't keep acting through an old session.
async function currentRole(email) {
  const u = await findUser(email);
  return u ? (u.role || 'admin') : null;
}
async function requireSuperAdmin(req, res, next) {
  if ((await currentRole(req.user.email)) !== 'super') {
    return res.status(403).json({ error: 'ต้องเป็นแอดมินหลักเท่านั้น' });
  }
  next();
}
// Wraps an async route handler so a thrown/rejected error becomes a clean
// 500 response instead of crashing the process.
function ah(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'เกิดข้อผิดพลาดบนเซิร์ฟเวอร์' });
  });
}

/* ---------- auth routes ---------- */
app.post('/api/login', ah(async (req, res) => {
  const email = String((req.body && req.body.email) || '').toLowerCase().trim();
  const password = String((req.body && req.body.password) || '');
  const user = await findUser(email);
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  }
  const token = sign({ email: user.email, exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
  res.cookie('xp_session', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_HOURS * 3600 * 1000 });
  res.json({ ok: true, email: user.email });
}));
app.post('/api/logout', (req, res) => { res.clearCookie('xp_session'); res.json({ ok: true }); });
app.get('/api/me', ah(async (req, res) => {
  const s = unsign(req.cookies && req.cookies.xp_session);
  if (!s) return res.status(401).json({ error: 'unauthorized' });
  res.json({ email: s.email, role: (await currentRole(s.email)) || 'admin' });
}));

/* ---------- admin account management ----------
   Any logged-in admin can SEE the admin list (read-only for a regular
   admin). Only the primary ("super") admin can create, edit the role of,
   reset the password of, or delete an admin account. A super admin can
   never delete their own account or demote/remove the last super admin,
   so the panel can't lock everyone out. */
app.get('/api/admins', requireAuth, ah(async (req, res) => {
  const users = await readUsers();
  res.json(users.map(u => ({ email: u.email, role: u.role || 'admin', protected: u.email === PROTECTED_EMAIL })));
}));
app.post('/api/admins', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const email = String((req.body && req.body.email) || '').toLowerCase().trim();
  const password = String((req.body && req.body.password) || '');
  const role = req.body && req.body.role === 'super' ? 'super' : 'admin';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'อีเมลไม่ถูกต้อง' });
  if (password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  if (await findUser(email)) return res.status(400).json({ error: 'อีเมลนี้เป็นแอดมินอยู่แล้ว' });
  await insertUser({ email, password: hashPassword(password), passwordEnc: encryptPassword(password), role });
  res.status(201).json({ email, role });
}));
app.get('/api/admins/:email/password', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const target = String(req.params.email || '').toLowerCase().trim();
  if (target === PROTECTED_EMAIL && req.user.email !== PROTECTED_EMAIL) {
    return res.status(403).json({ error: 'ไม่สามารถดูรหัสผ่านของบัญชีนี้ได้' });
  }
  const user = await findUser(target);
  if (!user) return res.status(404).json({ error: 'ไม่พบแอดมินนี้' });
  const plain = decryptPassword(user.passwordEnc);
  if (plain == null) return res.status(404).json({ error: 'บัญชีนี้ถูกสร้างก่อนมีฟีเจอร์นี้ ดูรหัสเดิมไม่ได้ กรุณารีเซ็ตรหัสผ่านใหม่' });
  res.json({ email: user.email, password: plain });
}));
app.put('/api/admins/:email', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const target = String(req.params.email || '').toLowerCase().trim();
  const user = await findUser(target);
  if (!user) return res.status(404).json({ error: 'ไม่พบแอดมินนี้' });
  if (target === PROTECTED_EMAIL && req.user.email !== PROTECTED_EMAIL) {
    return res.status(403).json({ error: 'ไม่สามารถแก้ไขบัญชีนี้ได้' });
  }

  const body = req.body || {};
  const patch = {};
  if (body.role !== undefined) {
    if (body.role !== 'super' && body.role !== 'admin') return res.status(400).json({ error: 'ระดับแอดมินไม่ถูกต้อง' });
    if (user.email === req.user.email && body.role !== 'super') {
      return res.status(400).json({ error: 'ไม่สามารถลดระดับบัญชีของตัวเองได้' });
    }
    const users = await readUsers();
    const otherSupers = users.filter(u => u.email !== target && u.role === 'super').length;
    if ((user.role || 'admin') === 'super' && body.role !== 'super' && otherSupers === 0) {
      return res.status(400).json({ error: 'ต้องมีแอดมินหลักเหลืออย่างน้อย 1 คน' });
    }
    patch.role = body.role;
  }
  if (body.password !== undefined && body.password !== '') {
    if (String(body.password).length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
    patch.password = hashPassword(String(body.password));
    patch.passwordEnc = encryptPassword(String(body.password));
  }
  if (Object.keys(patch).length) await updateUser(target, patch);
  res.json({ email: user.email, role: patch.role || user.role || 'admin' });
}));
app.delete('/api/admins/:email', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const target = String(req.params.email || '').toLowerCase().trim();
  if (target === req.user.email) return res.status(400).json({ error: 'ไม่สามารถลบบัญชีของตัวเองได้' });
  if (target === PROTECTED_EMAIL) return res.status(400).json({ error: 'ไม่สามารถลบบัญชีนี้ได้' });
  const user = await findUser(target);
  if (!user) return res.status(404).json({ error: 'ไม่พบแอดมินนี้' });
  const users = await readUsers();
  const otherSupers = users.filter(u => u.email !== target && u.role === 'super').length;
  if ((user.role || 'admin') === 'super' && otherSupers === 0) {
    return res.status(400).json({ error: 'ต้องมีแอดมินหลักเหลืออย่างน้อย 1 คน' });
  }
  await deleteUser(target);
  res.json({ ok: true });
}));

/* ---------- image upload (admin only) ----------
   Uploaded files are held in memory just long enough to stream them into
   MongoDB (GridFS) - nothing is written to local disk anymore, so images
   survive Render redeploys/restarts exactly like the rest of the data does. */
const upload = multer({
  storage: multer.memoryStorage(),
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
    const uploadStream = bucket.openUploadStream(req.file.originalname || 'image', { contentType: req.file.mimetype });
    uploadStream.on('error', (e) => res.status(500).json({ error: e.message || 'อัปโหลดไม่สำเร็จ' }));
    uploadStream.on('finish', () => res.status(201).json({ url: '/api/images/' + uploadStream.id.toString() }));
    uploadStream.end(req.file.buffer);
  });
});
// Serves an image stored in GridFS. Public (no login) because the catalog
// pages that show these images are public too.
app.get('/api/images/:id', (req, res) => {
  let oid;
  try { oid = new ObjectId(req.params.id); } catch (e) { return res.status(404).end(); }
  bucket.find({ _id: oid }).toArray().then((files) => {
    if (!files.length) return res.status(404).end();
    res.setHeader('Content-Type', files[0].contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    bucket.openDownloadStream(oid).on('error', () => res.status(404).end()).pipe(res);
  }).catch(() => res.status(404).end());
});
// Deletes a GridFS image by its stored URL ("/api/images/<id>"). Silently
// does nothing for a legacy "/uploads/..." URL or anything else unrecognized.
async function deleteGridfsImage(url) {
  if (!url || url.indexOf('/api/images/') !== 0) return;
  try { await bucket.delete(new ObjectId(url.slice('/api/images/'.length))); } catch (e) { /* already gone, or invalid id - fine */ }
}

/* ---------- version, backup & restore (must come before /api/:col) ---------- */
app.get('/api/version', (req, res) => res.json({ version: APP_VERSION, storage: 'mongodb' }));
// Download every collection as one JSON file (admin only). Images are NOT included -
// only their URLs - and admin accounts/passwords are never exported.
app.get('/api/backup', requireAuth, ah(async (req, res) => {
  const out = { app: 'xparts-hub', exportedAt: new Date().toISOString(), collections: {} };
  for (const c of Object.keys(COLLECTIONS)) out.collections[c] = await readCol(c);
  res.setHeader('Content-Disposition', 'attachment; filename="xparts-backup-' + new Date().toISOString().slice(0, 10) + '.json"');
  res.json(out);
}));
// Restore from a backup file produced above. Replaces the collections present in the file.
app.post('/api/restore', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const cols = req.body && req.body.collections;
  if (!cols || typeof cols !== 'object') return res.status(400).json({ error: 'ไฟล์สำรองไม่ถูกต้อง' });
  const restored = [];
  for (const c of Object.keys(cols)) {
    if (COLLECTIONS[c] && Array.isArray(cols[c])) { await replaceCol(c, cols[c]); restored.push(c); }
  }
  if (!restored.length) return res.status(400).json({ error: 'ไม่พบข้อมูลที่กู้คืนได้ในไฟล์นี้' });
  res.json({ ok: true, restored });
}));

/* ---------- generic collection CRUD (reads public, writes protected) ---------- */
function validCol(req, res, next) {
  if (!COLLECTIONS[req.params.col]) return res.status(404).json({ error: 'unknown collection' });
  next();
}
app.get('/api/:col', validCol, ah(async (req, res) => res.json(await readCol(req.params.col))));

app.post('/api/:col', validCol, requireAuth, ah(async (req, res) => {
  const b = req.body || {};
  const colName = req.params.col;
  // Every field is optional - including name, image, description, points,
  // color, product code, etc. - so an entry can be saved and shown on the
  // site even with incomplete data. The one exception is "sectionId" for
  // block cards (rules/about), which isn't a field the admin fills in by
  // hand - the UI sets it automatically to whichever block's "add card"
  // form was submitted - so it's always present and checking it here only
  // guards against a malformed request, not incomplete data entry.
  const name = String(b.name || '').trim();
  if (BLOCK_CARD_COLS[colName]) {
    if (b.sectionId == null || b.sectionId === '') return res.status(400).json({ error: 'sectionId is required' });
  }
  const rec = {
    id: Date.now(),
    name: name,
    type: b.type ? String(b.type).toUpperCase() : '',
    weight: b.weight === '' || b.weight == null ? null : Number(b.weight),
    points: b.points === '' || b.points == null ? null : Number(b.points),
    image: b.image || '',
    description: String(b.description || '').trim(),
    sectionId: b.sectionId === '' || b.sectionId == null ? null : Number(b.sectionId),
    productCode: String(b.productCode || '').trim(),
    color: String(b.color || '').trim(),
    metalCoat: !!b.metalCoat,
    partsCategory: String(b.partsCategory || '').trim(),
    spin: String(b.spin || '').trim(),
    createdAt: new Date().toISOString()
  };
  await insertRow(colName, rec);
  res.status(201).json(rec);
}));

// Edit an existing entry (partial update: only the fields present in the
// request body are changed, so e.g. the image is kept unless a new one - or
// an explicit empty string to remove it - is sent).
app.put('/api/:col/:id', validCol, requireAuth, ah(async (req, res) => {
  const colName = req.params.col;
  const b = req.body || {};
  const existing = await findRow(colName, req.params.id);
  if (!existing) return res.status(404).json({ error: 'ไม่พบข้อมูลนี้' });
  const str = k => String(b[k] == null ? '' : b[k]).trim();
  const num = k => (b[k] === '' || b[k] == null || isNaN(Number(b[k]))) ? null : Number(b[k]);
  const patch = {};
  if ('name' in b) patch.name = str('name');
  if ('type' in b) patch.type = b.type ? String(b.type).toUpperCase() : '';
  if ('weight' in b) patch.weight = num('weight');
  if ('points' in b) patch.points = num('points');
  if ('description' in b) patch.description = str('description');
  if ('productCode' in b) patch.productCode = str('productCode');
  if ('color' in b) patch.color = str('color');
  if ('partsCategory' in b) patch.partsCategory = str('partsCategory');
  if ('spin' in b) patch.spin = str('spin');
  if ('metalCoat' in b) patch.metalCoat = !!b.metalCoat;
  if ('image' in b) {
    const newImg = b.image || '';
    const oldImg = existing.image || '';
    // tidy up the replaced upload so old files/images don't pile up
    if (oldImg && oldImg !== newImg) {
      if (oldImg.indexOf('/uploads/') === 0) { try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(oldImg))); } catch (e) {} }
      else await deleteGridfsImage(oldImg);
    }
    patch.image = newImg;
  }
  patch.updatedAt = new Date().toISOString();
  const updated = await updateRow(colName, req.params.id, patch);
  res.json(updated);
}));

app.delete('/api/:col/:id', validCol, requireAuth, ah(async (req, res) => {
  const colName = req.params.col;
  const existing = await findRow(colName, req.params.id);
  await deleteRow(colName, req.params.id);
  if (existing) await deleteGridfsImage(existing.image);
  // deleting a "section" (banner block) cascades to its cards
  if (BLOCK_SECTION_COLS[colName]) {
    const cardCol = BLOCK_SECTION_COLS[colName];
    const cards = await col(cardCol).find({ sectionId: Number(req.params.id) }, { projection: { _id: 0 } }).toArray();
    for (const c of cards) await deleteGridfsImage(c.image);
    await col(cardCol).deleteMany({ sectionId: Number(req.params.id) });
  }
  res.json({ ok: true });
}));
app.delete('/api/:col', validCol, requireAuth, ah(async (req, res) => {
  const rows = await readCol(req.params.col);
  for (const r of rows) await deleteGridfsImage(r.image);
  await clearCol(req.params.col);
  if (BLOCK_SECTION_COLS[req.params.col]) {
    const cardRows = await readCol(BLOCK_SECTION_COLS[req.params.col]);
    for (const r of cardRows) await deleteGridfsImage(r.image);
    await clearCol(BLOCK_SECTION_COLS[req.params.col]);
  }
  res.json({ ok: true });
}));

/* ---------- connect to Atlas, then start the server ---------- */
async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(MONGODB_DB);
  bucket = new GridFSBucket(db, { bucketName: 'uploads' });

  // Unique indexes: `id` per collection, `email` for users. Safe to run on
  // every boot - createIndex is a no-op if the index already exists.
  for (const name of Object.keys(COLLECTIONS)) {
    await col(name).createIndex({ id: 1 }, { unique: true });
  }
  await db.collection('users').createIndex({ email: 1 }, { unique: true });

  await seedCollections();
  await seedAdmin();
  await migrateRoles();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`XParts Hub running on port ${PORT} - version ${APP_VERSION} - MongoDB: ${MONGODB_DB}`);
  });
}
main().catch((err) => {
  console.error('Failed to start: could not connect to MongoDB.', err);
  process.exit(1);
});
