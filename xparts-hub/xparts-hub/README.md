# XPARTS HUB - Beyblade X Database

เว็บไซต์ฐานข้อมูล Beyblade X พร้อมระบบหลังบ้าน (Node.js + Express) เก็บข้อมูลเป็นไฟล์ JSON ไม่ต้องติดตั้ง database

## โครงสร้างไฟล์

```
xparts-hub/
├── server.js          <- backend + ระบบล็อกอิน
├── package.json
├── users.json         <- บัญชีผู้ใช้ (สร้าง admin ให้อัตโนมัติครั้งแรกที่รัน)
├── beys.json          <- ข้อมูลเบย์เบลด (มีข้อมูลตัวอย่างให้แล้ว)
├── blades.json        <- ข้อมูล Blade
├── ratchets.json      <- ข้อมูล Ratchet
├── bits.json          <- ข้อมูล Bit
├── categories.json    <- หมวดหมู่ (ATTACK/DEFENSE/STAMINA/BALANCE)
└── public/            <- หน้าเว็บทั้งหมด (แยกไฟล์ต่อหน้า)
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

## วิธีรันบนเครื่อง

1. ติดตั้ง Node.js 18 ขึ้นไป (https://nodejs.org)
2. เปิด terminal ในโฟลเดอร์ xparts-hub แล้วรัน:

```
npm install
npm start
```

3. เปิด http://localhost:3000

## บัญชีแอดมินเริ่มต้น

```
Email:    admin@example.com
Password: admin1234
```

เปลี่ยนได้ด้วย environment variables: `ADMIN_EMAIL`, `ADMIN_PASSWORD` (มีผลครั้งแรกที่รันเท่านั้น — ลบ users.json เพื่อ reset) และตั้ง `SESSION_SECRET` เป็นค่าลับของคุณเองเสมอเมื่อขึ้น production

## วิธีเอาขึ้นอินเทอร์เน็ต (Deploy)

ตัวเลือกที่ง่ายที่สุดคือบริการโฮสต์ Node.js เช่น **Render** หรือ **Railway**:

1. อัปโหลดโฟลเดอร์นี้ขึ้น GitHub repository
2. สร้าง Web Service ใหม่ ชี้ไปที่ repo — Build command: `npm install` / Start command: `npm start`
3. ตั้ง environment variables: `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`
4. เปิด URL ที่ได้ ใช้งานได้ทันที

**ข้อควรทราบ:** โฮสต์ฟรีบางเจ้า (เช่น Render free tier) ใช้ดิสก์ชั่วคราว — ไฟล์ JSON ที่แก้ไขอาจถูก reset เมื่อเซิร์ฟเวอร์ restart ถ้าต้องการข้อมูลถาวรให้ใช้แผนที่มี persistent disk, ใช้ VPS, หรือต่อยอดเป็น database จริง (แก้แค่ readCol/writeCol ใน server.js)

## API

| Method | Path | หน้าที่ | ต้องล็อกอิน |
| ------ | ---- | ------- | ----------- |
| GET | /api/{beys,blades,ratchets,bits,categories} | ดึงข้อมูล | ไม่ |
| POST | /api/{collection} | เพิ่มข้อมูล | ใช่ |
| DELETE | /api/{collection}/:id | ลบ 1 รายการ | ใช่ |
| DELETE | /api/{collection} | ลบทั้งหมด | ใช่ |
| POST | /api/login, /api/logout | เข้า/ออกระบบ | - |
| GET | /api/me | เช็คสถานะล็อกอิน | - |
