const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// ==========================================
// 🔗 Supabase PostgreSQL 连接配置 (已增加 IPv4 稳定性修复)
// ==========================================
const pool = new Pool({
    // 关键修复：增加 sslmode 参数强制安全连接
    connectionString: "postgresql://postgres:Chenliang123%3Dxia@db.kzjtjgdytnptcqgqfhcw.supabase.co:5432/postgres?sslmode=require",
    ssl: { rejectUnauthorized: false },
    // 增加连接超时控制，防止进程卡死
    connectionTimeoutMillis: 5000 
});

// ==========================================
// 🛠️ 中间件配置
// ==========================================
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-mws-auth");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// ==========================================
// ✨ 管理员校验逻辑
// ==========================================
const MWS_ADMIN_KEY = "MWS2026"; 

const adminGuard = (req, res, next) => {
    const clientKey = req.headers['x-mws-auth']; 
    if (clientKey === MWS_ADMIN_KEY) {
        next();
    } else {
        console.log(`[认证提示] 访问拒绝，收到 Key: ${clientKey || '空'}`);
        res.status(403).json({ success: false, message: "身份验证失败" });
    }
};

// ==========================================
// 📦 产品 API
// ==========================================
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM products ORDER BY id DESC");
        res.json(result.rows || []);
    } catch (err) {
        console.error("数据库连接异常:", err.message);
        res.status(500).json({ error: "无法连接至云端数据库" });
    }
});

app.post('/api/products', adminGuard, async (req, res) => {
    const { id, name, price, image, category, description, size_info, colors, detail_images, skus } = req.body;
    const s = (data) => (typeof data === 'object' ? JSON.stringify(data) : (data || '[]'));
    
    try {
        if (id && id !== "null") {
            await pool.query(
                `UPDATE products SET name=$1, price=$2, image=$3, category=$4, description=$5, size_info=$6, colors=$7, detail_images=$8, skus=$9 WHERE id=$10`,
                [name, price, image, category, description, size_info, s(colors), s(detail_images), s(skus), id]
            );
            res.json({ success: true, msg: "档案已更新" });
        } else {
            const result = await pool.query(
                `INSERT INTO products (name, price, image, category, description, size_info, colors, detail_images, skus) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
                [name, price, image, category, description, size_info, s(colors), s(detail_images), s(skus)]
            );
            res.json({ success: true, id: result.rows[0].id, msg: "发布成功" });
        }
    } catch (err) {
        console.error("写入失败:", err.message);
        res.status(500).json({ success: false, msg: "云端存储失败" });
    }
});

app.delete('/api/products/:id', adminGuard, async (req, res) => {
    try {
        await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
        res.json({ success: true, message: "已移除" });
    } catch (err) { res.status(500).json({ success: false }); }
});

// ==========================================
// ⚙️ 配置管理 API
// ==========================================
app.get('/api/settings', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM settings");
        const config = {};
        result.rows.forEach(row => config[row.key] = row.value);
        res.json(config);
    } catch (err) { res.json({}); }
});

app.post('/api/settings', adminGuard, async (req, res) => {
    const settings = req.body;
    try {
        for (const key of Object.keys(settings)) {
            if (settings[key] !== undefined) {
                await pool.query(
                    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
                    [key, String(settings[key])]
                );
            }
        }
        res.json({ success: true, msg: "同步成功" });
    } catch (err) { res.status(500).json({ success: false }); }
});

// ==========================================
// 🛒 订单 API
// ==========================================
app.post('/api/buy', async (req, res) => {
    const { productId, specKey, customerName, phone, address, quantity, paymentMethod } = req.body;
    try {
        const productResult = await pool.query("SELECT * FROM products WHERE id = $1", [productId]);
        const product = productResult.rows[0];
        if (!product) return res.status(404).json({ success: false });
        
        const skus = JSON.parse(product.skus || '{}');
        const variant = skus[specKey] || {};
        
        await pool.query(
            `INSERT INTO orders (product_id, spec_key, sku_code, customer_name, phone, address, quantity, payment_method, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, '待发货')`,
            [productId, specKey, variant.sku || '', customerName, phone, address, quantity || 1, paymentMethod || '未选择']
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 M.W.S System Live | Port ${PORT}`);
});
