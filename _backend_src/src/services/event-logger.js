// src/services/event-logger.js - 服务端事件自动埋点
// 在关键业务操作时自动记录事件，不依赖前端调用
const db = require('../middleware/db');

/**
 * 记录事件到 events 表（fire-and-forget，失败不影响主业务）
 * @param {string} openid - 用户openid
 * @param {string} event_type - 事件类型
 * @param {string} [page] - 页面/来源
 * @param {object} [extra_data] - 额外数据（会被JSON.stringify）
 * @param {string} [session_id] - 会话ID
 */
function logEvent(openid, event_type, page, extra_data, session_id) {
  if (!openid || !event_type) return;
  db.query(
    'INSERT INTO events (openid, event_type, page, extra_data, session_id) VALUES (?, ?, ?, ?, ?)',
    [openid, event_type, page || '', extra_data ? JSON.stringify(extra_data) : null, session_id || null]
  ).catch(err => {
    // 事件记录失败不影响主业务，只打日志
    console.error(`[event-logger] ${event_type} 记录失败:`, err.message);
  });
}

module.exports = { logEvent };
