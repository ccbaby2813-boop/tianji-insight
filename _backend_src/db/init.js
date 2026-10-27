// db/init.js - 启动时导入种子数据
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function init() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
    multipleStatements: true
  });

  try {
    // 导入 hexagrams 种子数据
    const seedPath = path.join(__dirname, 'seed_hexagrams.sql');
    const seedSql = fs.readFileSync(seedPath, 'utf-8');
    await connection.query(seedSql);
    console.log('[init] ✅ 64卦种子数据导入成功');

    // 检查 admin 是否存在，不存在则创建
    const [rows] = await connection.query('SELECT id FROM admins WHERE username = ?', [process.env.ADMIN_USERNAME]);
    if (rows.length === 0) {
      await connection.query(
        'INSERT INTO admins (username, password_hash) VALUES (?, ?)',
        [process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD_HASH]
      );
      console.log('[init] ✅ 初始管理员创建成功');
    } else {
      console.log('[init] ℹ️ 管理员已存在');
    }

    console.log('[init] ✅ 数据库初始化完成');
  } catch (err) {
    console.error('[init] ❌ 初始化失败:', err.message);
  } finally {
    await connection.end();
  }
}

init();
