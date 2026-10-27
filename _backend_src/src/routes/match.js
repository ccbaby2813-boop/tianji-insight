// src/routes/match.js - 匹配相关接口
const express = require('express');
const router = express.Router();
const { verifyToken, optionalAuth } = require('../middleware/auth');
const db = require('../middleware/db');
const { logEvent } = require('../services/event-logger');
const { resolveOpenid, resolveOpenids } = require('../utils/openid-resolver');

// 引用 collection 模块的成就检查函数
let checkAndAwardAchievement;
function getAchievementChecker() {
  if (!checkAndAwardAchievement) {
    try {
      checkAndAwardAchievement = require('./collection').checkAndAwardAchievement;
    } catch (e) {
      console.error('[match] Failed to load collection module:', e.message);
    }
  }
  return checkAndAwardAchievement;
}

// POST /api/match/record - 创建匹配记录（需认证）
router.post('/record', verifyToken, async (req, res) => {
  try {
    const { user_a_openid: rawA, user_b_openid: rawB, user_a_gua, user_b_gua, relationship_key, relationship_name, match_level } = req.body;

    // 参数校验
    if (!rawB || !user_a_gua || !user_b_gua || !relationship_key) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '参数不完整' });
    }

    const conn = await db.get();
    try {
      // 🔴 关键修复：前端传入的 user_a_openid/user_b_openid 可能是对方绑定手机号前的旧 openid
      // 通过 user_bindings 表反查为当前主账号 openid，避免数据写入已失效的旧账号
      const [user_a_openid, user_b_openid] = await resolveOpenids(conn, rawA, rawB);

      // 安全：当前用户必须是匹配的一方（也用反查后的 openid 校验，且校验原始值）
      if (req.openid !== user_a_openid && req.openid !== user_b_openid
          && req.openid !== rawA && req.openid !== rawB) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: '无权创建他人匹配记录' });
      }

      // 防重复：同一对用户 1 分钟内已有记录则跳过写入
      const [existing] = await conn.query(
        'SELECT id FROM match_records WHERE ((user_a_openid=? AND user_b_openid=?) OR (user_a_openid=? AND user_b_openid=?)) AND created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)',
        [user_a_openid, user_b_openid, user_b_openid, user_a_openid]
      );
      if (existing.length > 0) {
        return res.json({ success: true, data: { id: existing[0].id, skipped: true } });
      }

      // 写入 match_records（同时写 user_a_gua/user_b_gua 和 gua_a/gua_b 两种字段，兼容现有表）
      // v1.3.3 标记 source='share'（分享匹配），不计入一元匹配每日10次额度
      const [result] = await conn.query(
        'INSERT INTO match_records (user_a_openid, user_b_openid, user_a_gua, user_b_gua, gua_a, gua_b, relationship_key, relationship_name, match_level, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [user_a_openid, user_b_openid, user_a_gua, user_b_gua, user_a_gua, user_b_gua, relationship_key, relationship_name || '', match_level || '', 'share']
      );

      // [NEW] 自动收集：双方互相收集对方的易经人格卡牌
      let isNewA = false, isNewB = false;
      let achA = null, achB = null;

      // A 收集 B 的卦
      if (user_a_openid && user_b_gua >= 1 && user_b_gua <= 64) {
        const [insA] = await conn.query(
          'INSERT IGNORE INTO user_gua_collection (openid, gua_id, source) VALUES (?, ?, ?)',
          [user_a_openid, user_b_gua, 'match']
        );
        isNewA = insA.affectedRows > 0;
        if (isNewA) {
          const checker = getAchievementChecker();
          if (checker) achA = await checker(conn, user_a_openid);
        }
      }

      // B 收集 A 的卦
      if (user_b_openid && user_a_gua >= 1 && user_a_gua <= 64) {
        const [insB] = await conn.query(
          'INSERT IGNORE INTO user_gua_collection (openid, gua_id, source) VALUES (?, ?, ?)',
          [user_b_openid, user_a_gua, 'match']
        );
        isNewB = insB.affectedRows > 0;
        if (isNewB) {
          const checker = getAchievementChecker();
          if (checker) achB = await checker(conn, user_b_openid);
        }
      }

      res.json({
        success: true,
        data: {
          id: result.insertId,
          collection: {
            isNewA, isNewB,
            achievementUnlockedA: achA?.unlocked || false,
            achievementUnlockedB: achB?.unlocked || false
          }
        }
      });

      // [埋点] 匹配完成
      logEvent(req.openid, 'match', 'match', {
        record_id: result.insertId,
        relationship_key,
        match_level: match_level || ''
      });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[match/record]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// GET /api/match/history/:openid - 获取匹配历史（需认证，只能查自己）
router.get('/history/:openid', verifyToken, async (req, res) => {
  try {
    // 直接用 token 解析的 openid，不依赖 URL 参数
    const openid = req.openid;

    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;

    const conn = await db.get();
    try {
      const [rows] = await conn.query(
        `SELECT mr.*,
          CASE WHEN mr.user_a_openid = ? THEN u_b.nickname ELSE u_a.nickname END AS other_nickname
        FROM match_records mr
        LEFT JOIN users u_a ON mr.user_a_openid = u_a.openid
        LEFT JOIN users u_b ON mr.user_b_openid = u_b.openid
        WHERE mr.user_a_openid = ? OR mr.user_b_openid = ?
        ORDER BY mr.created_at DESC
        LIMIT ? OFFSET ?`,
        [openid, openid, openid, pageSize, offset]
      );

      res.json({ success: true, data: rows });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[match/history]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// GET /api/match/:id - 获取匹配详情（需认证）
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const conn = await db.get();
    try {
      const [rows] = await conn.query('SELECT * FROM match_records WHERE id = ?', [req.params.id]);
      if (rows.length === 0) {
        return res.json({ success: false, code: 'RECORD_NOT_FOUND', message: '记录不存在' });
      }

      const record = rows[0];
      // 🔴 修复：数据库中的 user_a/b_openid 可能是用户绑定手机号前的旧 openid
      // 通过 resolveOpenid 反查后再与 req.openid（已被verifyToken反查为最新主账号）比较
      const recordUserA = await resolveOpenid(conn, record.user_a_openid);
      const recordUserB = await resolveOpenid(conn, record.user_b_openid);
      // 安全：只能查看自己参与的匹配
      if (recordUserA !== req.openid && recordUserB !== req.openid) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: '无权查看' });
      }

      res.json({ success: true, data: record });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[match/:id]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

module.exports = router;
