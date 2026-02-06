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

// --- 1. 数据库初始化 (保留原有，新增两表) ---
db.serialize(() => {
    // 保留原有表
    db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price REAL, image TEXT, category TEXT, description TEXT, size_info TEXT, colors TEXT, detail_images TEXT, skus TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, spec_key TEXT, sku_code TEXT, customer_name TEXT, phone TEXT, address TEXT, quantity INTEGER, payment_method TEXT, tracking_number TEXT DEFAULT '待上传', status TEXT DEFAULT '待支付', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT, nickname TEXT, role TEXT DEFAULT 'user', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    // ✨ 仅新增：媒体素材表 (对应 admin-media.html)
    db.run(`CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, tag TEXT, url TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    // ✨ 仅新增：品牌叙事志表 (对应 admin-journal.html)
    db.run(`CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, category TEXT, status TEXT DEFAULT '草稿', date TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    // 自动补全订单字段逻辑 (保留你的 A 方案)
    db.all("PRAGMA table_info(orders)", (err, rows) => {
        const cols = rows.map(r => r.name);
        if (!cols.includes('payment_method')) db.run("ALTER TABLE orders ADD COLUMN payment_method TEXT");
        if (!cols.includes('tracking_number')) db.run("ALTER TABLE orders ADD COLUMN tracking_number TEXT DEFAULT '待上传'");
        if (!cols.includes('status')) db.run("ALTER TABLE orders ADD COLUMN status TEXT DEFAULT '待支付'");
    });
});

// --- 2. 新增：媒体库 & 叙事志 API (仅做加法) ---

app.get('/api/media', (req, res) => {
    db.all("SELECT * FROM media ORDER BY id DESC", [], (err, rows) => res.json(rows || []));
});

app.post('/api/media', (req, res) => {
    const { type, tag, url } = req.body;
    db.run("INSERT INTO media (type, tag, url) VALUES (?, ?, ?)", [type, tag, url], function(err) {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, id: this.lastID });
    });
});

app.delete('/api/media/:id', (req, res) => {
    db.run("DELETE FROM media WHERE id = ?", [req.params.id], (err) => res.json({ success: !err }));
});

app.get('/api/journal', (req, res) => {
    db.all("SELECT * FROM journal ORDER BY id DESC", [], (err, rows) => res.json(rows || []));
});

app.post('/api/journal', (req, res) => {
    const { title, content, category, status } = req.body;
    const date = new Date().toLocaleDateString();
    db.run("INSERT INTO journal (title, content, category, status, date) VALUES (?, ?, ?, ?, ?)", [title, content, category, status, date], function(err) {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, id: this.lastID });
    });
});

app.delete('/api/journal/:id', (req, res) => {
    db.run("DELETE FROM journal WHERE id = ?", [req.params.id], (err) => res.json({ success: !err }));
});

// --- 3. 原有功能 API (完全保留，未做任何修改) ---

app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products ORDER BY id DESC", [], (err, rows) => res.json(rows || []));
});

app.post('/api/products', (req, res) => {
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

app.post('/api/buy', (req, res) => {
    const { productId, specKey, customerName, phone, address, quantity, paymentMethod } = req.body;
    db.get("SELECT * FROM products WHERE id = ?", [productId], (err, product) => {
        if (err || !product) return res.status(404).json({ success: false });
        const skus = JSON.parse(product.skus || '{}');
        const variant = skus[specKey];
        db.run(`INSERT INTO orders (product_id, spec_key, sku_code, customer_name, phone, address, quantity, payment_method, status) VALUES (?,?,?,?,?,?,?,?, '待发货')`, [productId, specKey, variant.sku, customerName, phone, address, quantity || 1, paymentMethod || '未选择'], function(err) {
            res.json({ success: !err, orderId: this.lastID, payUrl: `pay.html?orderId=${this.lastID}&amount=${variant.price}` });
        });
    });
});

app.get('/api/orders', (req, res) => {
    db.all("SELECT * FROM orders ORDER BY id DESC", [], (err, rows) => res.json(rows || []));
});

app.post('/api/orders/update', (req, res) => {
    const { orderId, tracking_number } = req.body;
    db.run(`UPDATE orders SET tracking_number = ?, status = '已发货' WHERE id = ?`, [tracking_number, orderId], (err) => res.json({ success: !err }));
});

app.get('/api/settings', (req, res) => {
    db.all("SELECT * FROM settings", [], (err, rows) => {
        const config = {};
        rows.forEach(row => config[row.key] = row.value);
        res.json(config);
    });
});

app.post('/api/settings', (req, res) => {
    const settings = req.body;
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    Object.keys(settings).forEach(key => stmt.run(key, settings[key]));
    stmt.finalize();
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE (email = ? OR nickname = ?) AND password = ?", [email, email, password], (err, user) => {
        if (err || !user) return res.json({ success: false });
        res.json({ success: true, user: { id: user.id, nickname: user.nickname, role: user.role } });
    });
});

// --- 4. 适配 GitHub/Render 的端口监听 ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 M.W.S System Running on Port ${PORT}`);
});

// ==========================================
// 1. 数据中枢数据库表初始化 (追加)
// ==========================================
db.serialize(() => {
    // 订单表：涵盖下单时间、地址、物流、支付状态、规格编码等
    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_no TEXT,              -- 订单号
        customer_name TEXT,         -- 联系人
        phone TEXT,                 -- 电话
        address TEXT,               -- 地址
        product_name TEXT,          -- 商品名称
        spec_info TEXT,             -- 规格 (颜色/尺寸)
        sku_code TEXT,              -- 商家编码
        total_amount REAL,          -- 订单金额
        pay_status TEXT DEFAULT '未支付', -- 支付状态
        ship_status TEXT DEFAULT '待发货', -- 发货状态
        logistics_no TEXT,          -- 物流单号
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 会员/用户资料表：涵盖年龄、累计消费、账号密码
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,       -- 登录账号
        password TEXT,              -- 密码
        nickname TEXT,              -- 会员昵称
        age INTEGER,                -- 年龄
        total_spent REAL DEFAULT 0, -- 累计消费金额
        last_login DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ==========================================
// 2. 数据中枢 API 接口 (追加)
// ==========================================

// --- 订单管理接口 ---
app.get('/api/orders', (req, res) => {
    db.all("SELECT * FROM orders ORDER BY created_at DESC", [], (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/orders/update', (req, res) => {
    const { id, pay_status, ship_status, logistics_no } = req.body;
    db.run("UPDATE orders SET pay_status = ?, ship_status = ?, logistics_no = ? WHERE id = ?",
        [pay_status, ship_status, logistics_no, id], (err) => {
            res.json({ success: !err });
        });
});

// --- 会员管理接口 ---
app.get('/api/users', (req, res) => {
    db.all("SELECT id, username, nickname, age, total_spent, created_at FROM users", [], (err, rows) => {
        res.json(rows);
    });
});

// --- 销售报表统计接口 ---
app.get('/api/stats', (req, res) => {
    const statsQuery = `
        SELECT 
            date(created_at) as date,
            COUNT(id) as order_count,
            SUM(total_amount) as daily_revenue
        FROM orders 
        WHERE pay_status = '已支付'
        GROUP BY date(created_at)
        ORDER BY date DESC LIMIT 30
    `;
    db.all(statsQuery, [], (err, rows) => {
        res.json(rows);
    });
});
