// src/routes/event.js - 埋点事件
const express = require('express');
const router = express.Router();
const db = require('../middleware/db');
const { verifyToken } = require('../middleware/auth');

// POST /api/event
router.post('/', verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    const { event_type, page, extra_data, session_id } = req.body;
    if (!event_type) return res.status(400).json({ success: false, code: 'INVALID_PARAM', message: 'event_type不能为空' });
    // 使用 db.query() 自动释放连接
    await db.query(
      'INSERT INTO events (openid, event_type, page, extra_data, session_id) VALUES (?, ?, ?, ?, ?)',
      [openid, event_type, page || '', extra_data ? JSON.stringify(extra_data) : null, session_id || null]
    );
    res.json({ success: true });
  } catch (err) { console.error('[event]', err); res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

module.exports = router;
