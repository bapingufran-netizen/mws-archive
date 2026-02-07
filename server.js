const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// ==========================================
// 🔗 数据库连接 (针对 Render 网络连接深度优化)
// ==========================================
const pool = new Pool({
    // 关键修复 1：在 URL 末尾增加 ?sslmode=require
    // 关键修复 2：将密码中的 = 转义为 %3D 确保字符串解析正确
    connectionString: "postgresql://postgres:Chenliang123%3Dxia@db.kzjtjgdytnptcqgqfhcw.supabase.co:5432/postgres?sslmode=require",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000 // 增加连接超时容忍
});

// ==========================================
// 🛠️ 中间件配置 (保持原样)
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
// ✨ 管理员鉴权 (保持 MWS2026 密钥不变)
// ==========================================
const MWS_ADMIN_KEY = "MWS2026"; 

const adminGuard = (req, res, next) => {
    const clientKey = req.headers['x-mws-auth']; 
    if (clientKey === MWS_ADMIN_KEY) {
        next();
    } else {
        console.log(`[认证拦截] 收到口令: ${clientKey || '空'}`);
        res.status(403).json({ success: false, message: "身份验证失败：权限不足" });
    }
};

// ==========================================
// 📦 产品管理 API (结构完全保留)
// ==========================================
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM products ORDER BY id DESC");
        res.json(result.rows || []);
    } catch (err) {
        console.error("数据库连接失败:", err.message);
        res.json([]);
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
        console.error("写入云端失败:", err.message);
        res.status(500).json({ success: false, msg: "存入云端失败，请稍后再试" });
    }
});

// 其余配置逻辑 (DELETE, GET/POST settings, POST buy) 保持你之前的版本完全不变
// ...

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 M.W.S System Running | Port ${PORT}`);
});
