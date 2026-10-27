// src/routes/tuiyan.js - 推演路由（v11.0 数据全量传递版）

const express = require('express');

const router = express.Router();

const { verifyToken } = require('../middleware/auth');

const { calculateGua, calculateMovingYao } = require('../services/algorithms');

const { buildRegularContext, callDeepSeek, buildVipContext, callDeepSeekVip } = require('../services/tuiyan');

const { checkVipDecodeLimit, consumeVipDecodeLimit, tryConsumeVipDecodeLimit, decrVipDecodeLimit, getExtraVipDecode, decrExtraVipDecode } = require('../services/redis');

const { calculateQimen, formatFullQimenSummary } = require('../services/qimen');

const { HEXAGRAMS } = require('../../config/hexagrams');

const ganzhi = require('../../utils/ganzhi');

const db = require('../middleware/db');

const { logEvent } = require('../services/event-logger');

const { resolveOpenid } = require('../utils/openid-resolver');
const { resetDailyQuota } = require('../utils/vip'); // 每日配额重置（VIP 每日20次次数制 / free 3次）

// [SEC-FIX] P1-2: 分享使用不可枚举的随机 share_token（32位hex），替代自增 id 防批量抓取用户隐私
const crypto = require('crypto');
function genShareToken() {
  return crypto.randomBytes(16).toString('hex'); // 32 hex 字符
}
function isShareToken(v) {
  return typeof v === 'string' && /^[a-f0-9]{32}$/i.test(v);
}
// 兼容降级：share_token 列未执行 migration 时静默跳过（不影响推演主流程）
async function attachShareToken(conn, recordId) {
  try {
    const token = genShareToken();
    await conn.query('UPDATE tuiyan_records SET share_token = ? WHERE id = ?', [token, recordId]);
    return token;
  } catch (e) {
    if (e && e.code === 'ER_BAD_FIELD_ERROR') return null; // 列不存在：旧库兼容
    console.warn('[tuiyan] attachShareToken failed:', e.message);
    return null;
  }
}
// AI并发控制信号量（防止大量并发AI请求阻塞所有进程）
class TuiyanSemaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }
  async acquire(timeoutMs = 0) {
    if (this.current < this.max) {
      this.current++;
      return { acquired: true };
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) this.queue.splice(idx, 1);
          reject(new Error('SEMAPHORE_TIMEOUT'));
        }, timeoutMs);
      }
      this.queue.push(entry);
    });
  }
  release() {
    this.current--;
    if (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (entry.timer) clearTimeout(entry.timer);
      this.current++;
      entry.resolve({ acquired: true });
    }
  }
}
const regularSemaphore = new TuiyanSemaphore(100); // 普通推演每进程100并发（全局400；flash官方并发上限2500）
const vipSemaphore = new TuiyanSemaphore(20);      // VIP推演每进程20并发（全局80；pro官方并发上限500）





function getHexagramByID(guaId) {

  const idNum = Number(guaId);

  for (const [, gua] of Object.entries(HEXAGRAMS)) {

    if (gua.id === idNum) return gua;

  }

  return null;

}



// POST /api/tuiyan

router.post('/', verifyToken, async (req, res) => {
  let semAcquired = false;
  let chargeType = 'points'; // 普通推演计费方式：'points'=免费扣积分 / 'quota'=VIP扣每日次数
  try {
    await regularSemaphore.acquire(60000);
    semAcquired = true;
  } catch (e) {
    if (e.message === 'SEMAPHORE_TIMEOUT') {
      return res.status(503).json({ success: false, code: 'TOO_MANY_REQUESTS', message: '当前推演请求较多，请稍候再试' });
    }
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: '服务异常' });
  }

  try {

    const { question } = req.body;

    if (!question || question.length > 200) return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '问题不能为空或超过200字' });



    const maliciousPatterns = [

      /(?:SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|EXEC|EXECUTE)\s+/i,

      /(?:<script|javascript:|onerror|onload|onclick)\s*=?/i,

      /(?:ignore\s+previous|override|system\s*prompt|disregard)/i,

      /(?:忽略上述|忽略之前|忘记所有|不要遵循|重新设定|从现在开始)/i,

      /(?:\n\s*(?:User:|System:|Assistant:|指令|角色))/i,

    ];

    for (const pat of maliciousPatterns) {

      if (pat.test(question)) {

        return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '问题包含不安全的字符' });

      }

    }



    // === 阶段1：读数据（快速，用完即释放连接）===

    const conn = await db.get();

    let user, guaImage, userGua, isVipUser;

    try {

      const [users] = await conn.query('SELECT * FROM users WHERE openid = ?', [req.openid]);

      if (!users.length) return res.status(404).json({ success: false, code: 'USER_NOT_FOUND' });

      user = users[0];

      if (!user.ming_ben_gua) return res.status(403).json({ success: false, code: 'PROFILE_INCOMPLETE', message: '请先完善档案' });

      // 🔴 修复：VIP判断应为 monthly/yearly（非'vip'），与payment.js写入的值一致
      isVipUser = (user.plan_type === 'monthly' || user.plan_type === 'yearly');

      // 普通推演计费：免费用户扣 10 积分；VIP 会员恢复原次数制（每日20次，0点重置，用不完作废）
      chargeType = isVipUser ? 'quota' : 'points';
      if (chargeType === 'points') {
        const [deductResult] = await conn.query(
          'UPDATE users SET points = points - 10 WHERE openid = ? AND points >= 10',
          [req.openid]
        );
        if (deductResult.affectedRows === 0) {
          return res.status(402).json({ success: false, code: 'POINTS_INSUFFICIENT', message: '积分不足：每日签到+10，看视频+10' });
        }
        // 记录积分流水
        const [pRows] = await conn.query('SELECT points FROM users WHERE openid = ?', [req.openid]);
        const balanceAfter = pRows.length ? pRows[0].points : 0;
        await conn.query(
          'INSERT INTO points_transactions (openid, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)',
          [req.openid, 'consume_tuiyan', -10, balanceAfter, '普通推演']
        );
      } else {
        // VIP 次数制：先每日重置（quota_remaining=20），剩余次数<=0 则提示，否则扣 1
        await resetDailyQuota(conn, req.openid, user);
        if (user.quota_remaining == null || user.quota_remaining <= 0) {
          return res.status(402).json({ success: false, code: 'VIP_QUOTA_EXCEEDED', message: '今日普通推演次数已用完，明天再来' });
        }
        await conn.query('UPDATE users SET quota_remaining = quota_remaining - 1 WHERE openid = ?', [req.openid]);
      }

      userGua = getHexagramByID(user.ming_ben_gua);

      if (!userGua) return res.status(500).json({ success: false, code: 'GUA_NOT_FOUND', message: '人格卦数据缺失' });

      const [guaRows] = await conn.query('SELECT image FROM hexagrams WHERE id = ?', [user.ming_ben_gua]);

      guaImage = guaRows.length ? (guaRows[0].image || '') : '';

    } finally {

      conn.release(); // ⚠️ AI调用前释放连接，防止连接池耗尽

    }



    // === 阶段2：构建参数（不持有连接）===

    const year = user.birth_year;

    const month = user.birth_month;

    const day = user.birth_day;

    const birthShichen = user.birth_shichen;

    const genderVal = user.gender;



    const nianZhu = ganzhi.getNianZhu(year);

    const yueZhu = ganzhi.getYueZhu(year, month, day);

    const riZhu = ganzhi.getRiZhu(year, month, day);



    const now = new Date();

    const nowYear = now.getFullYear();

    const nowMonth = now.getMonth() + 1;

    const nowDay = now.getDate();

    const nowHour = now.getHours();

    const nowShichenName = ganzhi.getShiChenByHour(nowHour);

    const nowShichenNum = ganzhi.diZhiNum(nowShichenName);

    const nowNianZhu = ganzhi.getNianZhu(nowYear, nowMonth, nowDay);

    const nowYueZhu = ganzhi.getYueZhu(nowYear, nowMonth, nowDay);

    const nowRiZhu = ganzhi.getRiZhu(nowYear, nowMonth, nowDay);

    const nowShiZhu = ganzhi.getShiZhu(nowRiZhu, nowShichenName);



    const qimen = calculateQimen(nowYear, nowMonth, nowDay, nowShichenNum, userGua.wuxing);

    if (qimen.error) return res.status(500).json({ success: false, code: 'QIMEN_ERROR', message: qimen.error });



    // v11.0 新增：生成AI格式化文本

    const qf = formatFullQimenSummary(qimen);



    const tuiyanTime = nowNianZhu + '年 ' + nowYueZhu + '月 ' + nowRiZhu + '日 ' + nowShiZhu + '时';

    const params = {
      question,
      lang: req.body.lang === 'en' ? 'en' : 'zh', // v19.0 双语：前端语言切换后推演结果输出英文
      userGuaName: userGua.full_name, userGuaGe: userGua.gua_ge,
      jingDianYuLu: userGua.judgment, userGuaImage: guaImage,
      tuiyanTime,
      jieQi: ganzhi.getJieQi(nowMonth, nowDay, nowYear),
      jieQiMeaning: qimen.jieQiMeaning,
      qimenJuName: qimen.qimenJuName, qimenJuDesc: qimen.qimenJuDesc,
      xunShouDesc: qf.xunShouDesc,
      // 值符星
      zhiFuStarName: qimen.zhiFuStarName, zhiFuStarDesc: qimen.zhiFuStarDesc,
      zhiFuStarLuck: qimen.zhiFuStarLuck,
      zhiFuGongName: qimen.zhiFuGongName,
      zhiFuGongDesc: qimen.zhiFuGongDesc, zhiFuGongShiYi: qimen.zhiFuGongShiYi,
      // 值使门
      zhiShiMenName: qimen.zhiShiMenName, zhiShiMenLuck: qimen.zhiShiMenLuck,
      zhiShiMenDesc: qimen.zhiShiMenDesc, zhiShiMenShiYi: qimen.zhiShiMenShiYi,
      zhiShiGongName: qimen.zhiShiGongName,
      zhiShiGongDesc: qimen.zhiShiGongDesc, zhiShiGongShiYi: qimen.zhiShiGongShiYi,
      // 五行
      wuxingA: userGua.wuxing, wuxingB: qimen.juWuxing,
      wuxingRelation: qimen.wuxingRelation,
      wuxingRelationDesc: qimen.wuxingRelationDesc,
      // 八神（精简：日干八神Name/JiXiong/Role供AI使用；时干八神仅用于qimenSnapshot落库）
      riGanShenName: qimen.riGanShenName, riGanShenJiXiong: qimen.riGanShenJiXiong,
      riGanShenRole: qimen.riGanShenRole,
      shiGanShenName: qimen.shiGanShenName, shiGanShenJiXiong: qimen.shiGanShenJiXiong,
      shiGanShenRole: qimen.shiGanShenRole
    };




    // === 阶段3：AI调用（不持有连接）===

    const aiStartTime = Date.now();

    console.log(`[AI调用] openid=${req.openid}, question_len=${(question||'').length}`);

    const aiResult = await callDeepSeek(buildRegularContext(params));

    const aiLatency = Date.now() - aiStartTime;

    console.log(`[AI调用] ${aiResult.success ? '成功' : '失败: ' + (aiResult.error || '未知')}`);

    // [埋点] AI调用结果

    logEvent(req.openid, aiResult.success ? 'ai_success' : 'ai_error', 'tuiyan', {

      latency: aiLatency,

      question_len: (question || '').length,

      error: aiResult.error || null,

      model: aiResult.meta?.model || null,

      prompt_tokens: aiResult.meta?.prompt_tokens || 0,

      completion_tokens: aiResult.meta?.completion_tokens || 0

    });



    if (!aiResult.success) {

      return res.status(500).json({ success: false, code: 'AI_ERROR', message: aiResult.error || '天机信号不稳定' });

    }



    // === 阶段4：写结果（快速，用完即释放连接）===

    // Unicode码点安全截断（避免截断emoji/CJK扩展区字符的surrogate pairs）

    const safeTruncate = (str, maxLen) => {

      const chars = Array.from(str);

      return chars.slice(0, maxLen).join('');

    };

    const sanitize = (raw, lang) => {

      const result = { ...raw };

      if (typeof result.jieDu === 'string') {

        const sensitivePatterns = [

          /https?:\/\/[^\s<>"']+/gi,

          /<\/?script[^>]*>/gi,

          /javascript\s*:/gi,

          /<iframe[^>]*>/gi,

          /<object[^>]*>/gi,

          /<embed[^>]*>/gi,

          /\b广告|加微信|加微|扫码|二维码|返现|刷单|兼职|博彩|赌博\b/gi,

        ];

        for (const pat of sensitivePatterns) {

          result.jieDu = result.jieDu.replace(pat, '');

        }

        result.jieDu = result.jieDu.trim();

        if (!result.jieDu) result.jieDu = '天机推演已完成';

      }

      ['yiList', 'jiList'].forEach(key => {

        if (Array.isArray(result[key])) {

          result[key] = result[key].map(item => {

            if (typeof item !== 'string') return item;

            var itemMax = lang === 'en' ? 45 : 15;
            return item.length > itemMax ? safeTruncate(item, itemMax) : item;

          });

        }

      });

      var panMax = lang === 'en' ? 120 : 50;
      if (typeof result.panCi === 'string' && result.panCi.length > panMax) {

        result.panCi = safeTruncate(result.panCi, panMax);

      }

      return result;

    };



    const resultData = sanitize(aiResult.data, params.lang);

    // v15.0 新增：将奇门遁甲排盘关键变量持久化到 result_data.qimenSnapshot
    // 用于推演结果页"奇门排盘"折叠区展示（替代原"卦辞象辞"原文区）
    resultData.qimenSnapshot = {
      tuiyanTime: params.tuiyanTime || '',
      jieQi: (params.jieQi || '') + (params.jieQiMeaning ? ' · ' + params.jieQiMeaning : ''),
      qimenJuName: params.qimenJuName || '',
      qimenJuDesc: params.qimenJuDesc || '',
      xunShouDesc: params.xunShouDesc || '',
      wuxingA: params.wuxingA || '',
      wuxingB: params.wuxingB || '',
      wuxingRelation: params.wuxingRelation || '',
      wuxingRelationDesc: params.wuxingRelationDesc || '',
      zhiFuStarName: params.zhiFuStarName || '',
      zhiFuStarLuck: params.zhiFuStarLuck || '',
      zhiFuGongName: params.zhiFuGongName || '',
      zhiFuGongDesc: params.zhiFuGongDesc || '',
      zhiFuGongShiYi: params.zhiFuGongShiYi || '',
      zhiShiMenName: params.zhiShiMenName || '',
      zhiShiMenLuck: params.zhiShiMenLuck || '',
      zhiShiGongName: params.zhiShiGongName || '',
      zhiShiGongDesc: params.zhiShiGongDesc || '',
      zhiShiGongShiYi: params.zhiShiGongShiYi || '',
      riGanShenName: params.riGanShenName || '',
      riGanShenJiXiong: params.riGanShenJiXiong || '',
      riGanShenRole: params.riGanShenRole || '',
      shiGanShenName: params.shiGanShenName || '',
      shiGanShenJiXiong: params.shiGanShenJiXiong || '',
      shiGanShenRole: params.shiGanShenRole || ''
    };



    const conn2 = await db.get();

    try {

      const [insertResult] = await conn2.query(

        'INSERT INTO tuiyan_records (openid, question, result_data) VALUES (?, ?, ?)',

        [req.openid, question, JSON.stringify(resultData)]

      );

      // [SEC-FIX] P1-2: 生成不可枚举的分享 token（旧库未迁移时返回 null，分享退化为 id）
      const shareToken = await attachShareToken(conn2, insertResult.insertId);

      // v15.15 修复：推演后更新 last_active_at，确保 DAU/WAU/MAU 统计准确
      await conn2.query('UPDATE users SET last_active_at = NOW() WHERE openid = ?', [req.openid]);



      // 计费后返回：免费用户返回积分余额；VIP 用户返回剩余次数
      if (chargeType === 'points') {
        const [pRows] = await conn2.query('SELECT points FROM users WHERE openid = ?', [req.openid]);
        resultData.points_remaining = pRows.length ? pRows[0].points : 0;
        resultData.points_cost = 10;
      } else {
        const [qRows] = await conn2.query('SELECT quota_remaining FROM users WHERE openid = ?', [req.openid]);
        resultData.quota_remaining = qRows.length ? qRows[0].quota_remaining : 0;
      }



      res.json({ success: true, data: { id: insertResult.insertId, share_token: shareToken, ...resultData } });

      // [埋点] 推演完成

      logEvent(req.openid, 'tuiyan', 'tuiyan', {

        record_id: insertResult.insertId,

        is_vip: !!isVipUser,

        question_len: (question || '').length

      });

    } finally {

      conn2.release();

    }

  } catch (err) {
    // AI 调用失败时回补已扣减的资源（免费用户回补 10 积分，VIP 用户回补 1 次普通推演）
    try {
      const connRollback = await db.get();
      if (chargeType === 'points') {
        await connRollback.query('UPDATE users SET points = points + 10 WHERE openid = ?', [req.openid]);
        const [rbRows] = await connRollback.query('SELECT points FROM users WHERE openid = ?', [req.openid]);
        await connRollback.query(
          'INSERT INTO points_transactions (openid, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)',
          [req.openid, 'refund_tuiyan', 10, rbRows.length ? rbRows[0].points : 0, '推演失败回补']
        );
      } else {
        await connRollback.query('UPDATE users SET quota_remaining = quota_remaining + 1 WHERE openid = ?', [req.openid]);
      }
      connRollback.release();
    } catch (e) { console.error('[tuiyan] 资源回补失败:', e.message); }
    console.error('[tuiyan]', err);
    res.status(500).json({ success: false, code: 'AI_ERROR', message: '推演失败' });
  } finally {
    if (semAcquired) regularSemaphore.release();
  }

});



// POST /api/tuiyan/vip — VIP超级推演（每日限1次，1500-2000字深度解读）

router.post('/vip', verifyToken, async (req, res) => {
  let semAcquired = false;
  try {
    await vipSemaphore.acquire(180000);
    semAcquired = true;
  } catch (e) {
    if (e.message === 'SEMAPHORE_TIMEOUT') {
      return res.status(503).json({ success: false, code: 'TOO_MANY_REQUESTS', message: '当前超级推演请求较多，请稍候再试' });
    }
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: '服务异常' });
  }

  try {

    const { question } = req.body;

    if (!question || question.length > 200) {

      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '问题不能为空或超过200字' });

    }



    // 恶意模式过滤（复用现有规则）

    const maliciousPatterns = [

      /(?:SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|EXEC|EXECUTE)\s+/i,

      /(?:<script|javascript:|onerror|onload|onclick)\s*=?/i,

      /(?:ignore\s+previous|override|system\s*prompt|disregard)/i,

      /(?:忽略上述|忽略之前|忘记所有|不要遵循|重新设定|从现在开始)/i,

      /(?:\n\s*(?:User:|System:|Assistant:|指令|角色))/i,

    ];

    for (const pat of maliciousPatterns) {

      if (pat.test(question)) {

        return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '问题包含不安全的字符' });

      }

    }



    // === 阶段1：读数据（快速，用完即释放连接）===

    const conn = await db.get();

    let user, guaImage, userGua;

    try {

      const [users] = await conn.query('SELECT * FROM users WHERE openid = ?', [req.openid]);

      if (!users.length) return res.status(404).json({ success: false, code: 'USER_NOT_FOUND' });

      user = users[0];



      // 🔴 v3.4 修复：建档检查必须先于VIP身份检查
      // 原顺序（VIP→Redis→建档）导致非VIP未建档用户收到 FORBIDDEN 而非 PROFILE_INCOMPLETE
      // 硬约束：未建档用户调用超级推演必须返回 403 + PROFILE_INCOMPLETE
      if (!user.ming_ben_gua) return res.status(403).json({ success: false, code: 'PROFILE_INCOMPLETE', message: '请先完善档案' });



      // v18 深度推演权限：VIP 优先用每日1次；每日用完（或非VIP）再走签到赠次（永久有效）；两者都没有才拒绝
      // 只读检查，成功后再消耗
      const isVipUserVip = (user.plan_type === 'monthly' || user.plan_type === 'yearly');
      let vipDailyAllowed = false;
      if (isVipUserVip) {
        const r = await checkVipDecodeLimit(req.openid);
        vipDailyAllowed = r.allowed;
      }
      const hasExtraDecode = (await getExtraVipDecode(req.openid)) > 0;

      if (!vipDailyAllowed && !hasExtraDecode) {
        return isVipUserVip
          ? res.json({ success: false, code: 'QUOTA_EXCEEDED', message: '今日超级推演次数已用完，明天再来' })
          : res.status(403).json({ success: false, code: 'VIP_DECODE_NO_QUOTA', message: '连续签到7天可获1次深度解读，或开通易学会员每日1次' });
      }

      userGua = getHexagramByID(user.ming_ben_gua);

      if (!userGua) return res.status(500).json({ success: false, code: 'GUA_NOT_FOUND', message: '人格卦数据缺失' });

      const [guaRows] = await conn.query('SELECT image FROM hexagrams WHERE id = ?', [user.ming_ben_gua]);

      guaImage = guaRows.length ? (guaRows[0].image || '') : '';

    } finally {

      conn.release();

    }



    // === 阶段2：构建参数（复用现有逻辑）===

    const year = user.birth_year;

    const month = user.birth_month;

    const day = user.birth_day;

    const birthShichen = user.birth_shichen;

    const genderVal = user.gender;



    const nianZhu = ganzhi.getNianZhu(year);

    const now = new Date();

    const nowYear = now.getFullYear();

    const nowMonth = now.getMonth() + 1;

    const nowDay = now.getDate();

    const nowHour = now.getHours();

    const nowShichenName = ganzhi.getShiChenByHour(nowHour);

    const nowShichenNum = ganzhi.diZhiNum(nowShichenName);

    const nowNianZhu = ganzhi.getNianZhu(nowYear, nowMonth, nowDay);

    const nowYueZhu = ganzhi.getYueZhu(nowYear, nowMonth, nowDay);

    const nowRiZhu = ganzhi.getRiZhu(nowYear, nowMonth, nowDay);

    const nowShiZhu = ganzhi.getShiZhu(nowRiZhu, nowShichenName);



    const qimen = calculateQimen(nowYear, nowMonth, nowDay, nowShichenNum, userGua.wuxing);

    if (qimen.error) return res.status(500).json({ success: false, code: 'QIMEN_ERROR', message: qimen.error });



    // v11.0 新增：生成AI格式化文本

    const qf = formatFullQimenSummary(qimen);






    const tuiyanTime = nowNianZhu + '年 ' + nowYueZhu + '月 ' + nowRiZhu + '日 ' + nowShiZhu + '时';



    const params = {

      question,

      lang: req.body.lang === 'en' ? 'en' : 'zh', // v19.0 双语：前端语言切换后深度推演输出英文

      userGuaName: userGua.full_name, userGuaGe: userGua.gua_ge,

      userGuaDesc: userGua.renGe, userGuaKeywords: userGua.guan_jian_ci,

      userGuaWeakness: userGua.zhi_ming_ruo_dian,

      jingDianYuLu: userGua.judgment, userGuaImage: guaImage,

      tuiyanTime,

      jieQi: ganzhi.getJieQi(nowMonth, nowDay, nowYear),

      sanYuan: qimen.sanYuan,

      qimenDun: qimen.dun, qimenJu: qimen.ju,

      qimenJuName: qimen.qimenJuName, qimenJuDesc: qimen.qimenJuDesc,

      zhiShiMenName: qimen.zhiShiMenName, zhiShiMenLuck: qimen.zhiShiMenLuck,

      zhiShiMenDesc: qimen.zhiShiMenDesc, zhiShiMenShiYi: qimen.zhiShiMenShiYi,

      zhiFuStarName: qimen.zhiFuStarName, zhiFuStarDesc: qimen.zhiFuStarDesc,

      zhiFuStarLuck: qimen.zhiFuStarLuck,

      zhiFuGongName: qimen.zhiFuGongName,

      zhiFuGongDesc: qimen.zhiFuGongDesc, zhiFuGongShiYi: qimen.zhiFuGongShiYi,

      zhiShiGongName: qimen.zhiShiGongName,

      zhiShiGongDesc: qimen.zhiShiGongDesc, zhiShiGongShiYi: qimen.zhiShiGongShiYi,

      wuxingRelation: qimen.wuxingRelation,

      wuxingRelationDesc: qimen.wuxingRelationDesc,

      wuxingA: userGua.wuxing, wuxingB: qimen.juWuxing,

      // v11.0 新增：全量qimen字段

      jieQiMeaning: qimen.jieQiMeaning,

      diPanFormatted: qf.diPanFormatted,

      gongCrossReference: qf.gongCrossReference,

      xunShouDesc: qf.xunShouDesc,

      riGanDesc: qf.riGanDesc,

      shiGanDesc: qf.shiGanDesc,

      shiZhuDesc: qf.shiZhuDesc || `${qimen.shiGan}${qimen.shiZhi}时`,

      riGanShenName: qimen.riGanShenName, riGanShenJiXiong: qimen.riGanShenJiXiong,

      riGanShenMeaning: qimen.riGanShenMeaning, riGanShenDesc: qimen.riGanShenDesc,

      riGanShenRole: qimen.riGanShenRole,

      shiGanShenName: qimen.shiGanShenName, shiGanShenJiXiong: qimen.shiGanShenJiXiong,

      shiGanShenMeaning: qimen.shiGanShenMeaning, shiGanShenDesc: qimen.shiGanShenDesc,

      shiGanShenRole: qimen.shiGanShenRole

    };



    // === 阶段3：VIP AI调用（不持有连接）===

    const aiStartTime = Date.now();

    console.log(`[VIP推演] openid=${req.openid}, question_len=${(question||'').length}`);

    const vipText = await callDeepSeekVip(buildVipContext(params));

    const aiLatency = Date.now() - aiStartTime;

    console.log(`[VIP推演] ${vipText.success ? '成功(' + vipText.data.length + '字)' : '失败: ' + (vipText.error || '未知')}`);

    // [埋点] VIP AI调用结果

    logEvent(req.openid, vipText.success ? 'ai_success' : 'ai_error', 'tuiyan_vip', {

      latency: aiLatency,

      question_len: (question || '').length,

      response_len: vipText.success ? vipText.data.length : 0,

      error: vipText.error || null,

      is_vip: true,

      model: vipText.meta?.model || null,

      prompt_tokens: vipText.meta?.prompt_tokens || 0,

      completion_tokens: vipText.meta?.completion_tokens || 0

    });



    if (!vipText.success) {

      // v15.3.4：checkVipDecodeLimit 已改为只读检查，AI 失败时无需回滚

      return res.status(500).json({ success: false, code: 'AI_ERROR', message: vipText.error || '天机信号不稳定' });

    }

    // [SEC-FIX] P2-1: AI 成功后原子消耗次数（Lua 检查+扣减一体，防止并发超发）；免费用户仅扣签到赠次（也已原子化）
    const vipUser = (user.plan_type === 'monthly' || user.plan_type === 'yearly');
    let vipUsed = false;
    if (vipUser) {
      const r = await tryConsumeVipDecodeLimit(req.openid);
      if (r.allowed) vipUsed = true;
    }
    if (!vipUsed) {
      await decrExtraVipDecode(req.openid);
    }



    // === 阶段4：写结果（快速，用完即释放连接）===

    // v15.0 新增：VIP推演同样持久化奇门排盘变量到 result_data.qimenSnapshot
    const vipResultData = {
      qimenSnapshot: {
        tuiyanTime: params.tuiyanTime || '',
        jieQi: (params.jieQi || '') + (params.jieQiMeaning ? ' · ' + params.jieQiMeaning : ''),
        qimenJuName: params.qimenJuName || '',
        qimenJuDesc: params.qimenJuDesc || '',
        xunShouDesc: params.xunShouDesc || '',
        wuxingA: userGua.wuxing || '',
        wuxingB: qimen.juWuxing || '',
        wuxingRelation: params.wuxingRelation || '',
        wuxingRelationDesc: params.wuxingRelationDesc || '',
        zhiFuStarName: params.zhiFuStarName || '',
        zhiFuStarLuck: params.zhiFuStarLuck || '',
        zhiFuGongName: params.zhiFuGongName || '',
        zhiFuGongDesc: params.zhiFuGongDesc || '',
        zhiFuGongShiYi: params.zhiFuGongShiYi || '',
        zhiShiMenName: params.zhiShiMenName || '',
        zhiShiMenLuck: params.zhiShiMenLuck || '',
        zhiShiGongName: params.zhiShiGongName || '',
        zhiShiGongDesc: params.zhiShiGongDesc || '',
        zhiShiGongShiYi: params.zhiShiGongShiYi || '',
        riGanShenName: params.riGanShenName || '',
        riGanShenJiXiong: params.riGanShenJiXiong || '',
        riGanShenRole: params.riGanShenRole || '',
        shiGanShenName: params.shiGanShenName || '',
        shiGanShenJiXiong: params.shiGanShenJiXiong || '',
        shiGanShenRole: params.shiGanShenRole || ''
      }
    };

    const conn2 = await db.get();

    try {

      const [insertResult] = await conn2.query(

        'INSERT INTO tuiyan_records (openid, question, result_data, is_vip_decode, vip_decode_text) VALUES (?, ?, ?, 1, ?)',

        [req.openid, question, JSON.stringify(vipResultData), vipText.data]

      );

      // [SEC-FIX] P1-2: 生成不可枚举的分享 token（旧库未迁移时返回 null，分享退化为 id）
      const shareToken = await attachShareToken(conn2, insertResult.insertId);

      // v15.15 修复：VIP 推演后更新 last_active_at，确保 DAU/WAU/MAU 统计准确
      await conn2.query('UPDATE users SET last_active_at = NOW() WHERE openid = ?', [req.openid]);



      // VIP超级推演不扣普通推演额度，返回-1表示无限
      const quotaRemaining = -1;

      res.json({

        success: true,

        data: {

          id: insertResult.insertId,

          share_token: shareToken,

          vip_decode_text: vipText.data,

          gua_name: userGua.full_name,

          gua_ge: userGua.gua_ge,

          symbol: guaImage || '',

          question,

          quota_remaining: quotaRemaining,

          created_at: new Date().toISOString()

        }

      });

      // [埋点] VIP推演完成

      logEvent(req.openid, 'tuiyan', 'tuiyan_vip', {

        record_id: insertResult.insertId,

        is_vip: true,

        question_len: (question || '').length,

        response_len: vipText.data.length

      });

    } finally {

      conn2.release();

    }

  } catch (err) {
    console.error('[tuiyan/vip]', err);
    res.status(500).json({ success: false, code: 'AI_ERROR', message: '推演失败' });
  } finally {
    if (semAcquired) vipSemaphore.release();
  }

});




// GET /api/tuiyan/shared/:id - 公开接口，查看分享的推演记录（脱敏数据）
// [SEC-FIX] P1-2: 优先按随机 share_token 查询（不可枚举）；32位hex之外按自增id兼容旧分享
router.get('/shared/:id', async (req, res) => {
  try {
    const conn = await db.get();
    try {
      const rawKey = String(req.params.id || '');
      const isToken = isShareToken(rawKey);
      const [rows] = isToken
        ? await conn.query('SELECT * FROM tuiyan_records WHERE share_token = ?', [rawKey])
        : await conn.query('SELECT * FROM tuiyan_records WHERE id = ?', [rawKey]);
      if (!rows.length) return res.status(404).json({ success: false, code: 'RECORD_NOT_FOUND', message: '记录不存在' });
      const r = rows[0];
      // 🔴 关键修复：tuiyan_records.openid 可能是用户绑定手机号前的旧 openid
      // 通过 user_bindings 表反查为当前主账号 openid 再查 users 表
      const sharerOpenid = await resolveOpenid(conn, r.openid);
      // 查询分享者信息（卦名+昵称）
      const [userRows] = await conn.query('SELECT ming_ben_gua, nickname FROM users WHERE openid = ?', [sharerOpenid]);
      let guaInfo = { symbol: '䷀', gua_name: '', gua_ge: '', judgment: '', image: '', wuxing: '' };
      let sharerNickname = '';
      if (userRows.length) {
        sharerNickname = userRows[0].nickname || '';
        if (userRows[0].ming_ben_gua) {
          const guaId = userRows[0].ming_ben_gua;
          const [guaRows] = await conn.query('SELECT name AS gua_name, symbol, judgment, image FROM hexagrams WHERE id = ?', [guaId]);
          if (guaRows.length) {
            guaInfo = {
              symbol: guaRows[0].symbol || '䷀',
              gua_name: guaRows[0].gua_name || '',
              judgment: guaRows[0].judgment || '',
              image: guaRows[0].image || '',
              wuxing: ''
            };
            for (const [, gua] of Object.entries(HEXAGRAMS)) {
              if (gua.id === guaId) { guaInfo.gua_ge = gua.gua_ge || ''; guaInfo.wuxing = gua.wuxing || ''; break; }
            }
          }
        }
      }
      // 脱敏返回：不含 openid，不含 is_vip_decode
      const resultData = typeof r.result_data === 'string' ? JSON.parse(r.result_data) : r.result_data;
      res.json({ success: true, data: {
        id: r.id,
        share_token: r.share_token || null,
        question: r.question,
        result_data: resultData,
        created_at: r.created_at,
        sharer_nickname: sharerNickname,
        ...guaInfo
      }});
    } finally { conn.release(); }
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/tuiyan/:id - 需要认证，只能查看自己的记录

router.get('/:id', verifyToken, async (req, res) => {

  try {

    const conn = await db.get();

    try {

      const [rows] = await conn.query('SELECT * FROM tuiyan_records WHERE id = ?', [req.params.id]);

      if (!rows.length) return res.status(404).json({ success: false, code: 'RECORD_NOT_FOUND' });

      const r = rows[0];

      // 🔴 关键修复：r.openid 可能是用户绑定手机号前的旧 openid
      // 通过 user_bindings 表反查为当前主账号 openid 再与 req.openid 比较
      // 否则用户绑定手机号后访问自己的历史推演会被误判为越权
      const recordOwnerOpenid = await resolveOpenid(conn, r.openid);

      if (recordOwnerOpenid !== req.openid) {

        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: '无权查看他人记录' });

      }

      const [userRows] = await conn.query('SELECT ming_ben_gua FROM users WHERE openid = ?', [recordOwnerOpenid]);

      let guaInfo = { symbol: '䷀', gua_name: '', gua_ge: '', judgment: '', image: '', wuxing: '' };

      if (userRows.length && userRows[0].ming_ben_gua) {

        const guaId = userRows[0].ming_ben_gua;

        const [guaRows] = await conn.query('SELECT name AS gua_name, symbol, judgment, image FROM hexagrams WHERE id = ?', [guaId]);

        if (guaRows.length) {

          guaInfo = {

            symbol: guaRows[0].symbol || '䷀',

            gua_name: guaRows[0].gua_name || '',

            judgment: guaRows[0].judgment || '',

            image: guaRows[0].image || '',

            wuxing: ''

          };

          const { HEXAGRAMS } = require('../../config/hexagrams');

          for (const [, gua] of Object.entries(HEXAGRAMS)) {

            if (gua.id === guaId) { guaInfo.gua_ge = gua.gua_ge || ''; guaInfo.wuxing = gua.wuxing || ''; break; }

          }

        }

      }

      res.json({ success: true, data: { ...r, result_data: typeof r.result_data === 'string' ? JSON.parse(r.result_data) : r.result_data, ...guaInfo } });

    } finally { conn.release(); }

  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }

});



module.exports = router;