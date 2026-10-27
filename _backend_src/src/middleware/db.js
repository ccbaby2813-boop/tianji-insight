// src/middleware/db.js - MySQL连接池（v10.3 连接数优化版）
// 关键原则：简单查询用 query()，复杂操作用 get()+release()
const mysql = require('mysql2/promise');

// 连接池配置：PM2 cluster 4进程 × 15连接 = 60，在MySQL max_connections(151)安全范围内
const CONNECTION_LIMIT = parseInt(process.env.DB_CONNECTION_LIMIT || '15', 10);
const QUEUE_LIMIT = parseInt(process.env.DB_QUEUE_LIMIT || '100', 10);
const IDLE_TIMEOUT = parseInt(process.env.DB_IDLE_TIMEOUT || '60000', 10);

let pool = null;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'tianji_tuiyan',
      waitForConnections: true,
      connectionLimit: CONNECTION_LIMIT,
      queueLimit: QUEUE_LIMIT,
      idleTimeout: IDLE_TIMEOUT,         // 60秒回收空闲连接，防止低峰期连接堆积
      charset: 'utf8mb4',
      dateStrings: true,                 // 时间字段返回原始字符串，避免mysql2转Date对象后序列化成UTC
      connectTimeout: 10000,             // 连接超时10秒
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      multipleStatements: false,         // 防止SQL注入
    });

    // 连接池事件监控
    pool.on('connection', () => {
      console.log('[db] 新连接创建');
    });
    pool.on('enqueue', () => {
      console.warn('[db] 连接池满，请求排队');
    });
    pool.on('acquire', () => {
      // console.log('[db] 连接获取'); // 生产环境可注释
    });
    pool.on('release', () => {
      // console.log('[db] 连接释放'); // 生产环境可注释
    });
  }
  return pool;
}

async function get() {
  const p = await getPool();
  return p.getConnection();
}

/**
 * 便捷查询：自动获取连接、执行查询、释放连接
 * 适用于：不需要事务的单条查询
 * 注意：不要在外部再 release！
 */
async function query(sql, params) {
  const conn = await get();
  try {
    return await conn.query(sql, params);
  } finally {
    conn.release();
  }
}

/**
 * 事务执行：自动管理连接和事务
 * callback: async (conn) => { ... }
 */
async function transaction(callback) {
  const conn = await get();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 获取连接池状态
 */
async function getStats() {
  const p = await getPool();
  // mysql2 pool 内部使用 generic-pool
  const inner = p.pool;
  const size = typeof inner.size === 'function' ? inner.size() : (inner.size || 0);
  const avail = inner.available && typeof inner.available.length === 'number' ? inner.available.length : 0;
  const pending = inner.pendingAcquires && typeof inner.pendingAcquires.length === 'number' ? inner.pendingAcquires.length : 0;
  return {
    status: 'active',
    totalConnections: size,
    activeConnections: Math.max(0, size - avail),
    idleConnections: avail,
    pendingAcquires: pending,
    config: { connectionLimit: CONNECTION_LIMIT, queueLimit: QUEUE_LIMIT }
  };
}

module.exports = { get, getPool, query, transaction, getStats };