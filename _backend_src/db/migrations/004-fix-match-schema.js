// db/migrations/004-fix-match-schema.js
// 迁移脚本：修复 match_records 表缺失列和 letter_blocks 表
// 运行: cd _backend_src && node db/migrations/004-fix-match-schema.js

require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'tianji',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'tianji_tuiyan',
  });

  console.log('Connected to database.');

  // 1. 检查并添加 match_records 表的缺失列
  const columnsToAdd = [
    { name: 'gua_a', def: 'INT NULL COMMENT "A方卦ID(冗余)" AFTER user_b_gua' },
    { name: 'gua_b', def: 'INT NULL COMMENT "B方卦ID(冗余)" AFTER gua_a' },
    { name: 'source', def: "VARCHAR(32) DEFAULT 'letter' COMMENT '来源:letter/share' AFTER match_level" },
  ];

  for (const col of columnsToAdd) {
    const [rows] = await conn.query(
      'SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['match_records', col.name]
    );
    if (rows[0].cnt === 0) {
      const sql = `ALTER TABLE match_records ADD COLUMN ${col.name} ${col.def}`;
      console.log(`Adding column ${col.name} to match_records...`);
      await conn.query(sql);
      console.log(`Column ${col.name} added successfully.`);
    } else {
      console.log(`Column ${col.name} already exists in match_records.`);
    }
  }

  // 2. 创建 letter_blocks 表（如果不存在）
  const [tables] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    ['letter_blocks']
  );
  if (tables[0].cnt === 0) {
    console.log('Creating letter_blocks table...');
    await conn.query(`
      CREATE TABLE letter_blocks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        blocker_openid VARCHAR(64) NOT NULL COMMENT '发起拉黑的用户',
        blocked_openid VARCHAR(64) NOT NULL COMMENT '被拉黑的用户',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_blocker_blocked (blocker_openid, blocked_openid),
        INDEX idx_blocker (blocker_openid),
        INDEX idx_blocked (blocked_openid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('letter_blocks table created successfully.');
  } else {
    console.log('letter_blocks table already exists.');
  }

  // 3. 验证结果
  console.log('\nVerifying schema...');
  const [matchCols] = await conn.query('DESCRIBE match_records');
  console.log('\nmatch_records columns:');
  matchCols.forEach(col => console.log(`  ${col.Field} ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : 'NULL'} ${col.Default !== null ? 'DEFAULT ' + col.Default : ''}`));

  const [blockCols] = await conn.query('DESCRIBE letter_blocks');
  console.log('\nletter_blocks columns:');
  blockCols.forEach(col => console.log(`  ${col.Field} ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : 'NULL'} ${col.Default !== null ? 'DEFAULT ' + col.Default : ''}`));

  await conn.end();
  console.log('\nMigration completed successfully!');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
