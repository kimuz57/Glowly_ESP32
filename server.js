const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors'); // 👈 1. เรียกใช้ cors
 // 👈 2. สั่งให้อนุญาตการเชื่อมต่อจากแอปมือถือ

console.log('DB_USER:', process.env.DB_USER); 
console.log('DB_NAME:', process.env.DB_NAME);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use(cors({
    origin: function (origin, callback) {
        callback(null, true); // ยอมรับทุกโดเมน
    },
    credentials: true // สำคัญมาก! อนุญาตให้แอปมือถือแนบ Cookie ยืนยันตัวตนมาได้
}));
app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'static')));

// บอก Express ว่าถ้ามีคนพิมพ์ URL ว่า /dashboard ให้ส่งไฟล์ dashboard.html ไปให้
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'dashboard.html'));
});

// แก้ตรงนี้: ใส่ || ไว้กันเซิร์ฟเวอร์พังเผื่อหาค่าใน .env ไม่เจอ
const sessionSecret = process.env.SESSION_SECRET || 'my_super_secret_fallback_key_123';
app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, 
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [results] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

        if (results.length === 0) {
            return res.json({ status: 'error', message: 'อีเมลไม่ถูกต้อง' });
        }

        const user = results[0];
        let isMatch = false;

        // เช็คว่ามี password และเป็น hash จริงๆ ก่อนเทียบ (กัน Error)
        if (user.password && user.password.startsWith('$2')) {
            isMatch = await bcrypt.compare(password, user.password);
        } else {
            isMatch = (password === user.password);
        }

        if (!isMatch) {
            return res.json({ status: 'error', message: 'รหัสผ่านไม่ถูกต้อง' });
        }

        // *** จุดที่เพิ่มใหม่: บันทึกข้อมูลลง Session เมื่อล็อกอินสำเร็จ ***
        req.session.userId = user.id;
        req.session.isLoggedIn = true;

        res.json({ status: 'ok', user: { id: user.id, email: user.email, name: user.name } });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Database Error' });
    }
});

// API สำหรับออกจากระบบ (ทำลาย Session)
app.post('/api/logout', (req, res) => {
    // สั่งทำลาย Session ของ User คนนี้ทิ้ง
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).json({ status: 'error', message: 'ไม่สามารถออกจากระบบได้' });
        }
        // ล้างคุกกี้ฝั่งเบราว์เซอร์ให้สะอาด
        res.clearCookie('connect.sid'); 
        res.json({ status: 'ok', message: 'ออกจากระบบสำเร็จ' });
    });
});

const requireLogin = (req, res, next) => {
    // ตรวจสอบว่ามี session และมีสถานะ isLoggedIn เป็น true หรือไม่
    if (req.session && req.session.isLoggedIn) {
        next(); // ถ้าล็อกอินแล้ว อนุญาตให้ไปทำคำสั่งต่อไปได้
    } else {
        // ถ้ายังไม่ล็อกอิน ให้ส่ง Error 401 (Unauthorized) กลับไป
        res.status(401).json({ status: 'error', message: 'กรุณาล็อกอินก่อนเข้าใช้งาน' });
    }
};

// แก้จากแบบเดิมที่เป็น Callback ให้เป็น async/await เหมือนตัวอื่นๆ
// ค้นหาบรรทัด app.get('/api/devices/:userId' แล้ววางทับด้วยโค้ดนี้ครับ
app.get('/api/devices/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        console.log(`🔍 Server ได้รับคำขอข้อมูลอุปกรณ์ของ User ID: ${userId}`);
        
        // แก้จาก callback เป็น await [rows]
        const [rows] = await db.query('SELECT * FROM devices WHERE user_id = ?', [userId]);
        
        console.log(`📦 พบอุปกรณ์ทั้งหมด: ${rows.length} รายการ`);
        res.json({ status: 'ok', devices: rows });
    } catch (err) {
        console.error('❌ Database Error:', err);
        res.status(500).json({ status: 'error', message: 'Database Error' });
    }
});


// API สำหรับอัปเดตสถานะไฟลง Database
app.put('/api/devices/:id/status', async (req, res) => {
    try {
        const deviceId = req.params.id;
        const newStatus = req.body.status; // จะรับค่า 0 หรือ 1 มาจากหน้าเว็บ

        // สั่งอัปเดตข้อมูลในฐานข้อมูล
        await db.query('UPDATE devices SET status = ? WHERE id = ?', [newStatus, deviceId]);
        
        res.json({ status: 'ok', message: 'อัปเดตสถานะใน Database เรียบร้อย' });
    } catch (err) {
        console.error('Database Update Error:', err);
        res.status(500).json({ status: 'error', message: 'ไม่สามารถอัปเดตฐานข้อมูลได้' });
    }
});

app.get('/api/check-auth', (req, res) => {
    if (req.session && req.session.isLoggedIn) {
        res.json({ status: 'ok', isLoggedIn: true, userId: req.session.userId });
    } else {
        res.json({ status: 'error', isLoggedIn: false });
    }
});



wss.on('connection', async (ws) => {  // <--- เติม async ตรงนี้
    console.log('✅ อุปกรณ์ (หรือ Web) เชื่อมต่อ WebSocket แล้ว');

    // ==========================================
    // ส่วนที่ 1 (เพิ่มใหม่): ซิงค์ข้อมูลจาก Database ทันทีที่เพิ่งต่อติด
    // ==========================================
    try {
        const [devices] = await db.query('SELECT * FROM devices');
        devices.forEach(device => {
            // สร้างคำสั่งให้ตรงกับที่ C Code ของ ESP32 รอรับอยู่
            // (เช่น OPEN_TRUNON_ROOM1 หรือ CLOSE_TRUNOFF_ROOM1)
            const action = device.status === 1 ? 'OPEN_TRUNON' : 'CLOSE_TRUNOFF';
            ws.send(`${action}_ROOM${device.id}`); 
        });
        console.log('📥 สาดข้อมูลสถานะเริ่มต้นให้ Client เรียบร้อย');
    } catch (err) {
        console.error('❌ ดึงสถานะเริ่มต้นจาก DB ไม่สำเร็จ:', err);
    }

    // ==========================================
    // ส่วนที่ 2 (ของเดิม): รับคำสั่งจากหน้าเว็บ แล้วกระจายต่อให้ ESP32
    // ==========================================
    ws.on('message', (message) => {
        const command = message.toString();
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(command);
            }
        });
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => { // 👈 ต้องมี '0.0.0.0' ตรงนี้ครับ!
    console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
});