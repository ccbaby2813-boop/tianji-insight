// src/routes/points.js - 积分体系路由（v17.0）
// 普通推演从「每日免费3次」改为「积分消耗制」（10积分/次）
// 积分来源：每日签到+10 / 连续签到7天+100&1次超级推演 / 激励视频广告+10 / 新用户注册+10 (v17.1 已移除VIP每日赠分)

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const db = require('../middleware/db');
const { resetDailyQuota, getTodayBeijing } = require('../utils/vip');
const redisService = require('../services/redis');

const CHECKIN_BASE = 10;        // 每日签到基础积分
const CHECKIN_STREAK_BONUS = 100; // 连续签到7天奖励积分
const AD_REWARD = 10;           // 单次广告奖励积分

// 北京时间的昨天（YYYY-MM-DD）
function getYesterdayBeijing() {
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  beijing.setDate(beijing.getDate() - 1);
  return beijing.toISOString().split('T')[0];
}

// 北京日期归一化（DB date 可能带时差）
function normalizeDate(d) {
  if (!d) return null;
  return new Date(new Date(d).getTime() + 8 * 60 * 60 * 1000).toISOString().split('T')[0];
}

/**
 * GET /api/points/balance - 积分余额与签到状态
 * 返回：points / totalPoints / todayCheckedIn / streak / checkinTotal / extraVipDecode
 */
router.get('/balance', verifyToken, async (req, res) => {
  try {
    const conn = await db.get();
    try {
      const [rows] = await conn.query(
        'SELECT points, total_points, last_checkin_date, checkin_streak, checkin_total, plan_type, expire_time, quota_remaining, last_quota_reset_date FROM users WHERE openid = ?',
        [req.openid]
      );
      if (!rows.length) return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: '用户不存在' });

      const user = rows[0];
      // 复用登录态的每日配额重置逻辑（VIP 每日20次次数制 / free 每日3次），保证次数新鲜
      await resetDailyQuota(conn, req.openid, user);

      const today = getTodayBeijing();
      const lastCheckin = normalizeDate(user.last_checkin_date);
      let extraVipDecode = 0;
      try { extraVipDecode = await redisService.getExtraVipDecode(req.openid); } catch (e) { /* Redis异常不影响查询 */ }

      res.json({
        success: true,
        data: {
          points: user.points || 0,
          totalPoints: user.total_points || 0,
          todayCheckedIn: lastCheckin === today,
          streak: user.checkin_streak || 0,
          checkinTotal: user.checkin_total || 0,
          extraVipDecode
        }
      });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[points/balance]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

/**
 * POST /api/points/checkin - 每日签到
 * 规则：+10积分/天；连续第7天（含14/21/28...每满7天）额外+100积分和1次超级推演
 */
router.post('/checkin', verifyToken, async (req, res) => {
  try {
    const conn = await db.get();
    try {
      const [rows] = await conn.query(
        'SELECT points, last_checkin_date, checkin_streak, checkin_total FROM users WHERE openid = ? FOR UPDATE',
        [req.openid]
      );
      if (!rows.length) return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: '用户不存在' });

      const user = rows[0];
      const today = getTodayBeijing();
      const lastCheckin = normalizeDate(user.last_checkin_date);

      if (lastCheckin === today) {
        return res.status(400).json({ success: false, code: 'ALREADY_CHECKED_IN', message: '今日已签到，明天再来' });
      }

      // 连续签到判定：昨天签过则连续+1，否则重置为1
      const streak = (lastCheckin === getYesterdayBeijing()) ? (user.checkin_streak || 0) + 1 : 1;
      const isStreakBonus = streak > 0 && streak % 7 === 0; // 每满7天（7/14/21...）都奖励
      const gained = CHECKIN_BASE + (isStreakBonus ? CHECKIN_STREAK_BONUS : 0);

      // 原子更新积分与签到状态
      const [upd] = await conn.query(
        'UPDATE users SET points = points + ?, total_points = total_points + ?, checkin_streak = ?, checkin_total = checkin_total + 1, last_checkin_date = ? WHERE openid = ?',
        [gained, gained, streak, today, req.openid]
      );
      if (upd.affectedRows === 0) {
        return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '签到失败，请重试' });
      }

      const newPoints = (user.points || 0) + gained;

      // 积分流水：基础签到
      await conn.query(
        'INSERT INTO points_transactions (openid, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)',
        [req.openid, 'checkin', CHECKIN_BASE, newPoints - (isStreakBonus ? CHECKIN_STREAK_BONUS : 0), '每日签到']
      );
      // 积分流水：连续7天奖励
      if (isStreakBonus) {
        await conn.query(
          'INSERT INTO points_transactions (openid, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)',
          [req.openid, 'checkin_streak', CHECKIN_STREAK_BONUS, newPoints, '连续签到' + streak + '天奖励']
        );
        // 奖励1次超级推演（Redis，90天有效）
        await redisService.incrExtraVipDecode(req.openid);
      }

      let extraVipDecode = 0;
      try { extraVipDecode = await redisService.getExtraVipDecode(req.openid); } catch (e) { /* 忽略 */ }

      res.json({
        success: true,
        data: {
          points: newPoints,
          gained,
          streak,
          isStreakBonus,
          bonusPoints: isStreakBonus ? CHECKIN_STREAK_BONUS : 0,
          bonusVipDecode: isStreakBonus ? 1 : 0,
          extraVipDecode
        }
      });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[points/checkin]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

/**
 * POST /api/points/ad-reward - 激励视频广告观看奖励
 * 规则：看完激励视频后前端回调，+10积分；[SEC-FIX] P1-4: 30秒冷却 + 每日上限(默认20次) 双防刷
 */
router.post('/ad-reward', verifyToken, async (req, res) => {
  try {
    // 冷却检查（30秒内仅1次；Redis 不可用时拒绝，防止绕过计数）
    const allowed = await redisService.checkAdRewardCooldown(req.openid);
    if (!allowed) {
      return res.status(429).json({ success: false, code: 'AD_TOO_FREQUENT', message: '操作太快了，稍后再试' });
    }
    // 每日次数上限（原子，不超发）
    const daily = await redisService.tryIncrAdDaily(req.openid);
    if (!daily.allowed) {
      return res.status(429).json({ success: false, code: 'AD_DAILY_LIMIT', message: '今日广告奖励次数已达上限' });
    }

    const conn = await db.get();
    try {
      const [upd] = await conn.query(
        'UPDATE users SET points = points + ?, total_points = total_points + ? WHERE openid = ?',
        [AD_REWARD, AD_REWARD, req.openid]
      );
      if (upd.affectedRows === 0) {
        return res.status(404).json({ success: false, code: 'USER_NOT_FOUND', message: '用户不存在' });
      }
      const [rows] = await conn.query('SELECT points FROM users WHERE openid = ?', [req.openid]);
      const newPoints = rows.length ? rows[0].points : 0;

      await conn.query(
        'INSERT INTO points_transactions (openid, type, amount, balance_after, remark) VALUES (?, ?, ?, ?, ?)',
        [req.openid, 'ad_reward', AD_REWARD, newPoints, '观看激励视频']
      );

      // [SEC-FIX] P1-4: 审计日志（广告奖励领取记录，含当日第几次）
      try {
        await conn.query(
          "INSERT INTO events (openid, event_type, extra_data) VALUES (?, 'ad_reward', ?)",
          [req.openid, JSON.stringify({ count: daily.count, gained: AD_REWARD })]
        );
      } catch (e) { /* 埋点失败不阻断主流程 */ }

      res.json({ success: true, data: { points: newPoints, gained: AD_REWARD, dailyCount: daily.count } });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[points/ad-reward]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

module.exports = router;
