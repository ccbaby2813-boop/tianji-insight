// src/middleware/auth.js - JWT验证中间件
const jwt = require('jsonwebtoken');
const db = require('../middleware/db');
const cache = require('../services/cache');

// Bug #9修复：从环境变量读取，不写死默认值
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// 🔴 v3.4 安全增强：JWT_SECRET 严格校验
// 1. 长度 ≥ 32
// 2. 不在弱密钥黑名单中（项目名、常见词、占位符）
// 3. 字符熵 ≥ 16（不同字符数）
// 4. 不允许纯数字/纯字母
function isWeakJwtSecret(secret) {
  if (!secret || typeof secret !== 'string') return true;
  if (secret.length < 32) return true;
  const blacklist = ['tianji', 'secret', 'password', 'jwt', 'token', 'key', 'default',
                     'changeme', 'your_secret', '12345678', 'qwerty', 'admin', 'test'];
  const lower = secret.toLowerCase();
  if (blacklist.some(w => lower.includes(w))) return true;
  // 字符熵：不同字符数量
  const uniqueChars = new Set(secret).size;
  if (uniqueChars < 16) return true;
  // 纯数字或纯字母
  if (/^\d+$/.test(secret)) return true;
  if (/^[a-zA-Z]+$/.test(secret)) return true;
  // 重复模式（如 abcabcabc...）
  if (/^(.{1,8})\1{3,}/.test(secret)) return true;
  return false;
}

if (isWeakJwtSecret(JWT_SECRET)) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[auth] 致命错误：JWT_SECRET未安全配置（长度<32/包含弱关键词/熵不足/字符单一），服务拒绝启动');
    process.exit(1);
  }
  console.warn('[auth] 警告：JWT_SECRET未安全配置，请在.env中设置至少32位含数字+字母+符号的随机密钥');
}

//  关键修复：openid 反查内存缓存（5分钟TTL）
// 解决场景：用户绑定手机号后，旧 JWT（24h有效）仍携带旧 openid（oXXX），
// 所有下游接口用 req.openid 都会出问题。
// 方案：在 verifyToken 中统一反查，把 req.openid 替换为最新主账号 openid。
// 缓存避免每次请求都查 DB。
const openidResolveCache = new Map(); // key: 原始openid, value: { resolved, expireAt }
const OPENID_CACHE_TTL = 5 * 60 * 1000; // 5分钟

// openid 反查监控计数器
let _openidResolveStats = { total: 0, cacheHit: 0, dbHit: 0, dbError: 0 };

/**
 * 反查 openid 为最新主账号 openid（带缓存）
 * 查不到绑定记录则原样返回（未绑定手机号的用户）
 * 查询失败时降级返回原始值（保证服务可用）
 * 
 * 查找优先级：
 * 1. phone_ 开头 → 直接返回（主账号）
 * 2. 查 user_bindings 表（platform_openid → unified_openid）
 * 3. 查 users 表（unionid → 有 user_id 的用户）
 */
async function resolveOpenidWithCache(rawOpenid) {
  if (!rawOpenid) return rawOpenid;
  // phone_ 开头的是主账号，无需反查
  if (rawOpenid.startsWith('phone_')) return rawOpenid;

  _openidResolveStats.total++;

  // 查缓存
  const cached = openidResolveCache.get(rawOpenid);
  if (cached && cached.expireAt > Date.now()) {
    _openidResolveStats.cacheHit++;
    return cached.resolved;
  }

  // 查 DB：先查 user_bindings，再查 unionid 关联
  try {
    let resolved = rawOpenid;

    // 1. 查 user_bindings 表
    const [bindRows] = await db.query(
      'SELECT unified_openid FROM user_bindings WHERE platform_openid = ? LIMIT 1',
      [rawOpenid]
    );
    if (bindRows.length > 0) {
      resolved = bindRows[0].unified_openid;
    } else {
      // 2. 查 users 表：通过 unionid 找到有 user_id 的用户
      const [userRows] = await db.query(
        'SELECT openid FROM users WHERE openid = ? AND unionid IS NOT NULL LIMIT 1',
        [rawOpenid]
      );
      if (userRows.length > 0 && userRows[0].unionid) {
        const [uidRows] = await db.query(
          'SELECT openid FROM users WHERE unionid = ? AND user_id IS NOT NULL AND openid != ? LIMIT 1',
          [userRows[0].unionid, rawOpenid]
        );
        if (uidRows.length > 0) {
          resolved = uidRows[0].openid;
        }
      }
    }

    _openidResolveStats.dbHit++;
    // 写缓存
    openidResolveCache.set(rawOpenid, { resolved, expireAt: Date.now() + OPENID_CACHE_TTL });
    // 清理过期缓存项（防止内存泄漏）
    if (openidResolveCache.size > 1000) {
      const now = Date.now();
      for (const [k, v] of openidResolveCache) {
        if (v.expireAt <= now) openidResolveCache.delete(k);
      }
    }
    return resolved;
  } catch (err) {
    _openidResolveStats.dbError++;
    // 每 100 次错误打印一次统计，避免日志刷屏
    if (_openidResolveStats.dbError % 100 === 1) {
      console.error('[verifyToken] openid反查失败统计:', JSON.stringify(_openidResolveStats));
    }
    console.error('[verifyToken] openid反查失败，降级使用原始值:', err.message);
    return rawOpenid; // 降级
  }
}

/**
 * 获取 openid 反查统计（用于健康检查/监控）
 */
function getOpenidResolveStats() {
  return { ..._openidResolveStats, cacheSize: openidResolveCache.size };
}

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, code: 'AUTH_TOKEN_MISSING', message: '缺少认证信息' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!token) {
    return res.status(401).json({ success: false, code: 'AUTH_TOKEN_INVALID', message: '无效的Token格式' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // 🔴 关键修复：反查 req.openid 为最新主账号 openid
    // 解决场景：用户绑定手机号后旧 JWT 仍携带旧 openid，导致所有下游接口写入孤儿记录
    const resolvedOpenid = await resolveOpenidWithCache(decoded.openid);
    req.openid = resolvedOpenid;
    req.originalOpenid = decoded.openid; // 保留原始值供审计/日志使用

    // 封禁用户检查（60秒缓存，DB失败时拒绝请求）
    // 🔴 关键修复：用反查后的 req.openid 查询 users 表
    // 🔴 关键修复：DB 查不到用户记录时返回 401（而非默认放行），防止绕过封禁
    try {
      const banKey = `ban:${req.openid}`;
      let userStatus = null; // null 表示未知
      let cacheOk = true;
      try {
        const cached = await cache.wrap(banKey, async () => {
          const [rows] = await db.query('SELECT status FROM users WHERE openid = ? LIMIT 1', [req.openid]);
          return { status: rows.length > 0 ? rows[0].status : null, found: rows.length > 0 };
        }, 60);
        if (cached && cached.status !== undefined) {
          userStatus = cached.status;
          if (!cached.found) {
            // 用户不存在（可能旧 JWT 的 openid 在 users 表中无记录）
            return res.status(401).json({ success: false, code: 'AUTH_TOKEN_INVALID', message: '登录状态无效，请重新登录' });
          }
        } else {
          cacheOk = false;
        }
      } catch (cacheErr) {
        cacheOk = false;
      }
      // 缓存层失败时，直接查DB兜底
      if (!cacheOk) {
        const [rows] = await db.query('SELECT status FROM users WHERE openid = ? LIMIT 1', [req.openid]);
        if (rows.length === 0) {
          // 用户不存在，拒绝请求（防止绕过封禁）
          return res.status(401).json({ success: false, code: 'AUTH_TOKEN_INVALID', message: '登录状态无效，请重新登录' });
        }
        userStatus = rows[0].status;
      }
      if (userStatus === 0) {
        return res.status(403).json({ success: false, code: 'USER_BANNED', message: '该账号已被封禁，如有疑问请联系客服' });
      }
    } catch (banErr) {
      console.error('[auth] 封禁检查失败，拒绝请求:', banErr.message);
      return res.status(500).json({ success: false, code: 'AUTH_CHECK_FAILED', message: '认证检查失败，请稍后重试' });
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, code: 'AUTH_TOKEN_EXPIRED', message: 'Token已过期，请重新登录' });
    }
    return res.status(401).json({ success: false, code: 'AUTH_TOKEN_INVALID', message: 'Token无效' });
  }
}

async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    req.user = null;
    req.openid = null;
    return next();
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    // 🔴 v3.5 加固：optionalAuth 也做 openid 反查，与 verifyToken 行为一致
    const resolvedOpenid = await resolveOpenidWithCache(decoded.openid);
    req.openid = resolvedOpenid;
    req.originalOpenid = decoded.openid;

    // 🔴 v3.5 加固：optionalAuth 也检查封禁状态（DB 失败时降级放行，保持 optional 语义）
    try {
      const [rows] = await db.query('SELECT status FROM users WHERE openid = ? LIMIT 1', [req.openid]);
      if (rows.length === 0) {
        // 用户不存在：保持 optional 语义，不阻断（部分接口允许匿名访问）
        req.user = null;
        req.openid = null;
        return next();
      }
      if (rows[0].status === 0) {
        return res.status(403).json({ success: false, code: 'USER_BANNED', message: '该账号已被封禁，如有疑问请联系客服' });
      }
    } catch (banErr) {
      console.error('[optionalAuth] 封禁检查失败，降级放行:', banErr.message);
    }
  } catch (e) {
    // optionalAuth: JWT 无效时静默降级为匿名用户（不阻断请求）
    if (e.name !== 'TokenExpiredError' && e.name !== 'JsonWebTokenError') {
      console.warn('[optionalAuth] JWT 解析异常:', e.message);
    }
    req.user = null;
    req.openid = null;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, code: 'ADMIN_AUTH_REQUIRED', message: '需要管理员权限' });
  }
  next();
}

/**
 * 校验 URL 参数 :openid 与当前登录用户（req.openid）是否归属同一主账号
 * 用于兼容"用户绑定手机号后前端缓存 openid 仍为旧值"的场景：
 *   - 若 req.params.openid === req.openid，直接放行
 *   - 若不一致，查 user_bindings 表确认两者是否关联到同一 unified_openid
 *   - 关联则放行（后续业务用 req.openid，最权威）
 *   - 不关联则 403
 * 用法：router.get('/profile/:openid', verifyToken, verifyOpenidMatch, handler)
 */
async function verifyOpenidMatch(req, res, next) {
  const urlOpenid = req.params && req.params.openid;
  if (!urlOpenid) return next(); // URL 无 :openid 参数，跳过

  // 1. 完全相等，直接放行
  if (urlOpenid === req.openid) return next();

  // 2. 不相等，查 user_bindings 表确认关联关系
  try {
    const [rows] = await db.query(
      `SELECT unified_openid FROM user_bindings
       WHERE (platform_openid = ? OR unified_openid = ?)
          OR (platform_openid = ? OR unified_openid = ?)
       LIMIT 2`,
      [urlOpenid, urlOpenid, req.openid, req.openid]
    );
    // 两个 openid 必须关联到同一个 unified_openid
    if (rows.length >= 2 && rows[0].unified_openid === rows[1].unified_openid) {
      // 校验通过：URL openid 与 req.openid 属于同一主账号
      // 后续业务继续用 req.openid（最权威）
      return next();
    }
    // 只命中一条记录的情况：检查是否 urlOpenid 是某绑定的 platform_openid 且其 unified_openid === req.openid
    if (rows.length === 1 && rows[0].unified_openid === req.openid) {
      return next();
    }
    // 还有种情况：req.openid 本身就是 unified_openid，urlOpenid 是它的 platform_openid
    // 上面 rows.length===1 分支已覆盖（rows[0].unified_openid === req.openid）
    return res.status(403).json({ success: false, code: 'FORBIDDEN', message: '无权访问他人信息' });
  } catch (err) {
    console.error('[verifyOpenidMatch] 查询失败，降级拒绝:', err.message);
    return res.status(403).json({ success: false, code: 'FORBIDDEN', message: '无权访问他人信息' });
  }
}

function generateToken(openid, role = 'user') {
  return jwt.sign({ openid, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

module.exports = { verifyToken, optionalAuth, requireAdmin, verifyOpenidMatch, generateToken, getOpenidResolveStats };
