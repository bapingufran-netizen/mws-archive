const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');

const app = express();

// ==========================================
// 🔗 数据库连接 (已优化读取 Render 环境变量)
// ==========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000
});

// ==========================================
// 🛠️ 跨域与中间件
// ==========================================
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(__dirname));

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-mws-auth");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ==========================================
// 📦 核心业务 API
// ==========================================

// 获取产品列表
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM products ORDER BY id DESC");
        res.json(result.rows || []);
    } catch (err) {
        console.error("数据库读取异常:", err.message);
        res.json([]);
    }
});

// 发布或更新产品
app.post('/api/products', async (req, res) => {
    const { id, name, price, image, category, description, size_info, colors, detail_images, skus } = req.body;
    
    // 🛡️ 核心修复：处理数据库 REAL 类型不支持空字符串的问题
    // 如果 price 为空字符串或非法字符，强制转换为数字 0
    const finalPrice = parseFloat(price) || 0;

    const s = (data) => (typeof data === 'object' ? JSON.stringify(data) : (data || '[]'));
    
    try {
        if (id && id !== "null") {
            // 更新逻辑 (使用 finalPrice)
            await pool.query(
                `UPDATE products SET name=$1, price=$2, image=$3, category=$4, description=$5, size_info=$6, colors=$7, detail_images=$8, skus=$9 WHERE id=$10`,
                [name, finalPrice, image, category, description, size_info, s(colors), s(detail_images), s(skus), id]
            );
            res.json({ success: true, msg: "档案已更新" });
        } else {
            // 插入逻辑 (使用 finalPrice)
            const result = await pool.query(
                `INSERT INTO products (name, price, image, category, description, size_info, colors, detail_images, skus) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
                [name, finalPrice, image, category, description, size_info, s(colors), s(detail_images), s(skus)]
            );
            res.json({ success: true, id: result.rows[0].id, msg: "发布成功" });
        }
    } catch (err) {
        console.error("写入失败:", err.message);
        // 返回更具体的错误信息方便调试
        res.status(500).json({ success: false, msg: "存储失败: " + err.message });
    }
});

// 删除产品
app.delete('/api/products/:id', async (req, res) => {
    try { 
        await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ success: false }); 
    }
});

// 获取配置
app.get('/api/settings', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM settings");
        const config = {}; result.rows.forEach(row => config[row.key] = row.value);
        res.json(config);
    } catch (err) { res.json({}); }
});

// 保存配置
app.post('/api/settings', async (req, res) => {
    const settings = req.body;
    try {
        for (const key of Object.keys(settings)) {
            await pool.query(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`, [key, String(settings[key])]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 M.W.S 系统在线 (无验证模式) | 端口: ${PORT}`);
});
