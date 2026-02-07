const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const db = new sqlite3.Database('./date.db');

app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
const upload = multer({ dest: 'uploads/' });

// ==========================================
// ✨ 管理员校验逻辑
// ==========================================
const MWS_ADMIN_KEY = "MWS2026"; 

const adminGuard = (req, res, next) => {
    if (req.headers['x-mws-auth'] === MWS_ADMIN_KEY) {
        next();
    } else {
        res.status(403).json({ success: false, message: "身份验证失败：拒绝访问" });
    }
};

// --- 1. 数据库初始化 ---
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price REAL, image TEXT, category TEXT, description TEXT, size_info TEXT, colors TEXT, detail_images TEXT, skus TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, spec_key TEXT, sku_code TEXT, customer_name TEXT, phone TEXT, address TEXT, quantity INTEGER, payment_method TEXT, tracking_number TEXT DEFAULT '待上传', status TEXT DEFAULT '待支付', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT, nickname TEXT, role TEXT DEFAULT 'user', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, tag TEXT, url TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, category TEXT, status TEXT DEFAULT '草稿', date TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    
    // 数据中枢表
    db.run(`CREATE TABLE IF NOT EXISTS orders_hub (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT, customer_name TEXT, phone TEXT, address TEXT, product_name TEXT, spec_info TEXT, sku_code TEXT, total_amount REAL, pay_status TEXT DEFAULT '未支付', ship_status TEXT DEFAULT '待发货', logistics_no TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS users_hub (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, nickname TEXT, age INTEGER, total_spent REAL DEFAULT 0, last_login DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    db.all("PRAGMA table_info(orders)", (err, rows) => {
        const cols = rows.map(r => r.name);
        if (!cols.includes('payment_method')) db.run("ALTER TABLE orders ADD COLUMN payment_method TEXT");
    });
});

// --- 2. 产品 API (含删除功能) ---

app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products ORDER BY id DESC", [], (err, rows) => res.json(rows || []));
});

app.post('/api/products', adminGuard, (req, res) => {
    const { id, name, price, image, category, description, size_info, colors, detail_images, skus } = req.body;
    const s = (data) => (typeof data === 'object' ? JSON.stringify(data) : data);
    if (id) {
        db.run(`UPDATE products SET name=?, price=?, image=?, category=?, description=?, size_info=?, colors=?, detail_images=?, skus=? WHERE id=?`, [name, price, image, category, description, size_info, s(colors), s(detail_images), s(skus), id], (err) => res.json({ success: !err, msg: "更新成功" }));
    } else {
        db.run(`INSERT INTO products (name, price, image, category, description, size_info, colors, detail_images, skus) VALUES (?,?,?,?,?,?,?,?,?)`, [name, price, image, category, description, size_info, s(colors), s(detail_images), s(skus)], function(err) {
            res.json({ success: !err, id: this.lastID, msg: "发布成功" });
        });
    }
});

app.delete('/api/products/:id', adminGuard, (req, res) => {
    const id = req.params.id;
    db.run("DELETE FROM products WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ success: false, message: "数据库删除失败" });
        res.json({ success: true, message: "档案已成功移除" });
    });
});

// --- 3. 配置管理 API (Settings) ---

app.get('/api/settings', (req, res) => {
    db.all("SELECT * FROM settings", [], (err, rows) => {
        const config = {};
        if (rows) rows.forEach(row => config[row.key] = row.value);
        res.json(config);
    });
});

app.post('/api/settings', adminGuard, (req, res) => {
    const settings = req.body;
    db.serialize(() => {
        const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
        Object.keys(settings).forEach(key => {
            if (settings[key] !== undefined) stmt.run(key, String(settings[key]));
        });
        stmt.finalize((err) => {
            if (err) return res.status(500).json({ success: false });
            res.json({ success: true, msg: "视觉引擎配置已同步" });
        });
    });
});

// --- 4. 订单与用户 API ---

app.post('/api/buy', (req, res) => {
    const { productId, specKey, customerName, phone, address, quantity, paymentMethod } = req.body;
    db.get("SELECT * FROM products WHERE id = ?", [productId], (err, product) => {
        if (err || !product) return res.status(404).json({ success: false });
        const skus = JSON.parse(product.skus || '{}');
        const variant = skus[specKey];
        db.run(`INSERT INTO orders (product_id, spec_key, sku_code, customer_name, phone, address, quantity, payment_method, status) VALUES (?,?,?,?,?,?,?,?, '待发货')`, [productId, specKey, variant.sku, customerName, phone, address, quantity || 1, paymentMethod || '未选择'], function(err) {
            res.json({ success: !err, orderId: this.lastID });
        });
    });
});

// ✨ 修复后的登录接口：自动识别用户名或邮箱
app.post('/api/login', (req, res) => {
    const { username, password } = req.body; // 兼容前端发送的 username 字段
    db.get("SELECT * FROM users WHERE (email = ? OR nickname = ?) AND password = ?", [username, username, password], (err, user) => {
        if (err || !user) {
            return res.json({ success: false, message: "凭据错误或用户不存在" });
        }
        res.json({ 
            success: true, 
            user: { id: user.id, nickname: user.nickname, role: user.role, email: user.email } 
        });
    });
});

// 注册接口 (补全)
app.post('/api/register', (req, res) => {
    const { username, nickname, password } = req.body;
    db.run("INSERT INTO users (email, nickname, password, role) VALUES (?, ?, ?, 'user')", [username, nickname, password], function(err) {
        if (err) return res.json({ success: false, message: "注册失败：账号可能已存在" });
        res.json({ success: true });
    });
});

app.get('/api/users_hub', adminGuard, (req, res) => {
    db.all("SELECT id, username, nickname, age, total_spent, created_at FROM users_hub", [], (err, rows) => res.json(rows));
});

// ==========================================
// 🚀 启动服务器
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 M.W.S System Running on Port ${PORT}`);
});
