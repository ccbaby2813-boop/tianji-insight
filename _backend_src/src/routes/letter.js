// src/routes/letter.js - 易缘传书（信件）相关接口 v1.3
// v1.3：每日同人3封信限制 + 好友拉黑（双向不可见/不可匹配/不可写信）+ 免费用户每日10次匹配 + 好友列表去重
// v1.2 修复：match-pool VIP 逻辑、match 接口 2080 关系数据查询、friends 返回 friendIsVip
// v1.1 修复：unread-count用db.get、新增report接口、match-pool返回性格描述+每日匹配次数限制
const express = require('express');
const router = express.Router();
const { verifyToken, optionalAuth } = require('../middleware/auth');
const db = require('../middleware/db');
const { logEvent } = require('../services/event-logger');
const { Solar } = require('lunar-javascript');
const { HEXAGRAMS } = require('../../config/hexagrams');
const relationshipData = require('../../config/relationship');
const { resolveOpenid } = require('../utils/openid-resolver');
const HEXAGRAMS_EN = require('../../config/hexagrams-en'); // v19.2
const relationshipDataEn = require('../../config/relationship-en'); // v20 方案B：2080条英文静态文件
const { createNotification, NOTIFICATION_TYPES } = require('./notification');
const pushService = require('../services/push-service'); // v2.4 TIMPush 系统推送

// v20：关系短语中英映射（由中文/英文静态文件按同 key 对照构建，Redis/AI 零依赖）
const _relNameEnMap = new Map(); // 中文 relationship_name -> 英文
const _relLevelEnMap = new Map(); // 中文 match_level -> 英文
for (const [key, zh] of Object.entries(relationshipData)) {
  const en = relationshipDataEn[key];
  if (!en) continue;
  if (zh.relationship_name && en.relationship_name) _relNameEnMap.set(zh.relationship_name, en.relationship_name);
  if (zh.match_level && en.match_level) _relLevelEnMap.set(zh.match_level, en.match_level);
}

/**
 * v1.3 每日给同一人最多发送信件数
 */
const DAILY_LETTER_LIMIT_PER_USER = 3;

/**
 * v1.3.1 免费用户每日匹配次数（从 1 改为 10）
 */
const DAILY_MATCH_LIMIT_FREE = 10;

/**
 * v1.3.3 VIP 会员判断（修复：之前用 plan_type === 'vip' 判断，但数据库实际值为 monthly/yearly）
 * 与 auth.js / admin.js / payment.js 保持一致：非 free 即 VIP
 * @param {string} planType - 用户套餐类型（free/monthly/yearly）
 * @returns {boolean} true=VIP会员
 */
function isVipPlan(planType) {
  return !!planType && planType !== 'free';
}

/**
 * 根据 ming_ben_gua ID 从 config 获取 gua_ge（人格格名）
 * 数据库 hexagrams 表无 gua_ge 字段，需从 config/hexagrams.js 读取
 */
function getGuaGeById(guaId) {
  if (!guaId) return '';
  const idNum = Number(guaId);
  for (const [, gua] of Object.entries(HEXAGRAMS)) {
    if (gua.id === idNum) return gua.gua_ge || '';
  }
  return '';
}

/**
 * v1.3.1 根据 ming_ben_gua ID 从 config 获取 zi_chao_biao_qian（自嘲标签）
 * 用于真实用户兜底（真实用户无 personality_desc 时用自嘲标签统一展示）
 * 避免虚拟用户有性格描述、真实用户没有的明显差异
 */
function getZiChaoBiaoQianById(guaId) {
  if (!guaId) return '';
  const idNum = Number(guaId);
  for (const [, gua] of Object.entries(HEXAGRAMS)) {
    if (gua.id === idNum) return gua.zi_chao_biao_qian || '';
  }
  return '';
}

/**
 * v1.4 根据 ming_ben_gua ID 从 config 获取 wuxing（五行）
 * 用于匹配池候选人头像渐变配色
 */
function getWuxingById(guaId) {
  if (!guaId) return '';
  const idNum = Number(guaId);
  for (const [, gua] of Object.entries(HEXAGRAMS)) {
    if (gua.id === idNum) return gua.wuxing || '';
  }
  return '';
}

/**
 * v1.3.2 时辰序号 → 中文名（1=子时 ... 12=亥时）
 */
const SHICHEN_NAMES = ['', '子时', '丑时', '寅时', '卯时', '辰时', '巳时', '午时', '未时', '申时', '酉时', '戌时', '亥时'];

/**
 * v1.3.2 格式化出生年月日时为农历中文显示
 * 例："庚午年五月初二 卯时"
 * 失败时降级为阳历数字 + 时辰名
 */
function formatBirthDisplay(year, month, day, shichen) {
  if (!year || !month || !day) return '';
  const shichenName = SHICHEN_NAMES[shichen] || '';
  try {
    const solar = Solar.fromYmd(year, month, day);
    const lunar = solar.getLunar();
    const yearGanZhi = lunar.getYearInGanZhi();
    const monthName = lunar.getMonthInChinese();
    const dayName = lunar.getDayInChinese();
    return `${yearGanZhi}年${monthName}月${dayName}日 ${shichenName}`.trim();
  } catch (e) {
    return `${year}年${month}月${day}日 ${shichenName}`.trim();
  }
}

/**
 * v1.5 格式化出生阳历显示（与农历并列展示）
 * 例："1990年5月20日"
 */
function formatBirthSolarDisplay(year, month, day) {
  if (!year || !month || !day) return '';
  return `${year}年${month}月${day}日`;
}

/**
 * v19.2 双语英文辅助：时辰英文名（拼音 + 时段）
 */
const SHICHEN_NAMES_EN = ['', 'Zi Hour (11pm-1am)', 'Chou Hour (1-3am)', 'Yin Hour (3-5am)', 'Mao Hour (5-7am)', 'Chen Hour (7-9am)', 'Si Hour (9-11am)', 'Wu Hour (11am-1pm)', 'Wei Hour (1-3pm)', 'Shen Hour (3-5pm)', 'You Hour (5-7pm)', 'Xu Hour (7-9pm)', 'Hai Hour (9-11pm)'];
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** v19.2 干支汉字→拼音（甲→Jia ... 亥→Hai），用于英文态干支年显示 */
const GAN_PINYIN = { '甲': 'Jia', '乙': 'Yi', '丙': 'Bing', '丁': 'Ding', '戊': 'Wu', '己': 'Ji', '庚': 'Geng', '辛': 'Xin', '壬': 'Ren', '癸': 'Gui' };
const ZHI_PINYIN = { '子': 'Zi', '丑': 'Chou', '寅': 'Yin', '卯': 'Mao', '辰': 'Chen', '巳': 'Si', '午': 'Wu', '未': 'Wei', '申': 'Shen', '酉': 'You', '戌': 'Xu', '亥': 'Hai' };
function ganZhiToPinyin(ganZhi) {
  if (!ganZhi || ganZhi.length < 2) return ganZhi || '';
  return (GAN_PINYIN[ganZhi[0]] || ganZhi[0]) + '-' + (ZHI_PINYIN[ganZhi[1]] || ganZhi[1]);
}

/** v19.2 英文出生显示：农历干支年拼音化 + 英月日 + 英时辰，如 "Geng-Wu Year, May 20 · Mao Hour (5-7am)" */
function formatBirthDisplayEn(year, month, day, shichen) {
  if (!year || !month || !day) return '';
  const shichenName = SHICHEN_NAMES_EN[shichen] || '';
  try {
    const solar = Solar.fromYmd(year, month, day);
    const lunar = solar.getLunar();
    const yearGanZhi = ganZhiToPinyin(lunar.getYearInGanZhi());
    const monthName = MONTH_NAMES_EN[(month - 1)] || String(month);
    return `${yearGanZhi} Year, ${monthName} ${day}${shichenName ? ' · ' + shichenName : ''}`.trim();
  } catch (e) {
    return `${MONTH_NAMES_EN[(month - 1)] || month} ${day}, ${year}${shichenName ? ' · ' + shichenName : ''}`.trim();
  }
}

/** v19.2 英文阳历显示，如 "May 20, 1990" */
function formatBirthSolarDisplayEn(year, month, day) {
  if (!year || !month || !day) return '';
  const monthName = MONTH_NAMES_EN[(month - 1)] || String(month);
  return `${monthName} ${day}, ${year}`;
}

/** v19.2 英文五行映射 */
const WUXING_EN = { '金': 'Metal', '木': 'Wood', '水': 'Water', '火': 'Fire', '土': 'Earth' };

/**
 * v20 关系短语翻译（relationship_name / match_level）
 * 静态映射查表（_relNameEnMap/_relLevelEnMap），查不到降级中文，Redis/AI 零依赖
 */
function translatePhrase(text, field) {
  if (!text) return text;
  const m = field === 'rellevel' ? _relLevelEnMap : _relNameEnMap;
  return m.get(text) || text;
}

/**
 * v19.2 match-pool 候选人统一映射（guest / 未建档 / 正式三分支共用）
 * langEn=true 时卦名/卦格/标签/五行用英文，日期用英文格式
 */
function mapCandidate(c, langEn, isGuest) {
  const en = langEn ? (HEXAGRAMS_EN[c.ming_ben_gua] || {}) : null;
  return {
    openid: c.openid,
    nickname: c.nickname,
    gender: c.gender,
    guaId: c.ming_ben_gua,
    guaName: langEn ? (en.name || c.gua_name || '') : (c.gua_name || ''),
    guaGe: langEn ? (en.gua_ge || getGuaGeById(c.ming_ben_gua)) : getGuaGeById(c.ming_ben_gua),
    // v1.3.2 统一用 64 卦自嘲标签（zi_chao_biao_qian），避免虚拟/真实用户差异暴露身份
    // v19.2 英文态用 social_tag（英文表无自嘲标签，语义相近）
    personalityDesc: langEn ? (en.social_tag || getZiChaoBiaoQianById(c.ming_ben_gua) || '') : (getZiChaoBiaoQianById(c.ming_ben_gua) || ''),
    // v1.4 五行（用于前端头像渐变配色）
    wuxing: langEn ? (WUXING_EN[getWuxingById(c.ming_ben_gua)] || getWuxingById(c.ming_ben_gua)) : getWuxingById(c.ming_ben_gua),
    // v1.3.2 出生年月日时（中文"庚午年五月初二 卯时" / 英文"GengWu Year, May 20 · Mao Hour (5-7am)"）
    // [PRIVACY-FIX] 游客/未建档用户不暴露他人出生信息（birthDisplay 置空，前端 wx:if 不渲染）
    birthDisplay: isGuest ? '' : (langEn
      ? formatBirthDisplayEn(c.birth_year, c.birth_month, c.birth_day, c.birth_shichen)
      : formatBirthDisplay(c.birth_year, c.birth_month, c.birth_day, c.birth_shichen)),
    // v1.5 出生阳历显示
    birthSolarDisplay: isGuest ? '' : (langEn
      ? formatBirthSolarDisplayEn(c.birth_year, c.birth_month, c.birth_day)
      : formatBirthSolarDisplay(c.birth_year, c.birth_month, c.birth_day)),
    isVip: isVipPlan(c.plan_type)
  };
}

// 安全过滤：信件内容检测（仅防 SQL 注入和 XSS，不防 AI 提示词注入）
const MALICIOUS_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|EXEC|SCRIPT)\b)/i,
  /<script|javascript:|onerror|onload|onclick/i
];

function sanitizeLetterContent(content) {
  if (!content) return { valid: false, reason: '内容为空' };
  if (content.length < 10) return { valid: false, reason: '信件内容至少10字' };
  if (content.length > 800) return { valid: false, reason: '信件内容不能超过800字' };
  for (const pattern of MALICIOUS_PATTERNS) {
    if (pattern.test(content)) return { valid: false, reason: '内容包含不安全信息' };
  }
  return { valid: true };
}

/**
 * 将阳历时间戳转换为农历中文日期（用于信件日期显示）
 * @param {string|Date} dateInput - 日期
 * @returns {string} 农历中文字符串，如 "六月初二"
 */
function formatLunarDate(dateInput) {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    const solar = Solar.fromDate(d);
    const lunar = solar.getLunar();
    const monthName = lunar.getMonthInChinese();
    const dayName = lunar.getDayInChinese();
    return monthName + '月' + dayName;
  } catch (e) {
    return '';
  }
}

/**
 * 格式化信件时间为友好显示
 * 同一天显示 HH:MM，昨天显示"昨天"，7天内显示"N天前"，更早显示农历
 */
function formatLetterTime(dateInput) {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diff = now - d;
    const day = 24 * 60 * 60 * 1000;
    if (diff < day && now.getDate() === d.getDate()) {
      const h = d.getHours();
      const m = d.getMinutes();
      return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
    }
    if (diff < 2 * day) return '昨天';
    if (diff < 7 * day) return Math.floor(diff / day) + '天前';
    return formatLunarDate(d);
  } catch (e) {
    return '';
  }
}

/**
 * 获取用户今日已匹配次数（仅统计一元匹配 source='letter'，分享匹配 source='share' 不计入额度）
 * v1.3.3 修复：之前统计所有 match_records 记录，导致分享匹配(无限制)消耗了一元匹配(每天10次)的额度
 */
async function getTodayMatchCount(conn, openid) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM match_records
     WHERE (user_a_openid = ? OR user_b_openid = ?)
     AND DATE(CONVERT_TZ(created_at, '+00:00', '+08:00')) = DATE(CONVERT_TZ(NOW(), '+00:00', '+08:00'))
     AND (source = 'letter' OR source IS NULL)`,
    [openid, openid]
  );
  return rows[0].cnt;
}

/**
 * v1.3 获取今日给某用户已发信件数（频率限制用）
 */
async function getTodayLetterCount(conn, senderOpenid, receiverOpenid) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM letters
     WHERE sender_openid = ? AND receiver_openid = ?
     AND DATE(CONVERT_TZ(created_at, '+00:00', '+08:00')) = DATE(CONVERT_TZ(NOW(), '+00:00', '+08:00'))`,
    [senderOpenid, receiverOpenid]
  );
  return rows[0].cnt;
}

/**
 * v1.3 检查两用户之间是否已拉黑（任一方拉黑即视为已拉黑，双向不可见）
 * @returns {boolean} true=已拉黑 / false=未拉黑
 */
async function isBlocked(conn, openidA, openidB) {
  const [rows] = await conn.query(
    `SELECT id FROM letter_blocks
     WHERE (blocker_openid = ? AND blocked_openid = ?)
        OR (blocker_openid = ? AND blocked_openid = ?)
     LIMIT 1`,
    [openidA, openidB, openidB, openidA]
  );
  return rows.length > 0;
}

/**
 * v1.3 获取用户被拉黑的 openid 列表（用于 match-pool 批量排除）
 */
async function getBlockedOpenids(conn, openid) {
  const [rows] = await conn.query(
    `SELECT CASE WHEN blocker_openid = ? THEN blocked_openid ELSE blocker_openid END AS blocked_openid
     FROM letter_blocks
     WHERE blocker_openid = ? OR blocked_openid = ?`,
    [openid, openid, openid]
  );
  return rows.map(r => r.blocked_openid);
}

// GET /api/letter/match-pool - 获取陌生人匹配候选池（10个异性，退出页面重新进入即刷新）
// v2.3 改为 optionalAuth：游客可浏览候选人资料，启封/匹配需登录+建档
router.get('/match-pool', optionalAuth, async (req, res) => {
  try {
    const conn = await db.get();
    try {
      const openid = req.openid || null;
      const isGuest = !openid;

      if (isGuest) {
        // 游客模式：返回所有有档案的用户（不限性别，随机 10 个）
        // v2.4 修复：应用层随机打散，避免连续 OFFSET 导致名字风格聚集
        const [allOpenids] = await conn.query(
          `SELECT openid FROM users
           WHERE ming_ben_gua IS NOT NULL AND ming_ben_gua > 0
             AND nickname IS NOT NULL AND nickname != ''
             AND has_profile = 1
             AND (status = 1 OR status IS NULL)`
        );
        
        // 应用层随机打散
        const shuffled = allOpenids.sort(() => Math.random() - 0.5);
        const selectedOpenids = shuffled.slice(0, 10).map(r => r.openid);
        
        if (selectedOpenids.length === 0) {
          return res.json({ success: true, data: { remaining: null, isVip: false, isGuest: true, candidates: [] } });
        }
        
        const placeholders = selectedOpenids.map(() => '?').join(',');
        const [candidates] = await conn.query(
          `SELECT openid, nickname, ming_ben_gua, gender, plan_type,
            birth_year, birth_month, birth_day, birth_shichen,
            (SELECT full_name FROM hexagrams WHERE id = users.ming_ben_gua) AS gua_name
           FROM users
           WHERE openid IN (${placeholders})`,
          selectedOpenids
        );

        return res.json({
          success: true,
          data: {
            remaining: null,
            isVip: false,
            isGuest: true,
            candidates: candidates.map(c => mapCandidate(c, req.query.lang === 'en', true))
          }
        });
      }

      // 已登录用户：原有逻辑
      const [userRows] = await conn.query(
        'SELECT gender, ming_ben_gua, nickname, plan_type FROM users WHERE openid = ?',
        [openid]
      );
      if (userRows.length === 0) {
        return res.json({ success: false, code: 'USER_NOT_FOUND', message: '用户不存在' });
      }
      const user = userRows[0];
      
      // v2.3.6 修复：已登录但未建档的用户，按游客模式处理（可浏览候选人，不可匹配）
      // 对齐设计原则：游客可浏览任何页面，只有调用档案参数时才提示建档
      if (!user.gender || !user.ming_ben_gua) {
        // 未建档用户：返回所有有档案的用户（不限性别，随机 10 个）
        // v2.4 修复：应用层随机打散，避免连续 OFFSET 导致名字风格聚集
        const [allOpenids] = await conn.query(
          `SELECT openid FROM users
           WHERE ming_ben_gua IS NOT NULL AND ming_ben_gua > 0
             AND nickname IS NOT NULL AND nickname != ''
             AND has_profile = 1
             AND (status = 1 OR status IS NULL)`
        );
        
        // 应用层随机打散
        const shuffled = allOpenids.sort(() => Math.random() - 0.5);
        const selectedOpenids = shuffled.slice(0, 10).map(r => r.openid);
        
        if (selectedOpenids.length === 0) {
          return res.json({ success: true, data: { remaining: null, isVip: false, isGuest: false, profileIncomplete: true, candidates: [] } });
        }
        
        const placeholders = selectedOpenids.map(() => '?').join(',');
        const [candidates] = await conn.query(
          `SELECT openid, nickname, ming_ben_gua, gender, plan_type,
            birth_year, birth_month, birth_day, birth_shichen,
            (SELECT full_name FROM hexagrams WHERE id = users.ming_ben_gua) AS gua_name
           FROM users
           WHERE openid IN (${placeholders})`,
          selectedOpenids
        );

        return res.json({
          success: true,
          data: {
            remaining: null,
            isVip: false,
            isGuest: false,
            profileIncomplete: true,  // 标记：需要建档才能匹配
            candidates: candidates.map(c => mapCandidate(c, req.query.lang === 'en', true))
          }
        });
      }

      // 今日剩余匹配次数（免费用户每天10次，VIP 会员无限）
      const isVip = isVipPlan(user.plan_type);
      let remaining;
      if (isVip) {
        remaining = -1; // -1 表示无限
      } else {
        const todayMatched = await getTodayMatchCount(conn, openid);
        remaining = Math.max(0, DAILY_MATCH_LIMIT_FREE - todayMatched);
      }

      // 查询已匹配过的用户
      const [matchedRows] = await conn.query(
        `SELECT DISTINCT CASE WHEN user_a_openid = ? THEN user_b_openid ELSE user_a_openid END AS matched_openid
         FROM match_records WHERE user_a_openid = ? OR user_b_openid = ?`,
        [openid, openid, openid]
      );
      const matchedOpenids = matchedRows.map(r => r.matched_openid);
      matchedOpenids.push(openid);

      // v1.3 排除被拉黑的用户
      const blockedOpenids = await getBlockedOpenids(conn, openid);
      matchedOpenids.push(...blockedOpenids);

      const targetGender = user.gender === 1 ? 2 : 1;
      const placeholders = matchedOpenids.map(() => '?').join(',');

      // v2.4 修复：应用层随机打散，避免连续 OFFSET 导致名字风格聚集
      const [allOpenids2] = await conn.query(
        `SELECT openid FROM users
         WHERE gender = ? AND ming_ben_gua IS NOT NULL AND ming_ben_gua > 0
           AND nickname IS NOT NULL AND nickname != ''
           AND has_profile = 1
           AND (status = 1 OR status IS NULL)
           AND openid NOT IN (${placeholders})`,
        [targetGender, ...matchedOpenids]
      );
      
      // 应用层随机打散
      const shuffled2 = allOpenids2.sort(() => Math.random() - 0.5);
      const selectedOpenids2 = shuffled2.slice(0, 10).map(r => r.openid);
      
      if (selectedOpenids2.length === 0) {
        return res.json({ success: true, data: { remaining: remaining, isVip: isVip, candidates: [] } });
      }
      
      const placeholders2 = selectedOpenids2.map(() => '?').join(',');
      const [candidates] = await conn.query(
        `SELECT openid, nickname, ming_ben_gua, gender, personality_desc, plan_type,
          birth_year, birth_month, birth_day, birth_shichen,
          (SELECT full_name FROM hexagrams WHERE id = users.ming_ben_gua) AS gua_name
         FROM users
         WHERE openid IN (${placeholders2})`,
        selectedOpenids2
      );

      // v19.2 双语：三分支统一走 mapCandidate
      res.json({
        success: true,
        data: {
          remaining: remaining,
          isVip: isVip,
          candidates: candidates.map(c => mapCandidate(c, req.query.lang === 'en', false))
        }
      });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[letter/match-pool]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// POST /api/letter/match - 选择候选人进行匹配
router.post('/match', verifyToken, async (req, res) => {
  const conn = await db.get();
  try {
    const openid = req.openid;
    const { targetOpenid: rawTargetOpenid } = req.body;
    if (!rawTargetOpenid) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '参数不完整' });
    }

    await conn.beginTransaction();

    // 🔴 关键修复：前端缓存的 targetOpenid 可能是对方绑定手机号前的旧 openid
    // 通过 user_bindings 表反查为当前主账号 openid，避免查不到用户/写入旧账号
    const targetOpenid = await resolveOpenid(conn, rawTargetOpenid);

    const [meRows] = await conn.query('SELECT openid, ming_ben_gua, gender, nickname, plan_type FROM users WHERE openid = ? FOR UPDATE', [openid]);
    const [targetRows] = await conn.query('SELECT openid, ming_ben_gua, gender, nickname, plan_type FROM users WHERE openid = ? FOR UPDATE', [targetOpenid]);

    if (meRows.length === 0 || targetRows.length === 0) {
      await conn.rollback();
      return res.json({ success: false, code: 'USER_NOT_FOUND', message: '用户不存在' });
    }
    if (meRows[0].gender === targetRows[0].gender) {
      await conn.rollback();
      return res.json({ success: false, code: 'SAME_GENDER', message: '只能匹配异性' });
    }

    // v1.3 检查是否已拉黑
    if (await isBlocked(conn, openid, targetOpenid)) {
      await conn.rollback();
      return res.json({ success: false, code: 'BLOCKED', message: '双方已拉黑，无法匹配' });
    }

    // 检查是否已匹配过
    const [existing] = await conn.query(
      `SELECT id FROM match_records
       WHERE (user_a_openid = ? AND user_b_openid = ?) OR (user_a_openid = ? AND user_b_openid = ?)
       LIMIT 1 FOR UPDATE`,
      [openid, targetOpenid, targetOpenid, openid]
    );
    if (existing.length > 0) {
      await conn.commit();
      return res.json({ success: true, data: { id: existing[0].id, skipped: true, message: '已匹配过' } });
    }

    // 每日匹配次数限制（免费用户每天10次，VIP 会员无限）
    const isVip = isVipPlan(meRows[0].plan_type);
    if (!isVip) {
      const todayMatched = await getTodayMatchCount(conn, openid);
      if (todayMatched >= DAILY_MATCH_LIMIT_FREE) {
        await conn.rollback();
        return res.json({ success: false, code: 'MATCH_LIMIT_EXCEEDED', message: '今日匹配次数已用完，明日再来' });
      }
    }

    let relationshipKey = `${Math.min(meRows[0].ming_ben_gua, targetRows[0].ming_ben_gua)}-${Math.max(meRows[0].ming_ben_gua, targetRows[0].ming_ben_gua)}`;
    let relationshipName = '';
    let matchLevel = '';
    try {
      // v1.2 修复：直接查 config/relationship.js（2080条关系数据），与 /api/relationship/:a/:b 一致
      // 之前错误调用了 wuxing.getRelationship（五行生克服务），导致 relationshipName/matchLevel 永远为空
      const rel = relationshipData[relationshipKey];
      if (rel) {
        relationshipName = rel.relationship_name || '';
        matchLevel = rel.match_level || '';
      }
    } catch (e) { /* 关系查询失败不阻塞匹配 */ }

    const myGua = meRows[0].ming_ben_gua;
    const targetGua = targetRows[0].ming_ben_gua;
    // v1.3.3 写入时标记 source='letter'（一元匹配），分享匹配 source='share' 不计入每日额度
    const [result] = await conn.query(
      'INSERT INTO match_records (user_a_openid, user_b_openid, user_a_gua, user_b_gua, gua_a, gua_b, relationship_key, relationship_name, match_level, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [openid, targetOpenid, myGua, targetGua, myGua, targetGua, relationshipKey, relationshipName, matchLevel, 'letter']
    );

    // 互相收集卦卡
    if (targetGua >= 1 && targetGua <= 64) {
      await conn.query('INSERT IGNORE INTO user_gua_collection (openid, gua_id, source) VALUES (?, ?, ?)', [openid, targetGua, 'match']);
    }
    if (myGua >= 1 && myGua <= 64) {
      await conn.query('INSERT IGNORE INTO user_gua_collection (openid, gua_id, source) VALUES (?, ?, ?)', [targetOpenid, myGua, 'match']);
    }

    await conn.commit();

    // [PUSH] 匹配成功后给被匹配方写通知（异步不阻塞响应）
    const matchNotifTitle = `[好友消息]${meRows[0].nickname || '一位有缘人'}`;
    const matchNotifContent = `${meRows[0].nickname || '一位有缘人'} 和你匹配了${relationshipName ? '：' + relationshipName : ''}`;
    createNotification(targetOpenid, NOTIFICATION_TYPES.MATCH_REPLY, matchNotifTitle, matchNotifContent, String(result.insertId)).catch(() => {});



    // v20 双语：lang=en 时关系名/匹配等级静态查表（零依赖）
    let relNameOut = relationshipName;
    let levelOut = matchLevel;
    if (req.body.lang === 'en') {
      relNameOut = translatePhrase(relationshipName, 'relname');
      levelOut = translatePhrase(matchLevel, 'rellevel');
    }

    // [PUSH] 匹配回应系统推送（App 通知栏，异步不阻塞；未配置推送或用户未注册时静默跳过）
    // 英文用户用英文模板（关系名复用上面静态查表的 relNameOut）
    pushService.sendToUser(targetOpenid, {
      title: matchNotifTitle,
      desc: matchNotifContent,
      enTitle: `[Friend message]${meRows[0].nickname || 'A kindred soul'} matched with you`,
      enDesc: `${meRows[0].nickname || 'A kindred soul'} matched with you${relNameOut && relNameOut !== relationshipName ? ': ' + relNameOut : ''}`,
      ext: { type: 'match_reply', matchId: String(result.insertId) },
      classification: 0
    }).catch(() => {});

    res.json({ success: true, data: { id: result.insertId, relationshipName: relNameOut, matchLevel: levelOut, myIsVip: isVipPlan(meRows[0].plan_type), targetIsVip: isVipPlan(targetRows[0].plan_type) } });

    logEvent(openid, 'letter_match', 'letter', { target_openid: targetOpenid, record_id: result.insertId });
  } catch (err) {
    try { await conn.rollback(); } catch (e) { /* ignore */ }
    console.error('[letter/match]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  } finally {
    conn.release();
  }
});

// GET /api/letter/friends - 获取传书好友列表
router.get('/friends', verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    const conn = await db.get();
    try {
      const [rows] = await conn.query(
        `SELECT t.match_id, t.friend_openid, t.friend_nickname, t.friend_gua, t.friend_gua_name,
          t.friend_gender, t.friend_plan_type, t.relationship_name, t.last_letter, t.last_letter_time, t.unread_count, t.is_blocked
         FROM (
           SELECT mr.id AS match_id,
             CASE WHEN mr.user_a_openid = ? THEN mr.user_b_openid ELSE mr.user_a_openid END AS friend_openid,
             CASE WHEN mr.user_a_openid = ? THEN u_b.nickname ELSE u_a.nickname END AS friend_nickname,
             CASE WHEN mr.user_a_openid = ? THEN u_b.ming_ben_gua ELSE u_a.ming_ben_gua END AS friend_gua,
             CASE WHEN mr.user_a_openid = ? THEN h_b.full_name ELSE h_a.full_name END AS friend_gua_name,
             CASE WHEN mr.user_a_openid = ? THEN u_b.gender ELSE u_a.gender END AS friend_gender,
             CASE WHEN mr.user_a_openid = ? THEN u_b.plan_type ELSE u_a.plan_type END AS friend_plan_type,
             mr.relationship_name,
             (SELECT content FROM letters WHERE (sender_openid = ? AND receiver_openid = CASE WHEN mr.user_a_openid = ? THEN mr.user_b_openid ELSE mr.user_a_openid END) OR (sender_openid = CASE WHEN mr.user_a_openid = ? THEN mr.user_b_openid ELSE mr.user_a_openid END AND receiver_openid = ?) ORDER BY created_at DESC LIMIT 1) AS last_letter,
             (SELECT MAX(created_at) FROM letters WHERE (sender_openid = ? AND receiver_openid = CASE WHEN mr.user_a_openid = ? THEN mr.user_b_openid ELSE mr.user_a_openid END) OR (sender_openid = CASE WHEN mr.user_a_openid = ? THEN mr.user_b_openid ELSE mr.user_a_openid END AND receiver_openid = ?)) AS last_letter_time,
             (SELECT COUNT(*) FROM letters WHERE sender_openid = CASE WHEN mr.user_a_openid = ? THEN mr.user_b_openid ELSE mr.user_a_openid END AND receiver_openid = ? AND is_read = 0) AS unread_count,
             (SELECT COUNT(*) FROM letter_blocks WHERE (blocker_openid = ? AND blocked_openid = CASE WHEN mr.user_a_openid = ? THEN mr.user_b_openid ELSE mr.user_a_openid END) OR (blocker_openid = CASE WHEN mr.user_a_openid = ? THEN mr.user_b_openid ELSE mr.user_a_openid END AND blocked_openid = ?)) AS is_blocked,
             ROW_NUMBER() OVER (PARTITION BY CASE WHEN mr.user_a_openid = ? THEN mr.user_b_openid ELSE mr.user_a_openid END ORDER BY mr.created_at DESC) AS rn
            FROM match_records mr
            LEFT JOIN users u_a ON mr.user_a_openid = u_a.openid
            LEFT JOIN users u_b ON mr.user_b_openid = u_b.openid
            LEFT JOIN hexagrams h_a ON u_a.ming_ben_gua = h_a.id
            LEFT JOIN hexagrams h_b ON u_b.ming_ben_gua = h_b.id
            WHERE mr.user_a_openid = ? OR mr.user_b_openid = ?
         ) t
         WHERE t.rn = 1
         ORDER BY t.last_letter_time DESC`,
         // v2.3.5 修复：占位符实际为23个（6友信息+4last_letter+4last_letter_time+2unread+4is_blocked+1PARTITION BY+2WHERE），
         // 原注释写24且参数传24个，多余参数在文本协议下虽被忽略但属隐患；改用 Array(23).fill 杜绝数错
        Array(23).fill(openid)
      );

      // v19.2 双语：lang=en 时卦名/卦格查英文表，关系名 AI 翻译（并行，按短语缓存）
      const langEn = req.query.lang === 'en';
      let friendsList = rows
        .filter(r => !r.is_blocked) // v1.3 过滤被拉黑的好友
        .map(r => {
          const en = langEn ? (HEXAGRAMS_EN[r.friend_gua] || {}) : null;
          return {
            matchId: r.match_id,
            friendOpenid: r.friend_openid,
            friendNickname: r.friend_nickname,
            friendGua: r.friend_gua,
            friendGuaName: langEn ? (en.name || r.friend_gua_name || '') : (r.friend_gua_name || ''),
            friendGuaGe: langEn ? (en.gua_ge || getGuaGeById(r.friend_gua)) : getGuaGeById(r.friend_gua),
            friendGender: r.friend_gender,
            friendIsVip: isVipPlan(r.friend_plan_type),
            relationshipName: r.relationship_name,
            lastLetter: r.last_letter ? (r.last_letter.length > 30 ? r.last_letter.substring(0, 30) + '...' : r.last_letter) : '',
            lastLetterTime: r.last_letter_time,
            unreadCount: r.unread_count || 0
          };
        });
      if (langEn) {
        // v20：静态查表翻译关系名（零依赖）
        friendsList = friendsList.map(f => ({ ...f, relationshipName: translatePhrase(f.relationshipName, 'relname') }));
      }
      res.json({ success: true, data: friendsList });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[letter/friends]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// POST /api/letter/send - 发送信件
router.post('/send', verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    const { receiverOpenid: rawReceiverOpenid, content } = req.body;

    if (!rawReceiverOpenid || !content) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '参数不完整' });
    }

    const sanitizeResult = sanitizeLetterContent(content);
    if (!sanitizeResult.valid) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: sanitizeResult.reason });
    }

    const conn = await db.get();
    try {
      // 🔴 关键修复：前端缓存的 receiverOpenid 可能是对方绑定手机号前的旧 openid
      const receiverOpenid = await resolveOpenid(conn, rawReceiverOpenid);

      const [matchRows] = await conn.query(
        `SELECT id FROM match_records
         WHERE (user_a_openid = ? AND user_b_openid = ?) OR (user_a_openid = ? AND user_b_openid = ?)`,
        [openid, receiverOpenid, receiverOpenid, openid]
      );
      if (matchRows.length === 0) {
        return res.json({ success: false, code: 'NOT_MATCHED', message: '只能给已匹配的有缘人写信' });
      }

      // v1.3 检查是否已拉黑
      if (await isBlocked(conn, openid, receiverOpenid)) {
        return res.json({ success: false, code: 'BLOCKED', message: '双方已拉黑，无法写信' });
      }

      // v1.3 每日给同一人最多3封信频率限制
      const todayLetterCount = await getTodayLetterCount(conn, openid, receiverOpenid);
      if (todayLetterCount >= DAILY_LETTER_LIMIT_PER_USER) {
        return res.json({
          success: false,
          code: 'DAILY_LETTER_LIMIT_EXCEEDED',
          message: `每天最多给同一人发送${DAILY_LETTER_LIMIT_PER_USER}封信，明日再来`
        });
      }

      const [result] = await conn.query(
        'INSERT INTO letters (sender_openid, receiver_openid, match_id, content) VALUES (?, ?, ?, ?)',
        [openid, receiverOpenid, matchRows[0].id, content.trim()]
      );

      // 在 res.json 前获取发送者昵称（用 conn，此时连接未释放）
      const [senderRows] = await conn.query('SELECT nickname FROM users WHERE openid = ?', [openid]);
      const senderNick = (senderRows[0] && senderRows[0].nickname) || '一位有缘人';

      res.json({ success: true, data: { id: result.insertId, sentAt: new Date() } });

      // [PUSH] 信件发送后给收信方写通知（异步不阻塞响应，createNotification 内部用全局 db 不依赖 conn）
      const letterSnippet = content.trim().length > 50 ? content.trim().slice(0, 50) + '…' : content.trim();
      createNotification(receiverOpenid, NOTIFICATION_TYPES.LETTER_RECEIVED, `[好友消息]${senderNick}`, letterSnippet, String(result.insertId)).catch(() => {});

    // [PUSH] 信件到达系统推送（App 通知栏，异步不阻塞；英文用户用英文模板）
    // v3.4.0 小米2026消息分类新规：好友聊天类推送标题=发送人昵称、内容=实际聊天内容（禁止模糊消息）
    pushService.sendToUser(receiverOpenid, {
      title: `[好友消息]${senderNick}`,
      desc: letterSnippet,
      enTitle: `[Friend message]${senderNick}`,
      enDesc: letterSnippet,
      ext: { type: 'letter_received', letterId: String(result.insertId) },
      classification: 0
    }).catch(() => {});

      logEvent(openid, 'letter_send', 'letter', { receiver_openid: receiverOpenid, letter_id: result.insertId });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[letter/send]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// GET /api/letter/thread/:friendOpenid - 获取信件往来（含农历日期）
router.get('/thread/:friendOpenid', verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    const rawFriendOpenid = req.params.friendOpenid;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;
    const offset = (page - 1) * pageSize;

    const conn = await db.get();
    try {
      // 🔴 关键修复：URL 参数中的 friendOpenid 可能是对方绑定手机号前的旧 openid
      const friendOpenid = await resolveOpenid(conn, rawFriendOpenid);

      const [matchRows] = await conn.query(
        `SELECT id FROM match_records
         WHERE (user_a_openid = ? AND user_b_openid = ?) OR (user_a_openid = ? AND user_b_openid = ?)`,
        [openid, friendOpenid, friendOpenid, openid]
      );
      if (matchRows.length === 0) {
        return res.json({ success: false, code: 'NOT_MATCHED', message: '只能查看已匹配的往来信件' });
      }

      // v1.3 检查是否已拉黑
      if (await isBlocked(conn, openid, friendOpenid)) {
        return res.json({ success: false, code: 'BLOCKED', message: '双方已拉黑，无法查看信件' });
      }

      const [letters] = await conn.query(
        `SELECT l.*, u.nickname AS sender_nickname, u.ming_ben_gua AS sender_gua, u.plan_type AS sender_plan_type
         FROM letters l
         LEFT JOIN users u ON l.sender_openid = u.openid
         WHERE (l.sender_openid = ? AND l.receiver_openid = ?) OR (l.sender_openid = ? AND l.receiver_openid = ?)
         ORDER BY l.created_at DESC
         LIMIT ? OFFSET ?`,
        [openid, friendOpenid, friendOpenid, openid, pageSize, offset]
      );

      const [friendRows] = await conn.query(
        `SELECT u.nickname, u.ming_ben_gua, u.gender, u.plan_type, h.full_name AS gua_name,
          mr.relationship_name
         FROM users u
         LEFT JOIN hexagrams h ON u.ming_ben_gua = h.id
         LEFT JOIN match_records mr ON (mr.user_a_openid = ? AND mr.user_b_openid = ?) OR (mr.user_a_openid = ? AND mr.user_b_openid = ?)
         WHERE u.openid = ?`,
        [openid, friendOpenid, friendOpenid, openid, friendOpenid]
      );

      // v1.3.3 好友 VIP 状态
      const friendIsVip = friendRows.length > 0 ? isVipPlan(friendRows[0].plan_type) : false;

      // v2.3.4 修复：查询真实总数（而非当前页数量）
      const [totalRows] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM letters
         WHERE (sender_openid = ? AND receiver_openid = ?) OR (sender_openid = ? AND receiver_openid = ?)`,
        [openid, friendOpenid, friendOpenid, openid]
      );
      const totalCount = totalRows[0].cnt;

      // 标记收到的信件为已读
      await conn.query(
        'UPDATE letters SET is_read = 1 WHERE sender_openid = ? AND receiver_openid = ? AND is_read = 0',
        [friendOpenid, openid]
      );

      // v20 lang=en：好友信息英文化（卦名/卦格/关系名静态查表）
      const threadLangEn = req.query.lang === 'en';

      res.json({
        success: true,
        data: {
          friend: friendRows.length > 0 ? (threadLangEn ? {
            nickname: friendRows[0].nickname,
            guaId: friendRows[0].ming_ben_gua,
            guaName: (HEXAGRAMS_EN[friendRows[0].ming_ben_gua] || {}).name || friendRows[0].gua_name || '',
            guaGe: (HEXAGRAMS_EN[friendRows[0].ming_ben_gua] || {}).gua_ge || getGuaGeById(friendRows[0].ming_ben_gua),
            gender: friendRows[0].gender,
            isVip: friendIsVip,
            relationshipName: translatePhrase(friendRows[0].relationship_name || '', 'relname')
          } : {
            nickname: friendRows[0].nickname,
            guaId: friendRows[0].ming_ben_gua,
            guaName: friendRows[0].gua_name || '',
            guaGe: getGuaGeById(friendRows[0].ming_ben_gua),
            gender: friendRows[0].gender,
            isVip: friendIsVip,
            relationshipName: friendRows[0].relationship_name || ''
          }) : null,
          letters: letters.map(l => ({
            id: l.id,
            senderOpenid: l.sender_openid,
            receiverOpenid: l.receiver_openid,
            content: l.content,
            isRead: l.is_read === 1,
            createdAt: l.created_at,
            lunarDate: formatLunarDate(l.created_at),
            displayTime: formatLetterTime(l.created_at),
            isMine: l.sender_openid === openid,
            // v1.3.3 发件人 VIP 状态（收到的信件显示对方VIP标识）
            senderIsVip: l.sender_openid !== openid ? friendIsVip : isVipPlan(l.sender_plan_type)
          })),
          total: totalCount
        }
      });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[letter/thread]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// POST /api/letter/mark-read - 显式标记单封信件为已读（v3.5 新增）
// 幂等接口：前端在点开信件详情时调用，确保未读状态准确同步
router.post('/mark-read', verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    const { letterId } = req.body;

    if (!letterId) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '缺少 letterId' });
    }

    const conn = await db.get();
    try {
      // 仅允许标记自己收到的信（receiver_openid = 当前用户），防止越权标记
      const [result] = await conn.query(
        'UPDATE letters SET is_read = 1 WHERE id = ? AND receiver_openid = ? AND is_read = 0',
        [letterId, openid]
      );

      res.json({
        success: true,
        data: {
          letterId: letterId,
          marked: result.affectedRows > 0 // true 表示本次从未读变为已读；false 表示本就已是已读或非本人信件
        }
      });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[letter/mark-read]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// GET /api/letter/unread-count - 获取未读信件数
router.get('/unread-count', verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    const conn = await db.get();
    try {
      // v2.3.4 修复：排除被拉黑用户的来信，避免"有未读但看不到信"的困惑
      const [rows] = await conn.query(
        `SELECT COUNT(*) AS count FROM letters l
         WHERE l.receiver_openid = ? AND l.is_read = 0
           AND NOT EXISTS (
             SELECT 1 FROM letter_blocks lb
             WHERE (lb.blocker_openid = ? AND lb.blocked_openid = l.sender_openid)
                OR (lb.blocker_openid = l.sender_openid AND lb.blocked_openid = ?)
           )`,
        [openid, openid, openid]
      );
      res.json({ success: true, data: { unreadCount: rows[0].count || 0 } });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[letter/unread-count]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// POST /api/letter/report - 举报用户/信件
router.post('/report', verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    const { targetOpenid: rawTargetOpenid, reason, letterId } = req.body;

    if (!rawTargetOpenid || !reason) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '参数不完整' });
    }

    const validReasons = ['骚扰内容', '不当言论', '诈骗信息', '其他'];
    if (!validReasons.includes(reason)) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '举报原因无效' });
    }

    const conn = await db.get();
    try {
      // 🔴 关键修复：前端缓存的 targetOpenid 可能是对方绑定手机号前的旧 openid
      const targetOpenid = await resolveOpenid(conn, rawTargetOpenid);

      // 不能举报自己
      if (targetOpenid === openid) {
        return res.json({ success: false, code: 'INVALID_PARAM', message: '不能举报自己' });
      }

      // 防重复举报（同一人对同一目标24小时内只能举报一次）
      const [existing] = await conn.query(
        `SELECT id FROM letter_reports
         WHERE reporter_openid = ? AND target_openid = ?
         AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
        [openid, targetOpenid]
      );
      if (existing.length > 0) {
        return res.json({ success: false, code: 'DUPLICATE_REPORT', message: '您已举报过该用户，请勿重复举报' });
      }

      await conn.query(
        'INSERT INTO letter_reports (reporter_openid, target_openid, letter_id, reason) VALUES (?, ?, ?, ?)',
        [openid, targetOpenid, letterId || null, reason]
      );

      res.json({ success: true, data: { message: '举报已提交，我们将尽快处理' } });

      logEvent(openid, 'letter_report', 'letter', { target_openid: targetOpenid, reason: reason });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[letter/report]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// POST /api/letter/block - 拉黑好友（双向不可见/不可匹配/不可写信）
router.post('/block', verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    const { targetOpenid: rawTargetOpenid } = req.body;
    if (!rawTargetOpenid) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '参数不完整' });
    }

    const conn = await db.get();
    try {
      // 🔴 关键修复：前端缓存的 targetOpenid 可能是对方绑定手机号前的旧 openid
      const targetOpenid = await resolveOpenid(conn, rawTargetOpenid);

      if (targetOpenid === openid) {
        return res.json({ success: false, code: 'INVALID_PARAM', message: '不能拉黑自己' });
      }

      // 校验是否为已匹配好友（只能拉黑好友）
      const [matchRows] = await conn.query(
        `SELECT id FROM match_records
         WHERE (user_a_openid = ? AND user_b_openid = ?) OR (user_a_openid = ? AND user_b_openid = ?)`,
        [openid, targetOpenid, targetOpenid, openid]
      );
      if (matchRows.length === 0) {
        return res.json({ success: false, code: 'NOT_MATCHED', message: '只能拉黑已匹配的有缘人' });
      }

      // 插入拉黑记录（UNIQUE KEY 防重复，已存在视为成功）
      try {
        await conn.query(
          'INSERT IGNORE INTO letter_blocks (blocker_openid, blocked_openid) VALUES (?, ?)',
          [openid, targetOpenid]
        );
      } catch (e) { /* 已存在不报错 */ }

      res.json({ success: true, data: { message: '已拉黑，双方将不再可见' } });

      logEvent(openid, 'letter_block', 'letter', { target_openid: targetOpenid });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[letter/block]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

module.exports = router;
