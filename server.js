const express = require('express');
const { Pool } = require('pg'); // 替换 sqlite3
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// ==========================================
// 🔗 Supabase PostgreSQL 连接配置
// ==========================================
const pool = new Pool({
    connectionString: "postgresql://postgres:[Chenliang123=xia]@db.kzjtjgdytnptcqgqfhcw.supabase.co:5432/postgres",
    ssl: { rejectUnauthorized: false } // Supabase 连接必须开启 SSL
});

app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
const upload = multer({ dest: 'uploads/' });

// ==========================================
// ✨ 管理员校验逻辑 (保持原样)
// ==========================================
const MWS_ADMIN_KEY = "MWS2026"; 

const adminGuard = (req, res, next) => {
    if (req.headers['x-mws-auth'] === MWS_ADMIN_KEY) {
        next();
    } else {
        res.status(403).json({ success: false, message: "身份验证失败：拒绝访问" });
    }
};

// --- 1. 产品 API ---

app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM products ORDER BY id DESC");
        res.json(result.rows || []);
    } catch (err) {
        res.json([]);
    }
});

app.post('/api/products', adminGuard, async (req, res) => {
    const { id, name, price, image, category, description, size_info, colors, detail_images, skus } = req.body;
    const s = (data) => (typeof data === 'object' ? JSON.stringify(data) : data);
    
    try {
        if (id) {
            await pool.query(
                `UPDATE products SET name=$1, price=$2, image=$3, category=$4, description=$5, size_info=$6, colors=$7, detail_images=$8, skus=$9 WHERE id=$10`,
                [name, price, image, category, description, size_info, s(colors), s(detail_images), s(skus), id]
            );
            res.json({ success: true, msg: "更新成功" });
        } else {
            const result = await pool.query(
                `INSERT INTO products (name, price, image, category, description, size_info, colors, detail_images, skus) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
                [name, price, image, category, description, size_info, s(colors), s(detail_images), s(skus)]
            );
            res.json({ success: true, id: result.rows[0].id, msg: "发布成功" });
        }
    } catch (err) {
        res.status(500).json({ success: false, msg: "数据库操作失败" });
    }
});

app.delete('/api/products/:id', adminGuard, async (req, res) => {
    try {
        await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
        res.json({ success: true, message: "档案已成功移除" });
    } catch (err) {
        res.status(500).json({ success: false, message: "数据库删除失败" });
    }
});

// --- 2. 配置管理 API (Settings) ---

app.get('/api/settings', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM settings");
        const config = {};
        result.rows.forEach(row => config[row.key] = row.value);
        res.json(config);
    } catch (err) {
        res.json({});
    }
});

app.post('/api/settings', adminGuard, async (req, res) => {
    const settings = req.body;
    try {
        for (const key of Object.keys(settings)) {
            if (settings[key] !== undefined) {
                // 使用 PostgreSQL 的 UPSERT 语法替换 INSERT OR REPLACE
                await pool.query(
                    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
                    [key, String(settings[key])]
                );
            }
        }
        res.json({ success: true, msg: "视觉引擎配置已同步" });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// --- 3. 订单与用户 API ---

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
    } catch (err) {
        res.status(500).json({ success: false, msg: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body; 
    try {
        const result = await pool.query(
            "SELECT * FROM users WHERE (email = $1 OR nickname = $2) AND password = $3",
            [username, username, password]
        );
        const user = result.rows[0];
        if (!user) return res.json({ success: false, message: "凭据错误" });
        res.json({ success: true, user: { id: user.id, nickname: user.nickname, role: user.role } });
    } catch (err) {
        res.json({ success: false, message: "登录异常" });
    }
});

app.post('/api/register', async (req, res) => {
    const { username, nickname, password } = req.body;
    try {
        await pool.query(
            "INSERT INTO users (email, nickname, password, role) VALUES ($1, $2, $3, 'user')",
            [username, nickname, password]
        );
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: "注册失败：账号可能已存在" });
    }
});

app.get('/api/users_hub', adminGuard, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, username, nickname, age, total_spent, created_at FROM users_hub");
        res.json(result.rows || []);
    } catch (err) {
        res.json([]);
    }
});

// ==========================================
// 🚀 启动服务器
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 M.W.S System Running on Supabase - Port ${PORT}`);
});