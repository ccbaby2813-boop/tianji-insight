// src/routes/notification.js - 用户通知路由
// 功能：通知列表、未读数、标记已读、全部已读
// 通知写入由 match.js（匹配回应）、letter.js（信件到达）、节气定时任务触发

const express = require('express');
const router = express.Router();
const db = require('../middleware/db');
const { verifyToken, optionalAuth } = require('../middleware/auth');

// 通知类型常量
const NOTIFICATION_TYPES = {
  MATCH_REPLY: 'match_reply',       // 匹配回应
  LETTER_RECEIVED: 'letter_received', // 信件到达
  JIEQI_REMINDER: 'jieqi_reminder',   // 节气提醒
  SYSTEM: 'system'                     // 系统通知
};

/**
 * 写入通知（供其他路由/定时任务调用）
 * @param {string} userOpenid - 接收用户 openid
 * @param {string} type - 通知类型
 * @param {string} title - 标题
 * @param {string} content - 内容
 * @param {string} relatedId - 关联ID
 */
async function createNotification(userOpenid, type, title, content = '', relatedId = null) {
  try {
    if (!userOpenid || !type || !title) return null;
    const [result] = await db.query(
      `INSERT INTO notifications (user_openid, type, title, content, related_id)
       VALUES (?, ?, ?, ?, ?)`,
      [userOpenid, type, title.substring(0, 200), content, relatedId]
    );
    return result.insertId;
  } catch (err) {
    console.error('[NOTIFICATION] create error:', err.message);
    return null;
  }
}

// GET /api/notifications - 获取通知列表（需登录）
router.get('/', verifyToken, async (req, res) => {
  try {
    const openid = req.user.openid;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const onlyUnread = req.query.unread === '1';

    let whereClause = 'WHERE user_openid = ?';
    const params = [openid];
    if (onlyUnread) {
      whereClause += ' AND is_read = 0';
    }

    const [rows] = await db.query(
      `SELECT id, type, title, content, related_id, is_read, created_at, read_at
       FROM notifications ${whereClause}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM notifications ${whereClause}`,
      params
    );

    res.json({
      success: true,
      data: {
        list: rows,
        total: countResult[0].total,
        page,
        pageSize,
        hasMore: page * pageSize < countResult[0].total
      }
    });
  } catch (err) {
    console.error('[NOTIFICATION] list error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '获取通知失败' });
  }
});

// GET /api/notifications/unread-count - 获取未读通知数量（需登录）
router.get('/unread-count', verifyToken, async (req, res) => {
  try {
    const openid = req.user.openid;
    const [rows] = await db.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_openid = ? AND is_read = 0`,
      [openid]
    );
    res.json({ success: true, data: { count: rows[0].count } });
  } catch (err) {
    console.error('[NOTIFICATION] unread-count error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '获取未读数失败' });
  }
});

// POST /api/notifications/:id/read - 标记单条已读（需登录）
router.post('/:id/read', verifyToken, async (req, res) => {
  try {
    const openid = req.user.openid;
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: '通知ID无效' });

    const [result] = await db.query(
      `UPDATE notifications SET is_read = 1, read_at = NOW()
       WHERE id = ? AND user_openid = ? AND is_read = 0`,
      [id, openid]
    );

    res.json({ success: true, data: { updated: result.affectedRows } });
  } catch (err) {
    console.error('[NOTIFICATION] read error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '标记已读失败' });
  }
});

// POST /api/notifications/read-all - 全部标记已读（需登录）
router.post('/read-all', verifyToken, async (req, res) => {
  try {
    const openid = req.user.openid;
    const [result] = await db.query(
      `UPDATE notifications SET is_read = 1, read_at = NOW()
       WHERE user_openid = ? AND is_read = 0`,
      [openid]
    );
    res.json({ success: true, data: { updated: result.affectedRows } });
  } catch (err) {
    console.error('[NOTIFICATION] read-all error:', err.message);
    res.status(500).json({ success: false, code: 'DB_ERROR', message: '全部已读失败' });
  }
});

module.exports = router;
module.exports.createNotification = createNotification;
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
