// src/routes/user.js - 用户相关接口
const express = require('express');
const router = express.Router();
const { verifyToken, optionalAuth, verifyOpenidMatch } = require('../middleware/auth');
const db = require('../middleware/db');
const { HEXAGRAMS } = require('../../config/hexagrams');
const HEXAGRAMS_EN = require('../../config/hexagrams-en'); // v19.2
const { Solar } = require('lunar-javascript');
const { logEvent } = require('../services/event-logger');
const redisService = require('../services/redis');
const { downgradeExpiredVip, resetDailyQuota } = require('../utils/vip'); // v2.3.5 抽取VIP降级公共函数

// [SEC-FIX] P1-5: 用户对象字段白名单——绝不返回 password_hash / email / phone / unionid 等敏感字段
const SAFE_USER_FIELDS = [
  'openid', 'nickname', 'avatar_url', 'birth_year', 'birth_month', 'birth_day', 'birth_shichen',
  'gender', 'ming_ben_gua', 'has_profile', 'personality_desc', 'plan_type', 'expire_time',
  'quota_remaining', 'points', 'total_points', 'last_quota_reset_date',
  'checkin_streak', 'checkin_total', 'last_checkin_date', 'letter_reply_enabled', 'created_at'
];
function safeUserFields(user) {
  if (!user || typeof user !== 'object') return user || {};
  const out = {};
  for (const k of SAFE_USER_FIELDS) {
    if (user[k] !== undefined) out[k] = user[k];
  }
  return out;
}

/**
 * 将阳历日期转换为农历数据（用于梅花易数本命卦计算）
 * @param {number} solarYear - 阳历年
 * @param {number} solarMonth - 阳历月
 * @param {number} solarDay - 阳历日
 * @returns {{ year, month, day }} 农历年、月、日（月取绝对值处理闰月）
 */
function solarToLunarForGua(solarYear, solarMonth, solarDay) {
  const solar = Solar.fromYmd(solarYear, solarMonth, solarDay);
  const lunar = solar.getLunar();
  return {
    year: lunar.getYear(),
    month: Math.abs(lunar.getMonth()), // 闰月返回负数，取绝对值
    day: lunar.getDay()
  };
}

/**
 * 辅助函数：根据 ming_ben_gua ID 补充易经人格展示字段
 * v19.2：lang='en' 时卦名/卦格/标签/五行用英文（hexagrams-en 静态表）
 */
async function getGuaExtra(guaId, conn, lang) {
  if (!guaId) return { symbol: '䷀', rarity: '', gua_ge: '', gua_ge_name: '', full_name: '', social_tag: '', wuxing: '' };
  const idNum = Number(guaId);
  let extra = { symbol: '䷀', rarity: '', gua_ge: '', gua_ge_name: '', full_name: '', social_tag: '', wuxing: '' };

  // 从数据库取完整卦象信息
  if (conn) {
    const [rows] = await conn.query('SELECT symbol, name, full_name FROM hexagrams WHERE id = ?', [idNum]);
    if (rows.length) {
      extra.symbol = rows[0].symbol || '䷀';
      extra.gua_ge_name = rows[0].name || '';
      extra.full_name = rows[0].full_name || '';
    }
  }

  // 从 config 取 rarity、gua_ge、wuxing
  for (const [, gua] of Object.entries(HEXAGRAMS)) {
    if (gua.id === idNum) {
      extra.rarity = gua.xi_you_du || '';
      extra.gua_ge = gua.gua_ge || '';
      extra.social_tag = gua.social_tag || '';
      extra.wuxing = gua.wuxing || '';
      break;
    }
  }

  // v19.2 英文态：短字段查静态表覆盖
  if (lang === 'en') {
    const en = HEXAGRAMS_EN[idNum] || {};
    const WUXING_EN_MAP = { '金': 'Metal', '木': 'Wood', '水': 'Water', '火': 'Fire', '土': 'Earth' };
    if (en.name) { extra.gua_ge_name = en.name; extra.full_name = en.name; }
    if (en.gua_ge) extra.gua_ge = en.gua_ge;
    if (en.social_tag) extra.social_tag = en.social_tag;
    if (extra.wuxing) extra.wuxing = WUXING_EN_MAP[extra.wuxing] || extra.wuxing;
  }
  return extra;
}

// POST /api/user/profile - 创建/更新用户档案（需认证）
router.post('/profile', verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    let { nickname, birth_year, birth_month, birth_day, birth_shichen, gender } = req.body;
    // 安全截断：去除首尾空格，限制20个Unicode码点以内
    nickname = typeof nickname === 'string' ? Array.from(nickname.trim()).slice(0, 20).join('') : '';

    if (!nickname || !birth_year || !birth_month || !birth_day) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '昵称和生日必填' });
    }

    // 🔴 修复：birth_year范围校验（与PATCH接口v1.5校验逻辑保持一致）
    const currentYear = new Date().getFullYear();
    const yearVal = parseInt(birth_year, 10);
    const monthVal = parseInt(birth_month, 10);
    const dayVal = parseInt(birth_day, 10);
    if (isNaN(yearVal) || isNaN(monthVal) || isNaN(dayVal) || yearVal < 1900 || yearVal > currentYear || monthVal < 1 || monthVal > 12 || dayVal < 1 || dayVal > 31) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '出生日期格式不正确' });
    }

    // gender: 1=男, 2=女, 0=未知
    const genderVal = gender === 'female' || gender === 2 ? 2 : gender === 'male' || gender === 1 ? 1 : 0;

    const conn = await db.get();
    try {
      // 阳历转农历后再计算本命卦（梅花易数传统算法使用农历）
      const lunarDate = solarToLunarForGua(birth_year, birth_month, birth_day);
      const { calculateMingBenGua } = require('../services/algorithms');
      const guaResult = calculateMingBenGua(lunarDate.year, lunarDate.month, lunarDate.day, birth_shichen || 0);
      const mingBenGua = guaResult.id; // 存储卦ID（数字）

      // 创建或更新用户档案（新用户用INSERT，已存在用UPDATE）
      await conn.query(
        'INSERT INTO users (openid, nickname, birth_year, birth_month, birth_day, birth_shichen, gender, ming_ben_gua, has_profile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE nickname=VALUES(nickname), birth_year=VALUES(birth_year), birth_month=VALUES(birth_month), birth_day=VALUES(birth_day), birth_shichen=VALUES(birth_shichen), gender=VALUES(gender), ming_ben_gua=VALUES(ming_ben_gua), has_profile=1',
        [openid, nickname, birth_year, birth_month, birth_day, birth_shichen || 0, genderVal, mingBenGua]
      );

      // [NEW] 自动收集用户自己的易经人格卡牌
      if (mingBenGua >= 1 && mingBenGua <= 64) {
        await conn.query(
          'INSERT IGNORE INTO user_gua_collection (openid, gua_id, source) VALUES (?, ?, ?)',
          [openid, mingBenGua, 'profile']
        ).catch(err => console.error('[collection] auto-collect profile gua error:', err.message));
      }

      const [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [openid]);
      const user = rows[0];

      // 补充易经人格展示字段
      const guaExtra = await getGuaExtra(user.ming_ben_gua, conn, req.body.lang);

      // [埋点] 档案创建/更新
      logEvent(openid, 'profile_create', 'profile', { nickname: user.nickname, ming_ben_gua: user.ming_ben_gua });

      res.json({ success: true, data: { ...safeUserFields(user), ...guaExtra } });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[user/profile]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// GET /api/user/me - 获取当前登录用户档案（从token解析，App端restoreSession用）
router.get('/me', verifyToken, async (req, res) => {
  try {
    const conn = await db.get();
    try {
      const [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [req.openid]);
      if (rows.length === 0) {
        return res.json({ success: false, code: 'USER_NOT_FOUND', message: '用户不存在' });
      }
      const user = rows[0];

      // 每日免费额度重置（GET profile 时检查）
      await resetDailyQuota(conn, req.openid, user);

      // v2.3.5 VIP过期自动降级为free（公共函数）
      await downgradeExpiredVip(conn, req.openid, user, user.last_quota_reset_date);

      // 补充易经人格展示字段
      const guaExtra = await getGuaExtra(user.ming_ben_gua, conn, req.query.lang);
      res.json({ success: true, data: { ...safeUserFields(user), ...guaExtra } });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[user/profile GET current]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// GET /api/user/profile/:openid - 获取用户档案（需认证，且只能查自己）
router.get('/profile/:openid', verifyToken, verifyOpenidMatch, async (req, res) => {
  try {
    const conn = await db.get();
    try {
      const [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [req.openid]);
      if (rows.length === 0) {
        return res.json({ success: false, code: 'USER_NOT_FOUND', message: '用户不存在' });
      }
      const user = rows[0];

      // 每日免费额度重置（GET profile 时检查）
      await resetDailyQuota(conn, req.openid, user);

      // v2.3.5 VIP过期自动降级为free（公共函数）
      await downgradeExpiredVip(conn, req.openid, user, user.last_quota_reset_date);

      // 补充易经人格展示字段
      const guaExtra = await getGuaExtra(user.ming_ben_gua, conn, req.query.lang);

      // 补充 VIP 深度解读剩余次数（Redis 只读，免费用户为 0）
      // 统一命名：vipDecodeRemaining（驼峰），与 /api/payment/vip-info 保持一致
      let vipDecodeRemaining = 0;
      if (user.plan_type === 'monthly' || user.plan_type === 'yearly') {
        try {
          vipDecodeRemaining = await redisService.getVipDecodeRemaining(req.openid);
        } catch (redisErr) {
          console.error('[user/profile GET] Redis查询vipDecodeRemaining失败:', redisErr.message);
          vipDecodeRemaining = 1; // fail open，与 vip-info 接口保持一致
        }
      }

      // v17.0 签到奖励的额外超级推演次数（连续签到7天+1次，90天有效，VIP/非VIP均可用）
      let extraVipDecode = 0;
      try { extraVipDecode = await redisService.getExtraVipDecode(req.openid); } catch (e) { /* 忽略 */ }

      // 返回两个字段名（vipDecodeRemaining 为新标准，vip_decode_remaining 为兼容过渡）
      res.json({ success: true, data: { ...safeUserFields(user), ...guaExtra, vipDecodeRemaining, vip_decode_remaining: vipDecodeRemaining, extraVipDecode } });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[user/profile GET]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// PATCH /api/user/profile/:openid - 更新或创建用户档案（需认证）
router.patch('/profile/:openid', verifyToken, verifyOpenidMatch, async (req, res) => {
  try {
    let { nickname, birth_year, birth_month, birth_day, birth_shichen, gender } = req.body;
    // 安全截断：去除首尾空格，限制20个Unicode码点以内
    if (nickname !== undefined) {
      nickname = typeof nickname === 'string' ? Array.from(nickname.trim()).slice(0, 20).join('') : nickname;
    }

    // [SEC-FIX] P3-5: 日志脱敏——不打印完整请求体（避免未来新增敏感字段时泄漏）
    console.log('[PATCH Profile] openid=', req.openid, 'fields=', Object.keys(req.body || {}).join(','));

    const conn = await db.get();
    try {
      // 先获取当前用户数据（可能不存在 — 新用户视同建档）
      const [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [req.openid]);
      const existing = rows[0] || null;

      // 合并现有数据与请求字段（新用户则全部从请求取）
      const isNewUser = !existing;
      const merged = {
        nickname: nickname !== undefined ? nickname : (existing ? existing.nickname : ''),
        birth_year: birth_year !== undefined ? birth_year : (existing ? existing.birth_year : null),
        birth_month: birth_month !== undefined ? birth_month : (existing ? existing.birth_month : null),
        birth_day: birth_day !== undefined ? birth_day : (existing ? existing.birth_day : null),
        birth_shichen: birth_shichen !== undefined ? birth_shichen : (existing ? existing.birth_shichen : null),
        gender: gender !== undefined
          ? (gender === 'female' || gender === 2 ? 2 : gender === 'male' || gender === 1 ? 1 : 0)
          : (existing ? existing.gender : 0),
      };

      // 新用户建档必填校验
      if (isNewUser) {
        if (!merged.nickname || !merged.birth_year || !merged.birth_month || !merged.birth_day || merged.birth_shichen === null || merged.birth_shichen === undefined) {
          return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '昵称和出生年月日时为必填项' });
        }
        const year = parseInt(merged.birth_year, 10);
        const month = parseInt(merged.birth_month, 10);
        const day = parseInt(merged.birth_day, 10);
        // 🔴 修复：增加birth_year范围校验（与POST接口保持一致）
        const currentYearPatch = new Date().getFullYear();
        if (isNaN(year) || isNaN(month) || isNaN(day) || year < 1900 || year > currentYearPatch || month < 1 || month > 12 || day < 1 || day > 31) {
          return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '出生日期格式不正确' });
        }
      }

      // 阳历转农历后再计算本命卦（梅花易数传统算法使用农历）
      const lunarDate = solarToLunarForGua(merged.birth_year, merged.birth_month, merged.birth_day);
      const { calculateMingBenGua } = require('../services/algorithms');
      const guaResult = calculateMingBenGua(
        lunarDate.year, lunarDate.month, lunarDate.day, merged.birth_shichen
      );

      // INSERT ... ON DUPLICATE KEY UPDATE：新用户创建，老用户更新，一份 SQL 搞定
      await conn.query(
        `INSERT INTO users (openid, nickname, birth_year, birth_month, birth_day, birth_shichen, gender, ming_ben_gua, has_profile)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           nickname=VALUES(nickname), birth_year=VALUES(birth_year), birth_month=VALUES(birth_month),
           birth_day=VALUES(birth_day), birth_shichen=VALUES(birth_shichen), gender=VALUES(gender),
           ming_ben_gua=VALUES(ming_ben_gua), has_profile=1`,
        [req.openid, merged.nickname, merged.birth_year, merged.birth_month, merged.birth_day,
         merged.birth_shichen, merged.gender, guaResult.id]
      );

      // [NEW] 自动收集用户自己的易经人格卡牌
      if (guaResult.id >= 1 && guaResult.id <= 64) {
        await conn.query(
          'INSERT IGNORE INTO user_gua_collection (openid, gua_id, source) VALUES (?, ?, ?)',
          [req.openid, guaResult.id, 'profile']
        ).catch(err => console.error('[collection] auto-collect profile gua error:', err.message));
      }

      const [result] = await conn.query('SELECT * FROM users WHERE openid = ?', [req.openid]);
      const user = result[0];

      // 补充易经人格展示字段
      const guaExtra = await getGuaExtra(user.ming_ben_gua, conn, req.body.lang);
      console.log('[PATCH Profile] Updated user:', user ? user.nickname : 'N/A', 'gua_extra:', guaExtra);

      // [埋点] 档案创建/更新
      logEvent(req.openid, 'profile_create', 'profile', { nickname: user.nickname, ming_ben_gua: user.ming_ben_gua });

      res.json({ success: true, data: { ...safeUserFields(user), ...guaExtra } });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[user/profile PATCH]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// POST /api/user/profile/:openid/request-delete - 注销账户并立即清空所有数据（需认证）
// [SEC-FIX] P2-2: 整个注销过程用事务包裹，避免多表删除中途失败留下半删除状态
router.post('/profile/:openid/request-delete', verifyToken, verifyOpenidMatch, async (req, res) => {
  let conn;
  try {
    conn = await db.get();
    const openid = req.openid;
    console.log('[user/request-delete] 开始注销账户:', openid);

    await conn.beginTransaction();
    try {
      // 1. 清理用户所有业务数据
      // 推演记录
      await conn.query('DELETE FROM tuiyan_records WHERE openid = ?', [openid]);
      // 订阅
      await conn.query('DELETE FROM subscriptions WHERE openid = ?', [openid]);
      // 事件
      await conn.query('DELETE FROM events WHERE openid = ?', [openid]);
      // 匹配记录 (作为A或B)
      await conn.query('DELETE FROM match_records WHERE user_a_openid = ? OR user_b_openid = ?', [openid, openid]);
      // 分享码
      await conn.query('DELETE FROM share_codes WHERE openid = ?', [openid]);
      // VIP订单
      await conn.query('DELETE FROM vip_orders WHERE openid = ?', [openid]);
      // 收藏的卦
      await conn.query('DELETE FROM user_gua_collection WHERE openid = ?', [openid]);
      // 成就
      await conn.query('DELETE FROM user_achievements WHERE openid = ?', [openid]);
      // 举报记录 (作为举报人或被举报人)
      await conn.query('DELETE FROM letter_reports WHERE reporter_openid = ? OR target_openid = ?', [openid, openid]);
      // 拉黑记录 (作为拉黑者或被拉黑者)
      await conn.query('DELETE FROM letter_blocks WHERE blocker_openid = ? OR blocked_openid = ?', [openid, openid]);
      // 信件 (作为发送者或接收者)
      await conn.query('DELETE FROM letters WHERE sender_openid = ? OR receiver_openid = ?', [openid, openid]);

      // 2. 标记账户为注销状态，而非物理删除 users 表记录
      // 保留用户表记录（openid），标记为已注销（plan_type = 'cancelled'）
      await conn.query("UPDATE users SET plan_type = 'cancelled', nickname = '已注销用户', avatar_url = NULL, has_profile = 0, delete_request_time = NOW() WHERE openid = ?", [openid]);

      // 3. 清理绑定关系
      await conn.query('DELETE FROM user_bindings WHERE unified_openid = ? OR platform_openid = ?', [openid, openid]);

      await conn.commit();
    } catch (txErr) {
      try { await conn.rollback(); } catch (_) {}
      throw txErr;
    }

    // [SEC-FIX] P2-2: 注销成功后清理 Redis 中的额度缓存（登录态由各登录口 cancelled 检查拒绝）
    try {
      await redisService.clearVipDecodeLimit(openid);
    } catch (e) { /* 清理失败不影响注销结果 */ }

    console.log('[user/request-delete] 账户注销完成:', openid);
    res.json({
      success: true,
      message: '账户已注销，所有数据已清空'
    });
  } catch (err) {
    console.error('[user/request-delete]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/user/profile/:openid/cancel-delete - 取消注销（需认证）
router.post('/profile/:openid/cancel-delete', verifyToken, verifyOpenidMatch, async (req, res) => {
  try {
    const conn = await db.get();
    try {
      // P1修复：清除pending_deletions中的待执行记录
      await conn.query(
        "UPDATE pending_deletions SET status = 'cancelled' WHERE openid = ? AND status = 'pending'",
        [req.openid]
      );
      await conn.query('UPDATE users SET delete_request_time=NULL WHERE openid=?', [req.openid]);
      res.json({ success: true, message: '已取消注销申请' });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[user/cancel-delete]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

router.get('/history/:openid', verifyToken, verifyOpenidMatch, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const offset = (page - 1) * pageSize;

    const conn = await db.get();
    try {
      const [rows] = await conn.query(
        'SELECT * FROM tuiyan_records WHERE openid=? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [req.openid, pageSize, offset]
      );

      const [countRows] = await conn.query(
        'SELECT COUNT(*) as total FROM tuiyan_records WHERE openid=?',
        [req.openid]
      );

      res.json({
        success: true,
        data: rows,
        pagination: { page, pageSize, total: countRows[0].total }
      });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[user/history]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

module.exports = router;
