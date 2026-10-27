// src/routes/admin.js - 天机推演管理后台路由（v2 完整版）
// 8大模块 · 48个API接口
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../middleware/db');
const cache = require('../services/cache');
const { verifyAdminToken } = require('../middleware/admin');
const { execFile, execFileSync, spawn } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');

// 🔴 v3.5 安全加固：所有 shell 命令一律走 execFile 参数数组形式，杜绝 shell 元字符注入
// execFileAsync(file, args, opts) — 默认忽略 stderr，避免 stderr 输出污染 stdout 解析
const execFileAsync = util.promisify(execFile);
const { resolveOpenid, resolveOpenidStandalone } = require('../utils/openid-resolver');

const JWT_SECRET = process.env.JWT_SECRET;
// 🔴 v3.4 安全加固：移除硬编码默认用户名，强制通过环境变量配置
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

// 测试事件过滤：排除 e2e_test* 和 test 类型
const TEST_EVENT_FILTER = "event_type NOT LIKE 'e2e_test%' AND event_type != 'test'";

// 登录限流：5次/分钟（Redis集群共享）
const redisService = require('../services/redis');
const LOGIN_RATE_LIMIT_PREFIX = 'tianji:admin:login_attempts:';
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

/**
 * Admin 专用 openid 反查中间件
 * 解决场景：管理后台界面缓存了用户绑定手机号前的旧 openid（oXXX/device_id），
 * 而数据库已迁移到主账号 openid（phone_xxx），导致查询/更新/删除都命中不到。
 * 行为：把 req.params.openid 反查为最新主账号 openid（user_bindings.unified_openid）
 *      同时保留 req.originalOpenid 供审计/日志使用
 * 查不到绑定记录则原样保留（说明该 openid 未绑定过手机号）
 */
async function resolveAdminOpenid(req, res, next) {
  const rawOpenid = req.params && req.params.openid;
  if (!rawOpenid) return next();
  try {
    req.originalOpenid = rawOpenid;
    const resolved = await resolveOpenidStandalone(rawOpenid);
    if (resolved !== rawOpenid) {
      req.params.openid = resolved; // 覆盖为最新主账号 openid
    }
    next();
  } catch (err) {
    console.error('[resolveAdminOpenid] 反查失败，使用原始值:', err.message);
    next(); // 失败时降级使用原始值，避免阻断管理操作
  }
}

/**
 * 同时反查 :openid 和 :friendOpenid 两个 URL 参数
 * 用于 /virtual-users/:openid/thread/:friendOpenid 系列接口
 */
async function resolveAdminDualOpenid(req, res, next) {
  const rawOpenid = req.params && req.params.openid;
  const rawFriend = req.params && req.params.friendOpenid;
  try {
    if (rawOpenid) {
      req.originalOpenid = rawOpenid;
      req.params.openid = await resolveOpenidStandalone(rawOpenid);
    }
    if (rawFriend) {
      req.originalFriendOpenid = rawFriend;
      req.params.friendOpenid = await resolveOpenidStandalone(rawFriend);
    }
    next();
  } catch (err) {
    console.error('[resolveAdminDualOpenid] 反查失败，使用原始值:', err.message);
    next();
  }
}

/**
 * 🔴 v3.5 统一审计日志 helper
 * 非阻塞式记录管理操作，失败只记 console，不影响业务响应
 * @param {Object} req - Express request（取 req.admin.id 和 req.ip）
 * @param {String} action - 操作类型（如 'virtual_reply_toggle'）
 * @param {String} target - 操作目标（如 openid / id；可选）
 * @param {Object|String} detail - 详细信息（对象会 JSON.stringify；可选）
 */
function logAdminAction(req, action, target, detail) {
  const adminId = req && req.admin && req.admin.id;
  if (!adminId || !action) return;
  const ip = req.ip || '';
  const detailStr = detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null;
  try {
    if (target && detailStr) {
      db.query('INSERT INTO admin_logs (admin_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)', [adminId, action, target, detailStr, ip]);
    } else if (target) {
      db.query('INSERT INTO admin_logs (admin_id, action, target, ip) VALUES (?, ?, ?, ?)', [adminId, action, target, ip]);
    } else if (detailStr) {
      db.query('INSERT INTO admin_logs (admin_id, action, detail, ip) VALUES (?, ?, ?, ?)', [adminId, action, detailStr, ip]);
    } else {
      db.query('INSERT INTO admin_logs (admin_id, action, ip) VALUES (?, ?, ?)', [adminId, action, ip]);
    }
  } catch (err) {
    console.error('[logAdminAction] 审计日志写入失败:', err.message);
  }
}

async function checkLoginRateLimit(ip) {
  try {
    const redis = await redisService.getClient();
    if (redis && redis.isReady) {
      const key = LOGIN_RATE_LIMIT_PREFIX + ip;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.pExpire(key, LOGIN_WINDOW_MS);
      }
      return count <= LOGIN_MAX_ATTEMPTS;
    }
  } catch (e) {
    console.error('[admin/login] Redis限流失败:', e.message);
  }
  // 🔴 v3.5 加固：管理员登录是高敏感操作，Redis 不可用时 fail-closed（拒绝）
  // 普通用户登录保持 fail-open 保证可用性，管理员登录必须 fail-closed 防止暴力破解
  if (process.env.NODE_ENV === 'production') {
    console.error('[admin/login] 生产环境 Redis 不可用，拒绝管理员登录');
    return false;
  }
  return true; // 非生产环境降级放行便于本地开发
}

// ========== 认证接口 ==========

// POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!(await checkLoginRateLimit(req.ip))) {
      return res.status(429).json({ success: false, code: 'ADMIN_RATE_LIMITED', message: '登录尝试过于频繁，请稍后再试' });
    }
    const conn = await db.get();
    try {
      const [rows] = await conn.query('SELECT * FROM admins WHERE username = ?', [username]);
      if (!rows.length) {
        const defaultHash = ADMIN_PASSWORD_HASH || '';
        if (defaultHash) {
          const valid = await bcrypt.compare(password, defaultHash);
          if (!valid) return res.status(401).json({ success: false, code: 'ADMIN_AUTH_FAILED', message: '用户名或密码错误' });
        } else if (process.env.NODE_ENV !== 'production' && process.env.ADMIN_FALLBACK_TOKEN && password === process.env.ADMIN_FALLBACK_TOKEN) {
          // 🔴 v3.4 安全加固：FALLBACK_TOKEN 仅在非生产环境可用，且必须显式配置
          // 生产环境必须通过 ADMIN_PASSWORD_HASH 或预置 DB 管理员账号登录
          console.warn('[admin/login] ⚠️ 使用 FALLBACK_TOKEN 创建管理员账号，请在生产环境前配置 ADMIN_PASSWORD_HASH');
        } else {
          return res.status(401).json({ success: false, code: 'ADMIN_AUTH_FAILED', message: '用户名或密码错误' });
        }
        const hash = await bcrypt.hash(password, 10);
        await conn.query('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [username, hash]);
        const [newRows] = await conn.query('SELECT id FROM admins WHERE username = ?', [username]);
        if (newRows.length) {
          await conn.query('INSERT INTO admin_logs (admin_id, action, ip) VALUES (?, "login", ?)', [newRows[0].id, req.ip]);
        }
        const token = jwt.sign({ id: newRows[0]?.id || null, username, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        return res.json({ success: true, data: { token } });
      }
      const valid = await bcrypt.compare(password, rows[0].password_hash);
      if (!valid) return res.status(401).json({ success: false, code: 'ADMIN_AUTH_FAILED', message: '用户名或密码错误' });
      const token = jwt.sign({ id: rows[0].id, username, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
      await conn.query('UPDATE admins SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?', [req.ip, rows[0].id]);
      await conn.query('INSERT INTO admin_logs (admin_id, action, ip) VALUES (?, "login", ?)', [rows[0].id, req.ip]);
      res.json({ success: true, data: { token } });
    } finally { conn.release(); }
  } catch (err) { res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' }); }
});

// [SEC-FIX] App 端崩溃监控：错误上报必须公开（在管理员鉴权之前），否则普通用户 401 无法上报
// 附内存限流防刷库：每 IP 每分钟最多 10 次
const _errReportBuckets = new Map();
function errReportRateLimit(req, res, next) {
  try {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const b = _errReportBuckets.get(key);
    if (!b || now - b.ts > 60000) {
      _errReportBuckets.set(key, { ts: now, n: 1 });
      return next();
    }
    b.n += 1;
    if (b.n > 10) return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: '上报过于频繁，请稍后再试' });
    return next();
  } catch (e) { return next(); }
}
router.post('/app-error-report', errReportRateLimit, async (req, res) => {
  try {
    const { error_type, error_message, stack_trace, page, user_openid, app_version, device_info, timestamp } = req.body;
    if (!error_type || !error_message) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'error_type 和 error_message 必填' });
    }

    await db.query(
      `INSERT INTO app_error_reports (error_type, error_message, stack_trace, page, user_openid, app_version, device_info, reported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [error_type, error_message, stack_trace || null, page || null, user_openid || null, app_version || null, device_info ? JSON.stringify(device_info) : null]
    );

    res.json({ success: true, message: '错误已上报' });
  } catch (err) {
    console.error('[ADMIN] app-error-report error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '上报失败' });
  }
});

// 以下所有接口需要管理员认证
router.use(verifyAdminToken);

// ============================================================
// 模块一：数据看板 Dashboard
// ============================================================


// GET /api/admin/dashboard/aggregate - Single aggregated call for overview
router.get('/dashboard/aggregate', async (req, res) => {
  try {
    const data = await cache.wrap('stats:aggregate', async () => {
      const [rows] = await db.query(`
        SELECT 'totalUsers' as k, COUNT(*) as v FROM users WHERE is_virtual = 0 OR is_virtual IS NULL
        UNION ALL SELECT 'todayNew', COUNT(*) FROM users WHERE (is_virtual = 0 OR is_virtual IS NULL) AND created_at >= CURDATE() AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        UNION ALL SELECT 'activeToday', COUNT(*) FROM users WHERE last_active_at >= CURDATE() AND (is_virtual = 0 OR is_virtual IS NULL)
        UNION ALL SELECT 'tuiyanToday', COUNT(*) FROM tuiyan_records t INNER JOIN users u ON t.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE (u.is_virtual = 0 OR u.is_virtual IS NULL) AND t.created_at >= CURDATE() AND t.created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        UNION ALL SELECT 'matchToday', COUNT(*) FROM match_records m INNER JOIN users u ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE (u.is_virtual = 0 OR u.is_virtual IS NULL) AND m.created_at >= CURDATE() AND m.created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        UNION ALL SELECT 'vipTotal', COUNT(*) FROM users WHERE (plan_type = 'monthly' OR plan_type = 'yearly') AND (is_virtual = 0 OR is_virtual IS NULL)
        UNION ALL SELECT 'pendingDelete', COUNT(*) FROM pending_deletions WHERE status = 'pending'
        UNION ALL SELECT 'revenueToday', COALESCE(SUM(goods_price),0) FROM vip_orders WHERE created_at >= CURDATE() AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY) AND status = 'completed'
      `);
      const m = {};
      rows.forEach(r => { m[r.k] = r.v; });
      return {
        totalUsers: Number(m.totalUsers) || 0,
        todayNewUsers: Number(m.todayNew) || 0,
        todayActiveUsers: Number(m.activeToday) || 0,
        todayTuiyan: Number(m.tuiyanToday) || 0,
        todayMatches: Number(m.matchToday) || 0,
        totalVip: Number(m.vipTotal) || 0,
        pendingDeletions: Number(m.pendingDelete) || 0,
        todayRevenue: parseFloat(m.revenueToday || 0)
      };
    }, 30);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '聚合查询失败' }); }
});
// GET /api/admin/dashboard/overview
router.get('/dashboard/overview', async (req, res) => {
  try {
    const data = await cache.wrap('stats:overview', async () => {
      const [rows] = await db.query(`
        SELECT 'users' as k, COUNT(*) as v FROM users WHERE is_virtual = 0 OR is_virtual IS NULL
        UNION ALL SELECT 'tuiyan', COUNT(*) FROM tuiyan_records t INNER JOIN users u ON t.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE u.is_virtual = 0 OR u.is_virtual IS NULL
        UNION ALL SELECT 'shares', COUNT(*) FROM share_codes sc INNER JOIN users u ON sc.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE u.is_virtual = 0 OR u.is_virtual IS NULL
        UNION ALL SELECT 'vipOrders', COUNT(*) FROM vip_orders v INNER JOIN users u ON v.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE v.status='completed' AND (u.is_virtual = 0 OR u.is_virtual IS NULL)
        UNION ALL SELECT 'matchRecords', COUNT(*) FROM match_records m INNER JOIN users u ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE u.is_virtual = 0 OR u.is_virtual IS NULL
        UNION ALL SELECT 'events', COUNT(*) FROM events e INNER JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE ${TEST_EVENT_FILTER} AND (u.is_virtual = 0 OR u.is_virtual IS NULL)
        UNION ALL SELECT 'revenue', COALESCE(SUM(CASE WHEN v.status='completed' THEN v.goods_price ELSE 0 END), 0) FROM vip_orders v INNER JOIN users u ON v.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE u.is_virtual = 0 OR u.is_virtual IS NULL
      `);
      const m = {};
      rows.forEach(r => { m[r.k] = r.v; });
      return {
        totalUsers: Number(m.users) || 0,
        totalTuiyan: Number(m.tuiyan) || 0,
        totalShares: Number(m.shares) || 0,
        completedOrders: Number(m.vipOrders) || 0,
        totalMatches: Number(m.matchRecords) || 0,
        totalEvents: Number(m.events) || 0,
        totalRevenue: Number(m.revenue) || 0
      };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/dashboard/trends?type=users&days=7
router.get('/dashboard/trends', async (req, res) => {
  try {
    const type = req.query.type || 'users';
    // 🔴 v3.4 安全修复：days 参数上限 365，防止递归 CTE 爆炸
    const days = Math.min(parseInt(req.query.days) || 7, 365);
    const cacheKey = `stats:trends:${type}:${days}`;
    const data = await cache.wrap(cacheKey, async () => {
      // 🔴 修复：排除虚拟用户；JOIN users 加 COLLATE 解决字符集冲突
      let sql;
      switch (type) {
        case 'users':
          sql = `WITH RECURSIVE date_series AS (
            SELECT DATE(DATE_SUB(NOW(), INTERVAL ${days} DAY)) as d
            UNION ALL SELECT DATE(d + INTERVAL 1 DAY) FROM date_series WHERE d < DATE(NOW())
          )
          SELECT DATE_FORMAT(ds.d, '%Y-%m-%d') as date, COALESCE(COUNT(t.created_at), 0) as cnt
          FROM date_series ds
          LEFT JOIN users t ON t.created_at >= ds.d AND t.created_at < DATE_ADD(ds.d, INTERVAL 1 DAY) AND (t.is_virtual = 0 OR t.is_virtual IS NULL)
          GROUP BY ds.d ORDER BY ds.d`;
          break;
        case 'tuiyan':
          sql = `WITH RECURSIVE date_series AS (
            SELECT DATE(DATE_SUB(NOW(), INTERVAL ${days} DAY)) as d
            UNION ALL SELECT DATE(d + INTERVAL 1 DAY) FROM date_series WHERE d < DATE(NOW())
          )
          SELECT DATE_FORMAT(ds.d, '%Y-%m-%d') as date, COALESCE(COUNT(t.created_at), 0) as cnt
          FROM date_series ds
          LEFT JOIN tuiyan_records t ON t.created_at >= ds.d AND t.created_at < DATE_ADD(ds.d, INTERVAL 1 DAY)
            AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = t.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
          GROUP BY ds.d ORDER BY ds.d`;
          break;
        case 'orders':
          sql = `WITH RECURSIVE date_series AS (
            SELECT DATE(DATE_SUB(NOW(), INTERVAL ${days} DAY)) as d
            UNION ALL SELECT DATE(d + INTERVAL 1 DAY) FROM date_series WHERE d < DATE(NOW())
          )
          SELECT DATE_FORMAT(ds.d, '%Y-%m-%d') as date, COALESCE(COUNT(t.created_at), 0) as cnt
          FROM date_series ds
          LEFT JOIN vip_orders t ON t.status = 'completed' AND t.created_at >= ds.d AND t.created_at < DATE_ADD(ds.d, INTERVAL 1 DAY)
            AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = t.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
          GROUP BY ds.d ORDER BY ds.d`;
          break;
        case 'events':
          sql = `WITH RECURSIVE date_series AS (
            SELECT DATE(DATE_SUB(NOW(), INTERVAL ${days} DAY)) as d
            UNION ALL SELECT DATE(d + INTERVAL 1 DAY) FROM date_series WHERE d < DATE(NOW())
          )
          SELECT DATE_FORMAT(ds.d, '%Y-%m-%d') as date, COALESCE(COUNT(t.created_at), 0) as cnt
          FROM date_series ds
          LEFT JOIN events t ON ${TEST_EVENT_FILTER} AND t.created_at >= ds.d AND t.created_at < DATE_ADD(ds.d, INTERVAL 1 DAY)
            AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = t.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
          GROUP BY ds.d ORDER BY ds.d`;
          break;
        case 'matches':
          sql = `WITH RECURSIVE date_series AS (
            SELECT DATE(DATE_SUB(NOW(), INTERVAL ${days} DAY)) as d
            UNION ALL SELECT DATE(d + INTERVAL 1 DAY) FROM date_series WHERE d < DATE(NOW())
          )
          SELECT DATE_FORMAT(ds.d, '%Y-%m-%d') as date, COALESCE(COUNT(t.created_at), 0) as cnt
          FROM date_series ds
          LEFT JOIN match_records t ON t.created_at >= ds.d AND t.created_at < DATE_ADD(ds.d, INTERVAL 1 DAY)
            AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = t.user_a_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
          GROUP BY ds.d ORDER BY ds.d`;
          break;
        case 'revenue':
          sql = `WITH RECURSIVE date_series AS (
            SELECT DATE(DATE_SUB(NOW(), INTERVAL ${days} DAY)) as d
            UNION ALL SELECT DATE(d + INTERVAL 1 DAY) FROM date_series WHERE d < DATE(NOW())
          )
          SELECT DATE_FORMAT(ds.d, '%Y-%m-%d') as date, COALESCE(SUM(CASE WHEN t.status='completed' THEN t.goods_price ELSE 0 END), 0) as cnt
          FROM date_series ds
          LEFT JOIN vip_orders t ON t.created_at >= ds.d AND t.created_at < DATE_ADD(ds.d, INTERVAL 1 DAY)
            AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = t.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
          GROUP BY ds.d ORDER BY ds.d`;
          break;
        default:
          sql = `WITH RECURSIVE date_series AS (
            SELECT DATE(DATE_SUB(NOW(), INTERVAL ${days} DAY)) as d
            UNION ALL SELECT DATE(d + INTERVAL 1 DAY) FROM date_series WHERE d < DATE(NOW())
          )
          SELECT DATE_FORMAT(ds.d, '%Y-%m-%d') as date, COALESCE(COUNT(t.created_at), 0) as cnt
          FROM date_series ds
          LEFT JOIN users t ON t.created_at >= ds.d AND t.created_at < DATE_ADD(ds.d, INTERVAL 1 DAY) AND (t.is_virtual = 0 OR t.is_virtual IS NULL)
          GROUP BY ds.d ORDER BY ds.d`;
      }
      const [rows] = await db.query(sql);
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/tuiyan/question-distribution - 推演问题类型真实分布（关键词分类）
router.get('/tuiyan/question-distribution', async (req, res) => {
  try {
    // 🔴 v3.4 安全修复：days 参数上限 365，防止递归 CTE 爆炸
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const cacheKey = `stats:tuiyan-q-dist:${days}`;
    const data = await cache.wrap(cacheKey, async () => {
      // 基于question字段做关键词匹配分类（中文关键词）
      const [rows] = await db.query(`
        SELECT
          CASE
            WHEN question REGEXP '工作|职业|事业|升职|跳槽|面试|创业|公司|老板|同事|上班|离职|就业' THEN '事业'
            WHEN question REGEXP '恋爱|爱情|感情|分手|复合|结婚|婚姻|对象|桃花|相亲|喜欢|暗恋|前任|复合|脱单' THEN '感情'
            WHEN question REGEXP '钱|财|收入|投资|理财|股票|基金|财运|亏本|赚钱|破财|债务|房价|车贷' THEN '财运'
            WHEN question REGEXP '病|健康|身体|医院|手术|疾病|康复|体检|症状|难受|不舒服' THEN '健康'
            WHEN question REGEXP '考|学|考研|高考|考试|成绩|升学|论文|毕业|留学|学业|复习' THEN '学业'
            ELSE '其他'
          END as category,
          COUNT(*) as cnt
        FROM tuiyan_records t
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          AND question IS NOT NULL AND question != ''
          AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = t.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
        GROUP BY category
        ORDER BY cnt DESC
      `, [days]);
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { console.error('[ADMIN] tuiyan question-distribution error:', err.message); res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/dashboard/retention
router.get('/dashboard/retention', async (req, res) => {
  try {
    const data = await cache.wrap('stats:retention', async () => {
      // v15.14 修复：改用 last_active_at 字段（不再依赖 events 表）
      // DAU: 今日活跃用户
      const [dauToday] = await db.query(`
        SELECT COUNT(*) as cnt FROM users
        WHERE last_active_at >= CURDATE() AND (is_virtual = 0 OR is_virtual IS NULL)
      `);
      // 昨日活跃（用于计算变化率）
      const [dauYesterday] = await db.query(`
        SELECT COUNT(*) as cnt FROM users
        WHERE last_active_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        AND last_active_at < CURDATE() AND (is_virtual = 0 OR is_virtual IS NULL)
      `);
      // WAU: 7日活跃用户
      const [wau] = await db.query(`
        SELECT COUNT(*) as cnt FROM users
        WHERE last_active_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND (is_virtual = 0 OR is_virtual IS NULL)
      `);
      // 上周活跃（用于计算变化率）
      const [wauLastWeek] = await db.query(`
        SELECT COUNT(*) as cnt FROM users
        WHERE last_active_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        AND last_active_at < DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND (is_virtual = 0 OR is_virtual IS NULL)
      `);
      // MAU: 30日活跃用户
      const [mau] = await db.query(`
        SELECT COUNT(*) as cnt FROM users
        WHERE last_active_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND (is_virtual = 0 OR is_virtual IS NULL)
      `);
      // 上月活跃（用于计算变化率）
      const [mauLastMonth] = await db.query(`
        SELECT COUNT(*) as cnt FROM users
        WHERE last_active_at >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
        AND last_active_at < DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND (is_virtual = 0 OR is_virtual IS NULL)
      `);
      // 总注册用户数（用于计算占比）
      const [totalUsers] = await db.query("SELECT COUNT(*) as cnt FROM users WHERE (is_virtual = 0 OR is_virtual IS NULL)");
      const total = totalUsers[0].cnt || 1;
      
      const dauCount = dauToday[0].cnt;
      const wauCount = wau[0].cnt;
      const mauCount = mau[0].cnt;
      
      return {
        dau: {
          count: dauCount,
          rate: parseFloat((dauCount / total * 100).toFixed(1)),
          change: dauYesterday[0].cnt > 0 ? parseFloat(((dauCount - dauYesterday[0].cnt) / dauYesterday[0].cnt * 100).toFixed(1)) : 0
        },
        wau: {
          count: wauCount,
          rate: parseFloat((wauCount / total * 100).toFixed(1)),
          change: wauLastWeek[0].cnt > 0 ? parseFloat(((wauCount - wauLastWeek[0].cnt) / wauLastWeek[0].cnt * 100).toFixed(1)) : 0
        },
        mau: {
          count: mauCount,
          rate: parseFloat((mauCount / total * 100).toFixed(1)),
          change: mauLastMonth[0].cnt > 0 ? parseFloat(((mauCount - mauLastMonth[0].cnt) / mauLastMonth[0].cnt * 100).toFixed(1)) : 0
        },
        // 保留 D1/D3/D7 留存数据（向后兼容）
        d1: { retained: 0, new: 0, rate: 0 },
        d3: { retained: 0, new: 0, rate: 0 },
        d7: { retained: 0, new: 0, rate: 0 }
      };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/dashboard/revenue
router.get('/dashboard/revenue', async (req, res) => {
  try {
    const data = await cache.wrap('stats:revenue', async () => {
      // 动态按 product_id 聚合，避免硬编码 vip_monthly/vip_yearly
      const [products] = await db.query("SELECT product_id, COUNT(*) as cnt, COALESCE(SUM(goods_price),0) as revenue FROM vip_orders WHERE status = 'completed' GROUP BY product_id");
      const [pending] = await db.query("SELECT COUNT(*) as cnt FROM vip_orders WHERE status='pending'");
      // 累计所有产品的总收入
      let totalRevenue = 0;
      const productMap = {};
      for (const p of products) {
        const rev = parseFloat(p.revenue) || 0;
        totalRevenue += rev;
        productMap[p.product_id] = { revenue: rev, orders: p.cnt };
      }
      // 兼容旧字段：monthly/yearly 从动态结果中取，缺失则为 0
      const monthly = productMap['vip_monthly'] || { revenue: 0, orders: 0 };
      const yearly = productMap['vip_yearly'] || { revenue: 0, orders: 0 };
      return {
        monthlyRevenue: monthly.revenue,
        monthlyOrders: monthly.orders,
        yearlyRevenue: yearly.revenue,
        yearlyOrders: yearly.orders,
        totalRevenue,
        pendingOrders: pending[0].cnt,
        products: products.map(p => ({ product_id: p.product_id, revenue: parseFloat(p.revenue) || 0, orders: p.cnt }))
      };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/dashboard/recent-activity?limit=20
router.get('/dashboard/recent-activity', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    // 🔴 修复：排除虚拟用户；JOIN 加 COLLATE
    const [users] = await db.query('SELECT nickname, created_at, plan_type FROM users WHERE (is_virtual = 0 OR is_virtual IS NULL) ORDER BY created_at DESC LIMIT ?', [limit]);
    const [tuiyan] = await db.query('SELECT r.openid, u.nickname, r.question, r.created_at FROM tuiyan_records r INNER JOIN users u ON r.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE (u.is_virtual = 0 OR u.is_virtual IS NULL) ORDER BY r.created_at DESC LIMIT ?', [limit]);
    const [orders] = await db.query('SELECT v.openid, u.nickname, v.product_id, v.status, v.created_at FROM vip_orders v INNER JOIN users u ON v.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE (u.is_virtual = 0 OR u.is_virtual IS NULL) ORDER BY v.created_at DESC LIMIT ?', [limit]);
    res.json({ success: true, data: { users, tuiyan, orders } });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/dashboard/gua-distribution
router.get('/dashboard/gua-distribution', async (req, res) => {
  try {
    const data = await cache.wrap('stats:gua-dist', async () => {
      const [rows] = await db.query(`
        SELECT u.ming_ben_gua, h.name, h.symbol, COUNT(*) as cnt
        FROM users u LEFT JOIN hexagrams h ON u.ming_ben_gua = h.id
        WHERE u.ming_ben_gua IS NOT NULL AND (u.is_virtual = 0 OR u.is_virtual IS NULL)
        GROUP BY u.ming_ben_gua, h.name, h.symbol
        ORDER BY cnt DESC
      `);
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/dashboard/plan-distribution
router.get('/dashboard/plan-distribution', async (req, res) => {
  try {
    const data = await cache.wrap('stats:plan-dist', async () => {
      const [rows] = await db.query(`
        SELECT plan_type, COUNT(*) as cnt,
          ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM users WHERE (is_virtual = 0 OR is_virtual IS NULL)), 0), 1) as percentage
        FROM users WHERE (is_virtual = 0 OR is_virtual IS NULL) GROUP BY plan_type ORDER BY cnt DESC
      `);
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/dashboard/hourly-activity
router.get('/dashboard/hourly-activity', async (req, res) => {
  try {
    const data = await cache.wrap('stats:hourly', async () => {
      const [rows] = await db.query(`
        SELECT HOUR(e.created_at) as hour, COUNT(*) as cnt
        FROM events e INNER JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci
        WHERE ${TEST_EVENT_FILTER}
        AND (u.is_virtual = 0 OR u.is_virtual IS NULL)
        AND e.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY hour ORDER BY hour
      `);
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/dashboard/source-analysis
router.get('/dashboard/source-analysis', async (req, res) => {
  try {
    const data = await cache.wrap('stats:sources', async () => {
      const [rows] = await db.query(`
        SELECT e.page, COUNT(*) as cnt
        FROM events e INNER JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci
        WHERE ${TEST_EVENT_FILTER} AND (u.is_virtual = 0 OR u.is_virtual IS NULL) AND e.page IS NOT NULL AND e.page != ''
        GROUP BY e.page ORDER BY cnt DESC LIMIT 20
      `);
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/dashboard/kpi-comparison
router.get('/dashboard/kpi-comparison', async (req, res) => {
  try {
    const data = await cache.wrap('stats:kpi', async () => {
      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthEnd = new Date(thisMonthStart);
      lastMonthEnd.setDate(0);
      const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
      const [thisMonth] = await db.query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE created_at >= ? AND (is_virtual = 0 OR is_virtual IS NULL)) as newUsers,
          (SELECT COUNT(*) FROM tuiyan_records t WHERE t.created_at >= ? AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = t.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) as newTuiyan,
          (SELECT COUNT(*) FROM vip_orders v WHERE v.created_at >= ? AND v.status='completed' AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = v.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) as completedOrders,
          (SELECT COALESCE(SUM(v.goods_price),0) FROM vip_orders v WHERE v.created_at >= ? AND v.status='completed' AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = v.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) as revenue
      `, [thisMonthStart, thisMonthStart, thisMonthStart, thisMonthStart]);
      const [lastMonth] = await db.query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE created_at >= ? AND created_at < ? AND (is_virtual = 0 OR is_virtual IS NULL)) as newUsers,
          (SELECT COUNT(*) FROM tuiyan_records t WHERE t.created_at >= ? AND t.created_at < ? AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = t.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) as newTuiyan,
          (SELECT COUNT(*) FROM vip_orders v WHERE v.created_at >= ? AND v.created_at < ? AND v.status='completed' AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = v.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) as completedOrders,
          (SELECT COALESCE(SUM(v.goods_price),0) FROM vip_orders v WHERE v.created_at >= ? AND v.created_at < ? AND v.status='completed' AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = v.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) as revenue
      `, [lastMonthStart, thisMonthStart, lastMonthStart, thisMonthStart, lastMonthStart, thisMonthStart, lastMonthStart, thisMonthStart]);
      return { thisMonth: thisMonth[0], lastMonth: lastMonth[0] };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// ============================================================
// 模块二：用户管理 User Management
// ============================================================

// GET /api/admin/users?page=1&pageSize=20&keyword=&planType=&hasProfile=&userType=&sort=&order=
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;
    const keyword = req.query.keyword || '';
    const planType = req.query.planType || '';
    const hasProfile = req.query.hasProfile;
    const userType = req.query.userType || '';
    const sort = req.query.sort || '';
    const order = req.query.order || 'desc';
    let where = '(is_virtual = 0 OR is_virtual IS NULL)';
    const params = [];
    if (keyword) { where += ' AND (nickname LIKE ? OR openid LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
    if (planType) { where += ' AND plan_type = ?'; params.push(planType); }
    if (hasProfile !== undefined) { where += ' AND has_profile = ?'; params.push(parseInt(hasProfile)); }
    if (userType === 'vip') { where += " AND (plan_type = 'monthly' OR plan_type = 'yearly')"; }
    else if (userType === 'free') { where += " AND plan_type = 'free'"; }
    else if (userType === 'profiled') { where += ' AND has_profile = 1'; }
    else if (userType === 'guest') { where += ' AND has_profile = 0'; }
    const allowedSorts = ['created_at', 'updated_at', 'last_active', 'tuiyan_count', 'match_count', 'quota_remaining', 'expire_time', 'points'];
    // v3.4 硬约束：用户列表默认按最后活跃时间倒序，优先展示最近登录用户
    let orderBy = 'ORDER BY last_active DESC';
    if (sort && allowedSorts.includes(sort)) {
      const orderDir = order === 'asc' ? 'ASC' : 'DESC';
      if (sort === 'tuiyan_count') orderBy = `ORDER BY tuiyan_count ${orderDir}`;
      else if (sort === 'match_count') orderBy = `ORDER BY match_count ${orderDir}`;
      else if (sort === 'last_active') orderBy = `ORDER BY last_active ${orderDir}`;
      else if (sort === 'points') orderBy = `ORDER BY u.points ${orderDir}`;
      else orderBy = `ORDER BY u.${sort} ${orderDir}`;
    }
    const [rows] = await db.query(
      `SELECT u.id, u.openid, u.nickname, u.phone, u.unionid, u.birth_year, u.birth_month, u.birth_day, u.gender, u.ming_ben_gua, u.plan_type, u.quota_remaining, u.has_profile, u.expire_time, u.created_at, u.updated_at, u.status, u.last_login_ip, u.city, u.last_active_at,
        u.points, u.total_points, u.checkin_streak, u.checkin_total, u.last_checkin_date,
        COALESCE((SELECT COUNT(*) FROM tuiyan_records WHERE openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci), 0) as tuiyan_count,
        COALESCE((SELECT COUNT(*) FROM tuiyan_records WHERE openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci AND is_vip_decode=1), 0) as vip_tuiyan_count,
        COALESCE((SELECT COUNT(*) FROM match_records WHERE user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci OR user_b_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci), 0) as match_count,
        COALESCE((SELECT COUNT(*) FROM share_codes WHERE openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci), 0) as share_count,
        COALESCE((SELECT MAX(e.created_at) FROM events e WHERE e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci AND ${TEST_EVENT_FILTER}), u.updated_at) as last_active
      FROM users u
      WHERE ${where} ${orderBy} LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [total] = await db.query(`SELECT COUNT(*) as cnt FROM users WHERE ${where}`, params);
    res.json({ success: true, data: { list: rows, total: total[0].cnt, page, pageSize } });
  } catch (err) { console.error('[admin/users]', err); res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});


// GET /api/admin/users/export - Export users as CSV
router.get('/users/export', async (req, res) => {
  try {
    const keyword = req.query.keyword || '';
    const planType = req.query.planType || '';
    const userType = req.query.userType || '';
    let where = '(is_virtual = 0 OR is_virtual IS NULL)'; // v1.3 排除虚拟用户
    const params = [];
    if (keyword) { where += ' AND (nickname LIKE ? OR openid LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
    if (planType) { where += ' AND plan_type = ?'; params.push(planType); }
    if (userType === 'vip') { where += " AND (plan_type = 'monthly' OR plan_type = 'yearly')"; }
    else if (userType === 'free') { where += " AND plan_type = 'free'"; }
    else if (userType === 'profiled') { where += ' AND has_profile = 1'; }
    else if (userType === 'guest') { where += ' AND has_profile = 0'; }

    const [rows] = await db.query(
      `SELECT u.openid, u.nickname, u.plan_type, u.has_profile, u.gender, u.created_at, u.updated_at,
        COALESCE((SELECT COUNT(*) FROM tuiyan_records WHERE openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci), 0) as tuiyan_count,
        COALESCE((SELECT COUNT(*) FROM match_records WHERE user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci OR user_b_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci), 0) as match_count
      FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT 5000`,
      params
    );
    // CSV format
    const BOM = '\uFEFF';
    const header = 'OpenID,昵称,用户类型,性别,已建档,推演次数,匹配次数,注册时间,最后活跃';
    const lines = rows.map(r => [
      r.openid, r.nickname || '未建档', (r.plan_type === 'monthly' || r.plan_type === 'yearly') ? 'VIP' : '免费',
      r.gender === 1 ? '男' : r.gender === 2 ? '女' : '-', r.has_profile ? '是' : '否',
      r.tuiyan_count, r.match_count, r.created_at?.toISOString().slice(0,19) || '', r.updated_at?.toISOString().slice(0,19) || ''
    ].map(v => `"${v}"`).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=users_${Date.now()}.csv`);
    res.send(BOM + header + '\n' + lines.join('\n'));
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '导出失败' }); }
});
// GET /api/admin/users/stats
router.get('/users/stats', async (req, res) => {
  try {
    const data = await cache.wrap('stats:users', async () => {
      // 🔴 修复：所有统计排除虚拟用户
      const [total] = await db.query('SELECT COUNT(*) as cnt FROM users WHERE (is_virtual = 0 OR is_virtual IS NULL)');
      const [withProfile] = await db.query('SELECT COUNT(*) as cnt FROM users WHERE has_profile = 1 AND (is_virtual = 0 OR is_virtual IS NULL)');
      const [free] = await db.query("SELECT COUNT(*) as cnt FROM users WHERE plan_type = 'free' AND (is_virtual = 0 OR is_virtual IS NULL)");
      const [monthly] = await db.query("SELECT COUNT(*) as cnt FROM users WHERE plan_type = 'monthly' AND (is_virtual = 0 OR is_virtual IS NULL)");
      const [yearly] = await db.query("SELECT COUNT(*) as cnt FROM users WHERE plan_type = 'yearly' AND (is_virtual = 0 OR is_virtual IS NULL)");
      const [expired] = await db.query("SELECT COUNT(*) as cnt FROM users WHERE (plan_type = 'monthly' OR plan_type = 'yearly') AND expire_time IS NOT NULL AND expire_time < NOW() AND (is_virtual = 0 OR is_virtual IS NULL)");
      const [avgTuiyan] = await db.query('SELECT AVG(cnt) as avg_cnt FROM (SELECT COUNT(*) as cnt FROM tuiyan_records t INNER JOIN users u ON t.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE (u.is_virtual = 0 OR u.is_virtual IS NULL) GROUP BY t.openid) t');
      return {
        total: total[0].cnt,
        withProfile: withProfile[0].cnt,
        withoutProfile: total[0].cnt - withProfile[0].cnt,
        free: free[0].cnt,
        monthly: monthly[0].cnt,
        yearly: yearly[0].cnt,
        expired: expired[0].cnt,
        avgTuiyanPerUser: avgTuiyan[0].avg_cnt ? parseFloat(parseFloat(avgTuiyan[0].avg_cnt).toFixed(1)) : 0
      };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/users/top-active (必须在 /:openid 之前！)
router.get('/users/top-active', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const data = await cache.wrap(`stats:top-active:${limit}`, async () => {
      // 🔴 修复：原SQL使用LEFT JOIN tuiyan_records + LEFT JOIN match_records产生笛卡尔积，
      // 导致COUNT(t.id)和COUNT(m.id)被放大为 tuiyan_count * match_count。
      // 改用子查询避免笛卡尔积，与用户列表/users的COALESCE子查询方式保持一致。
      const [rows] = await db.query(`
        SELECT u.openid, u.nickname, u.plan_type,
          COALESCE((SELECT COUNT(*) FROM tuiyan_records WHERE openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci), 0) AS tuiyan_count,
          COALESCE((SELECT COUNT(*) FROM match_records WHERE user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci OR user_b_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci), 0) AS match_count
        FROM users u
        WHERE (u.is_virtual = 0 OR u.is_virtual IS NULL)
        ORDER BY (tuiyan_count + match_count) DESC
        LIMIT ?
      `, [limit]);
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/users/new-users?days=7 (必须在 /:openid 之前！)
router.get('/users/new-users', async (req, res) => {
  try {
    // 🔴 v3.4 安全修复：days 参数上限 365，防止递归 CTE 爆炸
    const days = Math.min(parseInt(req.query.days) || 7, 365);
    const [rows] = await db.query(
      'SELECT id, openid, nickname, plan_type, created_at FROM users WHERE (is_virtual = 0 OR is_virtual IS NULL) AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY created_at DESC',
      [days]
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/users/:openid
router.get('/users/:openid', resolveAdminOpenid, async (req, res) => {
  try {
    const openid = req.params.openid;
    const [users] = await db.query('SELECT * FROM users WHERE openid = ?', [openid]);
    if (!users.length) return res.status(404).json({ success: false, code: 'USER_NOT_FOUND' });
    const [tuiyan] = await db.query('SELECT id, question, created_at, is_vip_decode FROM tuiyan_records WHERE openid = ? ORDER BY created_at DESC LIMIT 20', [openid]);
    const [matches] = await db.query('SELECT * FROM match_records WHERE user_a_openid COLLATE utf8mb4_unicode_ci = ? OR user_b_openid COLLATE utf8mb4_unicode_ci = ? ORDER BY created_at DESC LIMIT 20', [openid, openid]);
    const [subs] = await db.query('SELECT * FROM subscriptions WHERE openid = ? ORDER BY created_at DESC', [openid]);
    const [orders] = await db.query('SELECT * FROM vip_orders WHERE openid = ? ORDER BY created_at DESC', [openid]);
    const [events] = await db.query(`SELECT event_type, page, created_at FROM events WHERE openid = ? AND ${TEST_EVENT_FILTER} ORDER BY created_at DESC LIMIT 50`, [openid]);

    // [增强] 用户行为统计
    const [tuiyanStats] = await db.query(
      `SELECT COUNT(*) as total,
        COUNT(CASE WHEN is_vip_decode=1 THEN 1 END) as vip_count,
        COUNT(CASE WHEN is_vip_decode=0 OR is_vip_decode IS NULL THEN 1 END) as free_count,
        MIN(created_at) as first_at, MAX(created_at) as last_at
      FROM tuiyan_records WHERE openid = ?`, [openid]);
    const [matchStats] = await db.query(
      `SELECT COUNT(*) as total,
        MIN(created_at) as first_at, MAX(created_at) as last_at
      FROM match_records WHERE user_a_openid COLLATE utf8mb4_unicode_ci = ? OR user_b_openid COLLATE utf8mb4_unicode_ci = ?`, [openid, openid]);
    const [shareStats] = await db.query(
      `SELECT COUNT(*) as total,
        COALESCE(SUM(use_count),0) as total_uses,
        MIN(created_at) as first_at, MAX(created_at) as last_at
      FROM share_codes WHERE openid = ?`, [openid]);
    const [orderStats] = await db.query(
      `SELECT COUNT(*) as total,
        COUNT(CASE WHEN status='completed' THEN 1 END) as completed,
        COALESCE(SUM(CASE WHEN status='completed' THEN goods_price ELSE 0 END),0) as total_spent
      FROM vip_orders WHERE openid = ?`, [openid]);
    // 最近活跃时间（从events表获取）
    const [lastActive] = await db.query(
      `SELECT MAX(created_at) as last_active_at FROM events WHERE openid = ? AND ${TEST_EVENT_FILTER}`, [openid]);
    // 按天推演分布（最近30天）
    const [tuiyanDaily] = await db.query(
      `SELECT DATE(created_at) as date, COUNT(*) as cnt
      FROM tuiyan_records WHERE openid = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY date ORDER BY date`, [openid]);
    // 按天匹配分布（最近30天）
    const [matchDaily] = await db.query(
      `SELECT DATE(created_at) as date, COUNT(*) as cnt
      FROM match_records WHERE (user_a_openid COLLATE utf8mb4_unicode_ci = ? OR user_b_openid COLLATE utf8mb4_unicode_ci = ?) AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY date ORDER BY date`, [openid, openid]);

    const usageStats = {
      tuiyan: { ...tuiyanStats[0], daily: tuiyanDaily },
      match: { ...matchStats[0], daily: matchDaily },
      share: shareStats[0],
      order: { ...orderStats[0], total_spent_yuan: parseFloat((orderStats[0].total_spent / 100).toFixed(2)) },
      last_active_at: lastActive[0]?.last_active_at || null
    };

    res.json({ success: true, data: { user: users[0], tuiyan, matches, subscriptions: subs, orders, recentEvents: events, usageStats } });
  } catch (err) { console.error('[ADMIN] users/:openid error:', err.message); res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/users/:openid/records
router.get('/users/:openid/records', resolveAdminOpenid, async (req, res) => {
  try {
    const openid = req.params.openid;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;
    const [rows] = await db.query(
      'SELECT id, question, is_vip_decode, created_at FROM tuiyan_records WHERE openid = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [openid, pageSize, offset]
    );
    const [countResult] = await db.query('SELECT COUNT(*) as total FROM tuiyan_records WHERE openid = ?', [openid]);
    res.json({ success: true, data: { list: rows, total: countResult[0].total, page, pageSize } });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '查询推演记录失败' }); }
});

// GET /api/admin/users/:openid/points - 用户积分流水（v17.0）
router.get('/users/:openid/points', resolveAdminOpenid, async (req, res) => {
  try {
    const openid = req.params.openid;
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;
    const [rows] = await db.query(
      'SELECT id, type, amount, balance_after, remark, created_at FROM points_transactions WHERE openid = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
      [openid, pageSize, offset]
    );
    const [countResult] = await db.query('SELECT COUNT(*) as total FROM points_transactions WHERE openid = ?', [openid]);
    const [userRow] = await db.query('SELECT points, total_points, checkin_streak, checkin_total, last_checkin_date FROM users WHERE openid = ?', [openid]);
    res.json({
      success: true,
      data: {
        list: rows, total: countResult[0].total, page, pageSize,
        summary: userRow.length ? userRow[0] : null
      }
    });
  } catch (err) { console.error('[admin/users/points]', err); res.status(500).json({ success: false, code: 'DB_ERROR', message: '查询积分流水失败' }); }
});

// GET /api/admin/users/:openid/matches
router.get('/users/:openid/matches', resolveAdminOpenid, async (req, res) => {
  try {
    const openid = req.params.openid;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;
    const [rows] = await db.query(
      `SELECT m.id, m.user_a_openid, m.user_b_openid, m.gua_a, m.gua_b, m.match_score, m.relationship_name, m.match_level, m.created_at,
       ua.nickname as user_a_name, ub.nickname as user_b_name
       FROM match_records m
       LEFT JOIN users ua ON m.user_a_openid COLLATE utf8mb4_unicode_ci = ua.openid COLLATE utf8mb4_unicode_ci
       LEFT JOIN users ub ON m.user_b_openid COLLATE utf8mb4_unicode_ci = ub.openid COLLATE utf8mb4_unicode_ci
       WHERE m.user_a_openid = ? OR m.user_b_openid = ? ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      [openid, openid, pageSize, offset]
    );
    const [countResult] = await db.query('SELECT COUNT(*) as total FROM match_records WHERE user_a_openid = ? OR user_b_openid = ?', [openid, openid]);
    res.json({ success: true, data: { list: rows, total: countResult[0].total, page, pageSize } });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '查询匹配记录失败' }); }
});

// GET /api/admin/users/:openid/logs
router.get('/users/:openid/logs', resolveAdminOpenid, async (req, res) => {
  try {
    const openid = req.params.openid;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;
    const [rows] = await db.query(
      'SELECT id, admin_id, action, target, detail, ip, created_at FROM admin_logs WHERE target LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      ['%' + openid + '%', pageSize, offset]
    );
    const [countResult] = await db.query('SELECT COUNT(*) as total FROM admin_logs WHERE target LIKE ?', ['%' + openid + '%']);
    res.json({ success: true, data: { list: rows, total: countResult[0].total, page, pageSize } });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '查询操作日志失败' }); }
});

// PUT /api/admin/users/:openid/quota
router.put('/users/:openid/quota', resolveAdminOpenid, async (req, res) => {
  try {
    const { quota } = req.body;
    if (quota === undefined || quota < 0) return res.status(400).json({ success: false, code: 'INVALID_PARAM' });
    const conn = await db.get();
    try {
      await conn.query('UPDATE users SET quota_remaining = ? WHERE openid = ?', [quota, req.params.openid]);
      await conn.query('INSERT INTO admin_logs (admin_id, action, target, detail) VALUES (?, "quota_reset", ?, ?)',
        [req.admin.id, req.params.openid, JSON.stringify({ quota })]);
      res.json({ success: true });
    } finally { conn.release(); }
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// PUT /api/admin/users/:openid/plan
router.put('/users/:openid/plan', resolveAdminOpenid, async (req, res) => {
  try {
    const { planType, expireTime } = req.body;
    if (!planType || !['free', 'monthly', 'yearly'].includes(planType)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'planType必须是free/monthly/yearly' });
    }
    // 将 ISO 8601 格式转为 MySQL 接受的格式
    const mysqlTime = expireTime ? expireTime.replace('T', ' ').replace(/\.\d+Z$/, '') : null;
    const conn = await db.get();
    try {
      const quota = planType === 'free' ? 3 : 20;
      await conn.query('UPDATE users SET plan_type = ?, quota_remaining = ?, expire_time = ? WHERE openid = ?',
        [planType, quota, mysqlTime, req.params.openid]);
      await conn.query('INSERT INTO subscriptions (openid, plan_type, expire_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE plan_type=VALUES(plan_type), expire_at=VALUES(expire_at), updated_at=NOW()',
        [req.params.openid, planType, mysqlTime]);
      await conn.query('INSERT INTO admin_logs (admin_id, action, target, detail) VALUES (?, "plan_change", ?, ?)',
        [req.admin.id, req.params.openid, JSON.stringify({ planType, expireTime })]);
      await cache.clearStats();
      res.json({ success: true });
    } finally { conn.release(); }
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// PUT /api/admin/users/:openid/vip-decode-reset
router.put('/users/:openid/vip-decode-reset', resolveAdminOpenid, async (req, res) => {
  try {
    const redisService = require('../services/redis');
    await redisService.clearVipDecodeLimit(req.params.openid);
    await db.query('INSERT INTO admin_logs (admin_id, action, target) VALUES (?, "vip_decode_reset", ?)', [req.admin.id, req.params.openid]);
    res.json({ success: true, message: 'VIP推演次数已重置' });
  } catch (err) { res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '重置失败' }); }
});

// GET /api/admin/users/:openid/export
router.get('/users/:openid/export', resolveAdminOpenid, async (req, res) => {
  try {
    const [users] = await db.query('SELECT * FROM users WHERE openid = ?', [req.params.openid]);
    if (!users.length) return res.status(404).json({ success: false, code: 'USER_NOT_FOUND' });
    const [tuiyan] = await db.query('SELECT * FROM tuiyan_records WHERE openid = ?', [req.params.openid]);
    const [matches] = await db.query('SELECT * FROM match_records WHERE user_a_openid = ? OR user_b_openid = ?', [req.params.openid, req.params.openid]);
    const [subs] = await db.query('SELECT * FROM subscriptions WHERE openid = ?', [req.params.openid]);
    const [orders] = await db.query('SELECT * FROM vip_orders WHERE openid = ?', [req.params.openid]);
    const [events] = await db.query(`SELECT * FROM events WHERE openid = ? AND ${TEST_EVENT_FILTER}`, [req.params.openid]);
    res.json({ success: true, data: { user: users[0], tuiyan, matches, subscriptions: subs, orders, events } });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// POST /api/admin/users/batch-update-plan
router.post('/users/batch-update-plan', async (req, res) => {
  try {
    const { openids: rawOpenids, planType, expireTime } = req.body;
    if (!rawOpenids || !Array.isArray(rawOpenids) || rawOpenids.length === 0) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM' });
    }
    if (!planType || !['free', 'monthly', 'yearly'].includes(planType)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM' });
    }
    // 🔴 关键修复：批量操作时逐个反查 openid，避免漏掉旧 openid 的用户
    const openids = await Promise.all(rawOpenids.map(o => resolveOpenidStandalone(o)));
    const mysqlTime = expireTime ? expireTime.replace('T', ' ').replace(/\.\d+Z$/, '') : null;
    const conn = await db.get();
    try {
      await conn.beginTransaction();
      const quota = planType === 'free' ? 3 : 20;
      for (const openid of openids) {
        await conn.query('UPDATE users SET plan_type = ?, quota_remaining = ?, expire_time = ? WHERE openid = ?',
          [planType, quota, mysqlTime, openid]);
      }
      await conn.query('INSERT INTO admin_logs (admin_id, action, target, detail) VALUES (?, "batch_plan_update", "multiple", ?)',
        [req.admin.id, JSON.stringify({ count: openids.length, planType })]);
      await conn.commit();
      res.json({ success: true, message: `已更新 ${openids.length} 个用户` });
    } catch (err) { await conn.rollback(); throw err; }
    finally { conn.release(); }
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// DELETE /api/admin/users/:openid
router.delete('/users/:openid', resolveAdminOpenid, async (req, res) => {
  const conn = await db.get();
  try {
    await conn.beginTransaction();
    // 🔴 关键修复：req.params.openid 可能是用户绑定手机号前的旧 openid
    // 通过 user_bindings 表反查为当前主账号 openid，否则会留下大量残留数据
    const actualOpenid = await resolveOpenid(conn, req.params.openid);
    // 同时查所有关联的 platform_openid（旧微信/设备openid），一并删除残留
    const [bindRows] = await conn.query(
      'SELECT platform_openid FROM user_bindings WHERE unified_openid = ?',
      [actualOpenid]
    );
    const allRelatedOpenids = [actualOpenid, req.params.openid];
    for (const row of bindRows) {
      if (row.platform_openid && row.platform_openid !== actualOpenid) {
        allRelatedOpenids.push(row.platform_openid);
      }
    }
    // 去重
    const openidsToDelete = [...new Set(allRelatedOpenids)];

    for (const oid of openidsToDelete) {
      await conn.query('DELETE FROM tuiyan_records WHERE openid = ?', [oid]);
      await conn.query('DELETE FROM subscriptions WHERE openid = ?', [oid]);
      await conn.query('DELETE FROM events WHERE openid = ?', [oid]);
      await conn.query('DELETE FROM match_records WHERE user_a_openid = ? OR user_b_openid = ?', [oid, oid]);
      await conn.query('DELETE FROM share_codes WHERE openid = ?', [oid]);
      await conn.query('DELETE FROM vip_orders WHERE openid = ?', [oid]);
      await conn.query('DELETE FROM user_gua_collection WHERE openid = ?', [oid]);
      await conn.query('DELETE FROM user_achievements WHERE openid = ?', [oid]);
      await conn.query('DELETE FROM pending_deletions WHERE openid = ?', [oid]);
      await conn.query('DELETE FROM letter_reports WHERE reporter_openid = ? OR target_openid = ?', [oid, oid]);
      await conn.query('DELETE FROM letter_blocks WHERE blocker_openid = ? OR blocked_openid = ?', [oid, oid]);
      await conn.query('DELETE FROM letters WHERE sender_openid = ? OR receiver_openid = ?', [oid, oid]);
      await conn.query('DELETE FROM users WHERE openid = ?', [oid]);
    }
    // 删除 user_bindings 关联记录
    await conn.query('DELETE FROM user_bindings WHERE unified_openid = ? OR platform_openid = ?', [actualOpenid, actualOpenid]);
    await conn.query('INSERT INTO admin_logs (admin_id, action, target) VALUES (?, "user_delete", ?)', [req.admin.id, actualOpenid]);
    await conn.commit();
    res.json({ success: true, message: '用户已删除（含所有关联账号数据）' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  } finally { conn.release(); }
});

// ============================================================
// 模块三：订单管理 Order Management
// ============================================================

// GET /api/admin/orders?page=1&pageSize=20&status=&productType=&openid=
router.get('/orders', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;
    const status = req.query.status || '';
    const productType = req.query.productType || '';
    const rawOpenid = req.query.openid || '';
    // 🔴 关键修复：查询参数 openid 可能是旧值，反查为最新主账号
    const openid = rawOpenid ? await resolveOpenidStandalone(rawOpenid) : '';
    let where = '1=1';
    const params = [];
    if (status) { where += ' AND v.status = ?'; params.push(status); }
    if (productType) { where += ' AND v.product_id = ?'; params.push(productType); }
    if (openid) { where += ' AND v.openid = ?'; params.push(openid); }
    const [rows] = await db.query(
      `SELECT v.*, u.nickname FROM vip_orders v LEFT JOIN users u ON v.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE ${where} ORDER BY v.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [total] = await db.query(`SELECT COUNT(*) as cnt FROM vip_orders v WHERE ${where}`, params);
    res.json({ success: true, data: { list: rows, total: total[0].cnt, page, pageSize } });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/orders/stats
router.get('/orders/stats', async (req, res) => {
  try {
    const data = await cache.wrap('stats:orders', async () => {
      const [rows] = await db.query(`
        SELECT 'total' as k, COUNT(*) as v FROM vip_orders
        UNION ALL SELECT 'pending', COUNT(*) FROM vip_orders WHERE status='pending'
        UNION ALL SELECT 'completed', COUNT(*) FROM vip_orders WHERE status='completed'
        UNION ALL SELECT 'monthly', COUNT(*) FROM vip_orders WHERE product_id='vip_monthly'
        UNION ALL SELECT 'yearly', COUNT(*) FROM vip_orders WHERE product_id='vip_yearly'
        UNION ALL SELECT 'revenue', COALESCE(SUM(goods_price),0) FROM vip_orders WHERE status='completed'
        UNION ALL SELECT 'avgPrice', COALESCE(AVG(goods_price),0) FROM vip_orders WHERE status='completed'
        UNION ALL SELECT 'totalUsers', COUNT(*) FROM users WHERE status != -1 AND (is_virtual = 0 OR is_virtual IS NULL)
        UNION ALL SELECT 'activeUsers', COUNT(DISTINCT e.openid) FROM events e INNER JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE ${TEST_EVENT_FILTER} AND (u.is_virtual = 0 OR u.is_virtual IS NULL) AND e.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        UNION ALL SELECT 'payingUsers', COUNT(DISTINCT openid) FROM vip_orders WHERE status='completed'
        UNION ALL SELECT 'todayRev', COALESCE(SUM(goods_price),0) FROM vip_orders WHERE status='completed' AND created_at >= CURDATE() AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        UNION ALL SELECT 'todayOrd', COUNT(*) FROM vip_orders WHERE status='completed' AND created_at >= CURDATE() AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
      `);
      const m = {};
      rows.forEach(r => { m[r.k] = r.v; });
      // 复杂查询保留独立调用（含子查询/JOIN，无法直接合并进UNION ALL）
      const [repurchase] = await db.query("SELECT COALESCE(SUM(CASE WHEN order_count >= 2 THEN 1 ELSE 0 END), 0) as repeat_users, COUNT(*) as total_paying_users FROM (SELECT openid, COUNT(*) as order_count FROM vip_orders WHERE status='completed' GROUP BY openid) t");
      const [payCycle] = await db.query("SELECT AVG(DATEDIFF(v.created_at, u.created_at)) as avg_days FROM vip_orders v JOIN users u ON v.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE v.status='completed' AND v.created_at = (SELECT MIN(v2.created_at) FROM vip_orders v2 WHERE v2.openid = v.openid AND v2.status='completed')");
      return {
        total: m.total,
        pending: m.pending,
        completed: m.completed,
        monthly: m.monthly,
        yearly: m.yearly,
        totalRevenue: m.revenue,
        avgOrderPrice: m.avgPrice,
        conversionRate: m.total > 0 ? parseFloat((m.completed / m.total * 100).toFixed(1)) : 0,
        arpu: m.totalUsers > 0 ? Number((m.revenue / m.totalUsers).toFixed(2)) : 0,
        arpau: m.activeUsers > 0 ? Number((m.revenue / m.activeUsers).toFixed(2)) : 0,
        paidConversionCycle: payCycle[0].avg_days !== null ? Number(Number(payCycle[0].avg_days).toFixed(1)) : null,
        repurchaseRate: repurchase[0].total_paying_users > 0 ? parseFloat((repurchase[0].repeat_users / repurchase[0].total_paying_users * 100).toFixed(1)) : '0.0',
        payingUserCount: m.payingUsers,
        todayRevenue: m.todayRev,
        todayOrders: m.todayOrd
      };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/orders/revenue-trend (必须在 /:outTradeNo 之前！)
router.get('/orders/revenue-trend', async (req, res) => {
  try {
    // 🔴 v3.4 安全修复：days 参数上限 365，防止递归 CTE 爆炸
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const data = await cache.wrap(`stats:revenue-trend:${days}`, async () => {
      const [rows] = await db.query(
        `WITH RECURSIVE date_series AS (
          SELECT DATE(DATE_SUB(NOW(), INTERVAL ? DAY)) as d
          UNION ALL SELECT DATE(d + INTERVAL 1 DAY) FROM date_series WHERE d < DATE(NOW())
        )
        SELECT DATE_FORMAT(ds.d, '%Y-%m-%d') as date,
          COALESCE(SUM(CASE WHEN t.status='completed' THEN t.goods_price ELSE 0 END), 0) as revenue,
          COALESCE(COUNT(t.created_at), 0) as orders
        FROM date_series ds
        LEFT JOIN vip_orders t ON t.created_at >= ds.d AND t.created_at < DATE_ADD(ds.d, INTERVAL 1 DAY)
        GROUP BY ds.d ORDER BY ds.d`,
        [days]
      );
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/orders/product-analysis (必须在 /:outTradeNo 之前！)
router.get('/orders/product-analysis', async (req, res) => {
  try {
    const data = await cache.wrap('stats:product-analysis', async () => {
      const [rows] = await db.query(
        `SELECT product_id, COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status='completed' THEN goods_price ELSE 0 END) as revenue FROM vip_orders GROUP BY product_id`
      );
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/orders/top-buyers (必须在 /:outTradeNo 之前！)
router.get('/orders/top-buyers', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const data = await cache.wrap(`stats:top-buyers:${limit}`, async () => {
      const [rows] = await db.query(
        `SELECT v.openid, u.nickname, COUNT(*) as order_count, SUM(CASE WHEN status='completed' THEN goods_price ELSE 0 END) as total_spent FROM vip_orders v LEFT JOIN users u ON v.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci GROUP BY v.openid, u.nickname ORDER BY total_spent DESC LIMIT ?`,
        [limit]
      );
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/orders/:outTradeNo
router.get('/orders/:outTradeNo', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT v.*, u.nickname FROM vip_orders v LEFT JOIN users u ON v.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE v.out_trade_no = ?', [req.params.outTradeNo]);
    if (!rows.length) return res.status(404).json({ success: false, code: 'ORDER_NOT_FOUND' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// PUT /api/admin/orders/:outTradeNo/status
router.put('/orders/:outTradeNo/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !['pending', 'completed', 'failed', 'refunded'].includes(status)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM' });
    }
    const conn = await db.get();
    try {
      const [existing] = await conn.query('SELECT openid, product_id, status FROM vip_orders WHERE out_trade_no = ?', [req.params.outTradeNo]);
      if (!existing.length) return res.status(404).json({ success: false, code: 'ORDER_NOT_FOUND' });
      await conn.query('UPDATE vip_orders SET status = ?, updated_at = NOW() WHERE out_trade_no = ?', [status, req.params.outTradeNo]);
      if (status === 'completed') {
        const order = existing[0];
        const planType = order.product_id === 'vip_monthly' ? 'monthly' : order.product_id === 'vip_yearly' ? 'yearly' : null;
        if (planType) {
          const expireAt = new Date();
          if (planType === 'monthly') expireAt.setMonth(expireAt.getMonth() + 1);
          else expireAt.setFullYear(expireAt.getFullYear() + 1);
          await conn.query('UPDATE users SET plan_type=?, quota_remaining=20, expire_time=? WHERE openid=?', [planType, expireAt, order.openid]);
          await conn.query('INSERT INTO subscriptions (openid, plan_type, expire_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE plan_type=VALUES(plan_type), expire_at=VALUES(expire_at)', [order.openid, planType, expireAt]);
          // 清空VIP推演次数
          try { await require('../services/redis').clearVipDecodeLimit(order.openid); } catch (e) {}
        }
      }
      await conn.query('INSERT INTO admin_logs (admin_id, action, target, detail) VALUES (?, "order_status_update", ?, ?)',
        [req.admin.id, req.params.outTradeNo, JSON.stringify({ from: existing[0].status, to: status })]);
      await cache.clearStats();
      res.json({ success: true });
    } finally { conn.release(); }
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// ============================================================
// 模块四：分享分析 Share Analysis
// ============================================================

// GET /api/admin/shares/stats
router.get('/shares/stats', async (req, res) => {
  try {
    const data = await cache.wrap('stats:shares', async () => {
      const [rows] = await db.query(`
        SELECT 'total' as k, COUNT(*) as v FROM share_codes
        UNION ALL SELECT 'active', COUNT(*) FROM share_codes WHERE (expires_at IS NULL OR expires_at > NOW())
        UNION ALL SELECT 'expired', COUNT(*) FROM share_codes WHERE expires_at IS NOT NULL AND expires_at <= NOW()
        UNION ALL SELECT 'totalUse', COALESCE(SUM(use_count),0) FROM share_codes
        UNION ALL SELECT 'used', COUNT(*) FROM share_codes WHERE use_count > 0
        UNION ALL SELECT 'unused', COUNT(*) FROM share_codes WHERE use_count = 0
      `);
      const m = {};
      rows.forEach(r => { m[r.k] = r.v; });
      return {
        total: m.total,
        active: m.active,
        expired: m.expired,
        totalUses: m.totalUse,
        used: m.used,
        unused: m.unused,
        usageRate: m.total > 0 ? parseFloat((m.used / m.total * 100).toFixed(1)) : 0
      };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/shares?type=&status=&page=1&pageSize=20
router.get('/shares', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;
    const type = req.query.type || '';
    const status = req.query.status || '';
    let where = '1=1';
    const params = [];
    if (type) { where += ' AND s.type = ?'; params.push(type); }
    if (status === 'active') { where += ' AND (s.expires_at IS NULL OR s.expires_at > NOW())'; }
    else if (status === 'expired') { where += ' AND s.expires_at IS NOT NULL AND s.expires_at <= NOW()'; }
    const [rows] = await db.query(
      `SELECT s.*, u.nickname FROM share_codes s LEFT JOIN users u ON s.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [total] = await db.query(`SELECT COUNT(*) as cnt FROM share_codes s WHERE ${where}`, params);
    res.json({ success: true, data: { list: rows, total: total[0].cnt, page, pageSize } });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/shares/usage-trend?days=7
router.get('/shares/usage-trend', async (req, res) => {
  try {
    // 🔴 v3.4 安全修复：days 参数上限 365，防止递归 CTE 爆炸
    const days = Math.min(parseInt(req.query.days) || 7, 365);
    const cacheKey = `stats:share-usage-trend:${days}`;
    const data = await cache.wrap(cacheKey, async () => {
      // 仅统计分享码创建趋势（use_count是累计字段，无法按日统计真实使用次数）
      const [created] = await db.query(
        'SELECT DATE(created_at) as date, COUNT(*) as cnt FROM share_codes WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY DATE(created_at) ORDER BY date',
        [days]
      );
      return { created };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { console.error('[ADMIN] share usage-trend error:', err.message); res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/shares/type-distribution
router.get('/shares/type-distribution', async (req, res) => {
  try {
    const data = await cache.wrap('stats:share-type', async () => {
      const [rows] = await db.query('SELECT COALESCE(type, "other") as type, COUNT(*) as cnt, COALESCE(SUM(use_count),0) as total_uses FROM share_codes GROUP BY type ORDER BY cnt DESC');
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/shares/top-sharers
router.get('/shares/top-sharers', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const data = await cache.wrap(`stats:top-sharers:${limit}`, async () => {
      const [rows] = await db.query(
        `SELECT s.openid, u.nickname, COUNT(*) as share_count, COALESCE(SUM(s.use_count),0) as total_uses FROM share_codes s LEFT JOIN users u ON s.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci GROUP BY s.openid, u.nickname ORDER BY total_uses DESC LIMIT ?`,
        [limit]
      );
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// DELETE /api/admin/shares/clean-expired
router.delete('/shares/clean-expired', async (req, res) => {
  try {
    const conn = await db.get();
    try {
      const [result] = await conn.query('DELETE FROM share_codes WHERE expires_at IS NOT NULL AND expires_at <= NOW()');
      await conn.query('INSERT INTO admin_logs (admin_id, action, detail) VALUES (?, "clean_expired_shares", ?)',
        [req.admin.id, JSON.stringify({ deleted: result.affectedRows })]);
      res.json({ success: true, message: `已清理 ${result.affectedRows} 个过期分享码` });
    } finally { conn.release(); }
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/shares/conversion-funnel
router.get('/shares/conversion-funnel', async (req, res) => {
  try {
    const data = await cache.wrap('stats:share-funnel', async () => {
      const [generated] = await db.query('SELECT COUNT(*) as cnt FROM share_codes');
      const [used] = await db.query('SELECT COUNT(*) as cnt FROM share_codes WHERE use_count > 0');
      // 分享后产生推演的用户数（近似值）
      const [converted] = await db.query(`
        SELECT COUNT(DISTINCT u.openid) as cnt FROM users u
        JOIN share_codes s ON u.openid COLLATE utf8mb4_unicode_ci = s.openid COLLATE utf8mb4_unicode_ci
        JOIN tuiyan_records t ON u.openid COLLATE utf8mb4_unicode_ci = t.openid COLLATE utf8mb4_unicode_ci
        WHERE t.created_at > s.created_at AND (u.is_virtual = 0 OR u.is_virtual IS NULL)
      `);
      return {
        generated: generated[0].cnt,
        used: used[0].cnt,
        converted: converted[0].cnt,
        usageRate: generated[0].cnt > 0 ? parseFloat((used[0].cnt / generated[0].cnt * 100).toFixed(1)) : 0,
        conversionRate: generated[0].cnt > 0 ? parseFloat((converted[0].cnt / generated[0].cnt * 100).toFixed(1)) : 0
      };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// ============================================================
// 模块五：匹配分析 Match Analysis
// ============================================================

// GET /api/admin/matches/stats
router.get('/matches/stats', async (req, res) => {
  try {
    const data = await cache.wrap('stats:matches', async () => {
      const [rows] = await db.query(`
        SELECT 'total' as k, COUNT(*) as v FROM match_records m INNER JOIN users u ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE (u.is_virtual = 0 OR u.is_virtual IS NULL)
        UNION ALL SELECT 'uniquePairs', COUNT(DISTINCT LEAST(m.user_a_openid, m.user_b_openid), GREATEST(m.user_a_openid, m.user_b_openid)) FROM match_records m INNER JOIN users u ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE (u.is_virtual = 0 OR u.is_virtual IS NULL)
        UNION ALL SELECT 'uniqueUsers', COUNT(DISTINCT t.openid) FROM (SELECT m.user_a_openid as openid FROM match_records m INNER JOIN users u ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE (u.is_virtual = 0 OR u.is_virtual IS NULL) UNION SELECT m.user_b_openid FROM match_records m INNER JOIN users u ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE (u.is_virtual = 0 OR u.is_virtual IS NULL)) t
        UNION ALL SELECT 'avgScore', COALESCE(AVG(m.match_score),0) FROM match_records m INNER JOIN users u ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE (u.is_virtual = 0 OR u.is_virtual IS NULL) AND m.match_score IS NOT NULL
        UNION ALL SELECT 'today', COUNT(*) FROM match_records m INNER JOIN users u ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE (u.is_virtual = 0 OR u.is_virtual IS NULL) AND m.created_at >= CURDATE() AND m.created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        UNION ALL SELECT 'thisWeek', COUNT(*) FROM match_records m INNER JOIN users u ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE (u.is_virtual = 0 OR u.is_virtual IS NULL) AND m.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      `);
      const m = {};
      rows.forEach(r => { m[r.k] = r.v; });
      return {
        total: m.total,
        uniquePairs: m.uniquePairs,
        uniqueUsers: m.uniqueUsers,
        avgMatchScore: m.avgScore ? parseFloat(parseFloat(m.avgScore).toFixed(1)) : 0,
        todayCount: m.today,
        thisWeekCount: m.thisWeek
      };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/matches?page=1&pageSize=20&level=
router.get('/matches', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;
    const level = req.query.level || '';
    let where = '1=1';
    const params = [];
    if (level) { where += ' AND m.match_level = ?'; params.push(level); }
    // 🔴 修复：JOIN 加 COLLATE；排除虚拟用户的匹配记录
    const [rows] = await db.query(
      `SELECT m.*, ua.nickname as user_a_name, ub.nickname as user_b_name, ha.name as gua_a_name, hb.name as gua_b_name
       FROM match_records m
       LEFT JOIN users ua ON m.user_a_openid COLLATE utf8mb4_unicode_ci = ua.openid COLLATE utf8mb4_unicode_ci
       LEFT JOIN users ub ON m.user_b_openid COLLATE utf8mb4_unicode_ci = ub.openid COLLATE utf8mb4_unicode_ci
       LEFT JOIN hexagrams ha ON m.gua_a = ha.id
       LEFT JOIN hexagrams hb ON m.gua_b = hb.id
       INNER JOIN users u_filter ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u_filter.openid COLLATE utf8mb4_unicode_ci AND (u_filter.is_virtual = 0 OR u_filter.is_virtual IS NULL)
       WHERE ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [total] = await db.query(`SELECT COUNT(*) as cnt FROM match_records m INNER JOIN users u_filter ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u_filter.openid COLLATE utf8mb4_unicode_ci AND (u_filter.is_virtual = 0 OR u_filter.is_virtual IS NULL) WHERE ${where}`, params);
    res.json({ success: true, data: { list: rows, total: total[0].cnt, page, pageSize } });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/matches/gua-pair-distribution (必须在 /:id 之前！)
router.get('/matches/gua-pair-distribution', async (req, res) => {
  try {
    const data = await cache.wrap('stats:match-gua-pairs', async () => {
      const [rows] = await db.query(
        `SELECT m.gua_a, ha.name as gua_a_name, m.gua_b, hb.name as gua_b_name, COUNT(*) as cnt, AVG(m.match_score) as avg_score
         FROM match_records m
         LEFT JOIN hexagrams ha ON m.gua_a = ha.id
         LEFT JOIN hexagrams hb ON m.gua_b = hb.id
         INNER JOIN users u ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL)
         WHERE m.gua_a IS NOT NULL AND m.gua_b IS NOT NULL
         GROUP BY m.gua_a, m.gua_b, ha.name, hb.name
         ORDER BY cnt DESC LIMIT 50`
      );
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/matches/score-distribution (必须在 /:id 之前！)
router.get('/matches/score-distribution', async (req, res) => {
  try {
    const data = await cache.wrap('stats:match-score', async () => {
      const [rows] = await db.query(
        `SELECT
          SUM(CASE WHEN m.match_score < 30 THEN 1 ELSE 0 END) as low,
          SUM(CASE WHEN m.match_score >= 30 AND m.match_score < 60 THEN 1 ELSE 0 END) as medium,
          SUM(CASE WHEN m.match_score >= 60 AND m.match_score < 80 THEN 1 ELSE 0 END) as high,
          SUM(CASE WHEN m.match_score >= 80 THEN 1 ELSE 0 END) as excellent,
          AVG(m.match_score) as avg
        FROM match_records m INNER JOIN users u ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL) WHERE m.match_score IS NOT NULL`
      );
      return rows[0];
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/matches/relationship-distribution (必须在 /:id 之前！)
router.get('/matches/relationship-distribution', async (req, res) => {
  try {
    const data = await cache.wrap('stats:match-rel', async () => {
      const [rows] = await db.query(
        'SELECT COALESCE(m.relationship_name, "未指定") as relationship, COALESCE(m.relationship_key, "") as `key`, COUNT(*) as cnt, AVG(m.match_score) as avg_score FROM match_records m INNER JOIN users u ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL) GROUP BY m.relationship_name, m.relationship_key ORDER BY cnt DESC'
      );
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/matches/trend (必须在 /:id 之前！)
router.get('/matches/trend', async (req, res) => {
  try {
    // 🔴 v3.4 安全修复：days 参数上限 365，防止递归 CTE 爆炸
    const days = Math.min(parseInt(req.query.days) || 7, 365);
    const data = await cache.wrap(`stats:match-trend:${days}`, async () => {
      const [rows] = await db.query(
        `WITH RECURSIVE date_series AS (
          SELECT DATE(DATE_SUB(NOW(), INTERVAL ? DAY)) as d
          UNION ALL SELECT DATE(d + INTERVAL 1 DAY) FROM date_series WHERE d < DATE(NOW())
        )
        SELECT DATE_FORMAT(ds.d, '%Y-%m-%d') as date, COALESCE(COUNT(t.created_at), 0) as cnt
        FROM date_series ds
        LEFT JOIN match_records t ON t.created_at >= ds.d AND t.created_at < DATE_ADD(ds.d, INTERVAL 1 DAY)
          AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = t.user_a_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
        GROUP BY ds.d ORDER BY ds.d`,
        [days]
      );
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/matches/top-users (必须在 /:id 之前！)
router.get('/matches/top-users', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const data = await cache.wrap(`stats:match-top-users:${limit}`, async () => {
      const [rows] = await db.query(
        `SELECT t.openid, u.nickname, SUM(t.cnt) as total FROM (
          SELECT m.user_a_openid as openid, COUNT(*) as cnt FROM match_records m INNER JOIN users u1 ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u1.openid COLLATE utf8mb4_unicode_ci AND (u1.is_virtual = 0 OR u1.is_virtual IS NULL) GROUP BY m.user_a_openid
          UNION ALL
          SELECT m.user_b_openid as openid, COUNT(*) as cnt FROM match_records m INNER JOIN users u2 ON m.user_a_openid COLLATE utf8mb4_unicode_ci = u2.openid COLLATE utf8mb4_unicode_ci AND (u2.is_virtual = 0 OR u2.is_virtual IS NULL) GROUP BY m.user_b_openid
        ) t JOIN users u ON t.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci
        GROUP BY t.openid, u.nickname ORDER BY total DESC LIMIT ?`,
        [limit]
      );
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/matches/:id
router.get('/matches/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT m.*, ua.nickname as user_a_name, ub.nickname as user_b_name
       FROM match_records m
       LEFT JOIN users ua ON m.user_a_openid COLLATE utf8mb4_unicode_ci = ua.openid COLLATE utf8mb4_unicode_ci
       LEFT JOIN users ub ON m.user_b_openid COLLATE utf8mb4_unicode_ci = ub.openid COLLATE utf8mb4_unicode_ci
       WHERE m.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, code: 'RECORD_NOT_FOUND' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// ============================================================
// 模块六：内容管理 Content Management (Hexagrams)
// ============================================================

// GET /api/admin/hexagrams
router.get('/hexagrams', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM hexagrams ORDER BY id');
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/hexagrams/stats (必须在 /:id 之前！)
router.get('/hexagrams/stats', async (req, res) => {
  try {
    const data = await cache.wrap('stats:hexagrams', async () => {
      const [total] = await db.query('SELECT COUNT(*) as cnt FROM hexagrams');
      const [popularity] = await db.query(
        `SELECT h.id, h.name, h.symbol, COUNT(u.id) as user_count FROM hexagrams h LEFT JOIN users u ON h.id = u.ming_ben_gua AND (u.is_virtual = 0 OR u.is_virtual IS NULL) GROUP BY h.id, h.name, h.symbol ORDER BY user_count DESC`
      );
      return { total: total[0].cnt, popularity };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/hexagrams/:id
router.get('/hexagrams/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM hexagrams WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, code: 'HEXAGRAM_NOT_FOUND' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// POST /api/admin/hexagrams
router.post('/hexagrams', async (req, res) => {
  try {
    const { name, full_name, symbol, upper, lower, judgment, image, description } = req.body;
    if (!name) return res.status(400).json({ success: false, code: 'INVALID_PARAM' });
    const conn = await db.get();
    try {
      await conn.query('INSERT INTO hexagrams (name, full_name, symbol, upper, lower, judgment, image, description) VALUES (?,?,?,?,?,?,?,?)',
        [name, full_name || '', symbol || '', upper || '', lower || '', judgment || '', image || '', description || '']);
      await conn.query('INSERT INTO admin_logs (admin_id, action, target) VALUES (?, "hexagram_create", ?)', [req.admin.id, name]);
      res.json({ success: true });
    } finally { conn.release(); }
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// PUT /api/admin/hexagrams/:id
router.put('/hexagrams/:id', async (req, res) => {
  try {
    const { name, full_name, symbol, upper, lower, judgment, image, description } = req.body;
    const conn = await db.get();
    try {
      await conn.query('UPDATE hexagrams SET name=?, full_name=?, symbol=?, upper=?, lower=?, judgment=?, image=?, description=? WHERE id = ?',
        [name, full_name, symbol, upper, lower, judgment, image, description, req.params.id]);
      await conn.query('INSERT INTO admin_logs (admin_id, action, target) VALUES (?, "hexagram_update", ?)', [req.admin.id, req.params.id]);
      res.json({ success: true });
    } finally { conn.release(); }
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// ============================================================
// 模块七：事件分析 Event Analysis
// ============================================================

// GET /api/admin/events/stats
router.get('/events/stats', async (req, res) => {
  try {
    const data = await cache.wrap('stats:events', async () => {
      const [rows] = await db.query(
        `SELECT e.event_type, COUNT(*) as cnt, COUNT(DISTINCT e.openid) as unique_users, MAX(e.created_at) as last_at
         FROM events e INNER JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL)
         WHERE ${TEST_EVENT_FILTER}
         GROUP BY e.event_type ORDER BY cnt DESC`
      );
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/events/trend?type=&days=7
router.get('/events/trend', async (req, res) => {
  try {
    const eventType = req.query.type || '';
    // 🔴 v3.4 安全修复：days 参数上限 365，防止递归 CTE 爆炸
    const days = Math.min(parseInt(req.query.days) || 7, 365);
    const cacheKey = `stats:event-trend:${eventType}:${days}`;
    const data = await cache.wrap(cacheKey, async () => {
      let where = `${TEST_EVENT_FILTER} AND e.created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`;
      const params = [];
      if (eventType) { where += ' AND e.event_type = ?'; params.push(eventType); }
      const [rows] = await db.query(
        `SELECT DATE(e.created_at) as date, e.event_type, COUNT(*) as cnt FROM events e INNER JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL) WHERE ${where} GROUP BY date, e.event_type ORDER BY date`,
        params
      );
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/events/funnel
router.get('/events/funnel', async (req, res) => {
  try {
    // 🔴 v3.4 安全修复：days=0 表示全部，正整数上限 365 防止递归 CTE 爆炸
    const rawDays = parseInt(req.query.days) || 0;
    const days = rawDays === 0 ? 0 : Math.min(Math.max(rawDays, 1), 365);
    const dateFilter = days > 0 ? `AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)` : '';
    const cacheKey = `stats:funnel-v3:${days}`;
    const data = await cache.wrap(cacheKey, async () => {
      // 按用户维度聚合：统计每步独立用户数（完成过该步骤即计入，不要求严格顺序）
      // 避免 GROUP_CONCAT 截断和 openid 字符串拼接（SQL注入风险）
      const steps = [
        { key: 'app_open', label: '打开小程序' },
        { key: 'profile_create', label: '建立档案' },
        { key: 'tuiyan', label: 'AI推演' },
        { key: 'match', label: '易缘匹配' },
        { key: 'share', label: '分享' },
        { key: 'vip_purchase', label: 'VIP购买' }
      ];
      const results = [];
      for (const s of steps) {
        const [rows] = await db.query(
          `SELECT COUNT(DISTINCT e.openid) as cnt FROM events e INNER JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL) WHERE e.event_type = ? AND ${TEST_EVENT_FILTER} ${dateFilter.replace(/created_at/g, 'e.created_at')}`,
          [s.key]
        );
        results.push({ step: s.key, label: s.label, count: rows[0]?.cnt || 0 });
      }
      // 计算转化率（相对上一步）
      results.forEach((r, i) => {
        r.conversionRate = i === 0 ? '100.0' : (results[i-1].count > 0 ? parseFloat((r.count / results[i-1].count * 100).toFixed(1)) : '0.0');
      });
      return results;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { console.error('[ADMIN] funnel error:', err.message); res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/events/retention
router.get('/events/retention', async (req, res) => {
  try {
    const data = await cache.wrap('stats:retention-events', async () => {
      // 与 /dashboard/retention 逻辑统一：注册日与活跃日均为完整24h窗口
      // D1：注册在T-2（前天），活跃在T-1（昨天）；D3：注册在T-4，活跃在T-1；D7：注册在T-8，活跃在T-1
      const [d1] = await db.query(`
        SELECT COUNT(DISTINCT e.openid) as cnt FROM events e
        JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci
        WHERE u.created_at >= DATE_SUB(CURDATE(), INTERVAL 2 DAY)
        AND u.created_at < DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        AND (u.is_virtual = 0 OR u.is_virtual IS NULL)
        AND ${TEST_EVENT_FILTER}
        AND e.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        AND e.created_at < CURDATE()
      `);
      const [d3] = await db.query(`
        SELECT COUNT(DISTINCT e.openid) as cnt FROM events e
        JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci
        WHERE u.created_at >= DATE_SUB(CURDATE(), INTERVAL 4 DAY)
        AND u.created_at < DATE_SUB(CURDATE(), INTERVAL 3 DAY)
        AND (u.is_virtual = 0 OR u.is_virtual IS NULL)
        AND ${TEST_EVENT_FILTER}
        AND e.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        AND e.created_at < CURDATE()
      `);
      const [d7] = await db.query(`
        SELECT COUNT(DISTINCT e.openid) as cnt FROM events e
        JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci
        WHERE u.created_at >= DATE_SUB(CURDATE(), INTERVAL 8 DAY)
        AND u.created_at < DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        AND (u.is_virtual = 0 OR u.is_virtual IS NULL)
        AND ${TEST_EVENT_FILTER}
        AND e.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        AND e.created_at < CURDATE()
      `);
      const [n1] = await db.query("SELECT COUNT(*) as cnt FROM users WHERE (is_virtual = 0 OR is_virtual IS NULL) AND created_at >= DATE_SUB(CURDATE(), INTERVAL 2 DAY) AND created_at < DATE_SUB(CURDATE(), INTERVAL 1 DAY)");
      const [n3] = await db.query("SELECT COUNT(*) as cnt FROM users WHERE (is_virtual = 0 OR is_virtual IS NULL) AND created_at >= DATE_SUB(CURDATE(), INTERVAL 4 DAY) AND created_at < DATE_SUB(CURDATE(), INTERVAL 3 DAY)");
      const [n7] = await db.query("SELECT COUNT(*) as cnt FROM users WHERE (is_virtual = 0 OR is_virtual IS NULL) AND created_at >= DATE_SUB(CURDATE(), INTERVAL 8 DAY) AND created_at < DATE_SUB(CURDATE(), INTERVAL 7 DAY)");
      return {
        d1: { retained: d1[0].cnt, total: n1[0].cnt, rate: n1[0].cnt > 0 ? parseFloat((d1[0].cnt / n1[0].cnt * 100).toFixed(1)) : 0 },
        d3: { retained: d3[0].cnt, total: n3[0].cnt, rate: n3[0].cnt > 0 ? parseFloat((d3[0].cnt / n3[0].cnt * 100).toFixed(1)) : 0 },
        d7: { retained: d7[0].cnt, total: n7[0].cnt, rate: n7[0].cnt > 0 ? parseFloat((d7[0].cnt / n7[0].cnt * 100).toFixed(1)) : 0 }
      };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/events/retention-cohort
router.get('/events/retention-cohort', async (req, res) => {
  try {
    const data = await cache.wrap('stats:retention-cohort', async () => {
      // 按注册周分组，计算每周注册用户的D1/D7/D30留存
      const [cohorts] = await db.query(`
        SELECT
          DATE_FORMAT(created_at, '%Y-%u') as cohort_week,
          DATE(MIN(created_at)) as week_start,
          COUNT(DISTINCT openid) as registered
        FROM users
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        AND (is_virtual = 0 OR is_virtual IS NULL)
        GROUP BY DATE_FORMAT(created_at, '%Y-%u')
        ORDER BY cohort_week
      `);

      const result = [];
      for (const c of cohorts) {
        const [d1] = await db.query(`
          SELECT COUNT(DISTINCT e.openid) as cnt
          FROM events e
          JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci
          WHERE DATE_FORMAT(u.created_at, '%Y-%u') = ?
          AND (u.is_virtual = 0 OR u.is_virtual IS NULL)
          AND ${TEST_EVENT_FILTER}
          AND DATE(e.created_at) = DATE_ADD(DATE(u.created_at), INTERVAL 1 DAY)
        `, [c.cohort_week]);

        const [d7] = await db.query(`
          SELECT COUNT(DISTINCT e.openid) as cnt
          FROM events e
          JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci
          WHERE DATE_FORMAT(u.created_at, '%Y-%u') = ?
          AND (u.is_virtual = 0 OR u.is_virtual IS NULL)
          AND ${TEST_EVENT_FILTER}
          AND DATE(e.created_at) = DATE_ADD(DATE(u.created_at), INTERVAL 7 DAY)
        `, [c.cohort_week]);

        const [d30] = await db.query(`
          SELECT COUNT(DISTINCT e.openid) as cnt
          FROM events e
          JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci
          WHERE DATE_FORMAT(u.created_at, '%Y-%u') = ?
          AND (u.is_virtual = 0 OR u.is_virtual IS NULL)
          AND ${TEST_EVENT_FILTER}
          AND DATE(e.created_at) = DATE_ADD(DATE(u.created_at), INTERVAL 30 DAY)
        `, [c.cohort_week]);

        result.push({
          cohort: c.cohort_week,
          weekStart: c.week_start,
          registered: c.registered,
          d1Retention: d1[0].cnt,
          d7Retention: d7[0].cnt,
          d30Retention: d30[0].cnt,
          d1Rate: c.registered > 0 ? parseFloat((d1[0].cnt / c.registered * 100).toFixed(1)) : '0.0',
          d7Rate: c.registered > 0 ? parseFloat((d7[0].cnt / c.registered * 100).toFixed(1)) : '0.0',
          d30Rate: c.registered > 0 ? parseFloat((d30[0].cnt / c.registered * 100).toFixed(1)) : '0.0'
        });
      }
      return result;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/events/user-activity?days=7
router.get('/events/user-activity', async (req, res) => {
  try {
    // 🔴 v3.4 安全修复：days 参数上限 365，防止递归 CTE 爆炸
    const days = Math.min(parseInt(req.query.days) || 7, 365);
    const data = await cache.wrap(`stats:user-activity:${days}`, async () => {
      const [dau] = await db.query(
        `SELECT DATE(e.created_at) as date, COUNT(DISTINCT e.openid) as cnt FROM events e INNER JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL) WHERE ${TEST_EVENT_FILTER} AND e.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY date ORDER BY date`,
        [days]
      );
      const [totalEvents] = await db.query(
        `SELECT DATE(e.created_at) as date, COUNT(*) as cnt FROM events e INNER JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL) WHERE ${TEST_EVENT_FILTER} AND e.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY date ORDER BY date`,
        [days]
      );
      return { dau, totalEvents };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/events/top-pages
router.get('/events/top-pages', async (req, res) => {
  try {
    const data = await cache.wrap('stats:top-pages', async () => {
      const [rows] = await db.query(
        `SELECT e.page, COUNT(*) as cnt, COUNT(DISTINCT e.openid) as unique_users FROM events e INNER JOIN users u ON e.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL) WHERE ${TEST_EVENT_FILTER} AND e.page IS NOT NULL AND e.page != '' GROUP BY e.page ORDER BY cnt DESC LIMIT 20`
      );
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/events/data-quality
router.get('/events/data-quality', async (req, res) => {
  try {
    const data = await cache.wrap('stats:data-quality', async () => {
      const [total] = await db.query('SELECT COUNT(*) as cnt FROM events');
      const [valid] = await db.query(`SELECT COUNT(*) as cnt FROM events WHERE ${TEST_EVENT_FILTER}`);
      const [testEvents] = await db.query(`SELECT COUNT(*) as cnt FROM events WHERE NOT (${TEST_EVENT_FILTER})`);
      const [withExtraData] = await db.query("SELECT COUNT(*) as cnt FROM events WHERE extra_data IS NOT NULL AND extra_data != 'null'");
      const [withoutPage] = await db.query("SELECT COUNT(*) as cnt FROM events WHERE page IS NULL OR page = ''");
      return {
        total: total[0].cnt,
        valid: valid[0].cnt,
        testEvents: testEvents[0].cnt,
        withExtraData: withExtraData[0].cnt,
        withoutPage: withoutPage[0].cnt,
        qualityRate: total[0].cnt > 0 ? parseFloat((valid[0].cnt / total[0].cnt * 100).toFixed(1)) : 0
      };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// ============================================================
// 模块八：系统设置 System Settings
// ============================================================

// GET /api/admin/settings/logs?page=1&pageSize=20&action=
router.get('/settings/logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;
    const action = req.query.action || '';
    let where = '1=1';
    const params = [];
    if (action) { where += ' AND al.action = ?'; params.push(action); }
    const [rows] = await db.query(
      `SELECT al.*, a.username FROM admin_logs al LEFT JOIN admins a ON al.admin_id = a.id WHERE ${where} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [total] = await db.query(`SELECT COUNT(*) as cnt FROM admin_logs al WHERE ${where}`, params);
    res.json({ success: true, data: { list: rows, total: total[0].cnt, page, pageSize } });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/settings/logs/actions
router.get('/settings/logs/actions', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT DISTINCT action FROM admin_logs ORDER BY action');
    res.json({ success: true, data: rows.map(r => r.action) });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// POST /api/admin/settings/db-backup
router.post('/settings/db-backup', async (req, res) => {
  try {
    const backupDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = path.join(backupDir, `tianji_tuiyan_${timestamp}.sql`);
    const dbPassword = process.env.DB_PASSWORD || '';
    const dbName = process.env.DB_NAME || 'tianji_tuiyan';
    // 🔴 v3.4 安全修复：使用 spawn 参数数组替代 exec 字符串拼接，防止 shell 元字符注入
    const args = ['-u', 'root'];
    if (dbPassword) args.push(`-p${dbPassword}`);
    args.push(dbName, '-r', backupFile);
    const proc = spawn('mysqldump', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      console.error('[backup] spawn error:', err.message);
      return res.status(500).json({ success: false, code: 'BACKUP_FAILED', message: `备份失败: ${err.message}` });
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('[backup] Error, exit code:', code, stderr);
        return res.status(500).json({ success: false, code: 'BACKUP_FAILED', message: `备份失败: ${stderr}` });
      }
      db.query('INSERT INTO admin_logs (admin_id, action, detail) VALUES (?, "db_backup", ?)', [req.admin.id, JSON.stringify({ file: backupFile })]);
      // 🔴 v3.4 安全加固：响应中仅返回文件名，不泄露服务器完整路径
      const fileName = path.basename(backupFile);
      res.json({ success: true, message: '备份成功', data: { file: fileName, size: fs.statSync(backupFile).size } });
    });
  } catch (err) { res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '备份失败' }); }
});

// GET /api/admin/settings/backups
router.get('/settings/backups', async (req, res) => {
  try {
    const backupDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupDir)) return res.json({ success: true, data: [] });
    const files = fs.readdirSync(backupDir).map(f => {
      const stat = fs.statSync(path.join(backupDir, f));
      return { name: f, size: stat.size, modified: stat.mtime };
    }).sort((a, b) => b.modified - a.modified);
    res.json({ success: true, data: files.slice(0, 50) });
  } catch (err) { res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '读取备份列表失败' }); }
});

// GET /api/admin/settings/db-stats
router.get('/settings/db-stats', async (req, res) => {
  try {
    const data = await cache.wrap('stats:db', async () => {
      const conn = await db.get();
      try {
        const tables = ['users', 'tuiyan_records', 'share_codes', 'match_records', 'subscriptions', 'events', 'vip_orders', 'admin_logs', 'hexagrams', 'admins', 'user_gua_collection', 'user_achievements', 'pending_deletions'];
        const stats = {};
        for (const t of tables) {
          const [r] = await conn.query(`SELECT COUNT(*) as cnt FROM ${t}`);
          stats[t] = r[0].cnt;
        }
        const [dbSize] = await conn.query(
          `SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb FROM information_schema.tables WHERE table_schema = ?`,
          [process.env.DB_NAME || 'tianji_tuiyan']
        );
        return { tables: stats, totalSize: dbSize[0].size_mb || 0 };
      } finally { conn.release(); }
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/settings/config
router.get('/settings/config', async (req, res) => {
  try {
    const config = {
      port: process.env.PORT || 3003,
      dbHost: process.env.DB_HOST,
      dbName: process.env.DB_NAME,
      redisUrl: process.env.REDIS_URL ? 'configured' : 'not configured',
      xpayOfferId: process.env.XPAY_OFFER_ID || 'not configured',
      xpayEnv: process.env.XPAY_ENV || 'not configured',
      nodeEnv: process.env.NODE_ENV || 'development',
      nodeVersion: process.version
    };
    res.json({ success: true, data: config });
  } catch (err) { res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '获取配置失败' }); }
});

// GET /api/admin/settings/health
router.get('/settings/health', async (req, res) => {
  try {
    const dbStats = await db.getStats();
    let redisStatus = 'disconnected';
    try {
      const redisClient = require('../services/redis');
      const c = await redisClient.getClient?.() || null;
      if (c) {
        await c.ping();
        redisStatus = 'connected';
      }
    } catch (e) { redisStatus = 'error: ' + e.message; }
    const memUsage = process.memoryUsage();
    res.json({
      success: true,
      data: {
        uptime: process.uptime(),
        memory: { rss: memUsage.rss, heapUsed: memUsage.heapUsed, heapTotal: memUsage.heapTotal },
        db: dbStats,
        redis: redisStatus
      }
    });
  } catch (err) { res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '健康检查失败' }); }
});

// POST /api/admin/settings/clear-cache
router.post('/settings/clear-cache', async (req, res) => {
  try {
    await cache.clearStats();
    await db.query('INSERT INTO admin_logs (admin_id, action) VALUES (?, "cache_clear")', [req.admin.id]);
    res.json({ success: true, message: '缓存已清除' });
  } catch (err) { res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '清除缓存失败' }); }
});

// PUT /api/admin/settings/change-password
router.put('/settings/change-password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ success: false, code: 'INVALID_PARAM' });
    // 🔴 v3.5 加固：管理员密码复杂度要求——至少 10 位，含大小写字母+数字+特殊字符
    if (newPassword.length < 10) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '密码至少 10 位' });
    }
    if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^a-zA-Z0-9]/.test(newPassword)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '密码需包含大小写字母、数字和特殊字符' });
    }
    const [admin] = await db.query('SELECT * FROM admins WHERE id = ?', [req.admin.id]);
    if (!admin.length) return res.status(404).json({ success: false, code: 'ADMIN_NOT_FOUND' });
    const valid = await bcrypt.compare(oldPassword, admin[0].password_hash);
    if (!valid) return res.status(401).json({ success: false, code: 'INVALID_PASSWORD' });
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, req.admin.id]);
    await db.query('INSERT INTO admin_logs (admin_id, action) VALUES (?, "password_change")', [req.admin.id]);
    res.json({ success: true, message: '密码已修改' });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});


// ============================================================
// 模块九：系统运维 System Operations
// ============================================================

// GET /api/admin/system/status - 系统运维状态总览
router.get('/system/status', async (req, res) => {
  try {
    const os = require('os');

    // === 1. 系统基础信息 ===
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();
    const sysMem = os.freemem();
    const totalMem = os.totalmem();
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;

    // === 2. 磁盘使用 ===
    let diskInfo = [];
    try {
      // 🔴 v3.5 安全加固：execFile 参数数组形式，stderr 通过 stdio 忽略
      const { stdout } = await execFileAsync('df', ['-h', '/', '/mnt/vdb1'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const lines = stdout.trim().split('\n').slice(1);
      diskInfo = lines.map(line => {
        const parts = line.split(/\s+/);
        return {
          filesystem: parts[0],
          size: parts[1],
          used: parts[2],
          available: parts[3],
          usePercent: parts[4],
          mounted: parts[5]
        };
      });
    } catch (e) { diskInfo = [{ error: e.message }]; }

    // === 3. 数据库状态 ===
    const dbStats = await db.getStats();
    let tableStats = {};
    try {
      const [tables] = await db.query(
        "SELECT table_name, table_rows, round(((data_length + index_length) / 1024 / 1024), 2) as size_mb FROM information_schema.tables WHERE table_schema = ? ORDER BY size_mb DESC",
        [process.env.DB_NAME || 'tianji_tuiyan']
      );
      tableStats = tables;
    } catch (e) { tableStats = { error: e.message }; }

    // === 4. Redis 状态 ===
    let redisStatus = {};
    try {
      const redisService = require('../services/redis');
      const client = await redisService.getClient();
      if (client && client.isReady) {
        const info = await client.info('memory');
        const clientsInfo = await client.info('clients');
        const usedMemMatch = info.match(/used_memory_human:(.+)/);
        const maxMemMatch = info.match(/maxmemory_human:(.+)/);
        const connMatch = clientsInfo.match(/connected_clients:(.+)/);
        redisStatus = {
          connected: true,
          usedMemory: usedMemMatch ? usedMemMatch[1].trim() : 'unknown',
          maxMemory: maxMemMatch ? maxMemMatch[1].trim() : 'unknown',
          connectedClients: connMatch ? parseInt(connMatch[1]) : 0
        };
      } else {
        redisStatus = { connected: false };
      }
    } catch (e) { redisStatus = { connected: false, error: e.message }; }

    // === 5. PM2 进程状态 ===
    let pm2Status = [];
    try {
      // 🔴 v3.5 安全加固：execFile 参数数组形式
      const { stdout } = await execFileAsync('pm2', ['jlist'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const processes = JSON.parse(stdout);
      pm2Status = processes.filter(p => p.name).map(p => ({
        name: p.name,
        status: p.pm2_env.status,
        pid: p.pid,
        uptime: p.pm2_env.created_at ? Date.now() - new Date(p.pm2_env.created_at).getTime() : 0,
        restarts: p.pm2_env.restart_time || 0,
        memory: p.monit ? (p.monit.memory / 1024 / 1024).toFixed(1) + ' MB' : 'unknown',
        cpu: p.monit ? p.monit.cpu + '%' : 'unknown'
      }));
    } catch (e) { pm2Status = [{ error: e.message }]; }

    // === 6. 最近错误日志 ===
    let recentErrors = [];
    try {
      const logFile = path.join(require('os').homedir(), '.pm2/logs/tianji-tuiyan-api-error.log');
      if (fs.existsSync(logFile)) {
        // 🔴 v3.5 安全加固：execFileSync 参数数组形式
        const content = execFileSync('tail', ['-100', logFile], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
        const lines = content.split('\n').filter(l => l.trim());
        // 取最后20行
        recentErrors = lines.slice(-20).map((line, idx) => ({
          index: lines.length - 20 + idx,
          content: line.substring(0, 500)
        }));
      }
    } catch (e) { recentErrors = [{ error: e.message }]; }

    // === 7. 备份状态 ===
    let backupInfo = [];
    try {
      const backupDir = path.join(__dirname, '../../backups');
      const fs = require('fs');
      if (fs.existsSync(backupDir)) {
        const files = fs.readdirSync(backupDir)
          .filter(f => f.endsWith('.sql') || f.endsWith('.sql.gz'))
          .map(f => {
            const stat = fs.statSync(path.join(backupDir, f));
            return { name: f, size: (stat.size / 1024).toFixed(1) + ' KB', modified: stat.mtime };
          })
          .sort((a, b) => new Date(b.modified) - new Date(a.modified))
          .slice(0, 10);
        backupInfo = files;
      }
    } catch (e) { backupInfo = [{ error: e.message }]; }

    // === 8. DeepSeek API 状态 ===
    let deepseekStatus = { tested: false };
    try {
      const axios = require('axios');
      const start = Date.now();
      const resp = await axios.post(
        'https://api.deepseek.com/chat/completions',
        { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 },
        { headers: { Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 }
      );
      deepseekStatus = {
        tested: true,
        status: resp.status === 200 ? 'ok' : 'error',
        latencyMs: Date.now() - start,
        model: resp.data?.model || 'unknown'
      };
    } catch (e) {
      deepseekStatus = { tested: true, status: 'error', error: e.message };
    }

    res.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        system: {
          uptime,
          uptimeFormatted: formatUptime(uptime),
          processMemory: {
            rss: (memUsage.rss / 1024 / 1024).toFixed(1) + ' MB',
            heapUsed: (memUsage.heapUsed / 1024 / 1024).toFixed(1) + ' MB',
            heapTotal: (memUsage.heapTotal / 1024 / 1024).toFixed(1) + ' MB'
          },
          systemMemory: {
            total: (totalMem / 1024 / 1024 / 1024).toFixed(1) + ' GB',
            free: (sysMem / 1024 / 1024 / 1024).toFixed(1) + ' GB',
            usagePercent: (((totalMem - sysMem) / totalMem) * 100).toFixed(1) + '%'
          },
          loadAvg: loadAvg.map(v => v.toFixed(2)),
          cpuCount
        },
        disk: diskInfo,
        database: {
          pool: dbStats,
          tables: tableStats
        },
        redis: redisStatus,
        pm2: pm2Status,
        recentErrors: recentErrors,
        backups: backupInfo,
        deepseek: deepseekStatus
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '系统状态获取失败' });
  }
});

// POST /api/admin/system/restart-service - 重启指定服务
router.post('/system/restart-service', async (req, res) => {
  try {
    const { serviceName } = req.body;
    if (!serviceName) return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '服务名称不能为空' });
    const allowed = ['tianji-tuiyan-api', 'xiabook', 'digital-human-api'];
    if (!allowed.includes(serviceName)) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: '不允许重启此服务' });
    }
    // 🔴 v3.5 安全加固：execFile 参数数组形式，serviceName 已在白名单内校验
    await execFileAsync('pm2', ['reload', serviceName]);
    await db.query('INSERT INTO admin_logs (admin_id, action, detail) VALUES (?, "reload_service", ?)', [req.admin.id, serviceName]);
    res.json({ success: true, message: `${serviceName} 已滚动重启（零停机）` });
  } catch (err) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '重启失败' });
  }
});

// GET /api/admin/system/error-log - 获取错误日志（支持分页/搜索）
router.get('/system/error-log', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 50, 200);
    const keyword = req.query.keyword || '';
    const logFile = path.join(require('os').homedir(), '.pm2/logs/tianji-tuiyan-api-error.log');
    if (!fs.existsSync(logFile)) {
      return res.json({ success: true, data: { lines: [], total: 0, page, pageSize } });
    }
    // 防止大日志文件 OOM：超过 10MB 只读最后 10000 行
    const fileSize = fs.statSync(logFile).size;
    const MAX_LINES = 10000;
    let content;
    if (fileSize > 10 * 1024 * 1024) {
      // 🔴 v3.5 安全加固：execFileSync 参数数组形式
      content = execFileSync('tail', ['-n', String(MAX_LINES), logFile], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
    } else {
      content = fs.readFileSync(logFile, 'utf8');
    }
    let allLines = content.split('\n').filter(l => l.trim());
    if (keyword) {
      allLines = allLines.filter(l => l.toLowerCase().includes(keyword.toLowerCase()));
    }
    const total = fileSize > 10 * 1024 * 1024 ? Math.min(allLines.length, MAX_LINES) : allLines.length;
    const start = Math.max(0, allLines.length - page * pageSize);
    const end = allLines.length - (page - 1) * pageSize;
    const lines = allLines.slice(start, end).reverse();
    res.json({ success: true, data: { lines, total, page, pageSize } });
  } catch (err) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '读取日志失败' });
  }
});

// POST /api/admin/system/test-deepseek - 测试DeepSeek API连接
router.post('/system/test-deepseek', async (req, res) => {
  try {
    const axios = require('axios');
    const start = Date.now();
    const resp = await axios.post(
      'https://api.deepseek.com/chat/completions',
      { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'Hello, please reply OK' }], max_tokens: 10 },
      { headers: { Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    const latency = Date.now() - start;
    await db.query('INSERT INTO admin_logs (admin_id, action, detail) VALUES (?, "test_deepseek", ?)', [req.admin.id, JSON.stringify({ latency })]);
    res.json({
      success: true,
      data: {
        latencyMs: latency,
        model: resp.data?.model,
        response: resp.data?.choices?.[0]?.message?.content,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, code: 'API_ERROR', message: 'DeepSeek测试失败' });
  }
});

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小时 ${m}分`;
  if (h > 0) return `${h}小时 ${m}分`;
  return `${m}分`;
}

// ============================================================
// 补充API：删除合规、AI监控、匹配语料、成就管理
// ============================================================

// GET /api/admin/deletions/pending - 待删除用户列表
router.get('/deletions/pending', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT pd.*, u.nickname, u.openid 
      FROM pending_deletions pd 
      LEFT JOIN users u ON pd.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci 
      ORDER BY pd.requested_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// PUT /api/admin/deletions/:id/cancel - 取消删除请求
router.put('/deletions/:id/cancel', async (req, res) => {
  try {
    await db.query('DELETE FROM pending_deletions WHERE id = ?', [req.params.id]);
    await db.query('INSERT INTO admin_logs (admin_id, action, detail) VALUES (?, "cancel_deletion", ?)', 
      [req.admin.id, JSON.stringify({ deletionId: req.params.id })]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/ai/stats - AI质量统计
router.get('/ai/stats', async (req, res) => {
  try {
    const data = await cache.wrap('stats:ai-stats', async () => {
      const [totalCalls] = await db.query(`SELECT COUNT(*) as cnt FROM events e WHERE e.event_type LIKE 'ai_%' AND ${TEST_EVENT_FILTER} AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = e.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))`);
      const [successCalls] = await db.query(`SELECT COUNT(*) as cnt FROM events e WHERE e.event_type = 'ai_success' AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = e.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))`);
      const [failedCalls] = await db.query(`SELECT COUNT(*) as cnt FROM events e WHERE e.event_type = 'ai_error' AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = e.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))`);
      const [avgLatency] = await db.query(`SELECT AVG(CAST(JSON_EXTRACT(e.extra_data, '$.latency') AS UNSIGNED)) as avg_latency FROM events e WHERE e.event_type LIKE 'ai_%' AND ${TEST_EVENT_FILTER} AND e.extra_data IS NOT NULL AND JSON_VALID(e.extra_data) AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = e.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))`);
      const avgLat = avgLatency[0].avg_latency;
      return {
        totalCalls: totalCalls[0].cnt,
        successCalls: successCalls[0].cnt,
        failedCalls: failedCalls[0].cnt,
        avgLatency: avgLat ? Math.round(avgLat) : 0,
        successRate: totalCalls[0].cnt > 0 ? parseFloat(((successCalls[0].cnt / totalCalls[0].cnt) * 100).toFixed(1)) : 0
      };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { console.error('[ADMIN] ai/stats error:', err.message); res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/ai/logs - AI调用日志
router.get('/ai/logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;
    const typeFilter = req.query.type; // 'success' or 'error' 可选过滤
    const cacheKey = 'stats:ai-logs:' + limit + ':' + page + ':' + (typeFilter || 'all');
    const data = await cache.wrap(cacheKey, async () => {
      let whereClause = `WHERE e.event_type LIKE 'ai_%' AND ${TEST_EVENT_FILTER} AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = e.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))`;
      let params = [];
      if (typeFilter === 'success') {
        whereClause += " AND e.event_type = 'ai_success'";
      } else if (typeFilter === 'error') {
        whereClause += " AND e.event_type = 'ai_error'";
      }
      const [rows] = await db.query(
        'SELECT e.id, e.openid, e.event_type, e.created_at, e.extra_data FROM events e ' + whereClause + ' ORDER BY e.created_at DESC LIMIT ? OFFSET ?',
        [...params, limit, offset]
      );
      const [total] = await db.query('SELECT COUNT(*) as cnt FROM events e ' + whereClause, params);
      return { list: rows, total: total[0].cnt, page, limit };
    }, 300);
    res.json({ success: true, data });
  } catch (err) { console.error('[ADMIN] ai/logs error:', err.message); res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/ai/trend - AI调用趋势
router.get('/ai/trend', async (req, res) => {
  try {
    // 🔴 v3.4 安全修复：days 参数上限 365，防止递归 CTE 爆炸
    const days = Math.min(parseInt(req.query.days) || 7, 365);
    const data = await cache.wrap(`stats:ai-trend:${days}`, async () => {
      const [rows] = await db.query(`
        WITH RECURSIVE date_series AS (
          SELECT DATE(DATE_SUB(NOW(), INTERVAL ? DAY)) as d
          UNION ALL SELECT DATE(d + INTERVAL 1 DAY) FROM date_series WHERE d < DATE(NOW())
        )
        SELECT DATE_FORMAT(ds.d, '%Y-%m-%d') as date,
          COALESCE(COUNT(t.created_at), 0) as total,
          COALESCE(SUM(CASE WHEN t.event_type = 'ai_success' THEN 1 ELSE 0 END), 0) as success,
          COALESCE(SUM(CASE WHEN t.event_type = 'ai_error' THEN 1 ELSE 0 END), 0) as failed
        FROM date_series ds
        LEFT JOIN events t ON t.event_type LIKE 'ai_%' AND ${TEST_EVENT_FILTER} AND t.created_at >= ds.d AND t.created_at < DATE_ADD(ds.d, INTERVAL 1 DAY)
          AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = t.openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
        GROUP BY ds.d ORDER BY ds.d
      `, [days]);
      return rows;
    }, 300);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/admin/user-profile - 用户画像统计（性别/年龄/命卦分布）
router.get('/user-profile', async (req, res) => {
  try {
    const data = await cache.wrap('stats:user-profile', async () => {
    // 性别分布（排除虚拟用户）
    const [genderDist] = await db.query(`
      SELECT
        CASE gender
          WHEN 1 THEN '男'
          WHEN 2 THEN '女'
          ELSE '未知'
        END as label,
        COUNT(*) as cnt
      FROM users
      WHERE status != -1 AND (is_virtual = 0 OR is_virtual IS NULL)
      GROUP BY gender
      ORDER BY cnt DESC
    `);

    // 年龄分布（按出生年代分组，排除虚拟用户）
    const [ageDist] = await db.query(`
      SELECT
        CASE
          WHEN birth_year IS NULL OR birth_year = 0 THEN '未知'
          WHEN birth_year >= 2005 THEN '00后'
          WHEN birth_year >= 1995 THEN '95后'
          WHEN birth_year >= 1990 THEN '90后'
          WHEN birth_year >= 1985 THEN '85后'
          WHEN birth_year >= 1980 THEN '80后'
          WHEN birth_year >= 1970 THEN '70后'
          ELSE '60后及以前'
        END as label,
        COUNT(*) as cnt
      FROM users
      WHERE status != -1 AND (is_virtual = 0 OR is_virtual IS NULL)
      GROUP BY label
      ORDER BY
        CASE label
          WHEN '00后' THEN 1
          WHEN '95后' THEN 2
          WHEN '90后' THEN 3
          WHEN '85后' THEN 4
          WHEN '80后' THEN 5
          WHEN '70后' THEN 6
          WHEN '60后及以前' THEN 7
          ELSE 8
        END
    `);

    // 命卦分布（用户先天人格分类，排除虚拟用户）
    const [guaDist] = await db.query(`
      SELECT
        COALESCE(h.full_name, CONCAT('卦', u.ming_ben_gua)) as label,
        COUNT(*) as cnt
      FROM users u
      LEFT JOIN hexagrams h ON u.ming_ben_gua = h.id
      WHERE u.status != -1 AND (u.is_virtual = 0 OR u.is_virtual IS NULL) AND u.ming_ben_gua IS NOT NULL AND u.ming_ben_gua > 0
      GROUP BY u.ming_ben_gua, h.full_name
      ORDER BY cnt DESC
    `);

    // v15.14 城市分布（排除虚拟用户，取前10城市）
    const [regionDist] = await db.query(`
      SELECT
        COALESCE(city, '未知') as label,
        COUNT(*) as cnt
      FROM users
      WHERE status != -1 AND (is_virtual = 0 OR is_virtual IS NULL)
      GROUP BY city
      ORDER BY cnt DESC
      LIMIT 10
    `);

    return {
      genderDist: genderDist || [],
      ageDist: ageDist || [],
      guaDist: guaDist || [],
      regionDist: regionDist || []
    };
    }, 300);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[ADMIN] user-profile error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// GET /api/admin/achievements - 成就列表
router.get('/achievements', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT ua.id, ua.openid, ua.achievement_key, ua.unlocked_at, ua.extra_data,
        u.nickname 
      FROM user_achievements ua 
      LEFT JOIN users u ON ua.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci 
      ORDER BY ua.unlocked_at DESC 
      LIMIT 100
    `);
    res.json({ success: true, data: rows });
  } catch (err) { console.error('[ADMIN] achievements error:', err.message); res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// ============================================================
// 模块：虚拟用户管理 Virtual User Management（v1.3）
// ============================================================

// GET /api/admin/virtual-users - 虚拟用户列表（分页/搜索/性别筛选）
router.get('/virtual-users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;
    const keyword = req.query.keyword || '';
    const gender = req.query.gender;
    let where = 'is_virtual = 1';
    const params = [];
    if (keyword) { where += ' AND (nickname LIKE ? OR openid LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
    if (gender) { where += ' AND gender = ?'; params.push(parseInt(gender)); }
    const [rows] = await db.query(
      `SELECT u.id, u.openid, u.nickname, u.birth_year, u.birth_month, u.birth_day, u.birth_shichen, u.gender, u.ming_ben_gua, u.personality_desc, u.plan_type, u.has_profile, u.letter_reply_enabled, u.created_at,
        h.full_name AS gua_name,
        COALESCE((SELECT COUNT(*) FROM match_records WHERE user_a_openid = u.openid OR user_b_openid = u.openid), 0) AS match_count,
        COALESCE((SELECT COUNT(*) FROM letters WHERE sender_openid = u.openid), 0) AS sent_letter_count,
        COALESCE((SELECT COUNT(*) FROM letters WHERE receiver_openid = u.openid), 0) AS received_letter_count,
        COALESCE((SELECT COUNT(*) FROM letters WHERE receiver_openid = u.openid AND is_read = 0), 0) AS unread_letter_count
      FROM users u
      LEFT JOIN hexagrams h ON u.ming_ben_gua = h.id
      WHERE ${where} ORDER BY u.id ASC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [total] = await db.query(`SELECT COUNT(*) as cnt FROM users WHERE ${where}`, params);
    res.json({ success: true, data: { list: rows, total: total[0].cnt, page, pageSize } });
  } catch (err) {
    console.error('[ADMIN] virtual-users error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// GET /api/admin/virtual-users/reply-config - 获取全局回信开关状态
router.get('/virtual-users/reply-config', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT config_key, config_value FROM letter_reply_config WHERE config_key IN ('global_reply_enabled', 'updated_by')"
    );
    const config = {};
    rows.forEach(r => { config[r.config_key] = r.config_value; });
    res.json({ success: true, data: { globalReplyEnabled: config.global_reply_enabled === '1', updatedBy: config.updated_by || 'system' } });
  } catch (err) {
    console.error('[ADMIN] reply-config get error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// PUT /api/admin/virtual-users/reply-config - 修改全局回信开关
router.put('/virtual-users/reply-config', async (req, res) => {
  try {
    const { enabled } = req.body;
    if (enabled === undefined || enabled === null) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '参数 enabled 必填' });
    }
    const value = enabled ? '1' : '0';
    const adminOpenid = req.admin && req.admin.openid ? req.admin.openid : 'admin';
    await db.query(
      "INSERT INTO letter_reply_config (config_key, config_value) VALUES ('global_reply_enabled', ?), ('updated_by', ?) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)",
      [value, adminOpenid]
    );
    // 🔴 v3.5 审计日志
    logAdminAction(req, 'global_reply_config', null, { enabled: !!enabled });
    res.json({ success: true, data: { globalReplyEnabled: !!enabled, message: `全局回信已${enabled ? '开启' : '关闭'}` } });
  } catch (err) {
    console.error('[ADMIN] reply-config put error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// PUT /api/admin/virtual-users/:openid/reply-toggle - 单用户回信开关
router.put('/virtual-users/:openid/reply-toggle', resolveAdminOpenid, async (req, res) => {
  try {
    const targetOpenid = req.params.openid;
    const { enabled } = req.body;
    if (enabled === undefined || enabled === null) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '参数 enabled 必填' });
    }
    const [result] = await db.query(
      'UPDATE users SET letter_reply_enabled = ? WHERE openid = ? AND is_virtual = 1',
      [enabled ? 1 : 0, targetOpenid]
    );
    if (result.affectedRows === 0) {
      return res.json({ success: false, code: 'NOT_FOUND', message: '虚拟用户不存在' });
    }
    res.json({ success: true, data: { message: `${targetOpenid} 回信已${enabled ? '开启' : '关闭'}` } });
  } catch (err) {
    console.error('[ADMIN] reply-toggle error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// POST /api/admin/virtual-users/:openid/reply - 管理员代虚拟用户回信
router.post('/virtual-users/:openid/reply', resolveAdminOpenid, async (req, res) => {
  try {
    const senderOpenid = req.params.openid; // 虚拟用户 openid
    const { receiverOpenid: rawReceiverOpenid, content } = req.body;
    if (!rawReceiverOpenid || !content) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '参数 receiverOpenid 和 content 必填' });
    }
    if (content.length < 10 || content.length > 800) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '信件内容 10-800 字' });
    }

    // 🔴 关键修复：收信人 openid 可能是绑定手机号前的旧 openid，反查为当前主账号
    const receiverOpenid = await resolveOpenidStandalone(rawReceiverOpenid);

    // 校验：必须是虚拟用户
    const [senderRows] = await db.query(
      'SELECT openid, nickname, is_virtual, letter_reply_enabled FROM users WHERE openid = ?',
      [senderOpenid]
    );
    if (senderRows.length === 0) {
      return res.json({ success: false, code: 'NOT_FOUND', message: '虚拟用户不存在' });
    }
    if (senderRows[0].is_virtual !== 1) {
      return res.json({ success: false, code: 'INVALID_PARAM', message: '只能以虚拟用户身份代回信' });
    }

    // 校验：单用户开关
    if (senderRows[0].letter_reply_enabled !== 1) {
      return res.json({ success: false, code: 'REPLY_DISABLED', message: '该虚拟用户回信功能已被关闭' });
    }

    // 校验：全局开关
    const [cfgRows] = await db.query(
      "SELECT config_value FROM letter_reply_config WHERE config_key = 'global_reply_enabled'"
    );
    if (cfgRows.length > 0 && cfgRows[0].config_value !== '1') {
      return res.json({ success: false, code: 'GLOBAL_REPLY_DISABLED', message: '全局回信功能已关闭' });
    }

    // 校验：双方必须已匹配
    const [matchRows] = await db.query(
      `SELECT id FROM match_records
       WHERE (user_a_openid = ? AND user_b_openid = ?) OR (user_a_openid = ? AND user_b_openid = ?)`,
      [senderOpenid, receiverOpenid, receiverOpenid, senderOpenid]
    );
    if (matchRows.length === 0) {
      return res.json({ success: false, code: 'NOT_MATCHED', message: '虚拟用户与目标用户未匹配，无法回信' });
    }

    // 校验：双方未拉黑
    const [blockRows] = await db.query(
      `SELECT id FROM letter_blocks
       WHERE (blocker_openid = ? AND blocked_openid = ?) OR (blocker_openid = ? AND blocked_openid = ?) LIMIT 1`,
      [senderOpenid, receiverOpenid, receiverOpenid, senderOpenid]
    );
    if (blockRows.length > 0) {
      return res.json({ success: false, code: 'BLOCKED', message: '双方已拉黑，无法回信' });
    }

    // 插入信件
    const [result] = await db.query(
      'INSERT INTO letters (sender_openid, receiver_openid, match_id, content) VALUES (?, ?, ?, ?)',
      [senderOpenid, receiverOpenid, matchRows[0].id, content.trim()]
    );

    // 🔴 v3.5 审计日志
    logAdminAction(req, 'virtual_reply', senderOpenid, { receiver: receiverOpenid, letterId: result.insertId });
    res.json({ success: true, data: { id: result.insertId, message: '代回信已发出' } });
  } catch (err) {
    console.error('[ADMIN] virtual reply error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// GET /api/admin/virtual-users/:openid/matches - 获取虚拟用户的所有匹配好友（用于代回信选择）
router.get('/virtual-users/:openid/matches', resolveAdminOpenid, async (req, res) => {
  try {
    const virtualOpenid = req.params.openid;

    // 校验是否是虚拟用户
    const [vRows] = await db.query('SELECT openid, nickname, is_virtual FROM users WHERE openid = ?', [virtualOpenid]);
    if (vRows.length === 0 || vRows[0].is_virtual !== 1) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '该用户不是虚拟用户' });
    }

    // 查询所有已匹配且未拉黑的好友
    const [rows] = await db.query(`
      SELECT
        u.openid,
        u.nickname,
        u.gender,
        u.is_virtual,
        u.ming_ben_gua,
        h.full_name AS gua_name,
        mr.created_at AS matched_at,
        (SELECT MAX(created_at) FROM letters WHERE (sender_openid = ? AND receiver_openid = u.openid) OR (sender_openid = u.openid AND receiver_openid = ?)) AS last_letter_time,
        (SELECT COUNT(*) FROM letters WHERE receiver_openid = ? AND sender_openid = u.openid AND is_read = 0) AS unread_from_friend
      FROM match_records mr
      INNER JOIN users u ON (CASE WHEN mr.user_a_openid = ? THEN mr.user_b_openid ELSE mr.user_a_openid END) = u.openid
      LEFT JOIN hexagrams h ON u.ming_ben_gua = h.id
      WHERE (mr.user_a_openid = ? OR mr.user_b_openid = ?)
        AND NOT EXISTS (
          SELECT 1 FROM letter_blocks lb
          WHERE (lb.blocker_openid = ? AND lb.blocked_openid = u.openid)
             OR (lb.blocker_openid = u.openid AND lb.blocked_openid = ?)
        )
      ORDER BY last_letter_time DESC, mr.created_at DESC
    `, [virtualOpenid, virtualOpenid, virtualOpenid, virtualOpenid, virtualOpenid, virtualOpenid, virtualOpenid, virtualOpenid]);

    res.json({ success: true, data: { list: rows, total: rows.length } });
  } catch (err) {
    console.error('[ADMIN] virtual matches error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// GET /api/admin/virtual-users/:openid/threads - 获取虚拟用户的信件对话列表
router.get('/virtual-users/:openid/threads', resolveAdminOpenid, async (req, res) => {
  try {
    const virtualOpenid = req.params.openid;
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;

    // 校验是否是虚拟用户
    const [vRows] = await db.query('SELECT openid, nickname, is_virtual FROM users WHERE openid = ?', [virtualOpenid]);
    if (vRows.length === 0 || vRows[0].is_virtual !== 1) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '该用户不是虚拟用户' });
    }

    // 查询所有对话（对方用户 + 最后一条消息 + 未读数）
    const [threads] = await db.query(`
      SELECT
        other_openid,
        other_nickname,
        other_is_virtual,
        total_count,
        unread_count,
        last_content,
        last_time,
        last_side
      FROM (
        SELECT
          CASE WHEN l.sender_openid = ? THEN l.receiver_openid ELSE l.sender_openid END AS other_openid,
          CASE WHEN l.sender_openid = ? THEN ru.nickname ELSE su.nickname END AS other_nickname,
          CASE WHEN l.sender_openid = ? THEN ru.is_virtual ELSE su.is_virtual END AS other_is_virtual,
          COUNT(*) AS total_count,
          SUM(CASE WHEN l.receiver_openid = ? AND l.is_read = 0 THEN 1 ELSE 0 END) AS unread_count,
          SUBSTRING(MAX(CONCAT(l.created_at, '|', l.content)), 21) AS last_content,
          MAX(l.created_at) AS last_time,
          SUBSTRING(MAX(CONCAT(l.created_at, '|', CASE WHEN l.sender_openid = ? THEN 'sent' ELSE 'received' END)), 21) AS last_side
        FROM letters l
        LEFT JOIN users su ON l.sender_openid COLLATE utf8mb4_unicode_ci = su.openid COLLATE utf8mb4_unicode_ci
        LEFT JOIN users ru ON l.receiver_openid COLLATE utf8mb4_unicode_ci = ru.openid COLLATE utf8mb4_unicode_ci
        WHERE l.sender_openid = ? OR l.receiver_openid = ?
        GROUP BY other_openid, other_nickname, other_is_virtual
      ) t
      ORDER BY last_time DESC
      LIMIT ? OFFSET ?
    `, [virtualOpenid, virtualOpenid, virtualOpenid, virtualOpenid, virtualOpenid, virtualOpenid, virtualOpenid, pageSize, offset]);

    const [countRows] = await db.query(`
      SELECT COUNT(DISTINCT other_openid) as cnt FROM (
        SELECT CASE WHEN sender_openid = ? THEN receiver_openid ELSE sender_openid END AS other_openid
        FROM letters WHERE sender_openid = ? OR receiver_openid = ?
      ) t
    `, [virtualOpenid, virtualOpenid, virtualOpenid]);

    // 统计总未读数
    const [unreadRows] = await db.query(`
      SELECT COUNT(*) as total_unread FROM letters
      WHERE receiver_openid = ? AND is_read = 0
    `, [virtualOpenid]);

    res.json({
      success: true,
      data: {
        list: threads,
        total: countRows[0].cnt,
        totalUnread: unreadRows[0].total_unread,
        page,
        pageSize
      }
    });
  } catch (err) {
    console.error('[ADMIN] virtual threads error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// GET /api/admin/virtual-users/:openid/thread/:friendOpenid - 获取指定对话的信件记录
router.get('/virtual-users/:openid/thread/:friendOpenid', resolveAdminDualOpenid, async (req, res) => {
  try {
    const virtualOpenid = req.params.openid;
    const friendOpenid = req.params.friendOpenid;
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 50, 200);
    const offset = (page - 1) * pageSize;

    // 校验虚拟用户
    const [vRows] = await db.query('SELECT is_virtual FROM users WHERE openid = ?', [virtualOpenid]);
    if (vRows.length === 0 || vRows[0].is_virtual !== 1) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '该用户不是虚拟用户' });
    }

    // 校验匹配关系
    const [matchRows] = await db.query(
      `SELECT id FROM match_records
       WHERE (user_a_openid = ? AND user_b_openid = ?) OR (user_a_openid = ? AND user_b_openid = ?)`,
      [virtualOpenid, friendOpenid, friendOpenid, virtualOpenid]
    );

    // 查询信件
    const [letters] = await db.query(`
      SELECT l.id, l.sender_openid, l.receiver_openid, l.content, l.is_read, l.created_at,
        su.nickname as sender_nickname, su.is_virtual as sender_is_virtual,
        ru.nickname as receiver_nickname, ru.is_virtual as receiver_is_virtual,
        CASE WHEN l.sender_openid = ? THEN 'sent' ELSE 'received' END as direction
      FROM letters l
      LEFT JOIN users su ON l.sender_openid COLLATE utf8mb4_unicode_ci = su.openid COLLATE utf8mb4_unicode_ci
      LEFT JOIN users ru ON l.receiver_openid COLLATE utf8mb4_unicode_ci = ru.openid COLLATE utf8mb4_unicode_ci
      WHERE (l.sender_openid = ? AND l.receiver_openid = ?)
         OR (l.sender_openid = ? AND l.receiver_openid = ?)
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `, [virtualOpenid, virtualOpenid, friendOpenid, friendOpenid, virtualOpenid, pageSize, offset]);

    const [countRows] = await db.query(`
      SELECT COUNT(*) as cnt FROM letters
      WHERE (sender_openid = ? AND receiver_openid = ?)
         OR (sender_openid = ? AND receiver_openid = ?)
    `, [virtualOpenid, friendOpenid, friendOpenid, virtualOpenid]);

    // 对方用户信息
    const [friendRows] = await db.query(
      'SELECT openid, nickname, is_virtual, plan_type, gender, ming_ben_gua FROM users WHERE openid = ?',
      [friendOpenid]
    );

    res.json({
      success: true,
      data: {
        list: letters,
        total: countRows[0].cnt,
        page,
        pageSize,
        friendInfo: friendRows[0] || null,
        matched: matchRows.length > 0,
        matchId: matchRows[0]?.id || null
      }
    });
  } catch (err) {
    console.error('[ADMIN] virtual thread detail error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// POST /api/admin/virtual-users/:openid/thread/:friendOpenid/reply - 在对话中直接回信
router.post('/virtual-users/:openid/thread/:friendOpenid/reply', resolveAdminDualOpenid, async (req, res) => {
  try {
    const senderOpenid = req.params.openid;
    const receiverOpenid = req.params.friendOpenid; // 已由 resolveAdminDualOpenid 中间件反查为最新主账号
    const { content } = req.body;

    if (!content || content.trim().length < 1) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '信件内容不能为空' });
    }
    if (content.length > 800) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '信件内容不能超过800字' });
    }

    // 校验是否是虚拟用户
    const [senderRows] = await db.query(
      'SELECT openid, nickname, is_virtual, letter_reply_enabled FROM users WHERE openid = ?',
      [senderOpenid]
    );
    if (senderRows.length === 0 || senderRows[0].is_virtual !== 1) {
      return res.json({ success: false, code: 'INVALID_PARAM', message: '只能以虚拟用户身份回信' });
    }
    if (senderRows[0].letter_reply_enabled !== 1) {
      return res.json({ success: false, code: 'REPLY_DISABLED', message: '该虚拟用户回信功能已被关闭' });
    }

    // 校验全局开关
    const [cfgRows] = await db.query(
      "SELECT config_value FROM letter_reply_config WHERE config_key = 'global_reply_enabled'"
    );
    if (cfgRows.length > 0 && cfgRows[0].config_value !== '1') {
      return res.json({ success: false, code: 'GLOBAL_REPLY_DISABLED', message: '全局回信功能已关闭' });
    }

    // 校验匹配关系
    const [matchRows] = await db.query(
      `SELECT id FROM match_records
       WHERE (user_a_openid = ? AND user_b_openid = ?) OR (user_a_openid = ? AND user_b_openid = ?)`,
      [senderOpenid, receiverOpenid, receiverOpenid, senderOpenid]
    );
    if (matchRows.length === 0) {
      return res.json({ success: false, code: 'NOT_MATCHED', message: '虚拟用户与目标用户未匹配，无法回信' });
    }

    // 校验未拉黑
    const [blockRows] = await db.query(
      `SELECT id FROM letter_blocks
       WHERE (blocker_openid = ? AND blocked_openid = ?) OR (blocker_openid = ? AND blocked_openid = ?) LIMIT 1`,
      [senderOpenid, receiverOpenid, receiverOpenid, senderOpenid]
    );
    if (blockRows.length > 0) {
      return res.json({ success: false, code: 'BLOCKED', message: '双方已拉黑，无法回信' });
    }

    // 插入信件
    const [result] = await db.query(
      'INSERT INTO letters (sender_openid, receiver_openid, match_id, content) VALUES (?, ?, ?, ?)',
      [senderOpenid, receiverOpenid, matchRows[0].id, content.trim()]
    );

    // 🔴 v3.5 审计日志
    logAdminAction(req, 'virtual_thread_reply', senderOpenid, { receiver: receiverOpenid, letterId: result.insertId });
    res.json({ success: true, data: { id: result.insertId, sentAt: new Date() } });
  } catch (err) {
    console.error('[ADMIN] virtual thread reply error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// PUT /api/admin/virtual-users/:openid/thread/:friendOpenid/read - 标记对话已读
router.put('/virtual-users/:openid/thread/:friendOpenid/read', resolveAdminDualOpenid, async (req, res) => {
  try {
    const virtualOpenid = req.params.openid;
    const friendOpenid = req.params.friendOpenid;

    const [vRows] = await db.query('SELECT is_virtual FROM users WHERE openid = ?', [virtualOpenid]);
    if (vRows.length === 0 || vRows[0].is_virtual !== 1) {
      return res.json({ success: false, code: 'INVALID_PARAM', message: '该用户不是虚拟用户' });
    }

    await db.query(
      `UPDATE letters SET is_read = 1 WHERE receiver_openid = ? AND sender_openid = ? AND is_read = 0`,
      [virtualOpenid, friendOpenid]
    );
    // 🔴 v3.5 审计日志
    logAdminAction(req, 'virtual_thread_mark_read', virtualOpenid, { friend: friendOpenid });
    res.json({ success: true, data: { message: '已标记为已读' } });
  } catch (err) {
    console.error('[ADMIN] virtual mark read error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// GET /api/admin/letter-reports - 信件举报列表
router.get('/letter-reports', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;
    const status = req.query.status || '';
    let where = '1=1';
    const params = [];
    if (status) { where += ' AND lr.status = ?'; params.push(status); }
    const [rows] = await db.query(
      `SELECT lr.id, lr.reporter_openid, lr.target_openid, lr.letter_id, lr.reason, lr.status, lr.created_at,
        ru.nickname AS reporter_nickname,
        tu.nickname AS target_nickname,
        l.content AS letter_content
      FROM letter_reports lr
      LEFT JOIN users ru ON lr.reporter_openid COLLATE utf8mb4_unicode_ci = ru.openid COLLATE utf8mb4_unicode_ci
      LEFT JOIN users tu ON lr.target_openid COLLATE utf8mb4_unicode_ci = tu.openid COLLATE utf8mb4_unicode_ci
      LEFT JOIN letters l ON lr.letter_id = l.id
      WHERE ${where} ORDER BY lr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [total] = await db.query(`SELECT COUNT(*) as cnt FROM letter_reports lr WHERE ${where}`, params);
    res.json({ success: true, data: { list: rows, total: total[0].cnt, page, pageSize } });
  } catch (err) {
    console.error('[ADMIN] letter-reports error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// PUT /api/admin/letter-reports/:id - 处理举报
router.put('/letter-reports/:id', async (req, res) => {
  try {
    const reportId = req.params.id;
    const { status } = req.body;
    if (!['pending', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'status 仅支持 pending/reviewed/resolved' });
    }
    const [result] = await db.query(
      'UPDATE letter_reports SET status = ? WHERE id = ?',
      [status, reportId]
    );
    if (result.affectedRows === 0) {
      return res.json({ success: false, code: 'NOT_FOUND', message: '举报记录不存在' });
    }
    // 🔴 v3.5 审计日志
    logAdminAction(req, 'letter_report_update', String(reportId), { status });
    res.json({ success: true, data: { message: '举报状态已更新' } });
  } catch (err) {
    console.error('[ADMIN] letter-reports update error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// GET /api/admin/letter-stats - 易缘传书数据统计（管理后台首页/统计页用）
router.get('/letter-stats', async (req, res) => {
  try {
    const data = await cache.wrap('stats:letter-stats', async () => {
    const [matchPoolStats] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE (is_virtual = 0 OR is_virtual IS NULL) AND gender = 1 AND has_profile = 1) AS real_male,
        (SELECT COUNT(*) FROM users WHERE (is_virtual = 0 OR is_virtual IS NULL) AND gender = 2 AND has_profile = 1) AS real_female,
        (SELECT COUNT(*) FROM users WHERE is_virtual = 1 AND gender = 1) AS virtual_male,
        (SELECT COUNT(*) FROM users WHERE is_virtual = 1 AND gender = 2) AS virtual_female,
        (SELECT COUNT(*) FROM match_records m WHERE EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = m.user_a_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS total_matches,
        (SELECT COUNT(*) FROM letters l WHERE EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS total_letters,
        (SELECT COUNT(*) FROM letters l WHERE l.created_at >= CURDATE() AND l.created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY) AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS today_letters,
        (SELECT COUNT(*) FROM match_records m WHERE m.created_at >= CURDATE() AND m.created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY) AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = m.user_a_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS today_matches,
        (SELECT COUNT(*) FROM letter_reports WHERE status = 'pending') AS pending_reports,
        (SELECT COUNT(*) FROM letter_blocks) AS total_blocks
    `);
    // 近7天每日匹配/信件趋势
    const [trend] = await db.query(`
      SELECT dates.d AS date,
        (SELECT COUNT(*) FROM match_records m WHERE m.created_at >= dates.d AND m.created_at < DATE_ADD(dates.d, INTERVAL 1 DAY) AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = m.user_a_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS match_count,
        (SELECT COUNT(*) FROM letters l WHERE l.created_at >= dates.d AND l.created_at < DATE_ADD(dates.d, INTERVAL 1 DAY) AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS letter_count
      FROM (
        SELECT CURDATE() AS d UNION SELECT DATE_SUB(CURDATE(), INTERVAL 1 DAY) UNION
        SELECT DATE_SUB(CURDATE(), INTERVAL 2 DAY) UNION SELECT DATE_SUB(CURDATE(), INTERVAL 3 DAY) UNION
        SELECT DATE_SUB(CURDATE(), INTERVAL 4 DAY) UNION SELECT DATE_SUB(CURDATE(), INTERVAL 5 DAY) UNION
        SELECT DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      ) dates ORDER BY dates.d ASC
    `);
    // 卦象分布（虚拟用户）
    const [guaDist] = await db.query(`
      SELECT h.full_name AS gua_name, COUNT(*) AS cnt
      FROM users u LEFT JOIN hexagrams h ON u.ming_ben_gua = h.id
      WHERE u.is_virtual = 1 AND u.ming_ben_gua IS NOT NULL AND u.ming_ben_gua > 0
      GROUP BY u.ming_ben_gua, h.full_name ORDER BY cnt DESC
    `);
    return {
      overview: matchPoolStats[0],
      trend7d: trend,
      guaDistribution: guaDist
    };
    }, 300);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[ADMIN] letter-stats error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// ============================================================
// 模块：用户封禁管理（v2.1 新增）
// ============================================================

// PUT /api/admin/users/:openid/ban - 封禁用户
router.put('/users/:openid/ban', resolveAdminOpenid, async (req, res) => {
  try {
    const targetOpenid = req.params.openid;
    const { reason } = req.body;
    const [result] = await db.query('UPDATE users SET status = 0 WHERE openid = ?', [targetOpenid]);
    if (result.affectedRows === 0) {
      return res.json({ success: false, code: 'NOT_FOUND', message: '用户不存在' });
    }
    // 清除封禁缓存（同时清理旧 openid 的缓存，防止残留）
    try {
      await cache.del(`ban:${targetOpenid}`);
      if (req.originalOpenid && req.originalOpenid !== targetOpenid) {
        await cache.del(`ban:${req.originalOpenid}`);
      }
    } catch (e) {}
    // 记录操作日志
    const adminId = req.admin?.id || 0;
    await db.query('INSERT INTO admin_logs (admin_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)',
      [adminId, 'ban_user', targetOpenid, JSON.stringify({ reason: reason || '管理员封禁' }), req.ip]);
    res.json({ success: true, data: { message: '用户已封禁' } });
  } catch (err) {
    console.error('[ADMIN] ban user error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// PUT /api/admin/users/:openid/unban - 解封用户
router.put('/users/:openid/unban', resolveAdminOpenid, async (req, res) => {
  try {
    const targetOpenid = req.params.openid;
    const [result] = await db.query('UPDATE users SET status = 1 WHERE openid = ?', [targetOpenid]);
    if (result.affectedRows === 0) {
      return res.json({ success: false, code: 'NOT_FOUND', message: '用户不存在' });
    }
    // 清除封禁缓存（同时清理旧 openid 的缓存，防止残留）
    try {
      await cache.del(`ban:${targetOpenid}`);
      if (req.originalOpenid && req.originalOpenid !== targetOpenid) {
        await cache.del(`ban:${req.originalOpenid}`);
      }
    } catch (e) {}
    const adminId = req.admin?.id || 0;
    await db.query('INSERT INTO admin_logs (admin_id, action, target, ip) VALUES (?, ?, ?, ?)',
      [adminId, 'unban_user', targetOpenid, req.ip]);
    res.json({ success: true, data: { message: '用户已解封' } });
  } catch (err) {
    console.error('[ADMIN] unban user error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// ============================================================
// 模块：举报管理增强（v2.1 新增）
// ============================================================

// GET /api/admin/letter-reports/ranking - 被举报用户排行（按被举报次数倒序）
router.get('/letter-reports/ranking', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const [rows] = await db.query(`
      SELECT
        lr.target_openid,
        u.nickname AS target_nickname,
        u.gender,
        u.plan_type,
        u.is_virtual,
        u.status,
        COUNT(*) AS report_count,
        SUM(CASE WHEN lr.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
        MIN(lr.created_at) AS first_report_time,
        MAX(lr.created_at) AS last_report_time,
        GROUP_CONCAT(DISTINCT lr.reason) AS reasons
      FROM letter_reports lr
      LEFT JOIN users u ON lr.target_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci
      GROUP BY lr.target_openid, u.nickname, u.gender, u.plan_type, u.is_virtual, u.status
      ORDER BY report_count DESC
      LIMIT ?
    `, [limit]);
    res.json({ success: true, data: { list: rows } });
  } catch (err) {
    console.error('[ADMIN] letter-reports ranking error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// GET /api/admin/letter-reports/stats - 举报统计概览
router.get('/letter-reports/stats', async (req, res) => {
  try {
    const [overview] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM letter_reports) AS total_reports,
        (SELECT COUNT(*) FROM letter_reports WHERE status = 'pending') AS pending_reports,
        (SELECT COUNT(*) FROM letter_reports WHERE created_at >= CURDATE() AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)) AS today_reports,
        (SELECT COUNT(*) FROM letter_reports WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS week_reports,
        (SELECT COUNT(DISTINCT target_openid) FROM letter_reports) AS reported_users,
        (SELECT COUNT(*) FROM users WHERE status = 0 AND (is_virtual = 0 OR is_virtual IS NULL)) AS banned_users
    `);
    const [reasonDist] = await db.query(`
      SELECT reason, COUNT(*) AS cnt
      FROM letter_reports
      GROUP BY reason ORDER BY cnt DESC
    `);
    res.json({ success: true, data: { overview: overview[0], reasonDistribution: reasonDist } });
  } catch (err) {
    console.error('[ADMIN] letter-reports stats error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// GET /api/admin/letter-reports/:id/detail - 举报详情（含信件内容、举报人/被举报人信息）
router.get('/letter-reports/:id/detail', async (req, res) => {
  try {
    const reportId = req.params.id;
    const [rows] = await db.query(`
      SELECT
        lr.id, lr.reason, lr.status, lr.created_at,
        lr.reporter_openid, ru.nickname AS reporter_nickname, ru.gender AS reporter_gender,
        lr.target_openid, tu.nickname AS target_nickname, tu.gender AS target_gender,
        tu.plan_type AS target_plan_type, tu.is_virtual AS target_is_virtual, tu.status AS target_status,
        lr.letter_id, l.content AS letter_content, l.created_at AS letter_time,
        (SELECT COUNT(*) FROM letter_reports WHERE target_openid = lr.target_openid) AS target_total_reported
      FROM letter_reports lr
      LEFT JOIN users ru ON lr.reporter_openid COLLATE utf8mb4_unicode_ci = ru.openid COLLATE utf8mb4_unicode_ci
      LEFT JOIN users tu ON lr.target_openid COLLATE utf8mb4_unicode_ci = tu.openid COLLATE utf8mb4_unicode_ci
      LEFT JOIN letters l ON lr.letter_id = l.id
      WHERE lr.id = ?
    `, [reportId]);
    if (rows.length === 0) {
      return res.json({ success: false, code: 'NOT_FOUND', message: '举报记录不存在' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[ADMIN] letter-reports detail error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// ============================================================
// 模块：易缘传书漏斗分析（v2.1 新增）
// ============================================================

// GET /api/admin/letter-funnel - 易缘传书转化漏斗
router.get('/letter-funnel', async (req, res) => {
  try {
    // 🔴 v3.4 安全修复：days 参数上限 365，防止递归 CTE 爆炸
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = `DATE_SUB(NOW(), INTERVAL ${days} DAY)`;
    const [rows] = await db.query(`
      SELECT
        (SELECT COUNT(DISTINCT openid) FROM (
          SELECT m.user_a_openid as openid FROM match_records m WHERE (m.source = 'letter' OR m.source IS NULL) AND m.created_at >= ${since}
            AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = m.user_a_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
          UNION
          SELECT m.user_b_openid as openid FROM match_records m WHERE (m.source = 'letter' OR m.source IS NULL) AND m.created_at >= ${since}
            AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = m.user_b_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
        ) t) AS step1_users,
        (SELECT COUNT(DISTINCT CONCAT(LEAST(user_a_openid, user_b_openid), '|', GREATEST(user_a_openid, user_b_openid))) FROM match_records m WHERE (m.source = 'letter' OR m.source IS NULL) AND m.created_at >= ${since} AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = m.user_a_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS total_pairs,
        (SELECT COUNT(DISTINCT l.sender_openid) FROM letters l WHERE l.created_at >= ${since} AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS step2_sent,
        (SELECT COUNT(DISTINCT l.sender_openid) FROM letters l WHERE l.is_read = 1 AND l.created_at >= ${since} AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS step3_read,
        (SELECT COUNT(DISTINCT l1.sender_openid) FROM letters l1
         WHERE l1.is_read = 1 AND l1.created_at >= ${since}
         AND l1.sender_openid IN (
           SELECT DISTINCT l2.receiver_openid FROM letters l2
           WHERE l2.sender_openid COLLATE utf8mb4_unicode_ci = l1.receiver_openid COLLATE utf8mb4_unicode_ci AND l2.created_at >= ${since}
         )
         AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l1.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
        ) AS step4_replied,
        (SELECT COUNT(DISTINCT l.sender_openid) FROM letters l
         WHERE l.is_read = 1 AND l.created_at >= ${since}
         AND EXISTS (
           SELECT 1 FROM (
             SELECT LEAST(sender_openid, receiver_openid) AS ua, GREATEST(sender_openid, receiver_openid) AS ub
             FROM letters WHERE created_at >= ${since}
             GROUP BY ua, ub HAVING COUNT(*) >= 3 AND SUM(sender_openid = ua) > 0 AND SUM(sender_openid = ub) > 0
           ) deep
           WHERE l.sender_openid COLLATE utf8mb4_unicode_ci = deep.ua COLLATE utf8mb4_unicode_ci
              OR l.sender_openid COLLATE utf8mb4_unicode_ci = deep.ub COLLATE utf8mb4_unicode_ci
         )
         AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
        ) AS step5_deep
    `);
    const data = rows[0];
    const s1 = Number(data.step1_users) || 0;
    const s2 = Number(data.step2_sent) || 0;
    const s3 = Number(data.step3_read) || 0;
    const s4 = Number(data.step4_replied) || 0;
    const s5 = Number(data.step5_deep) || 0;
    const funnel = [
      { step: 1, label: '参与匹配用户', count: s1, conversionRate: 100 },
      { step: 2, label: '发送首封信', count: s2, conversionRate: s1 > 0 ? parseFloat(((s2 / s1) * 100).toFixed(1)) : 0 },
      { step: 3, label: '信件被阅读', count: s3, conversionRate: s2 > 0 ? parseFloat(((s3 / s2) * 100).toFixed(1)) : 0 },
      { step: 4, label: '收到回信', count: s4, conversionRate: s3 > 0 ? parseFloat(((s4 / s3) * 100).toFixed(1)) : 0 },
      { step: 5, label: '深度交流(互发3+封)', count: s5, conversionRate: s4 > 0 ? parseFloat(((s5 / s4) * 100).toFixed(1)) : 0 }
    ];
    res.json({ success: true, data: { funnel, days } });
  } catch (err) {
    console.error('[ADMIN] letter-funnel error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// ============================================================
// 模块：信件分析（v2.1 新增）
// ============================================================

// GET /api/admin/letter-analysis - 信件深度分析
router.get('/letter-analysis', async (req, res) => {
  try {
    // 🔴 v3.4 安全修复：days 参数上限 365，防止递归 CTE 爆炸
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = `DATE_SUB(NOW(), INTERVAL ${days} DAY)`;
    const [overview] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM letters l WHERE l.created_at >= ${since} AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS total_letters,
        (SELECT COUNT(DISTINCT l.sender_openid) FROM letters l WHERE l.created_at >= ${since} AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS unique_senders,
        (SELECT COUNT(DISTINCT l.receiver_openid) FROM letters l WHERE l.created_at >= ${since} AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.receiver_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS unique_receivers,
        (SELECT AVG(CHAR_LENGTH(l.content)) FROM letters l WHERE l.created_at >= ${since} AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS avg_length,
        (SELECT COUNT(*) FROM letters l WHERE l.is_read = 1 AND l.created_at >= ${since} AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS read_count,
        (SELECT COUNT(DISTINCT l1.receiver_openid) FROM letters l1
         WHERE l1.receiver_openid IN (
           SELECT DISTINCT l2.sender_openid FROM letters l2
           WHERE l2.receiver_openid COLLATE utf8mb4_unicode_ci = l1.receiver_openid COLLATE utf8mb4_unicode_ci AND l2.created_at >= ${since}
         ) AND l1.created_at >= ${since}
         AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l1.receiver_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
        ) AS replied_receivers
    `);
    // 信件趋势
    const [trend] = await db.query(`
      SELECT DATE(l.created_at) AS date, COUNT(*) AS count
      FROM letters l WHERE l.created_at >= ${since}
      AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
      GROUP BY DATE(l.created_at) ORDER BY date
    `);
    // 信件长度分布
    const [lengthDist] = await db.query(`
      SELECT
        CASE
          WHEN CHAR_LENGTH(l.content) < 50 THEN '短信(<50字)'
          WHEN CHAR_LENGTH(l.content) < 200 THEN '中信(50-200字)'
          WHEN CHAR_LENGTH(l.content) < 500 THEN '长信(200-500字)'
          ELSE '超长信(>500字)'
        END AS length_range,
        COUNT(*) AS cnt
      FROM letters l WHERE l.created_at >= ${since}
      AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
      GROUP BY length_range
    `);
    // 发送时段分布
    const [hourlyDist] = await db.query(`
      SELECT HOUR(l.created_at) AS hour, COUNT(*) AS cnt
      FROM letters l WHERE l.created_at >= ${since}
      AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
      GROUP BY HOUR(l.created_at) ORDER BY hour
    `);
    const o = overview[0];
    const replyRate = o.unique_receivers > 0 ? parseFloat(((o.replied_receivers / o.unique_receivers) * 100).toFixed(1)) : 0;
    res.json({
      success: true,
      data: {
        overview: {
          totalLetters: o.total_letters || 0,
          uniqueSenders: o.unique_senders || 0,
          uniqueReceivers: o.unique_receivers || 0,
          avgPerSender: o.unique_senders > 0 ? parseFloat((o.total_letters / o.unique_senders).toFixed(1)) : 0,
          avgLength: o.avg_length ? Math.round(o.avg_length) : 0,
          readRate: o.total_letters > 0 ? parseFloat(((o.read_count / o.total_letters) * 100).toFixed(1)) : 0,
          replyRate: replyRate
        },
        trend,
        lengthDistribution: lengthDist,
        hourlyDistribution: hourlyDist,
        days
      }
    });
  } catch (err) {
    console.error('[ADMIN] letter-analysis error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// v15.14 GET /api/admin/letter-history - 信件历史（谁给谁发信）
router.get('/letter-history', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, parseInt(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const senderKeyword = req.query.sender || '';
    const receiverKeyword = req.query.receiver || '';

    let where = '1=1';
    const params = [];

    if (senderKeyword) {
      where += ' AND (s.nickname LIKE ? OR s.openid LIKE ?)';
      params.push(`%${senderKeyword}%`, `%${senderKeyword}%`);
    }
    if (receiverKeyword) {
      where += ' AND (r.nickname LIKE ? OR r.openid LIKE ?)';
      params.push(`%${receiverKeyword}%`, `%${receiverKeyword}%`);
    }

    const [rows] = await db.query(`
      SELECT l.id, l.content, l.is_read, l.created_at,
        s.openid as sender_openid, s.nickname as sender_nickname,
        r.openid as receiver_openid, r.nickname as receiver_nickname
      FROM letters l
      LEFT JOIN users s ON l.sender_openid COLLATE utf8mb4_unicode_ci = s.openid COLLATE utf8mb4_unicode_ci
      LEFT JOIN users r ON l.receiver_openid COLLATE utf8mb4_unicode_ci = r.openid COLLATE utf8mb4_unicode_ci
      WHERE ${where}
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);

    const [total] = await db.query(`
      SELECT COUNT(*) as cnt FROM letters l
      LEFT JOIN users s ON l.sender_openid COLLATE utf8mb4_unicode_ci = s.openid COLLATE utf8mb4_unicode_ci
      LEFT JOIN users r ON l.receiver_openid COLLATE utf8mb4_unicode_ci = r.openid COLLATE utf8mb4_unicode_ci
      WHERE ${where}
    `, params);

    res.json({
      success: true,
      data: {
        list: rows,
        total: total[0].cnt,
        page,
        pageSize
      }
    });
  } catch (err) {
    console.error('[ADMIN] letter-history error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// ============================================================
// 模块：虚拟用户管理增强（v2.1 新增）
// ============================================================

// GET /api/admin/virtual-users/enhanced - 虚拟用户增强列表（含活跃度、被举报数）
router.get('/virtual-users/enhanced', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;
    const keyword = req.query.keyword || '';
    const gender = req.query.gender;
    const unreadOnly = req.query.unreadOnly === '1' || req.query.unreadOnly === 1;
    let where = 'is_virtual = 1';
    const params = [];
    if (keyword) { where += ' AND (nickname LIKE ? OR openid LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
    if (gender) { where += ' AND gender = ?'; params.push(parseInt(gender)); }
    if (unreadOnly) {
      where += ' AND EXISTS (SELECT 1 FROM letters WHERE receiver_openid = u.openid AND is_read = 0)';
    }

    const [rows] = await db.query(`
      SELECT u.openid, u.nickname, u.gender, u.ming_ben_gua, u.birth_year, u.birth_month, u.birth_day, u.birth_shichen,
        u.plan_type, u.letter_reply_enabled, u.status, u.created_at,
        h.full_name AS gua_name,
        COALESCE((SELECT COUNT(*) FROM match_records WHERE user_a_openid = u.openid OR user_b_openid = u.openid), 0) AS match_count,
        COALESCE((SELECT COUNT(*) FROM letters WHERE sender_openid = u.openid), 0) AS sent_letter_count,
        COALESCE((SELECT COUNT(*) FROM letters WHERE receiver_openid = u.openid), 0) AS received_letter_count,
        COALESCE((SELECT COUNT(*) FROM letter_reports WHERE target_openid = u.openid), 0) AS reported_count,
        COALESCE((SELECT COUNT(*) FROM letters WHERE receiver_openid = u.openid AND is_read = 0), 0) AS unread_letter_count,
        (SELECT MAX(created_at) FROM match_records WHERE user_a_openid = u.openid OR user_b_openid = u.openid) AS last_match_time,
        (SELECT MAX(created_at) FROM letters WHERE receiver_openid = u.openid) AS last_received_time
      FROM users u LEFT JOIN hexagrams h ON u.ming_ben_gua = h.id
      WHERE ${where}
      ORDER BY last_received_time IS NULL, last_received_time DESC, u.created_at DESC LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);
    const [total] = await db.query(`SELECT COUNT(*) as cnt FROM users u WHERE ${where}`, params);
    // 统计所有虚拟用户的总未读信件数（不受 unreadOnly 影响）
    const [unreadTotal] = await db.query(`SELECT COUNT(*) AS cnt FROM letters l JOIN users u ON l.receiver_openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci WHERE u.is_virtual = 1 AND l.is_read = 0`);
    res.json({ success: true, data: { list: rows, total: total[0].cnt, page, pageSize, totalUnread: unreadTotal[0].cnt } });
  } catch (err) {
    console.error('[ADMIN] virtual-users enhanced error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// PUT /api/admin/virtual-users/batch-reply-toggle - 批量开关回信
router.put('/virtual-users/batch-reply-toggle', async (req, res) => {
  try {
    const { openids: rawOpenids, enabled } = req.body;
    if (!Array.isArray(rawOpenids) || rawOpenids.length === 0) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'openids 必须为非空数组' });
    }
    // 🔴 关键修复：批量操作时逐个反查 openid，避免漏掉旧 openid 的虚拟用户
    const openids = await Promise.all(rawOpenids.map(o => resolveOpenidStandalone(o)));
    const placeholders = openids.map(() => '?').join(',');
    const [result] = await db.query(
      `UPDATE users SET letter_reply_enabled = ? WHERE openid IN (${placeholders}) AND is_virtual = 1`,
      [enabled ? 1 : 0, ...openids]
    );
    res.json({ success: true, data: { message: `已${enabled ? '开启' : '关闭'} ${result.affectedRows} 个虚拟用户的回信功能` } });
    // 🔴 v3.5 审计日志
    logAdminAction(req, 'virtual_batch_reply_toggle', 'multiple', { enabled: !!enabled, count: result.affectedRows });
  } catch (err) {
    console.error('[ADMIN] batch reply toggle error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// ============================================================
// 模块：用户详情增强 - 举报/拉黑记录（v2.1 新增）
// ============================================================

// GET /api/admin/users/:openid/reports - 用户被举报记录
router.get('/users/:openid/reports', resolveAdminOpenid, async (req, res) => {
  try {
    const targetOpenid = req.params.openid;
    const [rows] = await db.query(`
      SELECT lr.id, lr.reason, lr.status, lr.created_at,
        ru.nickname AS reporter_nickname,
        l.content AS letter_content
      FROM letter_reports lr
      LEFT JOIN users ru ON lr.reporter_openid COLLATE utf8mb4_unicode_ci = ru.openid COLLATE utf8mb4_unicode_ci
      LEFT JOIN letters l ON lr.letter_id = l.id
      WHERE lr.target_openid = ?
      ORDER BY lr.created_at DESC LIMIT 50
    `, [targetOpenid]);
    res.json({ success: true, data: { list: rows } });
  } catch (err) {
    console.error('[ADMIN] user reports error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// GET /api/admin/users/:openid/blocks - 用户拉黑记录
router.get('/users/:openid/blocks', resolveAdminOpenid, async (req, res) => {
  try {
    const targetOpenid = req.params.openid;
    const [asBlocker] = await db.query(`
      SELECT lb.created_at, bu.nickname AS blocked_nickname
      FROM letter_blocks lb LEFT JOIN users bu ON lb.blocked_openid COLLATE utf8mb4_unicode_ci = bu.openid COLLATE utf8mb4_unicode_ci
      WHERE lb.blocker_openid = ? ORDER BY lb.created_at DESC LIMIT 50
    `, [targetOpenid]);
    const [asBlocked] = await db.query(`
      SELECT lb.created_at, bu.nickname AS blocker_nickname
      FROM letter_blocks lb LEFT JOIN users bu ON lb.blocker_openid COLLATE utf8mb4_unicode_ci = bu.openid COLLATE utf8mb4_unicode_ci
      WHERE lb.blocked_openid = ? ORDER BY lb.created_at DESC LIMIT 50
    `, [targetOpenid]);
    res.json({ success: true, data: { blockedByMe: asBlocker, blockedMe: asBlocked } });
  } catch (err) {
    console.error('[ADMIN] user blocks error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// ============================================================
// 模块：匹配分析增强（v2.1 新增）
// ============================================================

// GET /api/admin/match-analysis/enhanced - 匹配增强分析（含写信率、卦象热度）
router.get('/match-analysis/enhanced', async (req, res) => {
  try {
    // 🔴 v3.4 安全修复：days 参数上限 365，防止递归 CTE 爆炸
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = `DATE_SUB(NOW(), INTERVAL ${days} DAY)`;
    // 匹配后写信率
    const [matchLetter] = await db.query(`
      SELECT
        (SELECT COUNT(DISTINCT CONCAT(LEAST(user_a_openid, user_b_openid), '|', GREATEST(user_a_openid, user_b_openid))) FROM match_records m WHERE m.created_at >= ${since} AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = m.user_a_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))) AS matched_pairs,
        (SELECT COUNT(DISTINCT CONCAT(LEAST(l.sender_openid, l.receiver_openid), '|', GREATEST(l.sender_openid, l.receiver_openid))) FROM letters l
         WHERE l.created_at >= ${since}
         AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = l.sender_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
         AND EXISTS(SELECT 1 FROM match_records m WHERE m.created_at >= ${since}
           AND ((m.user_a_openid COLLATE utf8mb4_unicode_ci=l.sender_openid COLLATE utf8mb4_unicode_ci AND m.user_b_openid COLLATE utf8mb4_unicode_ci=l.receiver_openid COLLATE utf8mb4_unicode_ci)
             OR (m.user_a_openid COLLATE utf8mb4_unicode_ci=l.receiver_openid COLLATE utf8mb4_unicode_ci AND m.user_b_openid COLLATE utf8mb4_unicode_ci=l.sender_openid COLLATE utf8mb4_unicode_ci)))
        ) AS letter_pairs
    `);
    // 卦象匹配热度（Top 20 最常配对的卦象组合）
    const [guaHeat] = await db.query(`
      SELECT
        CONCAT(ha.full_name, ' × ', hb.full_name) AS gua_pair,
        mr.gua_a, mr.gua_b,
        COUNT(*) AS match_count
      FROM match_records mr
      LEFT JOIN hexagrams ha ON mr.gua_a = ha.id
      LEFT JOIN hexagrams hb ON mr.gua_b = hb.id
      WHERE mr.created_at >= ${since} AND mr.gua_a IS NOT NULL AND mr.gua_b IS NOT NULL
        AND EXISTS (SELECT 1 FROM users u WHERE u.openid COLLATE utf8mb4_unicode_ci = mr.user_a_openid COLLATE utf8mb4_unicode_ci AND (u.is_virtual = 0 OR u.is_virtual IS NULL))
      GROUP BY mr.gua_a, mr.gua_b, ha.full_name, hb.full_name
      ORDER BY match_count DESC LIMIT 20
    `);
    const ml = matchLetter[0];
    const letterRate = ml.matched_pairs > 0 ? parseFloat(((ml.letter_pairs / ml.matched_pairs) * 100).toFixed(1)) : 0;
    res.json({
      success: true,
      data: {
        matchLetterConversion: {
          matchedPairs: ml.matched_pairs || 0,
          letterPairs: ml.letter_pairs || 0,
          letterRate: letterRate
        },
        guaHeat: guaHeat,
        days
      }
    });
  } catch (err) {
    console.error('[ADMIN] match-analysis enhanced error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// ============================================================
// 模块：节气养生管理 Solar Term Health（v2.2 新增）
// ============================================================

// GET /api/admin/solar-term/stats - L3 生成进度统计
router.get('/solar-term/stats', async (req, res) => {
  try {
    const [overall] = await db.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IS NOT NULL THEN 1 ELSE 0 END) AS gen_count,
        SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS reviewed,
        SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS needFix
      FROM solar_term_health_advice
    `);
    // 按节气分布
    const [byTerm] = await db.query(`
      SELECT s.solar_term_index, s.name,
        COUNT(a.id) AS gen_count,
        SUM(CASE WHEN a.status = 1 THEN 1 ELSE 0 END) AS reviewed
      FROM solar_term_basic s
      LEFT JOIN solar_term_health_advice a ON s.solar_term_index = a.solar_term_index
      GROUP BY s.solar_term_index, s.name
      ORDER BY s.solar_term_index
    `);
    // 按卦格五行分布
    const [byGuaWuxing] = await db.query(`
      SELECT gua_wuxing,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS reviewed
      FROM solar_term_health_advice
      GROUP BY gua_wuxing
    `);
    const o = overall[0] || {};
    const totalExpected = 1536;
    res.json({
      success: true,
      data: {
        totalExpected,
        total: o.total || 0,
        generated: o.gen_count || 0,
        pending: o.pending || 0,
        reviewed: o.reviewed || 0,
        needFix: o.needFix || 0,
        completionRate: totalExpected > 0 ? parseFloat((((o.total || 0) / totalExpected) * 100).toFixed(1)) : 0,
        reviewRate: (o.total || 0) > 0 ? parseFloat((((o.reviewed || 0) / o.total) * 100).toFixed(1)) : 0,
        byTerm,
        byGuaWuxing
      }
    });
  } catch (err) {
    console.error('[ADMIN] solar-term/stats error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// GET /api/admin/solar-term/advices - L3 列表（分页+筛选）
router.get('/solar-term/advices', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;
    const { termIndex, guaIndex, status, guaWuxing, termWuxing, keyword } = req.query;

    const where = [];
    const params = [];
    if (termIndex !== undefined && termIndex !== '') {
      where.push('solar_term_index = ?');
      params.push(parseInt(termIndex));
    }
    if (guaIndex !== undefined && guaIndex !== '') {
      where.push('gua_index = ?');
      params.push(parseInt(guaIndex));
    }
    if (status !== undefined && status !== '') {
      where.push('status = ?');
      params.push(parseInt(status));
    }
    if (guaWuxing) {
      where.push('gua_wuxing = ?');
      params.push(guaWuxing);
    }
    if (termWuxing) {
      where.push('term_wuxing = ?');
      params.push(termWuxing);
    }
    if (keyword) {
      where.push('(gua_ge LIKE ? OR warning LIKE ? OR classic_quote LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows] = await db.query(
      `SELECT id, solar_term_index, gua_index, gua_ge, gua_wuxing, term_wuxing,
              element_interaction, relation_type, corresponding_organ,
              LEFT(warning, 80) AS warning_preview,
              status, updated_at
       FROM solar_term_health_advice
       ${whereClause}
       ORDER BY solar_term_index ASC, gua_index ASC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM solar_term_health_advice ${whereClause}`,
      params
    );
    res.json({
      success: true,
      data: { list: rows, total: countRows[0].cnt, page, pageSize }
    });
  } catch (err) {
    console.error('[ADMIN] solar-term/advices error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// GET /api/admin/solar-term/advices/:id - L3 详情
router.get('/solar-term/advices/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '无效ID' });
    const [rows] = await db.query(
      `SELECT * FROM solar_term_health_advice WHERE id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: '记录不存在' });
    }
    // 解析 JSON 字段
    const row = rows[0];
    const parseJson = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) return v;
      try { return JSON.parse(v); } catch (e) { return []; }
    };
    row.recommend_food = parseJson(row.recommend_food);
    row.recommend_activity = parseJson(row.recommend_activity);
    row.recommend_emotion = parseJson(row.recommend_emotion);
    row.recommend_avoid = parseJson(row.recommend_avoid);
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[ADMIN] solar-term/advices/:id error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// PUT /api/admin/solar-term/advices/:id - 编辑 L3 内容
router.put('/solar-term/advices/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '无效ID' });
    const {
      warning, corresponding_organ, element_interaction,
      recommend_food, recommend_activity, recommend_emotion, recommend_avoid,
      classic_quote, classic_source, classic_interpretation
    } = req.body;

    const updates = [];
    const params = [];
    if (warning !== undefined) { updates.push('warning = ?'); params.push(warning); }
    if (corresponding_organ !== undefined) { updates.push('corresponding_organ = ?'); params.push(corresponding_organ); }
    if (element_interaction !== undefined) { updates.push('element_interaction = ?'); params.push(element_interaction); }
    if (recommend_food !== undefined) { updates.push('recommend_food = ?'); params.push(JSON.stringify(recommend_food || [])); }
    if (recommend_activity !== undefined) { updates.push('recommend_activity = ?'); params.push(JSON.stringify(recommend_activity || [])); }
    if (recommend_emotion !== undefined) { updates.push('recommend_emotion = ?'); params.push(JSON.stringify(recommend_emotion || [])); }
    if (recommend_avoid !== undefined) { updates.push('recommend_avoid = ?'); params.push(JSON.stringify(recommend_avoid || [])); }
    if (classic_quote !== undefined) { updates.push('classic_quote = ?'); params.push(classic_quote); }
    if (classic_source !== undefined) { updates.push('classic_source = ?'); params.push(classic_source); }
    if (classic_interpretation !== undefined) { updates.push('classic_interpretation = ?'); params.push(classic_interpretation); }

    if (updates.length === 0) {
      return res.json({ success: false, code: 'NO_CHANGE', message: '没有需要更新的字段' });
    }
    params.push(id);
    await db.query(
      `UPDATE solar_term_health_advice SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    // 🔴 v3.5 审计日志
    logAdminAction(req, 'solar_term_advice_update', String(id), { fields: updates.length });
    res.json({ success: true, data: { message: '更新成功' } });
  } catch (err) {
    console.error('[ADMIN] solar-term/advices PUT error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// PUT /api/admin/solar-term/advices/:id/status - 修改审核状态
router.put('/solar-term/advices/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    if (!id) return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '无效ID' });
    if (![0, 1, 2].includes(status)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'status 必须为 0/1/2' });
    }
    await db.query('UPDATE solar_term_health_advice SET status = ? WHERE id = ?', [status, id]);
    // 🔴 v3.5 审计日志
    logAdminAction(req, 'solar_term_advice_status', String(id), { status });
    res.json({ success: true, data: { message: '状态已更新' } });
  } catch (err) {
    console.error('[ADMIN] solar-term/advices/status error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// POST /api/admin/solar-term/batch-status - 批量修改审核状态
router.post('/solar-term/batch-status', async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'ids 必须为非空数组' });
    }
    if (![0, 1, 2].includes(status)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'status 必须为 0/1/2' });
    }
    const placeholders = ids.map(() => '?').join(',');
    const [result] = await db.query(
      `UPDATE solar_term_health_advice SET status = ? WHERE id IN (${placeholders})`,
      [status, ...ids]
    );
    res.json({ success: true, data: { affected: result.affectedRows, message: `已批量更新 ${result.affectedRows} 条` } });
  } catch (err) {
    console.error('[ADMIN] solar-term/batch-status error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// GET /api/admin/solar-term/basic - L1 节气基础列表
router.get('/solar-term/basic', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM solar_term_basic ORDER BY solar_term_index ASC`
    );
    // 解析 JSON 字段
    const parseJson = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) return v;
      try { return JSON.parse(v); } catch (e) { return []; }
    };
    rows.forEach(r => {
      r.wu_hou = parseJson(r.wu_hou);
      r.keywords = parseJson(r.keywords);
      r.general_yi_food = parseJson(r.general_yi_food);
      r.general_yi_activity = parseJson(r.general_yi_activity);
      r.general_yi_emotion = parseJson(r.general_yi_emotion);
      r.general_ji = parseJson(r.general_ji);
    });
    res.json({ success: true, data: { list: rows, total: rows.length } });
  } catch (err) {
    console.error('[ADMIN] solar-term/basic error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// PUT /api/admin/solar-term/basic/:index - 编辑 L1 节气基础信息
router.put('/solar-term/basic/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    if (index < 0 || index > 23) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '节气索引 0-23' });
    }
    const {
      season_desc, neijing_quote, neijing_source, neijing_interpretation,
      general_yi_food, general_yi_activity, general_yi_emotion, general_ji
    } = req.body;

    const updates = [];
    const params = [];
    if (season_desc !== undefined) { updates.push('season_desc = ?'); params.push(season_desc); }
    if (neijing_quote !== undefined) { updates.push('neijing_quote = ?'); params.push(neijing_quote); }
    if (neijing_source !== undefined) { updates.push('neijing_source = ?'); params.push(neijing_source); }
    if (neijing_interpretation !== undefined) { updates.push('neijing_interpretation = ?'); params.push(neijing_interpretation); }
    if (general_yi_food !== undefined) { updates.push('general_yi_food = ?'); params.push(JSON.stringify(general_yi_food || [])); }
    if (general_yi_activity !== undefined) { updates.push('general_yi_activity = ?'); params.push(JSON.stringify(general_yi_activity || [])); }
    if (general_yi_emotion !== undefined) { updates.push('general_yi_emotion = ?'); params.push(JSON.stringify(general_yi_emotion || [])); }
    if (general_ji !== undefined) { updates.push('general_ji = ?'); params.push(JSON.stringify(general_ji || [])); }

    if (updates.length === 0) {
      return res.json({ success: false, code: 'NO_CHANGE', message: '没有需要更新的字段' });
    }
    params.push(index);
    await db.query(
      `UPDATE solar_term_basic SET ${updates.join(', ')} WHERE solar_term_index = ?`,
      params
    );
    // 🔴 v3.5 审计日志
    logAdminAction(req, 'solar_term_basic_update', String(index), { fields: updates.length });
    res.json({ success: true, data: { message: 'L1 节气基础信息已更新' } });
  } catch (err) {
    console.error('[ADMIN] solar-term/basic PUT error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// ============================================================
// 模块：APP 错误上报（v15.15 新增）
// ============================================================

// POST /api/admin/app-error-report - APP 端上报错误
// GET /api/admin/app-error-reports - 查看错误上报列表
router.get('/app-error-reports', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, parseInt(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const errorType = req.query.errorType || '';
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';

    let where = '1=1';
    const params = [];

    if (errorType) {
      where += ' AND error_type = ?';
      params.push(errorType);
    }
    if (startDate) {
      where += ' AND reported_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      where += ' AND reported_at <= ?';
      params.push(endDate + ' 23:59:59');
    }

    const [rows] = await db.query(
      `SELECT id, error_type, error_message, stack_trace, page, user_openid, app_version, device_info, reported_at
       FROM app_error_reports WHERE ${where} ORDER BY reported_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const [total] = await db.query(
      `SELECT COUNT(*) as cnt FROM app_error_reports WHERE ${where}`,
      params
    );

    // 统计各错误类型数量
    const [typeStats] = await db.query(
      `SELECT error_type, COUNT(*) as cnt FROM app_error_reports GROUP BY error_type ORDER BY cnt DESC`
    );

    res.json({
      success: true,
      data: {
        list: rows,
        total: total[0].cnt,
        page,
        pageSize,
        typeStats
      }
    });
  } catch (err) {
    console.error('[ADMIN] app-error-reports error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' });
  }
});

// ============================================================
// 模块：App 下载版本配置（官网下载链接动态管理，v19.14 新增；v19.15 增加后台上传 APK）
// 前台读取走公开接口 GET /api/app-download（见 src/routes/app-download.js）
// APK 文件：后台上传到 public/apk-current/tianji.apk，官网经 /api/app-download/file 流式下发
// ============================================================

const APP_DOWNLOAD_KEY = 'app_download';
const APP_DOWNLOAD_DEFAULT = { url: '/tianji/api/app-download/file', version: '3.1.0', enabled: true };
const APP_APK_DIR = path.join(__dirname, '..', '..', 'public', 'apk-current');
const APP_APK_FILE = path.join(APP_APK_DIR, 'tianji.apk');

// multer：用于后台上传 APK（流式落盘，不占内存；大小上限 500MB）
let multer;
try {
  multer = require('multer');
} catch (e) {
  console.warn('[ADMIN] multer 未安装，后台上传 APK 不可用；请在本机 _backend_src 及服务器 node_modules 安装 multer');
  multer = null;
}
function makeApkUploader() {
  if (!multer) return null;
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => { try { fs.mkdirSync(APP_APK_DIR, { recursive: true }); } catch (_) {} cb(null, APP_APK_DIR); },
      filename: (req, file, cb) => cb(null, 'tianji.apk')
    }),
    limits: { fileSize: 500 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
              // multer fileFilter 签名为 cb(err, accept)：合法时必须 cb(null, true)
              // 此前写成 cb(null)（accept=undefined→falsy），multer 视为静默拒绝，req.file 恒为 null 且不报错
              if (/\.(apk)$/i.test(file.originalname || '')) return cb(null, true);
              cb(new Error('仅支持 .apk 文件'));
            }
  });
}

async function readAppDownload() {
  const [rows] = await db.query(
    'SELECT config_value, updated_at FROM app_configs WHERE config_key = ? LIMIT 1',
    [APP_DOWNLOAD_KEY]
  );
  if (rows.length === 0) return { ...APP_DOWNLOAD_DEFAULT, updated_at: null };
  let parsed = {};
  try { parsed = JSON.parse(rows[0].config_value || '{}'); } catch (_) { parsed = {}; }
  return {
    url: parsed.url || APP_DOWNLOAD_DEFAULT.url,
    version: parsed.version || APP_DOWNLOAD_DEFAULT.version,
    enabled: parsed.enabled !== false,
    updated_at: rows[0].updated_at || null
  };
}

// GET /api/admin/app-download - 读取当前 App 下载配置
router.get('/app-download', async (req, res) => {
  try {
    const data = await readAppDownload();
    res.json({ success: true, data });
  } catch (err) {
    console.error('[ADMIN] app-download GET error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '读取失败' });
  }
});

// PUT /api/admin/app-download - 更新 App 下载配置
router.put('/app-download', async (req, res) => {
  try {
    const { url, version, enabled } = req.body;
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '下载链接不能为空' });
    }
    const current = await readAppDownload();
    const next = {
      url: url.trim(),
      version: (typeof version === 'string' && version.trim()) ? version.trim() : (current.version || ''),
      enabled: enabled === undefined ? current.enabled : !!enabled
    };
    await db.query(
      `INSERT INTO app_configs (config_key, config_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
      [APP_DOWNLOAD_KEY, JSON.stringify(next)]
    );
    logAdminAction(req, 'app_download_update', APP_DOWNLOAD_KEY, next);
    res.json({ success: true, data: { message: '下载配置已更新', ...next, updated_at: new Date().toISOString() } });
  } catch (err) {
    console.error('[ADMIN] app-download PUT error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '更新失败' });
  }
});

// POST /api/admin/app-download/upload - 后台上传 APK（multipart：file + version 字段）
// 上传后把下载链接改为后端流式地址 /tianji/api/app-download/file，并更新版本号，即刻生效
router.post('/app-download/upload', (req, res, next) => {
  console.log('[ADMIN] upload req: Content-Type=', req.headers['content-type'], 'Content-Length=', req.headers['content-length']);
  const uploader = makeApkUploader();
  if (!uploader) {
    return res.status(500).json({ success: false, code: 'MULTER_MISSING', message: '服务器未安装上传组件，请联系技术处理' });
  }
  uploader.single('file')(req, res, async (err) => {
    console.log('[ADMIN] multer result: err=', err ? err.message : 'none', 'file=', req.file ? (req.file.originalname + '(' + req.file.size + 'B)') : 'null', 'body=', JSON.stringify(req.body));
    if (err) {
      const msg = /仅支持/.test(err.message) ? err.message : ('上传失败：' + err.message);
      return res.status(400).json({ success: false, code: 'UPLOAD_ERROR', message: msg });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, code: 'NO_FILE', message: '请选择要上传的 APK 文件' });
    }
    try {
      const version = (typeof req.body.version === 'string' && req.body.version.trim()) ? req.body.version.trim() : 'latest';
      const next = { url: '/tianji/api/app-download/file', version, enabled: true };
      await db.query(
        `INSERT INTO app_configs (config_key, config_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
        [APP_DOWNLOAD_KEY, JSON.stringify(next)]
      );
      logAdminAction(req, 'app_download_upload', APP_DOWNLOAD_KEY, { filename: req.file.originalname, version, size: req.file.size });
      res.json({
        success: true,
        data: { message: 'APK 上传成功并已生效', filename: req.file.originalname, size: req.file.size, ...next, updated_at: new Date().toISOString() }
      });
    } catch (e) {
      console.error('[ADMIN] app-download upload error:', e.message);
      res.status(500).json({ success: false, code: 'DB_ERROR', message: '上传完成但保存配置失败' });
    }
  });
});

module.exports = router;
