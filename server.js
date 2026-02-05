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

// 核心初始化
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        name TEXT, price REAL, image TEXT, category TEXT, 
        description TEXT, size_info TEXT, colors TEXT, 
        detail_images TEXT, skus TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        spec_key TEXT,
        sku_code TEXT,
        customer_name TEXT,
        phone TEXT,
        address TEXT,
        quantity INTEGER,
        payment_method TEXT,
        tracking_number TEXT DEFAULT '待上传',
        status TEXT DEFAULT '待支付',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        nickname TEXT,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 自动补全字段逻辑
    db.all("PRAGMA table_info(orders)", (err, rows) => {
        const cols = rows.map(r => r.name);
        if (!cols.includes('payment_method')) db.run("ALTER TABLE orders ADD COLUMN payment_method TEXT");
        if (!cols.includes('tracking_number')) db.run("ALTER TABLE orders ADD COLUMN tracking_number TEXT DEFAULT '待上传'");
        if (!cols.includes('status')) db.run("ALTER TABLE orders ADD COLUMN status TEXT DEFAULT '待支付'");
    });
});

// --- 商品管理 API ---
app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products ORDER BY id DESC", [], (err, rows) => res.json(rows || []));
});

app.post('/api/products', (req, res) => {
    const { id, name, price, image, category, description, size_info, colors, detail_images, skus } = req.body;
    const s = (data) => (typeof data === 'object' ? JSON.stringify(data) : data);
    if (id) {
        const sql = `UPDATE products SET name=?, price=?, image=?, category=?, description=?, size_info=?, colors=?, detail_images=?, skus=? WHERE id=?`;
        db.run(sql, [name, price, image, category, description, size_info, s(colors), s(detail_images), s(skus), id], (err) => {
            if (err) return res.status(500).json({ success: false, msg: err.message });
            res.json({ success: true, msg: "资料已成功更新" });
        });
    } else {
        const sql = `INSERT INTO products (name, price, image, category, description, size_info, colors, detail_images, skus) VALUES (?,?,?,?,?,?,?,?,?)`;
        db.run(sql, [name, price, image, category, description, size_info, s(colors), s(detail_images), s(skus)], function(err) {
            if (err) return res.status(500).json({ success: false, msg: err.message });
            res.json({ success: true, id: this.lastID, msg: "新商品已发布" });
        });
    }
});

// --- 订单与下单 API ---
app.post('/api/buy', (req, res) => {
    const { productId, specKey, customerName, phone, address, quantity, paymentMethod } = req.body;
    if (!productId || !specKey || !customerName || !phone || !address) {
        return res.status(400).json({ success: false, msg: "收货信息不完整" });
    }
    db.get("SELECT * FROM products WHERE id = ?", [productId], (err, product) => {
        if (err || !product) return res.status(404).json({ success: false, msg: "找不到该商品" });
        const skus = JSON.parse(product.skus || '{}');
        const variant = skus[specKey];
        if (!variant) return res.status(400).json({ success: false, msg: "规格已失效" });

        const sql = `INSERT INTO orders (product_id, spec_key, sku_code, customer_name, phone, address, quantity, payment_method, status) 
                     VALUES (?,?,?,?,?,?,?,?, '待发货')`;
        db.run(sql, [productId, specKey, variant.sku, customerName, phone, address, quantity || 1, paymentMethod || '未选择'], function(err) {
            if (err) return res.status(500).json({ success: false, msg: "订单入库失败" });
            res.json({ 
                success: true, 
                orderId: this.lastID, 
                sku: variant.sku,
                payUrl: `pay.html?orderId=${this.lastID}&amount=${variant.price}` 
            });
        });
    });
});

app.get('/api/orders', (req, res) => {
    db.all("SELECT * FROM orders ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        res.json(rows || []);
    });
});

// ✨ A方案核心修改：发货即同步状态
app.post('/api/orders/update', (req, res) => {
    const { orderId, tracking_number } = req.body;
    // 更新单号的同时，强制将 status 改为 '已发货'
    const sql = `UPDATE orders SET tracking_number = ?, status = '已发货' WHERE id = ?`;
    db.run(sql, [tracking_number, orderId], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: "物流单号已同步至用户端" });
    });
});

// ✨ A方案新增：前端用户查询个人订单
app.get('/api/user/orders', (req, res) => {
    const nickname = req.query.name;
    if (!nickname) return res.json([]);
    const sql = "SELECT * FROM orders WHERE customer_name = ? ORDER BY id DESC";
    db.all(sql, [nickname], (err, rows) => {
        if (err) return res.status(500).json([]);
        res.json(rows || []);
    });
});

// --- 店铺与用户管理 API ---
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

app.post('/api/register', (req, res) => {
    const { email, password, nickname } = req.body;
    const sql = `INSERT INTO users (email, password, nickname) VALUES (?, ?, ?)`;
    db.run(sql, [email, password, nickname], function(err) {
        if (err) return res.status(400).json({ success: false, msg: "邮箱或昵称已被占用" });
        res.json({ success: true, msg: "欢迎加入 M.W.S ARCHIVE" });
    });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    // 支持邮箱或昵称登录
    const sql = "SELECT * FROM users WHERE (email = ? OR nickname = ?) AND password = ?";
    db.get(sql, [email, email, password], (err, user) => {
        if (err || !user) return res.json({ success: false, msg: "验证失败" });
        res.json({ 
            success: true, 
            user: { id: user.id, nickname: user.nickname, role: user.role } 
        });
    });
});

app.listen(3000, () => {
    console.log('\x1b[36m%s\x1b[0m', '-------------------------------------------');
    console.log('\x1b[32m%s\x1b[0m', '🚀 MR WANG ARCHIVE SYSTEM READY');
    console.log('\x1b[35m%s\x1b[0m', '🔗 后台: http://localhost:3000/studio.html');
    console.log('\x1b[36m%s\x1b[0m', '-------------------------------------------');
});