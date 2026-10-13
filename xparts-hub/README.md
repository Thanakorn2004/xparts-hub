# XPARTS HUB - Beyblade X Database

เว็บไซต์ฐานข้อมูล Beyblade X พร้อมระบบหลังบ้าน (Node.js + Express) เก็บข้อมูลทุกอย่างบน **MongoDB Atlas** (cloud database) ทั้งข้อมูล (เบย์/ชิ้นส่วน/หมวดหมู่/บัญชีแอดมิน) และ**รูปที่อัปโหลด** (เก็บแบบไบนารีใน MongoDB ด้วย GridFS) จึงไม่มีอะไรหายเวลา Render redeploy/restart อีกต่อไป และไม่ต้องพึ่ง persistent disk เลย

## โครงสร้างไฟล์

```
xparts-hub/
├── server.js                    <- backend + ระบบล็อกอิน (อ่าน/เขียนข้อมูล+รูปผ่าน MongoDB)
├── migrate-to-mongo.js          <- สคริปต์ย้ายข้อมูลเดิม (JSON บนดิสก์) เข้า MongoDB Atlas ครั้งเดียว
├── migrate-images-to-gridfs.js  <- สคริปต์ย้ายรูปเดิม (ไฟล์บนดิสก์) เข้า MongoDB (GridFS) ครั้งเดียว
├── package.json
├── seed/                        <- ข้อมูลตั้งต้น (beys/blades/ratchets/bits/categories/rules/about) โหลดเข้า MongoDB อัตโนมัติเฉพาะตอนฐานข้อมูลว่าง
└── data/                        <- ใช้ชั่วคราวเฉพาะตอนรันสคริปต์ย้ายข้อมูล/รูปเท่านั้น ไม่ได้ใช้งานระหว่างรันเว็บปกติแล้ว
└── public/                      <- หน้าเว็บทั้งหมด (แยกไฟล์ต่อหน้า)
    ├── index.html     <- 1. หน้าแรก
    ├── about.html     <- 2. แนะนำ Beyblade X + เทคนิคปรับแต่ง
    ├── beyblades.html <- 3. ข้อมูลเบย์เบลด (กรองตามสาย)
    ├── blade.html     <- 4. ชิ้นส่วน Blade
    ├── ratchet.html   <- 5. ชิ้นส่วน Ratchet
    ├── bit.html       <- 6. ชิ้นส่วน Bit
    ├── rules.html     <- 7. กติกาการแข่งขัน + สนาม
    ├── search.html    <- 8. ค้นหาข้อมูลทุกประเภท
    ├── login.html     <- 9. ล็อกอินแอดมิน
    ├── admin.html     <- ระบบหลังบ้าน (จัดการเบย์/ชิ้นส่วน/หมวดหมู่)
    ├── style.css      <- สไตล์กลางของทุกหน้า
    ├── store.js       <- ตัวเชื่อมข้อมูล API/localStorage
    ├── auth.js        <- ตัวช่วยล็อกอินฝั่งเว็บ
    ├── catalog.js     <- ตัวแสดงการ์ดข้อมูล
    └── admin.js       <- ตรรกะหน้าแอดมิน
```

## ตั้งค่า MongoDB Atlas (ทำครั้งเดียว)

1. สมัคร/เข้า https://www.mongodb.com/cloud/atlas แล้วสร้าง **Cluster ฟรี** (M0)
2. **Database Access** → Add New Database User → ตั้ง username/password (จดไว้ ใช้ต่อ)
3. **Network Access** → Add IP Address → เลือก **Allow Access from Anywhere** (`0.0.0.0/0`) — จำเป็นเพราะ Render ไม่มี IP คงที่
4. **Database** → Connect → Drivers → ก๊อป connection string จะหน้าตาประมาณ:
   ```
   mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
   ```
   แทน `<username>`/`<password>` ด้วยค่าจากข้อ 2 (ถ้ารหัสผ่านมีอักขระพิเศษต้อง URL-encode)
5. นี่คือค่า environment variable `MONGODB_URI` ที่ server.js ต้องใช้

## วิธีรันบนเครื่อง

1. ติดตั้ง Node.js 18 ขึ้นไป (https://nodejs.org)
2. เปิด terminal ในโฟลเดอร์ xparts-hub แล้วรัน:

```
npm install
set MONGODB_URI=mongodb+srv://...          (Windows: set, Mac/Linux: export)
npm start
```

3. เปิด http://localhost:3000

**ย้ายข้อมูล+รูปเดิมเข้า MongoDB (ถ้ามีข้อมูลอยู่แล้วจากเวอร์ชันเก่าที่เก็บเป็นไฟล์ JSON/รูปบนดิสก์):**
ต้องรันจากเครื่อง/ที่ที่มีโฟลเดอร์ `data/` ของเดิมอยู่จริง (เช่น Render Shell ของเว็บเซอร์วิสเดิม ก่อนเปลี่ยนไปใช้ server.js เวอร์ชันใหม่) ตามลำดับนี้:
```
MONGODB_URI="mongodb+srv://..." node migrate-to-mongo.js
MONGODB_URI="mongodb+srv://..." node migrate-images-to-gridfs.js
```
สคริปต์แรกอ่าน `data/*.json` และ `data/users.json` ก๊อปเข้า MongoDB (ข้อมูลเบย์/ชิ้นส่วน/บัญชีแอดมิน) ส่วนสคริปต์ที่สองอ่านไฟล์รูปจาก `data/uploads/` อัปโหลดเข้า MongoDB (GridFS) แล้วแก้ลิงก์รูปในทุก collection ให้ชี้ไปที่รูปใหม่อัตโนมัติ — รันได้ปลอดภัยถ้ารันซ้ำ (ของที่ย้ายไปแล้วจะไม่ถูกย้ายซ้ำ)

## บัญชีแอดมินเริ่มต้น

```
Email:    admin@example.com
Password: admin1234
```

เปลี่ยนได้ด้วย environment variables: `ADMIN_EMAIL`, `ADMIN_PASSWORD` (มีผลเฉพาะตอนที่ยังไม่มีแอดมินในฐานข้อมูลเลย — ลบบัญชีทั้งหมดใน MongoDB collection `users` เพื่อ reset) และตั้ง `SESSION_SECRET` เป็นค่าลับของคุณเองเสมอเมื่อขึ้น production

## วิธีเอาขึ้นอินเทอร์เน็ต (Deploy บน Render)

1. อัปโหลดโฟลเดอร์นี้ขึ้น GitHub repository
2. สร้าง Web Service ใหม่ ชี้ไปที่ repo — Build command: `npm install` / Start command: `npm start`
3. ตั้ง environment variables:
   - `MONGODB_URI` = connection string จาก MongoDB Atlas (ขั้นตอนด้านบน) — **จำเป็น** ถ้าไม่ตั้งเซิร์ฟเวอร์จะไม่ยอมสตาร์ท
   - `SESSION_SECRET` = ค่าลับของคุณเอง
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` = บัญชีแอดมินเริ่มต้น (ถ้ายังไม่มีข้อมูลเดิม)
4. เปิด URL ที่ได้ ใช้งานได้ทันที

**ข้อดีของการย้ายมา MongoDB Atlas:** ข้อมูลทั้งหมด — เบย์/ชิ้นส่วน/หมวดหมู่/บัญชีแอดมิน **และรูปที่อัปโหลด** — จะไม่หายอีกต่อไปเวลา Render redeploy/restart เพราะอยู่บนคลาวด์แยกจากเซิร์ฟเวอร์ทั้งหมดแล้ว ไม่ต้องผูก Render persistent disk อีกต่อไป (ลบ Disk เดิมออกได้ถ้าเคยเพิ่มไว้ ประหยัดค่าใช้จ่าย)

## รูปภาพที่อัปโหลด (เก็บใน MongoDB ด้วย GridFS)

ตั้งแต่เวอร์ชันนี้ รูปที่แอดมินอัปโหลดใหม่จะถูกเก็บเป็นไบนารีในฐานข้อมูล MongoDB เดียวกัน (ผ่าน GridFS) ไม่ใช่ไฟล์บนดิสก์แล้ว — เรียกดูผ่าน `/api/images/<id>` อัตโนมัติ ไม่ต้องตั้งค่าอะไรเพิ่ม (ใช้ `MONGODB_URI` ตัวเดียวกับข้อมูล)
- ข้อจำกัด: แพ็กเกจฟรี (M0) ของ Atlas มีพื้นที่รวมประมาณ 512MB (ทั้งข้อมูล+รูป) ถ้ารูปเยอะ/ไฟล์ใหญ่มากอาจต้องอัปเกรดแพ็กเกจ หรือลดขนาดรูปก่อนอัปโหลด (จำกัดไว้ที่ 5MB ต่อไฟล์)
- สำรอง/กู้คืนข้อมูล (ไม่รวมรูป): หน้า Admin มีลิงก์ "ดาวน์โหลดข้อมูลสำรอง" และ "กู้คืนจากไฟล์สำรอง" (กู้คืนได้เฉพาะแอดมินหลัก; ไฟล์สำรองไม่รวมรูปและรหัสผ่าน — แต่ตอนนี้ทุกอย่างปลอดภัยอยู่แล้วบน MongoDB Atlas)

## API

| Method | Path | หน้าที่ | ต้องล็อกอิน |
| ------ | ---- | ------- | ----------- |
| GET | /api/{beys,blades,ratchets,bits,categories} | ดึงข้อมูล | ไม่ |
| GET | /api/images/:id | ดึงไฟล์รูปจาก GridFS | ไม่ |
| POST | /api/upload | อัปโหลดรูป (เก็บเข้า GridFS คืนลิงก์ /api/images/:id) | ใช่ |
| GET | /api/backup | ดาวน์โหลดข้อมูลสำรองทั้งหมด | ใช่ |
| POST | /api/restore | กู้คืนจากไฟล์สำรอง (แอดมินหลัก) | ใช่ |
| POST | /api/{collection} | เพิ่มข้อมูล | ใช่ |
| PUT | /api/{collection}/:id | แก้ไขข้อมูล 1 รายการ (ส่งเฉพาะฟิลด์ที่ต้องการแก้) | ใช่ |
| DELETE | /api/{collection}/:id | ลบ 1 รายการ | ใช่ |
| DELETE | /api/{collection} | ลบทั้งหมด | ใช่ |
| POST | /api/login, /api/logout | เข้า/ออกระบบ | - |
| GET | /api/me | เช็คสถานะล็อกอิน | - |
