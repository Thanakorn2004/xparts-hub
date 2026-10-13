// One-time migration: copies the site's existing JSON data (the beys/blades/
// ratchets/bits/categories/rules/about files and users.json, normally living
// in DATA_DIR on Render's disk) into a MongoDB Atlas database.
//
// Run this ONCE, from wherever your current data/ folder actually lives
// (e.g. a Render Shell session on the running service, where DATA_DIR is
// already mounted), with MONGODB_URI pointing at your new Atlas cluster:
//
//   MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/" node migrate-to-mongo.js
//
// It's safe to re-run: any collection that already has documents in Mongo is
// skipped (so it won't duplicate data), unless you pass --force to wipe and
// reimport everything.
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'xparts_hub';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const FORCE = process.argv.includes('--force');

const COLLECTIONS = ['beys', 'blades', 'ratchets', 'bits', 'categories', 'rules_sections', 'rules_cards', 'about_sections', 'about_cards'];

function readJson(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}

async function main() {
  if (!MONGODB_URI) {
    console.error('Set MONGODB_URI first, e.g.:\n  MONGODB_URI="mongodb+srv://..." node migrate-to-mongo.js');
    process.exit(1);
  }
  console.log('Reading existing data from: ' + DATA_DIR);
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);
  console.log('Connected to MongoDB database: ' + MONGODB_DB);

  for (const name of COLLECTIONS) {
    const file = path.join(DATA_DIR, name + '.json');
    if (!fs.existsSync(file)) { console.log('  - ' + name + ': no data/' + name + '.json found, skipping'); continue; }
    const rows = readJson(file);
    const coll = db.collection(name);
    const existing = await coll.countDocuments();
    if (existing > 0 && !FORCE) { console.log('  - ' + name + ': already has ' + existing + ' document(s) in Mongo, skipping (use --force to overwrite)'); continue; }
    if (FORCE) await coll.deleteMany({});
    if (rows.length) { await coll.insertMany(rows); await coll.createIndex({ id: 1 }, { unique: true }); }
    console.log('  - ' + name + ': imported ' + rows.length + ' row(s)');
  }

  const usersFile = path.join(DATA_DIR, 'users.json');
  if (fs.existsSync(usersFile)) {
    const users = readJson(usersFile);
    const coll = db.collection('users');
    const existing = await coll.countDocuments();
    if (existing > 0 && !FORCE) {
      console.log('  - users: already has ' + existing + ' account(s) in Mongo, skipping (use --force to overwrite)');
    } else {
      if (FORCE) await coll.deleteMany({});
      if (users.length) { await coll.insertMany(users); await coll.createIndex({ email: 1 }, { unique: true }); }
      console.log('  - users: imported ' + users.length + ' admin account(s)');
    }
  } else {
    console.log('  - users: no data/users.json found, skipping (server.js will seed a default admin on first boot)');
  }

  await client.close();
  console.log('\nDone. You can now switch the server to MongoDB (MONGODB_URI set, new server.js deployed).');
}
main().catch((err) => { console.error(err); process.exit(1); });
