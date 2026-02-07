const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
// ✨ 增量添加：引入加密库用于真实注册安全
const bcrypt = require('bcryptjs'); 

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
    const finalPrice = parseFloat(price) || 0;

    const s = (data) => (typeof data === 'object' ? JSON.stringify(data) : (data || '[]'));
    
    try {
        if (id && id !== "null") {
            await pool.query(
                `UPDATE products SET name=$1, price=$2, image=$3, category=$4, description=$5, size_info=$6, colors=$7, detail_images=$8, skus=$9 WHERE id=$10`,
                [name, finalPrice, image, category, description, size_info, s(colors), s(detail_images), s(skus), id]
            );
            res.json({ success: true, msg: "档案已更新" });
        } else {
            const result = await pool.query(
                `INSERT INTO products (name, price, image, category, description, size_info, colors, detail_images, skus) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
                [name, finalPrice, image, category, description, size_info, s(colors), s(detail_images), s(skus)]
            );
            res.json({ success: true, id: result.rows[0].id, msg: "发布成功" });
        }
    } catch (err) {
        console.error("写入失败:", err.message);
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

// ==========================================
// 👤 用户认证 API (新增加的功能，不影响上方逻辑)
// ==========================================

// 1. 真实注册接口 (优化版错误处理)
app.post('/api/register', async (req, res) => {
    const { nickname, email, pass } = req.body;
    try {
        // 先检查邮箱是否真的存在
        const check = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
        if (check.rows.length > 0) {
            return res.json({ success: false, msg: "该邮箱已被占用" });
        }

        const hashedPassword = await bcrypt.hash(pass, 10);
        
        // 执行插入
        await pool.query(
            "INSERT INTO users (nickname, email, password) VALUES ($1, $2, $3)",
            [nickname, email, hashedPassword]
        );

        res.json({ success: true, msg: "注册成功" });
    } catch (err) {
        // 如果这里报错，说明是数据库结构或连接问题，不再误报“邮箱占用”
        console.error("数据库插入真实报错:", err.message);
        res.status(500).json({ success: false, msg: "系统繁忙: " + err.message });
    }
});


// 2. 真实登录
app.post('/api/login', async (req, res) => {
    const { email, pass } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        const user = result.rows[0];
        if (!user) return res.json({ success: false, msg: "账号不存在" });

        const isMatch = await bcrypt.compare(pass, user.password);
        if (!isMatch) return res.json({ success: false, msg: "密码错误" });

        delete user.password;
        res.json({ success: true, user: user });
    } catch (err) {
        res.status(500).json({ success: false, msg: "登录异常" });
    }
});

// ==========================================
// 👤 用户资料扩展 API (新增)
// ==========================================

// 1. 获取用户最新资料 (用于 account.html 实时同步)
app.get('/api/user/profile', async (req, res) => {
    const { email } = req.query;
    try {
        const result = await pool.query(
            "SELECT nickname, email, avatar, balance, role FROM users WHERE email = $1", 
            [email]
        );
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.json({ success: false, msg: "用户不存在" });
        }
    } catch (err) {
        console.error("获取资料失败:", err.message);
        res.status(500).json({ success: false });
    }
});

// 2. 更新用户头像 (用于上传头像后永久保存)
app.post('/api/user/update-avatar', async (req, res) => {
    const { email, avatar } = req.body;
    try {
        await pool.query(
            "UPDATE users SET avatar = $1 WHERE email = $2",
            [avatar, email]
        );
        res.json({ success: true, msg: "头像已同步至云端" });
    } catch (err) {
        console.error("更新头像失败:", err.message);
        res.status(500).json({ success: false, msg: "保存失败" });
    }
});

// --- 新增：接收客服留言接口 ---
app.post('/api/messages/send', async (req, res) => {
    const { email, content } = req.body;
    try {
        await pool.query(
            "INSERT INTO messages (user_email, content) VALUES ($1, $2)",
            [email, content]
        );
        res.json({ success: true, msg: "您的留言已存档至 MWS Archive。" });
    } catch (err) {
        console.error("留言保存失败:", err.message);
        res.status(500).json({ success: false, msg: "发送失败，请稍后重试。" });
    }
});

// ==========================================
// 🚀 启动监听
// ==========================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 M.W.S 系统在线 (认证增强版) | 端口: ${PORT}`);
});



