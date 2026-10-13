// One-time migration: uploads every image file currently referenced as
// "/uploads/<filename>" (the old local-disk storage) into MongoDB (GridFS),
// then rewrites that document's `image` field to the new "/api/images/<id>"
// URL. Run this AFTER migrate-to-mongo.js (so the documents already exist in
// MongoDB) and from wherever the old data/uploads folder actually lives
// (e.g. a Render Shell session on the running service):
//
//   MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/" node migrate-images-to-gridfs.js
//
// Safe to re-run: a document whose image already starts with "/api/images/"
// is left alone.
const fs = require('fs');
const path = require('path');
const { MongoClient, GridFSBucket } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'xparts_hub';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const COLLECTIONS = ['beys', 'blades', 'ratchets', 'bits', 'categories', 'rules_sections', 'rules_cards', 'about_sections', 'about_cards'];

async function uploadFile(bucket, filePath, filename) {
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename);
    fs.createReadStream(filePath)
      .on('error', reject)
      .pipe(uploadStream)
      .on('error', reject)
      .on('finish', () => resolve(uploadStream.id));
  });
}

async function main() {
  if (!MONGODB_URI) {
    console.error('Set MONGODB_URI first, e.g.:\n  MONGODB_URI="mongodb+srv://..." node migrate-images-to-gridfs.js');
    process.exit(1);
  }
  if (!fs.existsSync(UPLOAD_DIR)) {
    console.log('No upload folder found at ' + UPLOAD_DIR + ' - nothing to migrate.');
    return;
  }
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);
  const bucket = new GridFSBucket(db, { bucketName: 'uploads' });
  console.log('Connected to MongoDB database: ' + MONGODB_DB);

  let moved = 0, missing = 0, skipped = 0;
  for (const name of COLLECTIONS) {
    const coll = db.collection(name);
    const rows = await coll.find({}).toArray();
    for (const row of rows) {
      const img = row.image || '';
      if (!img || img.indexOf('/uploads/') !== 0) { skipped++; continue; }
      const filename = path.basename(img);
      const filePath = path.join(UPLOAD_DIR, filename);
      if (!fs.existsSync(filePath)) { console.log('  ! missing file for ' + name + ' id ' + row.id + ': ' + filePath); missing++; continue; }
      const id = await uploadFile(bucket, filePath, filename);
      await coll.updateOne({ _id: row._id }, { $set: { image: '/api/images/' + id.toString() } });
      moved++;
      console.log('  - ' + name + ' id ' + row.id + ': ' + img + ' -> /api/images/' + id.toString());
    }
  }

  await client.close();
  console.log('\nDone. Moved ' + moved + ' image(s) into GridFS, ' + missing + ' file(s) were missing on disk, ' + skipped + ' row(s) had no local image to move.');
}
main().catch((err) => { console.error(err); process.exit(1); });
