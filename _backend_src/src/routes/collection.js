// src/routes/collection.js - 64卦卡牌收集系统
const express = require('express');
const router = express.Router();
const { verifyToken, verifyOpenidMatch } = require('../middleware/auth');
const db = require('../middleware/db');

/**
 * 计算用户在第N位完成成就
 */
async function getCompletionOrder(conn, unlockedAt) {
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS cnt FROM user_achievements WHERE achievement_key = 'zhou_tian_yuan_man' AND unlocked_at <= ?",
    [unlockedAt]
  );
  return rows[0].cnt;
}

/**
 * 检查并解锁成就
 * @returns {{ unlocked: boolean, completionOrder: number|null }}
 */
async function checkAndAwardAchievement(conn, openid) {
  const [countRows] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM user_gua_collection WHERE openid = ?',
    [openid]
  );
  if (countRows[0].cnt >= 64) {
    await conn.query(
      "INSERT IGNORE INTO user_achievements (openid, achievement_key, extra_data) VALUES (?, 'zhou_tian_yuan_man', ?)",
      [openid, JSON.stringify({ gua_count: 64 })]
    );
    const [achRows] = await conn.query(
      "SELECT unlocked_at FROM user_achievements WHERE openid = ? AND achievement_key = 'zhou_tian_yuan_man'",
      [openid]
    );
    if (achRows.length > 0) {
      const order = await getCompletionOrder(conn, achRows[0].unlocked_at);
      return { unlocked: true, completionOrder: order };
    }
  }
  return { unlocked: false, completionOrder: null };
}

// GET /api/user/gua-collection/count/:openid - 快速获取收集数量 + 成就状态
router.get('/count/:openid', verifyToken, verifyOpenidMatch, async (req, res) => {
  try {
    const conn = await db.get();
    try {
      // 懒回填：自动补上用户自己的 ming_ben_gua
      const [userRows] = await conn.query(
        'SELECT ming_ben_gua FROM users WHERE openid = ? AND has_profile = 1',
        [req.openid]
      );
      if (userRows.length > 0 && userRows[0].ming_ben_gua) {
        const mg = userRows[0].ming_ben_gua;
        if (mg >= 1 && mg <= 64) {
          await conn.query(
            'INSERT IGNORE INTO user_gua_collection (openid, gua_id, source) VALUES (?, ?, ?)',
            [req.openid, mg, 'profile']
          ).catch(() => {});
        }
      }

      const [countRows] = await conn.query(
        'SELECT COUNT(*) AS cnt FROM user_gua_collection WHERE openid = ?',
        [req.openid]
      );
      const [achRows] = await conn.query(
        "SELECT unlocked_at FROM user_achievements WHERE openid = ? AND achievement_key = 'zhou_tian_yuan_man'",
        [req.openid]
      );
      const achieved = achRows.length > 0;
      let completionOrder = null;
      if (achieved) {
        completionOrder = await getCompletionOrder(conn, achRows[0].unlocked_at);
      }
      res.json({
        success: true,
        data: {
          total: countRows[0].cnt,
          achievementUnlocked: achieved,
          completionOrder
        }
      });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[collection/count]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// GET /api/user/gua-collection/:openid - 获取已收集卦ID列表
router.get('/:openid', verifyToken, verifyOpenidMatch, async (req, res) => {
  try {
    const conn = await db.get();
    try {
      // 懒回填：自动补上用户自己的 ming_ben_gua
      const [userRows] = await conn.query(
        'SELECT ming_ben_gua FROM users WHERE openid = ? AND has_profile = 1',
        [req.openid]
      );
      if (userRows.length > 0 && userRows[0].ming_ben_gua) {
        const mg = userRows[0].ming_ben_gua;
        if (mg >= 1 && mg <= 64) {
          await conn.query(
            'INSERT IGNORE INTO user_gua_collection (openid, gua_id, source) VALUES (?, ?, ?)',
            [req.openid, mg, 'profile']
          ).catch(() => {});
        }
      }

      const [rows] = await conn.query(
        'SELECT gua_id, collected_at, source FROM user_gua_collection WHERE openid = ? ORDER BY gua_id ASC',
        [req.openid]
      );
      res.json({
        success: true,
        data: {
          collected: rows.map(r => ({
            gua_id: r.gua_id,
            collected_at: r.collected_at,
            source: r.source
          })),
          total: rows.length
        }
      });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[collection GET]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// POST /api/user/gua-collection - 幂等手动收集
router.post('/', verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    const { gua_id, source } = req.body;
    if (!gua_id || gua_id < 1 || gua_id > 64) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '卦ID无效（1-64）' });
    }
    const conn = await db.get();
    try {
      await conn.query(
        'INSERT IGNORE INTO user_gua_collection (openid, gua_id, source) VALUES (?, ?, ?)',
        [openid, gua_id, source || 'manual']
      );
      // 检查成就
      const achResult = await checkAndAwardAchievement(conn, openid);
      res.json({
        success: true,
        data: { isNew: true, achievementUnlocked: achResult.unlocked, completionOrder: achResult.completionOrder }
      });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[collection POST]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

module.exports = router;
module.exports.checkAndAwardAchievement = checkAndAwardAchievement;
