// src/routes/auth.js - 微信登录
const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const { generateToken, verifyToken } = require('../middleware/auth');
const sessionKeyStore = require('../store');
const db = require('../middleware/db');
const cache = require('../services/cache'); // 用于清理 ban 缓存（带 tianji:cache: 前缀）
const redisService = require('../services/redis'); // Redis 服务（短信验证码、限流）
const { downgradeExpiredVip, resetDailyQuota } = require('../utils/vip'); // v2.3.5 抽取 VIP 降级公共函数

// v15.14 IP 归属地查询（带 Redis 缓存，TTL 7 天）
async function getCityByIP(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;
  try {
    const redis = await require('../services/redis').getClient();
    const cacheKey = 'ip_city:' + ip;
    // 查缓存
    if (redis && redis.isReady) {
      const cached = await redis.get(cacheKey);
      if (cached) return cached;
    }
    // 调 API（ip-api.com 免费，45 次/分钟）
    const res = await axios.get(`http://ip-api.com/json/${ip}?fields=city`, { timeout: 5000 });
    const city = res.data && res.data.city ? res.data.city : null;
    // 写缓存
    if (redis && redis.isReady && city) {
      await redis.set(cacheKey, city, 'EX', 7 * 24 * 3600);
    }
    return city;
  } catch (e) {
    console.error('[auth/getCityByIP] IP 归属地查询失败:', e.message);
    return null;
  }
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'code必填' });

    // 微信 code2Session - 使用官方API
    const appId = process.env.WX_APPID;
    const appSecret = process.env.WX_APPSECRET;

    if (!appId || !appSecret) {
      console.error('[auth/login] WX_APPID或WX_APPSECRET未配置');
      return res.status(500).json({ success: false, code: 'CONFIG_ERROR', message: '服务器配置错误,请联系管理员' });
    }

    let openid = null;
    let sessionKey = null;
    let unionid = null;  // 微信开放平台UnionID(如果小程序绑定了开放平台,响应中会包含)

    try {
      // 注意:appSecret不能明文放在URL中,应该用encodeURIComponent
      const wxUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${encodeURIComponent(appSecret)}&js_code=${code}&grant_type=authorization_code`;
      const wxRes = await axios.get(wxUrl, { timeout: 10000 });

      console.log('[auth/login] 微信登录响应: errcode=' + (wxRes.data.errcode || 0) + ', openid=' + (wxRes.data.openid ? wxRes.data.openid.substring(0, 8) + '...' : 'null'));

      if (wxRes.data.errcode) {
        console.error('[auth/login] 微信登录失败:', wxRes.data);
        // 常见错误码处理
        if (wxRes.data.errcode === 40029) {
          // 微信开发者工具的 code 是测试的,会返回 40029
          // 仅在开发环境下使用测试openid
          if (process.env.NODE_ENV !== 'production') {
            console.log('[auth/login] 检测到开发者工具测试code,使用测试openid');
            openid = 'devtools_test_openid_' + Date.now();
            sessionKey = 'devtools_session_key';
          } else {
            return res.status(400).json({ success: false, code: 'WX_LOGIN_FAILED', message: '无效的登录凭证' });
          }
        } else if (wxRes.data.errcode === 45011) {
          return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: '操作太频繁,请稍后再试' });
        } else {
          return res.status(500).json({ success: false, code: 'WX_LOGIN_FAILED', message: wxRes.data.errmsg });
        }
      }

      // 只有在正常响应时才从微信响应中获取 openid(开发工具 40029 已设置测试 openid)
      if (openid === null) {
        openid = wxRes.data.openid;
        sessionKey = wxRes.data.session_key;
        unionid = wxRes.data.unionid || null;  // 可能包含unionid(如果小程序绑定了微信开放平台)
      }

      if (!openid) {
        return res.status(500).json({ success: false, code: 'WX_LOGIN_FAILED', message: '获取openid失败' });
      }
    } catch (err) {
      console.error('[auth/login] 请求微信API异常:', err.message);
      return res.status(500).json({ success: false, code: 'WX_LOGIN_FAILED', message: '微信登录服务异常' });
    }

    const conn = await db.get();
    try {
      // 保存原始微信 openid（用于绑定查询和sessionKey）
      const wxOpenid = openid;

      // 跨端身份统一：优先用 user_id 查找（如果该 unionid 已有 user_id 用户）
      let loginOpenid = openid;
      let foundByUserId = false;

      if (unionid) {
        // 查找是否有通过 APP 登录创建的、带有 user_id 的用户
        const [uidRows] = await conn.query(
          'SELECT openid FROM users WHERE unionid = ? AND user_id IS NOT NULL LIMIT 1',
          [unionid]
        );
        if (uidRows.length > 0) {
          loginOpenid = uidRows[0].openid;
          foundByUserId = true;
          console.log('[auth/login] 通过unionid找到user_id用户: openid=' + loginOpenid);
        }
      }

      // 如果没有通过 user_id 找到，走原有的绑定查找逻辑
      if (!foundByUserId) {
        // 1) 先按 platform='wechat' + platform_openid=微信openid 查
        const [bindByWx] = await conn.query(
          'SELECT unified_openid FROM user_bindings WHERE platform = ? AND platform_openid = ? LIMIT 1',
          ['wechat', wxOpenid]
        );
        if (bindByWx.length > 0) {
          loginOpenid = bindByWx[0].unified_openid;
        }
        // 2) 再按 unionid 查（跨端融合）
        else if (unionid) {
          const [bindByUnion] = await conn.query(
            'SELECT unified_openid FROM user_bindings WHERE unionid = ? LIMIT 1',
            [unionid]
          );
          if (bindByUnion.length > 0) {
            loginOpenid = bindByUnion[0].unified_openid;
          }
        }
      }

      let [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [loginOpenid]);

      let isNewUser = false;
      if (rows.length === 0) {
        // 自动注册新用户
        const insertResult = await conn.query(
          'INSERT IGNORE INTO users (openid, unionid, plan_type, quota_remaining, points) VALUES (?, ?, "free", 3, 10)',
          [loginOpenid, unionid]
        );
        isNewUser = insertResult[0].affectedRows > 0;
        if (isNewUser) {
          await conn.query(
            'INSERT IGNORE INTO subscriptions (openid, plan_type) VALUES (?, "free")',
            [loginOpenid]
          );
          // v17.0 新用户注册赠 10 积分（=1次普通推演），记流水
          await conn.query(
            'INSERT INTO points_transactions (openid, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)',
            [loginOpenid, 'new_user', 10, 10, '新用户注册赠分']
          );
        }
        [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [loginOpenid]);
      }

      const user = rows[0];

      // 检查账户状态（是否已注销）
      if (user.plan_type === 'cancelled') {
        console.log('[auth/login] 账户已注销, 拒绝登录: openid=' + loginOpenid);
        return res.status(403).json({ 
          success: false, 
          code: 'USER_CANCELLED', 
          message: '您的账户已被注销，无法登录' 
        });
      }

      // 如果是通过 user_id 关联到的用户，确保当前 wxOpenid 也在绑定表中
      if (foundByUserId && wxOpenid !== loginOpenid) {
        await conn.query(
          'INSERT IGNORE INTO user_bindings (unified_openid, platform, platform_openid, unionid) VALUES (?, ?, ?, ?)',
          [loginOpenid, 'wechat', wxOpenid, unionid]
        );
      }

      // 每日免费配额重置 + VIP过期检查
      await resetDailyQuota(conn, loginOpenid, user);

      // v2.3.5 VIP过期自动降级（公共函数）
      await downgradeExpiredVip(conn, loginOpenid, user, user.last_quota_reset_date);

      // 如果获取到 unionid,更新 users 表的 unionid 字段(便于后续跨端识别)
      if (unionid) {
        await conn.query('UPDATE users SET unionid = ? WHERE openid = ?', [unionid, loginOpenid]);
      }

      // 记录登录事件
      await conn.query(
        "INSERT INTO events (openid, event_type) VALUES (?, 'app_open')",
        [loginOpenid]
      );

      // v15.14 记录 IP 地址、更新最后活跃时间、查询城市归属地
      const forwardedFor = req.headers['x-forwarded-for'];
      const clientIP = forwardedFor ? forwardedFor.split(',')[0].trim() : (req.ip || req.connection.remoteAddress || '');
      const city = await getCityByIP(clientIP);
      await conn.query(
        'UPDATE users SET last_login_ip = ?, last_active_at = NOW()' + (city ? ', city = ?' : '') + ' WHERE openid = ?',
        city ? [clientIP, city, loginOpenid] : [clientIP, loginOpenid]
      );

      // 生成JWT token(24小时有效期)
      const token = generateToken(loginOpenid);
      // 存储 session_key 供虚拟支付签名使用
      if (sessionKey) {
        await sessionKeyStore.set(wxOpenid, sessionKey);
        if (wxOpenid !== loginOpenid) {
          await sessionKeyStore.set(loginOpenid, sessionKey);
        }
      }

      res.json({
        success: true,
        data: {
          openid: loginOpenid,
          token,
          isNewUser,
          quota_remaining: user.quota_remaining,
          points: user.points || 0,
          plan_type: user.plan_type
        }
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// POST /api/auth/wx-login - 微信登录别名（兼容前端调用）
// 与 /login 完全相同，只是路径不同
router.post('/wx-login', async (req, res) => {
  // 直接复用 /login 的处理逻辑
  req.url = '/login';
  return router.handle(req, res, () => {});
});

// ========== 多端应用 access_token 缓存 ==========
// code2Verifyinfo 需要多端应用的 access_token
let _donutAccessToken = null;
let _donutAccessTokenExpiry = 0;

async function getDonutAccessToken() {
  const now = Date.now();
  // 缓存有效且剩余时间 > 5 分钟，直接返回
  if (_donutAccessToken && now < _donutAccessTokenExpiry - 300000) {
    return _donutAccessToken;
  }

  const appId = process.env.MINIAPP_APPID;
  const appSecret = process.env.MINIAPP_APPSECRET;

  if (!appId || !appSecret) {
    throw new Error('MINIAPP_APPID 或 MINIAPP_APPSECRET 未配置');
  }

  const url = `https://api.weixin.qq.com/cgi-bin/token?appid=${appId}&secret=${encodeURIComponent(appSecret)}&grant_type=client_credential`;
  const res = await axios.get(url, { timeout: 10000 });

  if (res.data.errcode) {
    throw new Error(`获取多端应用 access_token 失败: ${res.data.errcode} ${res.data.errmsg}`);
  }

  _donutAccessToken = res.data.access_token;
  _donutAccessTokenExpiry = now + res.data.expires_in * 1000;
  console.log('[auth] 多端应用 access_token 已刷新, 有效期', res.data.expires_in, '秒');
  return _donutAccessToken;
}

// POST /api/auth/miniapp-login - 多端应用 App 端登录（官方方案）
// 前端调用 wx.weixinAppLogin() 或 wx.weixinMiniProgramLogin() 获取 code
// 后端调用 code2Verifyinfo 获取 user_id（跨端唯一标识）+ 各平台 openid
// 官方文档：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/openapi/code2Verifyinfo.html
router.post('/miniapp-login', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'code必填' });

    const appId = process.env.MINIAPP_APPID;
    const appSecret = process.env.MINIAPP_APPSECRET;

    if (!appId || !appSecret) {
      console.error('[auth/miniapp-login] MINIAPP_APPID或MINIAPP_APPSECRET未配置');
      return res.status(500).json({ success: false, code: 'CONFIG_ERROR', message: '服务器配置错误,请联系管理员' });
    }

    let miniprogramOpenid = null;
    let mobileAppOpenid = null;
    let unionid = null;
    let userId = null;
    let phone = null;

    try {
      // 1. 获取多端应用 access_token
      const accessToken = await getDonutAccessToken();

      // 2. 调用 code2Verifyinfo 换取用户标识（官方要求 GET 请求）
      const verifyUrl = `https://api.weixin.qq.com/donut/code2verifyinfo?access_token=${accessToken}`;
      const verifyRes = await axios.get(verifyUrl, {
        params: {
          appid: appId,
          appsecret: appSecret,
          code: code,
          grant_type: 'authorization_code'
        },
        timeout: 10000
      });

      console.log('[auth/miniapp-login] code2Verifyinfo响应: errcode=' + (verifyRes.data.errcode || 0));

      if (verifyRes.data.errcode) {
        console.error('[auth/miniapp-login] code2Verifyinfo失败:', verifyRes.data);
        if (verifyRes.data.errcode === 10001000) {
          return res.status(400).json({ success: false, code: 'WX_LOGIN_FAILED', message: '登录凭证已过期' });
        } else if (verifyRes.data.errcode === 10001001) {
          return res.status(400).json({ success: false, code: 'WX_LOGIN_FAILED', message: '无效的登录凭证' });
        } else if (verifyRes.data.errcode === 10001005) {
          return res.status(500).json({ success: false, code: 'CONFIG_ERROR', message: '多端应用未接入身份管理，请在多端应用控制台开通' });
        } else {
          return res.status(500).json({ success: false, code: 'WX_LOGIN_FAILED', message: verifyRes.data.errmsg || '微信登录失败' });
        }
      }

      // 3. 提取用户标识信息
      const userInfo = verifyRes.data.user_info || {};
      userId = userInfo.user_id || null;

      // 小程序 openid
      if (userInfo.miniprogram_info && userInfo.miniprogram_info.openid) {
        miniprogramOpenid = userInfo.miniprogram_info.openid;
        unionid = userInfo.miniprogram_info.unionid || unionid;
      }

      // 移动应用 openid
      if (userInfo.openapp_info && userInfo.openapp_info.openid) {
        mobileAppOpenid = userInfo.openapp_info.openid;
        unionid = userInfo.openapp_info.unionid || unionid;
      }

      // 手机号
      if (userInfo.phone_info && userInfo.phone_info.phone) {
        phone = userInfo.phone_info.phone;
      }

      console.log('[auth/miniapp-login] 用户标识: userId=' + (userId || 'null') + ', mpOpenid=' + (miniprogramOpenid ? miniprogramOpenid.substring(0, 8) + '...' : 'null') + ', mobileOpenid=' + (mobileAppOpenid ? mobileAppOpenid.substring(0, 8) + '...' : 'null') + ', phone=' + (phone || 'null'));

      if (!userId) {
        return res.status(500).json({ success: false, code: 'WX_LOGIN_FAILED', message: '获取用户标识失败' });
      }
    } catch (err) {
      console.error('[auth/miniapp-login] 请求微信API异常:', err.message);
      return res.status(500).json({ success: false, code: 'WX_LOGIN_FAILED', message: '微信登录服务异常' });
    }

    // 4. 用 user_id 作为主键查找/创建用户（跨端统一身份）
    const conn = await db.get();
    try {
      // 4a. 优先用 user_id 查找用户（跨端唯一标识）
      let [rows] = await conn.query('SELECT * FROM users WHERE user_id = ? LIMIT 1', [userId]);

      let loginOpenid = null;
      let isNewUser = false;

      if (rows.length > 0) {
        // 用户已存在（通过 user_id 找到）
        loginOpenid = rows[0].openid;
        console.log('[auth/miniapp-login] 通过user_id找到已有用户: openid=' + loginOpenid);
        
        // 检查账户状态（是否已注销）
        if (rows[0].plan_type === 'cancelled') {
          console.log('[auth/miniapp-login] 账户已注销, 拒绝登录: openid=' + loginOpenid);
          return res.status(403).json({ 
            success: false, 
            code: 'USER_CANCELLED', 
            message: '您的账户已被注销，无法登录' 
          });
        }
      } else {
        // 4b. user_id 未找到，尝试用 unionid 关联已有用户
        if (unionid) {
          const [unionRows] = await conn.query('SELECT * FROM users WHERE unionid = ? AND user_id IS NULL LIMIT 1', [unionid]);
          if (unionRows.length > 0) {
            // 找到通过小程序登录创建的旧用户，关联 user_id
            loginOpenid = unionRows[0].openid;
            await conn.query('UPDATE users SET user_id = ? WHERE openid = ?', [userId, loginOpenid]);
            console.log('[auth/miniapp-login] 通过unionid关联旧用户并设置user_id: openid=' + loginOpenid);
            rows = unionRows;
          }
        }
      }

      if (!loginOpenid) {
        // 4c. 全新用户，用 mobileAppOpenid 或 miniprogramOpenid 创建
        loginOpenid = mobileAppOpenid || miniprogramOpenid || ('uid_' + userId.substring(0, 20));

        const insertResult = await conn.query(
          'INSERT IGNORE INTO users (openid, user_id, unionid, phone, plan_type, quota_remaining, points) VALUES (?, ?, ?, ?, "free", 3, 10)',
          [loginOpenid, userId, unionid, phone]
        );
        isNewUser = insertResult[0].affectedRows > 0;
        if (isNewUser) {
          await conn.query(
            'INSERT IGNORE INTO subscriptions (openid, plan_type) VALUES (?, "free")',
            [loginOpenid]
          );
          // v17.0 新用户注册赠 10 积分（=1次普通推演），记流水
          await conn.query(
            'INSERT INTO points_transactions (openid, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)',
            [loginOpenid, 'new_user', 10, 10, '新用户注册赠分']
          );
        }
        [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [loginOpenid]);
        console.log('[auth/miniapp-login] 创建新用户: openid=' + loginOpenid + ', user_id=' + userId);
      }

      const user = rows[0];

      // 5. 每日配额重置 + VIP降级
      await resetDailyQuota(conn, loginOpenid, user);
      await downgradeExpiredVip(conn, loginOpenid, user, user.last_quota_reset_date);

      // 6. 更新 unionid 和 phone（如果新获取到）
      const updateFields = [];
      const updateValues = [];
      if (unionid && user.unionid !== unionid) {
        updateFields.push('unionid = ?');
        updateValues.push(unionid);
      }
      if (phone && !user.phone) {
        updateFields.push('phone = ?');
        updateValues.push(phone);
      }
      if (updateFields.length > 0) {
        updateValues.push(loginOpenid);
        await conn.query('UPDATE users SET ' + updateFields.join(', ') + ' WHERE openid = ?', updateValues);
      }

      // 7. 记录登录事件
      await conn.query("INSERT INTO events (openid, event_type) VALUES (?, 'app_open')", [loginOpenid]);

      // 8. 记录 IP 和活跃时间
      const forwardedFor = req.headers['x-forwarded-for'];
      const clientIP = forwardedFor ? forwardedFor.split(',')[0].trim() : (req.ip || req.connection.remoteAddress || '');
      await conn.query('UPDATE users SET last_login_ip = ?, last_active_at = NOW() WHERE openid = ?', [clientIP, loginOpenid]);

      // 9. 维护 user_bindings 绑定记录
      if (miniprogramOpenid) {
        await conn.query(
          'INSERT IGNORE INTO user_bindings (unified_openid, platform, platform_openid, unionid) VALUES (?, ?, ?, ?)',
          [loginOpenid, 'wechat', miniprogramOpenid, unionid]
        );
      }
      if (mobileAppOpenid && mobileAppOpenid !== miniprogramOpenid) {
        await conn.query(
          'INSERT IGNORE INTO user_bindings (unified_openid, platform, platform_openid, unionid) VALUES (?, ?, ?, ?)',
          [loginOpenid, 'mobile_app', mobileAppOpenid, unionid]
        );
      }

      // 10. 生成 JWT token（用 loginOpenid，与现有体系兼容）
      const token = generateToken(loginOpenid);

      res.json({
        success: true,
        data: {
          openid: loginOpenid,
          user_id: userId,
          token,
          isNewUser,
          quota_remaining: user.quota_remaining,
          points: user.points || 0,
          plan_type: user.plan_type
        }
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[auth/miniapp-login]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// 设备登录限流:10 次/分钟/IP（Redis 集群共享）
const DEVICE_LOGIN_PREFIX = 'tianji:device_login:';
const DEVICE_LOGIN_WINDOW_MS = 60 * 1000;
const DEVICE_LOGIN_MAX_ATTEMPTS = 10;

// [SEC-FIX] P1-3: Redis 不可用时 fail-closed（拒绝登录而非放行），防止绕过限流
async function checkDeviceLoginRateLimit(ip) {
  try {
    const redis = await redisService.getClient();
    if (redis && redis.isReady) {
      const key = DEVICE_LOGIN_PREFIX + ip;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.pExpire(key, DEVICE_LOGIN_WINDOW_MS);
      }
      return count <= DEVICE_LOGIN_MAX_ATTEMPTS;
    }
  } catch (e) {
    console.error('[auth/device-login] Redis限流失败，fail-closed 拒绝:', e.message);
  }
  return false; // Redis 不可用 → 拒绝，等待 Redis 恢复
}

// [SEC-FIX] P1-3: 强制 device_id 为高强度格式（前缀 + ≥24 位随机字符），
// 拒绝短/可预测的 device_id（否则可被枚举冒充他人账号）。
// 兼容历史前缀：device_ / web_dev_ / dv_；长度 24-64。
function isValidDeviceId(device_id) {
  if (typeof device_id !== 'string') return false;
  if (device_id.length < 24 || device_id.length > 64) return false;
  if (!/^(device_|web_dev_|dv_)/.test(device_id)) return false;
  return true;
}

// POST /api/auth/device-login - 设备登录(H5/APP端,非微信环境)
router.post('/device-login', async (req, res) => {
  try {
    // 速率限制
    if (!(await checkDeviceLoginRateLimit(req.ip))) {
      return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: '操作太频繁,请稍后再试' });
    }

    const { device_id } = req.body;
    if (!device_id) return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'device_id必填' });

    // [SEC-FIX] P1-3: 强制高强度格式（前缀+≥24位随机串），拒绝弱 device_id 防枚举冒充
    if (!isValidDeviceId(device_id)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'device_id格式无效：需以 device_/web_dev_/dv_ 开头且长度24-64位随机串' });
    }

    // 设备ID直接作为openid使用(H5/APP端无微信openid,用device_id作为唯一标识)
    const tempOpenid = device_id;

    const conn = await db.get();
    try {
      // 查 user_bindings 表：如果该设备已绑定手机号，返回主账号 token
      let loginOpenid = tempOpenid;
      const [ubByDevice] = await conn.query(
        'SELECT unified_openid FROM user_bindings WHERE platform = ? AND platform_openid = ? LIMIT 1',
        ['app_device', tempOpenid]
      );
      if (ubByDevice.length > 0) {
        loginOpenid = ubByDevice[0].unified_openid;
      }

      const openid = loginOpenid;
      let [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [openid]);

      let isNewUser = false;
      if (rows.length === 0) {
        // 自动注册新设备用户
        // 🔴 修复:使用 INSERT IGNORE 防止并发竞争导致 Duplicate Entry 崩溃
        const insertResult = await conn.query(
          'INSERT IGNORE INTO users (openid, plan_type, quota_remaining, points) VALUES (?, "free", 3, 10)',
          [openid]
        );
        isNewUser = insertResult[0].affectedRows > 0;
        if (isNewUser) {
          await conn.query(
            'INSERT IGNORE INTO subscriptions (openid, plan_type) VALUES (?, "free")',
            [openid]
          );
          // v17.0 新用户注册赠 10 积分（=1次普通推演），记流水
          await conn.query(
            'INSERT INTO points_transactions (openid, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)',
            [openid, 'new_user', 10, 10, '新用户注册赠分']
          );
        }
        [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [openid]);
      }

      const user = rows[0];

      // [SEC-FIX] P2-2: 已注销用户拒绝登录（与其他登录方式保持一致）
      if (user.plan_type === 'cancelled') {
        console.log('[auth/device-login] 账户已注销, 拒绝登录: openid=' + openid);
        return res.status(403).json({ success: false, code: 'USER_CANCELLED', message: '您的账户已被注销，无法登录' });
      }

      // 每日免费配额重置 + VIP过期检查
      await resetDailyQuota(conn, openid, user);

      // v2.3.5 VIP过期自动降级（公共函数）
      await downgradeExpiredVip(conn, openid, user, user.last_quota_reset_date);

      // 记录登录事件
      await conn.query(
        "INSERT INTO events (openid, event_type) VALUES (?, 'app_open')",
        [openid]
      );

      // 生成JWT token(24小时有效期)
      const token = generateToken(openid);

      res.json({
        success: true,
        data: {
          // v2.3.5 统一：返回生成 token 时用的 openid（绑定手机号后为 unified_openid），与 token 保持一致
          openid: openid,
          token,
          isNewUser,
          quota_remaining: user.quota_remaining,
          points: user.points || 0,
          plan_type: user.plan_type
        }
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[auth/device-login]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});


// ========== 手机号登录 (APP/H5) ==========

// Storage for SMS verification codes (fallback if Redis unavailable)
const smsCodeStore = new Map();

// [SEC-FIX] P1-1: 验证码连续失败达到阈值即作废并锁定（防止暴力破解）
const SMS_VERIFY_MAX_FAILS = 5;

// [SEC-FIX] P1-1: 验证码哈希存储（每验证码独立随机盐），防拖库后离线爆破
function hashSmsCode(code, salt) {
  return crypto.createHash('sha256').update(code + ':' + salt).digest('hex');
}

async function storeSmsCode(phone, code) {
  const salt = crypto.randomBytes(8).toString('hex');
  const payload = JSON.stringify({ h: hashSmsCode(code, salt), s: salt });
  try {
    const redis = await redisService.getClient();
    if (redis && redis.isReady) {
      await redis.setEx("tianji:sms:" + phone, 300, payload);
      return;
    }
  } catch (e) {
    console.error("[sms] Redis store failed, using memory fallback:", e.message);
  }
  smsCodeStore.set(phone, { payload, expires: Date.now() + 300000 });
}

// v18.21 商店审核体验账号（.env: REVIEW_PHONE / REVIEW_CODE）
// 未配置环境变量时通道完全关闭；万能验证码仅对审核手机号生效，其他账号不受影响
function isReviewAccount(phone) {
  return !!process.env.REVIEW_PHONE && !!process.env.REVIEW_CODE && phone === process.env.REVIEW_PHONE;
}

/**
 * [SEC-FIX] P1-1: 验证短信验证码（含失败锁定与哈希比对）
 * @returns {{ok: boolean, locked: boolean, retryAfter?: number}}
 */
async function verifySmsCode(phone, code) {
  // 审核体验账号：固定验证码直接通过
  if (isReviewAccount(phone)) {
    return { ok: code === process.env.REVIEW_CODE, locked: false };
  }
  const failKey = "tianji:sms:fail:" + phone;
  try {
    const redis = await redisService.getClient();
    if (redis && redis.isReady) {
      // 失败锁定检查
      const fails = parseInt((await redis.get(failKey)) || '0', 10);
      if (fails >= SMS_VERIFY_MAX_FAILS) {
        const ttl = await redis.ttl(failKey).catch(() => 300);
        return { ok: false, locked: true, retryAfter: ttl > 0 ? ttl : 300 };
      }
      const stored = await redis.get("tianji:sms:" + phone);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.h && parsed.s && parsed.h === hashSmsCode(code, parsed.s)) {
            await redis.del("tianji:sms:" + phone);
            await redis.del(failKey);
            return { ok: true, locked: false };
          }
        } catch (e) {
          // 旧版明文验证码兼容：stored 非 JSON 时按明文比对
          if (stored === code) {
            await redis.del("tianji:sms:" + phone);
            await redis.del(failKey);
            return { ok: true, locked: false };
          }
        }
      }
      // 验证失败：累加失败次数（与验证码同生命周期，5分钟）
      const n = await redis.incr(failKey);
      if (n === 1) await redis.expire(failKey, 300);
      return { ok: false, locked: n >= SMS_VERIFY_MAX_FAILS, retryAfter: 300 };
    }
  } catch (e) {
    console.error("[sms] Redis verify failed, using memory fallback:", e.message);
  }
  // 内存降级：同样计数
  const entry = smsCodeStore.get(phone);
  const failEntry = smsCodeStore.get(failKey) || { count: 0, expires: Date.now() + 300000 };
  if (failEntry.count >= SMS_VERIFY_MAX_FAILS) {
    return { ok: false, locked: true, retryAfter: Math.max(1, Math.ceil((failEntry.expires - Date.now()) / 1000)) };
  }
  if (entry) {
    let matched = false;
    try {
      const parsed = JSON.parse(entry.payload);
      matched = parsed.h && parsed.s && parsed.h === hashSmsCode(code, parsed.s);
    } catch (e) {
      matched = entry.payload === code; // 兼容旧版明文
    }
    if (matched && Date.now() < entry.expires) {
      smsCodeStore.delete(phone);
      smsCodeStore.delete(failKey);
      return { ok: true, locked: false };
    }
  }
  failEntry.count++;
  smsCodeStore.set(failKey, failEntry);
  return { ok: false, locked: failEntry.count >= SMS_VERIFY_MAX_FAILS, retryAfter: Math.max(1, Math.ceil((failEntry.expires - Date.now()) / 1000)) };
}

// POST /api/auth/send-code - 发送手机验证码（阿里云短信）
const { sendSms } = require("../utils/sms");

// v15.15 短信限流配置
const SMS_LIMITS = {
  cooldown: 60,           // 同一手机号 60 秒冷却
  perIpHour: 5,           // 同一 IP 每小时最多 5 次
  perIpDay: 20,           // 同一 IP 每天最多 20 次
  perPhoneDay: 10,        // 同一手机号每天最多 10 次
};

router.post("/send-code", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || !/^1\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, code: "INVALID_PARAM", message: "手机号格式不正确" });
    }

    // v18.21 审核体验账号：跳过限流与真实短信，直接返回成功（验证码为固定 REVIEW_CODE）
    if (isReviewAccount(phone)) {
      console.log('[auth/send-code] 审核体验账号请求验证码（不发送短信）');
      return res.json({ success: true, message: "验证码已发送" });
    }

    // 获取真实 IP
    const forwardedFor = req.headers['x-forwarded-for'];
    const clientIP = forwardedFor ? forwardedFor.split(',')[0].trim() : (req.ip || req.connection.remoteAddress || '');

    const redis = await redisService.getClient();
    const isRedisReady = redis && redis.isReady;

    // v15.15 多层限流检查
    if (isRedisReady) {
      // 1. 手机号 60 秒冷却
      const cooldownKey = "tianji:sms:cooldown:" + phone;
      const inCooldown = await redis.get(cooldownKey);
      if (inCooldown) {
        const ttl = await redis.ttl(cooldownKey);
        return res.status(429).json({ success: false, code: "RATE_LIMITED", message: `验证码已发送，请${ttl}秒后重试` });
      }

      // 2. IP 每小时限流
      const ipHourKey = `tianji:sms:ip_hour:${clientIP}`;
      const ipHourCount = await redis.incr(ipHourKey);
      if (ipHourCount === 1) {
        await redis.expire(ipHourKey, 3600);
      }
      if (ipHourCount > SMS_LIMITS.perIpHour) {
        return res.status(429).json({ success: false, code: "RATE_LIMITED", message: "当前网络环境发送过于频繁，请稍后再试" });
      }

      // 3. IP 每日限流
      const today = new Date().toISOString().split('T')[0];
      const ipDayKey = `tianji:sms:ip_day:${clientIP}:${today}`;
      const ipDayCount = await redis.incr(ipDayKey);
      if (ipDayCount === 1) {
        await redis.expire(ipDayKey, 86400);
      }
      if (ipDayCount > SMS_LIMITS.perIpDay) {
        return res.status(429).json({ success: false, code: "RATE_LIMITED", message: "今日发送次数已达上限，请明天再试" });
      }

      // 4. 手机号每日限流
      const phoneDayKey = `tianji:sms:phone_day:${phone}:${today}`;
      const phoneDayCount = await redis.incr(phoneDayKey);
      if (phoneDayCount === 1) {
        await redis.expire(phoneDayKey, 86400);
      }
      if (phoneDayCount > SMS_LIMITS.perPhoneDay) {
        return res.status(429).json({ success: false, code: "RATE_LIMITED", message: "该手机号今日发送次数已达上限，请明天再试" });
      }

      // 设置冷却期
      await redis.setEx(cooldownKey, SMS_LIMITS.cooldown, "1");
    } else {
      // Redis 不可用时的内存降级限流
      const lastSend = smsCodeStore.get("cooldown:" + phone);
      if (lastSend && Date.now() - lastSend < SMS_LIMITS.cooldown * 1000) {
        const waitSec = Math.ceil((SMS_LIMITS.cooldown * 1000 - (Date.now() - lastSend)) / 1000);
        return res.status(429).json({ success: false, code: "RATE_LIMITED", message: `验证码已发送，请${waitSec}秒后重试` });
      }
      smsCodeStore.set("cooldown:" + phone, Date.now());
    }

    // 生成 6 位数字验证码
    const code = String(Math.floor(100000 + Math.random() * 900000));

    // 存储验证码 (5 分钟有效)
    await storeSmsCode(phone, code);

    // 调用阿里云短信发送
    const smsResult = await sendSms(phone, code);
    if (!smsResult.sent) {
      const maskedPhone = phone.length >= 11 ? phone.slice(0, 3) + '****' + phone.slice(-4) : phone;
      console.error(`[auth/send-code] 短信发送失败：${maskedPhone} reason=${smsResult.reason} message=${smsResult.message}`);
      if (process.env.NODE_ENV === 'production') {
        return res.status(500).json({ success: false, code: "SMS_FAILED", message: "短信发送失败，请稍后重试" });
      }
    }

    res.json({ success: true, message: "验证码已发送" });
  } catch (err) {
    console.error("[auth/send-code]", err);
    res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "发送失败，请重试" });
  }
});

// POST /api/auth/phone-login - 手机号 + 验证码登录（跨端统一身份）
router.post("/phone-login", async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !/^1\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, code: "INVALID_PARAM", message: "手机号格式不正确" });
    }
    if (!code || !/^\d{4,6}$/.test(code)) {
      return res.status(400).json({ success: false, code: "INVALID_PARAM", message: "验证码格式不正确" });
    }

    // 验证验证码
    const vr = await verifySmsCode(phone, code);
    if (!vr.ok) {
      if (vr.locked) {
        return res.status(429).json({ success: false, code: "VERIFY_LOCKED", message: "验证码错误次数过多，请稍后重试" });
      }
      return res.status(400).json({ success: false, code: "INVALID_PARAM", message: "验证码错误或已过期" });
    }

    // 用手机号生成稳定的 openid（[SEC-FIX] P2-4: 双盐兼容存量账号）
    const phoneOpenid = phoneOpenidOf(phone);
    const legacyPhoneOpenid = legacyPhoneOpenidOf(phone);

    const conn = await db.get();
    try {
      // 1. 先查 phoneOpenid 对应的用户（新盐优先，兼容旧盐）
      let [rows] = await conn.query("SELECT * FROM users WHERE openid IN (?, ?) LIMIT 1", [phoneOpenid, legacyPhoneOpenid]);

      let loginOpenid = phoneOpenid;
      let isNewUser = false;

      if (rows.length === 0) {
        // 2. 用户不存在，检查是否有其他 openid 的用户绑定了这个手机号
        const [phoneRows] = await conn.query("SELECT * FROM users WHERE phone = ? LIMIT 1", [phone]);
        if (phoneRows.length > 0) {
          // 找到已有用户，将 openid 统一为 phoneOpenid
          loginOpenid = phoneRows[0].openid;
          const oldOpenid = loginOpenid;
          await conn.query("UPDATE users SET openid = ? WHERE openid = ?", [phoneOpenid, oldOpenid]);
          // 更新含 openid 列的子表（points_transactions 自 v17.0 已存在，若旧表缺失则由 try/catch 兜底）
          const tables = ['tuiyan_records', 'subscriptions', 'vip_orders', 'user_gua_collection', 'user_achievements', 'events', 'points_transactions'];
          for (const tbl of tables) {
            try { await conn.query(`UPDATE ${tbl} SET openid = ? WHERE openid = ?`, [phoneOpenid, oldOpenid]); } catch (e) {}
          }
          // 更新双主键/双 openid 的信件、匹配、举报、拉黑相关表（与 bind-phone 首次绑定分支保持一致）
          await conn.query('UPDATE match_records SET user_a_openid = ? WHERE user_a_openid = ?', [phoneOpenid, oldOpenid]);
          await conn.query('UPDATE match_records SET user_b_openid = ? WHERE user_b_openid = ?', [phoneOpenid, oldOpenid]);
          await conn.query('UPDATE letters SET sender_openid = ? WHERE sender_openid = ?', [phoneOpenid, oldOpenid]);
          await conn.query('UPDATE letters SET receiver_openid = ? WHERE receiver_openid = ?', [phoneOpenid, oldOpenid]);
          await conn.query('UPDATE letter_reports SET reporter_openid = ? WHERE reporter_openid = ?', [phoneOpenid, oldOpenid]);
          await conn.query('UPDATE letter_reports SET target_openid = ? WHERE target_openid = ?', [phoneOpenid, oldOpenid]);
          await conn.query('UPDATE letter_blocks SET blocker_openid = ? WHERE blocker_openid = ?', [phoneOpenid, oldOpenid]);
          await conn.query('UPDATE letter_blocks SET blocked_openid = ? WHERE blocked_openid = ?', [phoneOpenid, oldOpenid]);
          // 更新 user_bindings
          await conn.query("UPDATE user_bindings SET unified_openid = ? WHERE unified_openid = ?", [phoneOpenid, oldOpenid]);
          loginOpenid = phoneOpenid;
          console.log('[auth/phone-login] 合并旧用户到phoneOpenid: ' + loginOpenid);
          [rows] = await conn.query("SELECT * FROM users WHERE openid = ?", [loginOpenid]);

          // v17.0 连签赠次（extra_vip_decode，Redis）迁移 + 清理旧 openid 的 Redis key（与 bind-phone 一致）
          try {
            const redis = await redisService.getClient();
            if (redis && redis.isReady) {
              const esrc = 'tianji:extra_vip_decode:' + oldOpenid;
              const edst = 'tianji:extra_vip_decode:' + phoneOpenid;
              const ev = await redis.get(esrc);
              if (ev && parseInt(ev, 10) > 0) {
                await redis.set(edst, String(parseInt(ev, 10) + (parseInt(await redis.get(edst)) || 0)));
              }
              await redis.del(esrc);
              const scanPattern = `tianji:vip_decode:${oldOpenid}:*`;
              let cursor = '0';
              do {
                const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', scanPattern, 'COUNT', 100);
                cursor = nextCursor;
                if (keys.length > 0) await redis.del(keys);
              } while (cursor !== '0');
              await redis.del(`tianji:session_key:${oldOpenid}`);
              try { await cache.del(`ban:${oldOpenid}`); } catch (e) {}
              console.log(`[auth/phone-login] 已迁移并清理旧 openid 的 Redis key: ${oldOpenid}`);
            }
          } catch (redisErr) {
            console.warn('[auth/phone-login] Redis 迁移/清理失败（不影响主流程）:', redisErr.message);
          }
        } else {
          // 3. 全新用户
          isNewUser = true;
          // v18.21 审核体验账号首次登录：预置充足额度（500积分+10次VIP深度解读）供商店审核实测
          // 注：quota_remaining 创建后会被 resetDailyQuota 按 free 计划重置为 3 次/天，属预期行为
          const isReview = isReviewAccount(phone);
          const initPoints = isReview ? 500 : 10;
          const initQuota = isReview ? 10 : 3;
          const insertResult = await conn.query(
            "INSERT IGNORE INTO users (openid, phone, plan_type, quota_remaining, points) VALUES (?, ?, 'free', ?, ?)",
            [phoneOpenid, phone, initQuota, initPoints]
          );
          if (insertResult[0].affectedRows > 0) {
            await conn.query("INSERT IGNORE INTO subscriptions (openid, plan_type) VALUES (?, 'free')", [phoneOpenid]);
            // v17.0 新用户注册赠 10 积分（=1次普通推演），记流水
            await conn.query(
              'INSERT INTO points_transactions (openid, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)',
              [phoneOpenid, 'new_user', initPoints, initPoints, isReview ? '商店审核体验账号预置积分' : '新用户注册赠分']
            );
            if (isReview) {
              try { for (let i = 0; i < 10; i++) await redisService.incrExtraVipDecode(phoneOpenid); } catch (e) { console.warn('[auth/phone-login] 审核账号预置VIP次数失败:', e.message); }
              console.log('[auth/phone-login] 审核体验账号已创建并预置额度');
            }
          }
          [rows] = await conn.query("SELECT * FROM users WHERE openid = ?", [phoneOpenid]);
        }
      } else {
        // 用户已存在，更新手机号
        if (!rows[0].phone) {
          await conn.query("UPDATE users SET phone = ? WHERE openid = ?", [phone, phoneOpenid]);
        }
      }

      const user = rows[0];

      // 检查账户状态（是否已注销）
      if (user.plan_type === 'cancelled') {
        console.log('[auth/phone-login] 账户已注销, 拒绝登录: openid=' + loginOpenid);
        return res.status(403).json({ 
          success: false, 
          code: 'USER_CANCELLED', 
          message: '您的账户已被注销，无法登录' 
        });
      }

      // 每日配额重置 + VIP降级
      await resetDailyQuota(conn, loginOpenid, user);
      await downgradeExpiredVip(conn, loginOpenid, user, user.last_quota_reset_date);

      // 记录登录事件
      await conn.query("INSERT INTO events (openid, event_type) VALUES (?, 'app_open')", [loginOpenid]);

      const token = generateToken(loginOpenid);

      res.json({
        success: true,
        data: {
          openid: loginOpenid,
          token,
          isNewUser,
          quota_remaining: user.quota_remaining,
          points: user.points || 0,
          plan_type: user.plan_type
        }
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("[auth/phone-login]", err);
    res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "服务器内部错误" });
  }
});


// ========== v19.0 邮箱+密码登录（海外/Google Play 上架用） ==========
// 流程：首次注册 = 邮箱收验证码 + 设置密码；之后 = 邮箱+密码直接登录
// 依赖：users 表 email/password_hash 列（下方 ensureEmailColumns 幂等迁移）、nodemailer、.env SMTP_* 配置

// 幂等迁移：users 表补 email/password_hash 列（启动时执行一次，已存在则跳过）
async function ensureEmailColumns() {
  try {
    const conn = await db.get();
    try {
      const [cols] = await conn.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME IN ('email','password_hash')");
      const existing = new Set(cols.map(c => c.COLUMN_NAME));
      if (!existing.has('email')) {
        await conn.query("ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL UNIQUE");
        console.log('[auth] users.email 列已添加');
      }
      if (!existing.has('password_hash')) {
        await conn.query("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL");
        console.log('[auth] users.password_hash 列已添加');
      }
    } finally { conn.release(); }
  } catch (e) {
    // PM2 cluster 多实例并发启动时，列被其他实例抢先添加会报 Duplicate column，视为成功
    if (e && (e.code === 'ER_DUP_FIELDNAME' || /Duplicate column/i.test(e.message || ''))) {
      console.log('[auth] email/password_hash 列已存在（其他实例已添加），跳过');
    } else {
      console.error('[auth] ensureEmailColumns 失败（email登录不可用）:', e.message);
    }
  }
}
ensureEmailColumns();

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// [SEC-FIX] P2-4: PII（手机号/邮箱）哈希盐改由环境变量 PII_HASH_SALT 提供。
// 未配置时回退旧盐以兼容存量账号（生产环境必须配置强随机盐，防止离线爆破还原手机号/邮箱）。
const PII_HASH_SALT = process.env.PII_HASH_SALT || '';
const LEGACY_PII_SALT = '_tianji_salt';

function piiHash(value) {
  return crypto.createHash('sha256').update(value + (PII_HASH_SALT || LEGACY_PII_SALT)).digest('hex').substring(0, 20);
}
function legacyPiiHash(value) {
  return crypto.createHash('sha256').update(value + LEGACY_PII_SALT).digest('hex').substring(0, 20);
}
function phoneOpenidOf(phone) { return 'phone_' + piiHash(phone); }
function legacyPhoneOpenidOf(phone) { return 'phone_' + legacyPiiHash(phone); }
function emailOpenidOf(email) { return 'email_' + piiHash(email.toLowerCase()); }
function legacyEmailOpenidOf(email) { return 'email_' + legacyPiiHash(email.toLowerCase()); }

// SMTP 发送邮件（lazy require nodemailer，未安装/未配置时返回明确错误）
async function sendMail(to, subject, html) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return { ok: false, reason: 'SMTP_NOT_CONFIGURED' };
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch (e) { return { ok: false, reason: 'NODEMAILER_NOT_INSTALLED' }; }
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT || '465', 10),
      secure: parseInt(SMTP_PORT || '465', 10) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    await transporter.sendMail({ from: SMTP_FROM || SMTP_USER, to, subject, html });
    return { ok: true };
  } catch (e) {
    console.error('[auth/email] SMTP send failed:', e.message);
    return { ok: false, reason: 'SMTP_ERROR', message: e.message };
  }
}

// [SEC-FIX] P1-1: 邮箱验证码哈希存储 + 失败锁定（每验证码独立随机盐）
const EMAIL_VERIFY_MAX_FAILS = 5;
function hashEmailCode(code, salt) {
  return crypto.createHash('sha256').update(code + ':' + salt).digest('hex');
}
async function storeEmailCode(redis, purpose, em, code) {
  const salt = crypto.randomBytes(8).toString('hex');
  await redis.set('tianji:emailcode:' + purpose + ':' + em,
    JSON.stringify({ h: hashEmailCode(code, salt), s: salt }), 'EX', 300);
}
/**
 * @returns {{ok: boolean, locked: boolean, retryAfter?: number}}
 */
async function verifyEmailCode(redis, purpose, em, code) {
  const failKey = 'tianji:emailcode:fail:' + purpose + ':' + em;
  const fails = parseInt((await redis.get(failKey)) || '0', 10);
  if (fails >= EMAIL_VERIFY_MAX_FAILS) {
    const ttl = await redis.ttl(failKey).catch(() => 300);
    return { ok: false, locked: true, retryAfter: ttl > 0 ? ttl : 300 };
  }
  const stored = await redis.get('tianji:emailcode:' + purpose + ':' + em);
  if (stored) {
    let matched = false;
    try {
      const p = JSON.parse(stored);
      matched = p.h && p.s && p.h === hashEmailCode(code, p.s);
    } catch (e) {
      matched = stored === String(code); // 兼容旧版明文验证码
    }
    if (matched) {
      await redis.del('tianji:emailcode:' + purpose + ':' + em);
      await redis.del(failKey);
      return { ok: true, locked: false };
    }
  }
  const n = await redis.incr(failKey);
  if (n === 1) await redis.expire(failKey, 300);
  return { ok: false, locked: n >= EMAIL_VERIFY_MAX_FAILS, retryAfter: 300 };
}

// POST /api/auth/email-send-code - 发送邮箱验证码（注册/重置密码，5分钟有效，60s冷却，每日≤10次）
router.post('/email-send-code', async (req, res) => {
  try {
    const { email, purpose } = req.body;
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'Invalid email address' });
    }
    const validPurpose = purpose === 'reset' ? 'reset' : (purpose === 'bind' ? 'bind' : 'register');
    const redis = await redisService.getClient();
    if (!redis || !redis.isReady) {
      return res.status(500).json({ success: false, code: 'REDIS_UNAVAILABLE', message: 'Service unavailable, try later' });
    }
    const em = email.toLowerCase();

    // 重置密码：必须存在账号
    if (validPurpose === 'reset') {
      const conn = await db.get();
      try {
        const [rows] = await conn.query('SELECT openid FROM users WHERE email = ? LIMIT 1', [em]);
        if (rows.length === 0) {
          return res.status(404).json({ success: false, code: 'ACCOUNT_NOT_FOUND', message: 'No account found with this email' });
        }
      } finally { conn.release(); }
    }

    // 60s 冷却（按 purpose 分开计数，互不影响）
    const cdKey = 'tianji:emailcode:cd:' + validPurpose + ':' + em;
    const cd = await redis.get(cdKey);
    if (cd) return res.status(429).json({ success: false, code: 'TOO_FREQUENT', message: 'Please wait 60s before resending' });
    // 每日上限 10 次（按 purpose 分开）
    const dailyKey = 'tianji:emailcode:daily:' + validPurpose + ':' + em + ':' + new Date().toISOString().slice(0, 10);
    const sent = parseInt((await redis.get(dailyKey)) || '0', 10);
    if (sent >= 10) return res.status(429).json({ success: false, code: 'DAILY_LIMIT', message: 'Too many requests today, try tomorrow' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const subject = validPurpose === 'reset'
      ? 'I Ching Insight — Password Reset Verification'
      : 'I Ching Insight — Verification Code';
    const purposeText = validPurpose === 'reset'
      ? 'You are resetting your password for I Ching Insight.'
      : 'You are registering an account with I Ching Insight.';
    const r = await sendMail(em, subject,
      `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a2e">
         <h2 style="letter-spacing:1px">I Ching Insight</h2>
         <p>${purposeText}</p>
         <p>Your verification code is:</p>
         <p style="font-size:32px;letter-spacing:8px;color:#C8A55B;font-weight:bold">${code}</p>
         <p style="color:#666;font-size:13px">This code expires in 5 minutes. If you did not request it, please ignore this email.</p>
       </div>`);
    if (!r.ok) {
      const msg = r.reason === 'SMTP_NOT_CONFIGURED' || r.reason === 'NODEMAILER_NOT_INSTALLED'
        ? 'Email service not configured on server'
        : 'Failed to send email, please retry';
      return res.status(500).json({ success: false, code: r.reason, message: msg });
    }
    // 存储验证码（按 purpose 分开，哈希存储防拖库爆破）
    await storeEmailCode(redis, validPurpose, em, code);
    await redis.set(cdKey, '1', 'EX', 60);
    if (sent === 0) await redis.set(dailyKey, '1', 'EX', 86400);
    else await redis.incr(dailyKey);
    res.json({ success: true, message: 'Verification code sent' });
  } catch (err) {
    console.error('[auth/email-send-code]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Server error' });
  }
});

// POST /api/auth/email-code-login - 邮箱+验证码 登录/注册合一（官网购会员/注销页用，无密码）
// 验证码即凭证：账号不存在时自动注册；已存在则直接登录（不要求设过密码）
router.post('/email-code-login', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'Invalid email address' });
    }
    if (!code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'Invalid verification code' });
    }
    const em = email.toLowerCase();
    const redis = await redisService.getClient();
    if (!redis || !redis.isReady) {
      return res.status(500).json({ success: false, code: 'REDIS_UNAVAILABLE', message: 'Service unavailable, try later' });
    }
    const evr = await verifyEmailCode(redis, 'register', em, code);
    if (!evr.ok) {
      if (evr.locked) {
        return res.status(429).json({ success: false, code: 'VERIFY_LOCKED', message: 'Verification attempts exceeded, try later' });
      }
      return res.status(400).json({ success: false, code: 'CODE_INVALID', message: 'Verification code is wrong or expired' });
    }

    const emailOpenid = emailOpenidOf(em);
    const conn = await db.get();
    try {
      const [existing] = await conn.query('SELECT * FROM users WHERE email = ? OR openid IN (?, ?) LIMIT 1', [em, emailOpenid, legacyEmailOpenidOf(em)]);
      let loginOpenid;
      let isNewUser = false;

      if (existing.length === 0) {
        isNewUser = true;
        await conn.query(
          "INSERT IGNORE INTO users (openid, email, plan_type, quota_remaining, points) VALUES (?, ?, 'free', 3, 10)",
          [emailOpenid, em]
        );
        await conn.query("INSERT IGNORE INTO subscriptions (openid, plan_type) VALUES (?, 'free')", [emailOpenid]);
        await conn.query(
          'INSERT INTO points_transactions (openid, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)',
          [emailOpenid, 'new_user', 10, 10, '邮箱验证码注册赠分']
        );
        loginOpenid = emailOpenid;
      } else {
        if (existing[0].plan_type === 'cancelled') {
          return res.status(403).json({ success: false, code: 'USER_CANCELLED', message: 'This account has been deactivated' });
        }
        loginOpenid = existing[0].openid;
      }

      const [rows] = await conn.query('SELECT * FROM users WHERE email = ? OR openid IN (?, ?) LIMIT 1', [em, emailOpenid, legacyEmailOpenidOf(em)]);
      const user = rows[0];
      await resetDailyQuota(conn, loginOpenid, user);
      await downgradeExpiredVip(conn, loginOpenid, user, user.last_quota_reset_date);
      await conn.query("INSERT INTO events (openid, event_type) VALUES (?, 'app_open')", [loginOpenid]);
      const token = generateToken(loginOpenid);
      res.json({ success: true, data: { openid: loginOpenid, token, isNewUser, quota_remaining: user.quota_remaining, points: user.points || 0, plan_type: user.plan_type } });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[auth/email-code-login]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Server error' });
  }
});

// POST /api/auth/email-register - 邮箱+验证码+密码 注册（首次）
router.post('/email-register', async (req, res) => {
  try {
    const { email, code, password } = req.body;
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'Invalid email address' });
    }
    if (!code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'Invalid verification code' });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'Password must be at least 6 characters' });
    }
    const em = email.toLowerCase();
    const redis = await redisService.getClient();
    if (!redis || !redis.isReady) {
      return res.status(500).json({ success: false, code: 'REDIS_UNAVAILABLE', message: 'Service unavailable, try later' });
    }
    const evr = await verifyEmailCode(redis, 'register', em, code);
    if (!evr.ok) {
      if (evr.locked) {
        return res.status(429).json({ success: false, code: 'VERIFY_LOCKED', message: 'Verification attempts exceeded, try later' });
      }
      return res.status(400).json({ success: false, code: 'CODE_INVALID', message: 'Verification code is wrong or expired' });
    }

    const emailOpenid = emailOpenidOf(em);
    const conn = await db.get();
    try {
      // 已有同邮箱账号且已设密码 → 引导直接登录
      const [existing] = await conn.query('SELECT openid, password_hash, nickname FROM users WHERE email = ? OR openid IN (?, ?) LIMIT 1', [em, emailOpenid, legacyEmailOpenidOf(em)]);
      if (existing.length > 0 && existing[0].password_hash) {
        return res.status(409).json({ success: false, code: 'ACCOUNT_EXISTS', message: 'Account already exists, please sign in directly' });
      }
      // v19.4 邮箱已被微信/手机账号绑定（无密码）：设置密码后两账号合一，需用户确认
      if (existing.length > 0 && !existing[0].password_hash && !req.body.confirmMerge
          && existing[0].openid !== emailOpenid) {
        return res.status(409).json({
          success: false,
          code: 'MERGE_CONFIRM',
          message: 'This email is bound to a WeChat account. Setting a password will merge both accounts into one.',
          data: { boundNickname: existing[0].nickname || '' }
        });
      }

      const bcrypt = require('bcrypt');
      const hash = await bcrypt.hash(String(password), 10);

      let isNewUser = false;
      if (existing.length === 0) {
        isNewUser = true;
        // 新用户：赠10积分（与手机号注册一致）
        const ins = await conn.query(
          "INSERT IGNORE INTO users (openid, email, plan_type, quota_remaining, points, password_hash) VALUES (?, ?, 'free', 3, 10, ?)",
          [emailOpenid, em, hash]
        );
        if (ins[0].affectedRows > 0) {
          await conn.query("INSERT IGNORE INTO subscriptions (openid, plan_type) VALUES (?, 'free')", [emailOpenid]);
          await conn.query(
            'INSERT INTO points_transactions (openid, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)',
            [emailOpenid, 'new_user', 10, 10, '邮箱注册赠分']
          );
        }
      } else {
        // 旧账号（邮箱曾绑定但无密码）补设密码
        await conn.query('UPDATE users SET password_hash = ?, email = ? WHERE openid = ?', [hash, em, existing[0].openid]);
      }

      const [rows] = await conn.query('SELECT * FROM users WHERE email = ? OR openid IN (?, ?) LIMIT 1', [em, emailOpenid, legacyEmailOpenidOf(em)]);
      const user = rows[0];
      const loginOpenid = user.openid;
      if (user.plan_type === 'cancelled') {
        return res.status(403).json({ success: false, code: 'USER_CANCELLED', message: 'This account has been deactivated' });
      }
      await resetDailyQuota(conn, loginOpenid, user);
      await downgradeExpiredVip(conn, loginOpenid, user, user.last_quota_reset_date);
      await conn.query("INSERT INTO events (openid, event_type) VALUES (?, 'app_open')", [loginOpenid]);
      const token = generateToken(loginOpenid);
      res.json({ success: true, data: { openid: loginOpenid, token, isNewUser, quota_remaining: user.quota_remaining, points: user.points || 0, plan_type: user.plan_type } });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[auth/email-register]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Server error' });
  }
});

// POST /api/auth/email-login - 邮箱+密码 登录
router.post('/email-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !EMAIL_RE.test(email) || !password) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'Invalid email or password' });
    }
    const em = email.toLowerCase();
    const emailOpenid = emailOpenidOf(em);
    const conn = await db.get();
    try {
      const [rows] = await conn.query('SELECT * FROM users WHERE email = ? OR openid IN (?, ?) LIMIT 1', [em, emailOpenid, legacyEmailOpenidOf(em)]);
      if (rows.length === 0 || !rows[0].password_hash) {
        return res.status(404).json({ success: false, code: 'ACCOUNT_NOT_FOUND', message: 'Account not found, please sign up first' });
      }
      const bcrypt = require('bcrypt');
      const ok = await bcrypt.compare(String(password), rows[0].password_hash);
      if (!ok) {
        return res.status(401).json({ success: false, code: 'PASSWORD_WRONG', message: 'Wrong email or password' });
      }
      const user = rows[0];
      const loginOpenid = user.openid;
      if (user.plan_type === 'cancelled') {
        return res.status(403).json({ success: false, code: 'USER_CANCELLED', message: 'This account has been deactivated' });
      }
      await resetDailyQuota(conn, loginOpenid, user);
      await downgradeExpiredVip(conn, loginOpenid, user, user.last_quota_reset_date);
      await conn.query("INSERT INTO events (openid, event_type) VALUES (?, 'app_open')", [loginOpenid]);
      const token = generateToken(loginOpenid);
      res.json({ success: true, data: { openid: loginOpenid, token, isNewUser: false, quota_remaining: user.quota_remaining, points: user.points || 0, plan_type: user.plan_type } });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[auth/email-login]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Server error' });
  }
});
// ========== 邮箱登录 END ==========

// POST /api/auth/email-reset-password - 邮箱+验证码 重置密码
router.post('/email-reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'Invalid email address' });
    }
    if (!code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'Invalid verification code' });
    }
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'New password must be at least 6 characters' });
    }
    const em = email.toLowerCase();
    const redis = await redisService.getClient();
    if (!redis || !redis.isReady) {
      return res.status(500).json({ success: false, code: 'REDIS_UNAVAILABLE', message: 'Service unavailable, try later' });
    }
    const evr = await verifyEmailCode(redis, 'reset', em, code);
    if (!evr.ok) {
      if (evr.locked) {
        return res.status(429).json({ success: false, code: 'VERIFY_LOCKED', message: 'Verification attempts exceeded, try later' });
      }
      return res.status(400).json({ success: false, code: 'CODE_INVALID', message: 'Verification code is wrong or expired' });
    }

    const conn = await db.get();
    try {
      const [rows] = await conn.query('SELECT * FROM users WHERE email = ? LIMIT 1', [em]);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, code: 'ACCOUNT_NOT_FOUND', message: 'No account found with this email' });
      }
      const bcrypt = require('bcrypt');
      const hash = await bcrypt.hash(String(newPassword), 10);
      await conn.query('UPDATE users SET password_hash = ? WHERE email = ?', [hash, em]);

      // 通知邮件
      try {
        await sendMail(em, 'I Ching Insight — Password Reset Successful',
          `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a2e">
             <h2 style="letter-spacing:1px">I Ching Insight</h2>
             <p>Your password has been reset successfully.</p>
             <p style="color:#666;font-size:13px">If you did not make this change, please contact support immediately.</p>
           </div>`);
      } catch (e) { console.warn('[auth/email-reset-password] 通知邮件发送失败:', e.message); }

      res.json({ success: true, message: 'Password reset successful' });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[auth/email-reset-password]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Server error' });
  }
});

// ========== 密码重置 END ==========


// ========== v19.4 邮箱绑定 + 账号合并（微信账号 ↔ 邮箱账号） ==========

/**
 * 将独立邮箱账号(email_xxx)的数据合并到当前主账号（复用 bind-phone 合并逻辑）
 * 合并后：主账号获得 email + password_hash（可用邮箱登录同一账号），邮箱账号行删除
 * @param conn   数据库连接（调用方管理事务）
 * @param mainOpenid 主账号 openid（保持不变）
 * @param emailAccount 邮箱账号 users 行
 * @param email 邮箱（小写）
 */
async function mergeEmailAccountInto(conn, mainOpenid, emailAccount, email) {
  const fromOpenid = emailAccount.openid;

  // 子表数据迁移（与 bind-phone 合并分支一致）
  await conn.query('UPDATE tuiyan_records SET openid = ? WHERE openid = ?', [mainOpenid, fromOpenid]);
  await conn.query('DELETE FROM subscriptions WHERE openid = ?', [fromOpenid]); // 主账号已有订阅，直接删临时账号记录
  await conn.query('UPDATE vip_orders SET openid = ? WHERE openid = ?', [mainOpenid, fromOpenid]);
  // user_gua_collection: 先删除主账号已有的重复卦，再迁移
  await conn.query('DELETE FROM user_gua_collection WHERE openid = ? AND gua_id IN (SELECT gua_id FROM (SELECT gua_id FROM user_gua_collection WHERE openid = ?) AS tmp)', [fromOpenid, mainOpenid]);
  await conn.query('UPDATE user_gua_collection SET openid = ? WHERE openid = ?', [mainOpenid, fromOpenid]);
  // user_achievements: 同上
  await conn.query('DELETE FROM user_achievements WHERE openid = ? AND achievement_key IN (SELECT achievement_key FROM (SELECT achievement_key FROM user_achievements WHERE openid = ?) AS tmp)', [fromOpenid, mainOpenid]);
  await conn.query('UPDATE user_achievements SET openid = ? WHERE openid = ?', [mainOpenid, fromOpenid]);
  await conn.query('UPDATE match_records SET user_a_openid = ? WHERE user_a_openid = ?', [mainOpenid, fromOpenid]);
  await conn.query('UPDATE match_records SET user_b_openid = ? WHERE user_b_openid = ?', [mainOpenid, fromOpenid]);
  await conn.query('UPDATE letters SET sender_openid = ? WHERE sender_openid = ?', [mainOpenid, fromOpenid]);
  await conn.query('UPDATE letters SET receiver_openid = ? WHERE receiver_openid = ?', [mainOpenid, fromOpenid]);
  await conn.query('UPDATE letter_reports SET reporter_openid = ? WHERE reporter_openid = ?', [mainOpenid, fromOpenid]);
  await conn.query('UPDATE letter_reports SET target_openid = ? WHERE target_openid = ?', [mainOpenid, fromOpenid]);
  await conn.query('UPDATE letter_blocks SET blocker_openid = ? WHERE blocker_openid = ?', [mainOpenid, fromOpenid]);
  await conn.query('UPDATE letter_blocks SET blocked_openid = ? WHERE blocked_openid = ?', [mainOpenid, fromOpenid]);
  await conn.query('UPDATE events SET openid = ? WHERE openid = ?', [mainOpenid, fromOpenid]);
  try { await conn.query('UPDATE share_codes SET openid = ? WHERE openid = ?', [mainOpenid, fromOpenid]); } catch (e) {}
  try { await conn.query('UPDATE pending_deletions SET openid = ? WHERE openid = ?', [mainOpenid, fromOpenid]); } catch (e) {}
  try { await conn.query('UPDATE points_transactions SET openid = ? WHERE openid = ?', [mainOpenid, fromOpenid]); } catch (e) { console.warn('[email-merge] points_transactions 迁移跳过:', e.message); }

  // 积分余额/累计/累计签到天数合并到主账号
  await conn.query(
    'UPDATE users dst JOIN users src ON src.openid = ? SET dst.points = dst.points + src.points, dst.total_points = dst.total_points + src.total_points, dst.checkin_total = dst.checkin_total + src.checkin_total WHERE dst.openid = ?',
    [fromOpenid, mainOpenid]
  );

  // 主账号获得邮箱登录能力（email 列 UNIQUE，先删旧行再写入主账号）
  await conn.query('DELETE FROM users WHERE openid = ?', [fromOpenid]);
  await conn.query('UPDATE users SET email = ?, password_hash = ? WHERE openid = ?',
    [email, emailAccount.password_hash, mainOpenid]);

  // 记录绑定关系（旧邮箱登录 token 通过 user_bindings 解析到主账号）
  await conn.query('DELETE FROM user_bindings WHERE unified_openid = ?', [fromOpenid]);
  await conn.query(
    'INSERT INTO user_bindings (unified_openid, platform, platform_openid, unionid) VALUES (?, ?, ?, NULL)',
    [mainOpenid, 'email', fromOpenid]
  );
}

/**
 * 事务提交后：迁移/清理被合并邮箱账号的 Redis 数据
 */
async function migrateEmailAccountRedis(fromOpenid, mainOpenid) {
  try {
    const redis = await redisService.getClient();
    if (!redis || !redis.isReady) return;
    // extra_vip_decode 连签赠次迁移
    const esrc = 'tianji:extra_vip_decode:' + fromOpenid;
    const edst = 'tianji:extra_vip_decode:' + mainOpenid;
    const ev = await redis.get(esrc);
    if (ev && parseInt(ev, 10) > 0) {
      await redis.set(edst, String(parseInt(ev, 10) + (parseInt(await redis.get(edst)) || 0)));
    }
    await redis.del(esrc);
    // vip_decode 计数 / session_key / ban 缓存清理
    const scanPattern = `tianji:vip_decode:${fromOpenid}:*`;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', scanPattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) await redis.del(keys);
    } while (cursor !== '0');
    await redis.del(`tianji:session_key:${fromOpenid}`);
    try { await cache.del(`ban:${fromOpenid}`); } catch (e) {}
    console.log(`[email-merge] 已清理被合并邮箱账号的 Redis key: ${fromOpenid}`);
  } catch (e) {
    console.warn('[email-merge] Redis 迁移/清理失败（不影响主流程）:', e.message);
  }
}

// POST /api/auth/email-bind - 当前登录账号绑定邮箱（我的页入口）
// 场景A：邮箱未被占用 → 直接绑定（当前账号获得邮箱登录能力）
// 场景B：邮箱已被独立邮箱账号占用 → 返回 mergeable 摘要，前端弹窗确认后带 confirmMerge=true 重新提交执行合并
router.post('/email-bind', verifyToken, async (req, res) => {
  let conn;
  try {
    const { email, code, password, confirmMerge } = req.body;
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'Invalid email address' });
    }
    if (!code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'Invalid verification code' });
    }
    const em = email.toLowerCase();
    const mainOpenid = req.openid;

    // 校验绑定验证码
    const redis = await redisService.getClient();
    if (!redis || !redis.isReady) {
      return res.status(500).json({ success: false, code: 'REDIS_UNAVAILABLE', message: 'Service unavailable, try later' });
    }
    const evr = await verifyEmailCode(redis, 'bind', em, code);
    if (!evr.ok) {
      if (evr.locked) {
        return res.status(429).json({ success: false, code: 'VERIFY_LOCKED', message: 'Verification attempts exceeded, try later' });
      }
      return res.status(400).json({ success: false, code: 'CODE_INVALID', message: 'Verification code is wrong or expired' });
    }

    conn = await db.get();
    try {
      const [mainRows] = await conn.query('SELECT openid, email, password_hash FROM users WHERE openid = ? LIMIT 1', [mainOpenid]);
      if (mainRows.length === 0) {
        return res.status(404).json({ success: false, code: 'ACCOUNT_NOT_FOUND', message: 'Current account not found' });
      }
      // 幂等：已绑定该邮箱
      if (mainRows[0].email === em) {
        await redis.del('tianji:emailcode:bind:' + em);
        return res.json({ success: true, data: { bound: true, merged: false } });
      }

      const [takenRows] = await conn.query('SELECT openid, nickname, plan_type, password_hash, email FROM users WHERE email = ? LIMIT 1', [em]);
      const taken = takenRows[0];

      if (!taken) {
        // ===== 场景A：邮箱未占用 → 直接绑定（需同时设置密码用于邮箱登录）=====
        if (!password || String(password).length < 6) {
          return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'Password must be at least 6 characters' });
        }
        const bcrypt = require('bcrypt');
        const hash = await bcrypt.hash(String(password), 10);
        await conn.query('UPDATE users SET email = ?, password_hash = ? WHERE openid = ?', [em, hash, mainOpenid]);
        await redis.del('tianji:emailcode:bind:' + em);
        return res.json({ success: true, data: { bound: true, merged: false } });
      }

      // 邮箱被占用：只有独立邮箱账号（email_xxx）可合并
      const emailOpenid = emailOpenidOf(em);
      if (taken.openid !== emailOpenid) {
        return res.status(409).json({ success: false, code: 'EMAIL_TAKEN', message: 'This email is already bound to another account' });
      }
      if (!taken.password_hash) {
        // 占用行无密码（异常数据：email_xxx 行但没有密码）→ 直接认领
        if (!password || String(password).length < 6) {
          return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'Password must be at least 6 characters' });
        }
        const bcrypt = require('bcrypt');
        const hash = await bcrypt.hash(String(password), 10);
        await conn.query('UPDATE users SET password_hash = ? WHERE openid = ?', [hash, taken.openid]);
        await redis.del('tianji:emailcode:bind:' + em);
        return res.json({ success: true, data: { bound: true, merged: false } });
      }

      // ===== 场景B：独立邮箱账号 → 需用户确认合并 =====
      if (!confirmMerge) {
        return res.json({
          success: true,
          data: {
            bound: false,
            mergeable: true,
            mergeSummary: {
              nickname: taken.nickname || '',
              planType: taken.plan_type || 'free',
              points: 0
            }
          }
        });
      }

      // 执行合并：邮箱账号数据迁入当前主账号
      await conn.beginTransaction();
      await mergeEmailAccountInto(conn, mainOpenid, taken, em);
      await conn.commit();
      await redis.del('tianji:emailcode:bind:' + em);
      await migrateEmailAccountRedis(emailOpenid, mainOpenid);
      return res.json({ success: true, data: { bound: true, merged: true, openid: mainOpenid } });
    } catch (txErr) {
      try { await conn.rollback(); } catch (_) {}
      throw txErr;
    }
  } catch (err) {
    console.error('[auth/email-bind]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Server error' });
  } finally {
    if (conn) conn.release();
  }
});
// ========== 邮箱绑定 + 账号合并 END ==========


// ========== 网页微信扫码登录 + 账号绑定 ==========

// POST /api/auth/web-wx-login - 网页微信扫码登录(微信开放平台网站应用 OAuth)
router.post('/web-wx-login', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'code必填' });

    // 网页扫码登录使用微信开放平台网站应用的 AppID/AppSecret(与小程序不同)
    const appId = process.env.WX_WEB_APPID;
    const appSecret = process.env.WX_WEB_APPSECRET;

    if (!appId || !appSecret) {
      console.error('[auth/web-wx-login] WX_WEB_APPID或WX_WEB_APPSECRET未配置');
      return res.status(500).json({ success: false, code: 'CONFIG_ERROR', message: '服务器配置错误,请联系管理员' });
    }

    let webOpenid = null;
    let unionid = null;

    try {
      const wxUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appId}&secret=${encodeURIComponent(appSecret)}&code=${code}&grant_type=authorization_code`;
      const wxRes = await axios.get(wxUrl, { timeout: 10000 });

      console.log('[auth/web-wx-login] 微信OAuth响应: errcode=' + (wxRes.data.errcode || 0));

      if (wxRes.data.errcode) {
        console.error('[auth/web-wx-login] 微信OAuth失败:', wxRes.data);
        return res.status(400).json({ success: false, code: 'WX_LOGIN_FAILED', message: wxRes.data.errmsg || '微信登录失败' });
      }

      webOpenid = wxRes.data.openid;
      unionid = wxRes.data.unionid || null;

      if (!webOpenid) {
        return res.status(500).json({ success: false, code: 'WX_LOGIN_FAILED', message: '获取openid失败' });
      }
    } catch (err) {
      console.error('[auth/web-wx-login] 请求微信API异常:', err.message);
      return res.status(500).json({ success: false, code: 'WX_LOGIN_FAILED', message: '微信登录服务异常' });
    }

    // 生成网页端临时 openid: wx_web_ + sha256(web_openid).substr(0,20)
    const tempOpenid = 'wx_web_' + crypto.createHash('sha256').update(webOpenid).digest('hex').substring(0, 20);

    const conn = await db.get();
    try {
      // 先查 user_bindings 看是否已绑定,确定实际登录用 openid
      let loginOpenid = tempOpenid;

      // 1) 按 unionid 查:如果已绑定,返回主账号 token
      if (unionid) {
        const [ubByUnion] = await conn.query(
          'SELECT unified_openid FROM user_bindings WHERE unionid = ? LIMIT 1',
          [unionid]
        );
        if (ubByUnion.length > 0) {
          loginOpenid = ubByUnion[0].unified_openid;
        }
      }

      // 2) 按 platform='wx_web' AND platform_openid 查:如果已绑定,返回主账号 token
      if (loginOpenid === tempOpenid) {
        const [ubByPlat] = await conn.query(
          'SELECT unified_openid FROM user_bindings WHERE platform = ? AND platform_openid = ? LIMIT 1',
          ['wx_web', tempOpenid]
        );
        if (ubByPlat.length > 0) {
          loginOpenid = ubByPlat[0].unified_openid;
        }
      }

      // 未绑定时:用 wx_web_xxxx 作为 openid 创建/登录临时账号,将 unionid 存入 users 表
      let [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [loginOpenid]);

      let isNewUser = false;
      if (rows.length === 0) {
        const insertResult = await conn.query(
          'INSERT IGNORE INTO users (openid, plan_type, quota_remaining, points) VALUES (?, "free", 3, 10)',
          [loginOpenid]
        );
        isNewUser = insertResult[0].affectedRows > 0;
        if (isNewUser) {
          await conn.query(
            'INSERT IGNORE INTO subscriptions (openid, plan_type) VALUES (?, "free")',
            [loginOpenid]
          );
          // v17.0 新用户注册赠 10 积分（=1次普通推演），记流水
          await conn.query(
            'INSERT INTO points_transactions (openid, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)',
            [loginOpenid, 'new_user', 10, 10, '新用户注册赠分']
          );
        }
        [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [loginOpenid]);
      }

      const user = rows[0];

      // 每日免费配额重置 + VIP过期检查
      await resetDailyQuota(conn, loginOpenid, user);

      // v2.3.5 VIP过期自动降级（公共函数）
      await downgradeExpiredVip(conn, loginOpenid, user, user.last_quota_reset_date);

      // 如果获取到 unionid,将 unionid 和 wx_web_openid 存入 users 表
      if (unionid) {
        await conn.query('UPDATE users SET unionid = ?, wx_web_openid = ? WHERE openid = ?', [unionid, webOpenid, loginOpenid]);
      } else {
        // 即使没有 unionid，也记录 wx_web_openid 便于反查
        await conn.query('UPDATE users SET wx_web_openid = ? WHERE openid = ?', [webOpenid, loginOpenid]);
      }

      // 记录登录事件
      await conn.query(
        "INSERT INTO events (openid, event_type) VALUES (?, 'app_open')",
        [loginOpenid]
      );

      const token = generateToken(loginOpenid);

      res.json({
        success: true,
        data: {
          openid: user.openid,
          token,
          isNewUser,
          quota_remaining: user.quota_remaining,
          points: user.points || 0,
          plan_type: user.plan_type
        }
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[auth/web-wx-login]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});


// GET /api/auth/binding-status - 查询当前账号绑定状态
router.get('/binding-status', verifyToken, async (req, res) => {
  const conn = await db.get();
  try {
    const openid = req.openid;

    // 查询当前用户是否已有 phone 字段
    const [userRows] = await conn.query('SELECT phone FROM users WHERE openid = ? LIMIT 1', [openid]);
    let phone = '';
    let isBound = false;

    if (userRows.length > 0 && userRows[0].phone) {
      phone = userRows[0].phone;
      isBound = true;
    } else {
      // 查 user_bindings 表(当前 openid 可能在 unified_openid 或 platform_openid 字段)
      const [bindRows] = await conn.query(
        'SELECT unified_openid FROM user_bindings WHERE unified_openid = ? OR platform_openid = ? LIMIT 1',
        [openid, openid]
      );
      if (bindRows.length > 0) {
        isBound = true;
        // 查找主账号的手机号
        const [mainRows] = await conn.query('SELECT phone FROM users WHERE openid = ? LIMIT 1', [bindRows[0].unified_openid]);
        if (mainRows.length > 0 && mainRows[0].phone) phone = mainRows[0].phone;
      }
    }

    // 脱敏手机号: 138****8888
    let maskedPhone = '';
    if (phone && phone.length === 11) {
      maskedPhone = phone.substring(0, 3) + '****' + phone.substring(7);
    }

    res.json({
      success: true,
      data: { isBound, phone: maskedPhone }
    });
  } catch (err) {
    console.error('[auth/binding-status]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  } finally {
    conn.release();
  }
});


// POST /api/auth/bind-phone - VIP购买前绑定手机号 + 账号合并
router.post('/bind-phone', verifyToken, async (req, res) => {
  let conn;
  try {
    const { phone, code } = req.body;
    if (!phone || !/^1\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '手机号格式不正确' });
    }
    if (!code || !/^\d{4,6}$/.test(code)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '验证码格式不正确' });
    }

    // 验证短信验证码(复用 phone-login 中已定义的 verifySmsCode)
    const vr = await verifySmsCode(phone, code);
    if (!vr.ok) {
      if (vr.locked) {
        return res.status(429).json({ success: false, code: 'VERIFY_LOCKED', message: '验证码错误次数过多，请稍后重试' });
      }
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '验证码错误或已过期' });
    }

    // 计算 phone_openid（[SEC-FIX] P2-4: 双盐兼容存量账号）
    const phoneOpenid = phoneOpenidOf(phone);
    const legacyPhoneOpenid = legacyPhoneOpenidOf(phone);

    // 当前登录的 openid
    const currentOpenid = req.openid;

    // 如果当前 openid 已经是 phone_openid(APP用户本来就是手机号登录),直接返回成功
    if (currentOpenid === phoneOpenid) {
      const token = generateToken(phoneOpenid);
      return res.json({
        success: true,
        data: { openid: phoneOpenid, token, isMerged: false }
      });
    }

    conn = await db.get();

    // 查询 phone_openid 账号是否已存在（兼容旧盐存量账号）
    const [existingRows] = await conn.query('SELECT openid FROM users WHERE openid IN (?, ?) LIMIT 1', [phoneOpenid, legacyPhoneOpenid]);
    const phoneAccountExists = existingRows.length > 0;

    // 获取当前账号的 unionid(用于绑定记录)
    const [currentUserRows] = await conn.query('SELECT unionid FROM users WHERE openid = ? LIMIT 1', [currentOpenid]);
    const currentUnionid = (currentUserRows.length > 0 && currentUserRows[0].unionid) ? currentUserRows[0].unionid : null;

    // 判断 platform: wx_web_ 开头='wx_web', phone_ 开头='phone'(已绑定), o/ O开头='wechat'(微信小程序), 其他='app_device'(设备登录)
    let platform;
    if (currentOpenid.startsWith('wx_web_')) {
      platform = 'wx_web';
    } else if (currentOpenid.startsWith('phone_')) {
      platform = 'phone';
    } else if (currentOpenid.startsWith('o') || currentOpenid.startsWith('O')) {
      platform = 'wechat';
    } else {
      platform = 'app_device';
    }

    try {
      await conn.beginTransaction();

      if (!phoneAccountExists) {
        // ===== 首次绑定: 在事务中将当前账号原地升级 =====
        // 1. 更新 users 表
        await conn.query('UPDATE users SET openid = ?, phone = ? WHERE openid = ?', [phoneOpenid, phone, currentOpenid]);

        // 2. 更新所有子表的 openid 字段
        await conn.query('UPDATE tuiyan_records SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE subscriptions SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE vip_orders SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE user_gua_collection SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE user_achievements SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE match_records SET user_a_openid = ? WHERE user_a_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE match_records SET user_b_openid = ? WHERE user_b_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE letters SET sender_openid = ? WHERE sender_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE letters SET receiver_openid = ? WHERE receiver_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE letter_reports SET reporter_openid = ? WHERE reporter_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE letter_reports SET target_openid = ? WHERE target_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE letter_blocks SET blocker_openid = ? WHERE blocker_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE letter_blocks SET blocked_openid = ? WHERE blocked_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE events SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        // v17.0 积分流水表 openid 同步迁移（表在 v17.0 已建；表不存在则跳过）
        try {
          await conn.query('UPDATE points_transactions SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        } catch (e) { console.warn('[bind-phone] points_transactions 迁移跳过:', e.message); }
        // share_codes / pending_deletions 表可能不存在,用 try-catch 兜底
        try {
          await conn.query('UPDATE share_codes SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        } catch (e) { /* share_codes 表可能不存在,忽略 */ }
        try {
          await conn.query('UPDATE pending_deletions SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        } catch (e) { /* pending_deletions 表可能不存在,忽略 */ }

        // 3. 更新已有的绑定记录（换绑场景：旧主账号的绑定记录指向新主账号）
        // 例如: user_bindings(wechat, oBq433xxx → phone_A) 需要更新为 (→ phone_B)
        await conn.query(
          'UPDATE user_bindings SET unified_openid = ? WHERE unified_openid = ?',
          [phoneOpenid, currentOpenid]
        );

        // 4. 插入本次绑定记录
        await conn.query(
          'INSERT INTO user_bindings (unified_openid, platform, platform_openid, unionid) VALUES (?, ?, ?, ?)',
          [phoneOpenid, platform, currentOpenid, currentUnionid]
        );

        await conn.commit();

        // v17.0 连签赠次（extra_vip_decode，Redis）迁移到新 openid
        try {
          const esrc = 'tianji:extra_vip_decode:' + currentOpenid;
          const edst = 'tianji:extra_vip_decode:' + phoneOpenid;
          const eRedis = await redisService.getClient();
          if (eRedis && eRedis.isReady) {
            const ev = await eRedis.get(esrc);
            if (ev && parseInt(ev, 10) > 0) {
              await eRedis.set(edst, String(parseInt(ev, 10) + (parseInt(await eRedis.get(edst)) || 0)));
            }
            await eRedis.del(esrc);
          }
        } catch (eRedisErr) { console.warn('[bind-phone] extra_vip_decode 迁移失败:', eRedisErr.message); }

        // 🔴 关键修复：事务提交后清理旧 openid 的 Redis key，防止旧数据残留
        // 1. 清理 VIP 推演计数（tianji:vip_decode:${currentOpenid}:*）
        // 2. 清理 session_key（tianji:session_key:${currentOpenid}）
        // 3. 清理封禁缓存（ban:${currentOpenid}）
        try {
          const redis = await redisService.getClient();
          if (redis && redis.isReady) {
            // SCAN 删除 vip_decode 计数
            const scanPattern = `tianji:vip_decode:${currentOpenid}:*`;
            let cursor = '0';
            do {
              const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', scanPattern, 'COUNT', 100);
              cursor = nextCursor;
              if (keys.length > 0) await redis.del(keys);
            } while (cursor !== '0');
            // 删除 session_key 和 ban 缓存
            await redis.del(`tianji:session_key:${currentOpenid}`);
            // ban 缓存走 cache 服务（自动加 tianji:cache: 前缀）
            try { await cache.del(`ban:${currentOpenid}`); } catch (e) {}
            console.log(`[bind-phone] 已清理旧 openid 的 Redis key: ${currentOpenid}`);
          }
        } catch (redisErr) {
          console.warn('[bind-phone] Redis 清理失败（不影响主流程）:', redisErr.message);
        }

        const token = generateToken(phoneOpenid);
        return res.json({
          success: true,
          data: { openid: phoneOpenid, token, isMerged: false }
        });
      } else {
        // ===== 已存在: 在事务中合并数据(将当前临时账号数据迁移到 phone_openid 账号) =====
        await conn.query('UPDATE tuiyan_records SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        // subscriptions: 主账号已有记录,直接删除临时账号的记录(不迁移)
        await conn.query('DELETE FROM subscriptions WHERE openid = ?', [currentOpenid]);
        await conn.query('UPDATE vip_orders SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        // user_gua_collection: 先删除重复行(主账号已有同gua_id),再UPDATE剩余行
        await conn.query('DELETE FROM user_gua_collection WHERE openid = ? AND gua_id IN (SELECT gua_id FROM (SELECT gua_id FROM user_gua_collection WHERE openid = ?) AS tmp)', [currentOpenid, phoneOpenid]);
        await conn.query('UPDATE user_gua_collection SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        // user_achievements: 同上,先删除重复行
        await conn.query('DELETE FROM user_achievements WHERE openid = ? AND achievement_key IN (SELECT achievement_key FROM (SELECT achievement_key FROM user_achievements WHERE openid = ?) AS tmp)', [currentOpenid, phoneOpenid]);
        await conn.query('UPDATE user_achievements SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE match_records SET user_a_openid = ? WHERE user_a_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE match_records SET user_b_openid = ? WHERE user_b_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE letters SET sender_openid = ? WHERE sender_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE letters SET receiver_openid = ? WHERE receiver_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE letter_reports SET reporter_openid = ? WHERE reporter_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE letter_reports SET target_openid = ? WHERE target_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE letter_blocks SET blocker_openid = ? WHERE blocker_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE letter_blocks SET blocked_openid = ? WHERE blocked_openid = ?', [phoneOpenid, currentOpenid]);
        await conn.query('UPDATE events SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        try {
          await conn.query('UPDATE share_codes SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        } catch (e) { /* share_codes 表可能不存在,忽略 */ }
        try {
          await conn.query('UPDATE pending_deletions SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        } catch (e) { /* pending_deletions 表可能不存在,忽略 */ }

        // v17.0 积分体系合并：迁移临时账号积分流水至主账号（表在 v17.0 已建；表不存在则跳过）
        try {
          await conn.query('UPDATE points_transactions SET openid = ? WHERE openid = ?', [phoneOpenid, currentOpenid]);
        } catch (e) { console.warn('[bind-phone] points_transactions 迁移跳过:', e.message); }
        // 合并积分余额/累计/累计签到天数到主账号（临时账号随后被删除）
        await conn.query(
          'UPDATE users dst JOIN users src ON src.openid = ? SET dst.points = dst.points + src.points, dst.total_points = dst.total_points + src.total_points, dst.checkin_total = dst.checkin_total + src.checkin_total WHERE dst.openid = ?',
          [currentOpenid, phoneOpenid]
        );

        // 删除临时账号
        await conn.query('DELETE FROM users WHERE openid = ?', [currentOpenid]);
        await conn.query('DELETE FROM subscriptions WHERE openid = ?', [currentOpenid]);

        // 更新已有的绑定记录（换绑场景：旧主账号的绑定记录指向新主账号）
        await conn.query(
          'UPDATE user_bindings SET unified_openid = ? WHERE unified_openid = ?',
          [phoneOpenid, currentOpenid]
        );

        // 插入本次绑定记录
        await conn.query(
          'INSERT INTO user_bindings (unified_openid, platform, platform_openid, unionid) VALUES (?, ?, ?, ?)',
          [phoneOpenid, platform, currentOpenid, currentUnionid]
        );

        await conn.commit();

        // v17.0 连签赠次（extra_vip_decode，Redis）从临时账号迁移到主账号
        try {
          const esrc = 'tianji:extra_vip_decode:' + currentOpenid;
          const edst = 'tianji:extra_vip_decode:' + phoneOpenid;
          const eRedis = await redisService.getClient();
          if (eRedis && eRedis.isReady) {
            const ev = await eRedis.get(esrc);
            if (ev && parseInt(ev, 10) > 0) {
              await eRedis.set(edst, String(parseInt(ev, 10) + (parseInt(await eRedis.get(edst)) || 0)));
            }
            await eRedis.del(esrc);
          }
        } catch (eRedisErr) { console.warn('[bind-phone] extra_vip_decode 迁移失败:', eRedisErr.message); }

        // 🔴 关键修复：事务提交后清理旧 openid 的 Redis key（同首次绑定分支）
        try {
          const redis = await redisService.getClient();
          if (redis && redis.isReady) {
            const scanPattern = `tianji:vip_decode:${currentOpenid}:*`;
            let cursor = '0';
            do {
              const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', scanPattern, 'COUNT', 100);
              cursor = nextCursor;
              if (keys.length > 0) await redis.del(keys);
            } while (cursor !== '0');
            await redis.del(`tianji:session_key:${currentOpenid}`);
            // ban 缓存走 cache 服务（自动加 tianji:cache: 前缀）
            try { await cache.del(`ban:${currentOpenid}`); } catch (e) {}
            console.log(`[bind-phone] 已清理旧 openid 的 Redis key: ${currentOpenid}`);
          }
        } catch (redisErr) {
          console.warn('[bind-phone] Redis 清理失败（不影响主流程）:', redisErr.message);
        }

        const token = generateToken(phoneOpenid);
        return res.json({
          success: true,
          data: { openid: phoneOpenid, token, isMerged: true }
        });
      }
    } catch (txErr) {
      try { await conn.rollback(); } catch (_) {}
      throw txErr;
    }
  } catch (err) {
    console.error('[auth/bind-phone]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  } finally {
    if (conn) conn.release();
  }
});


module.exports = router;
