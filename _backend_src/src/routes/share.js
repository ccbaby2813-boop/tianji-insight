// src/routes/share.js - 分享路由
const express = require('express');
const router = express.Router();
const db = require('../middleware/db');
const { verifyToken } = require('../middleware/auth');
const { logEvent } = require('../services/event-logger');
const { resolveOpenid } = require('../utils/openid-resolver');

// POST /api/share/code - 生成分享短码（需认证）
// type='result' 时 scene 存推演记录 ID，接收者可查看分享者的完整推演结果
// type='match' 或 'gua_match' 时 scene 可空，接收者进入双方匹配
router.post('/code', verifyToken, async (req, res) => {
  try {
    const { scene, type } = req.body;
    const openid = req.openid;
    if (!openid) return res.status(400).json({ success: false, code: 'AUTH_FAILED', message: '未认证' });

    // 🔴 v3.4 安全增强：从 8 位（10^8）提升至 12 位（10^12），熵增加 10000 倍
    // 配合 express-rate-limit 全局速率限制，杜绝暴力枚举
    const shareId = String(require('crypto').randomInt(100000000000, 1000000000000));
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    // 使用 db.transaction 确保自动释放
    await db.transaction(async (conn) => {
      await conn.query('INSERT INTO share_codes (share_id, openid, type, scene, expires_at, use_limit) VALUES (?,?,?,?,?,?)', [shareId, openid, type || 'gua_match', scene || '', expiresAt, 100]);
    });
    // [埋点] 分享码生成
    logEvent(openid, 'share', 'share', { type: type || 'gua_match', share_id: shareId });
    res.json({ success: true, data: { share_id: shareId, expires_at: expiresAt } });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/share/resolve/:shareId - 解析短码（公开）
// type='result'：返回分享者昵称 + 完整推演记录数据（接收者查看分享者的推演结果）
// type='match'/'gua_match'：返回分享者卦象/昵称/openid（接收者进入双方匹配）
router.get('/resolve/:shareId', async (req, res) => {
  try {
    const { shareId } = req.params;
    const conn = await db.get();
    try {
      const [rows] = await conn.query('SELECT * FROM share_codes WHERE share_id = ? AND (expires_at IS NULL OR expires_at > NOW())', [shareId]);
      if (!rows.length) return res.status(404).json({ success: false, code: 'INVALID_SHARE_ID', message: '短码无效或已过期' });
      const share = rows[0];
      if (share.use_count >= 100) return res.status(410).json({ success: false, code: 'SHARE_LIMIT_EXCEEDED', message: '短码使用次数已达上限' });
      await conn.query('UPDATE share_codes SET use_count = use_count + 1 WHERE id = ? AND use_count < use_limit', [share.id]);

      // 🔴 关键修复：分享码存的是分享者生成时的 openid，分享者若已绑定手机号则会变为 phone_xxx
      // 通过 user_bindings 表反查最新主账号 openid，确保前端拿到的是当前有效 openid
      const latestSharerOpenid = await resolveOpenid(conn, share.openid);

      const [users] = await conn.query('SELECT openid, nickname, ming_ben_gua FROM users WHERE openid = ?', [latestSharerOpenid]);
      if (!users.length) return res.status(404).json({ success: false, code: 'USER_NOT_FOUND' });

      // type='result'：返回分享者的完整推演记录数据
      if (share.type === 'result') {
        const recordId = parseInt(share.scene) || 0;
        if (!recordId) {
          return res.status(404).json({ success: false, code: 'RECORD_NOT_FOUND', message: '推演记录不存在' });
        }
        const [records] = await conn.query('SELECT id, question, result_data, is_vip_decode, vip_decode_text, created_at FROM tuiyan_records WHERE id = ?', [recordId]);
        if (!records.length) {
          return res.status(404).json({ success: false, code: 'RECORD_NOT_FOUND', message: '推演记录不存在' });
        }
        const rec = records[0];
        // result_data 是 JSON 字段，MySQL 已自动解析为对象
        let resultData = rec.result_data;
        if (typeof resultData === 'string') {
          try { resultData = JSON.parse(resultData); } catch (e) { resultData = {}; }
        }
        // 动态附加卦象信息（从用户 ming_ben_gua 关联 hexagrams 表 + config）
        if (users[0].ming_ben_gua && (!resultData.symbol || !resultData.gua_name)) {
          try {
            const [guaRows] = await conn.query('SELECT name, symbol, full_name FROM hexagrams WHERE id = ?', [users[0].ming_ben_gua]);
            if (guaRows.length) {
              if (!resultData.symbol) resultData.symbol = guaRows[0].symbol || '䷀';
              if (!resultData.gua_name) resultData.gua_name = guaRows[0].full_name || guaRows[0].name || '';
            }
            // 从 config 获取 gua_ge（HEXAGRAMS 是以卦名为 key 的对象）
            if (!resultData.gua_ge) {
              try {
                const { HEXAGRAMS } = require('../../config/hexagrams');
                const guaList = Object.values(HEXAGRAMS);
                for (const g of guaList) {
                  if (g.id === users[0].ming_ben_gua) { resultData.gua_ge = g.gua_ge || ''; break; }
                }
              } catch (e) { /* config 不可用时忽略 */ }
            }
          } catch (e) { /* 卦象查询失败时忽略，不影响主数据 */ }
        }
        return res.json({
          success: true,
          data: {
            type: 'result',
            recordId: rec.id,
            sharerNickname: users[0].nickname,
            sharerOpenid: users[0].openid,
            record: {
              id: rec.id,
              question: rec.question,
              result_data: resultData,
              is_vip_decode: rec.is_vip_decode,
              vip_decode_text: rec.vip_decode_text,
              created_at: rec.created_at
            }
          }
        });
      }

      // type='match_result'：返回分享者当时的完整匹配结果（scene 存 "guaA:guaB"）
      // 匹配结果是静态关系数据（relationshipData），落地页可完整展示，不依赖双方在线
      if (share.type === 'match_result') {
        const parts = String(share.scene || '').split(':');
        const guaA = parseInt(parts[0]);
        const guaB = parseInt(parts[1]);
        if (!guaA || !guaB || guaA < 1 || guaA > 64 || guaB < 1 || guaB > 64) {
          return res.status(404).json({ success: false, code: 'RECORD_NOT_FOUND', message: '匹配结果不存在' });
        }
        const relationshipData = require('../../config/relationship');
        const { HEXAGRAMS } = require('../../config/hexagrams');
        const key = Math.min(guaA, guaB) + '-' + Math.max(guaA, guaB);
        const relData = relationshipData[key];
        if (!relData) {
          return res.status(404).json({ success: false, code: 'RECORD_NOT_FOUND', message: '匹配结果不存在' });
        }
        const findGuaById = function(id) {
          for (const g of Object.values(HEXAGRAMS)) { if (g.id === id) return g; }
          return null;
        };
        const infoA = findGuaById(guaA);
        const infoB = findGuaById(guaB);
        return res.json({
          success: true,
          data: {
            type: 'match_result',
            sharerGuaId: guaA,
            sharerGuaSymbol: infoA ? (infoA.symbol || '') : '',
            sharerGuaName: infoA ? (infoA.full_name || infoA.name || '') : '',
            sharerGuaGe: infoA ? (infoA.gua_ge || '') : '',
            partnerGuaId: guaB,
            partnerGuaSymbol: infoB ? (infoB.symbol || '') : '',
            partnerGuaName: infoB ? (infoB.full_name || infoB.name || '') : '',
            partnerGuaGe: infoB ? (infoB.gua_ge || '') : '',
            sharerNickname: users[0].nickname,
            relation: {
              relationship_name: relData.relationship_name || '',
              one_liner: relData.one_liner || '',
              analysis: relData.analysis || '',
              resonance: relData.resonance || [],
              conflict: relData.conflict || [],
              advice: relData.advice || '',
              match_level: relData.match_level || ''
            }
          }
        });
      }

      // type='match'/'gua_match'：返回分享者基本信息+卦象符号，前端进入双方匹配
      var sharerGuaSymbol = '';
      var sharerGuaName = '';
      if (users[0].ming_ben_gua) {
        const [hexRows] = await conn.query('SELECT symbol, name FROM hexagrams WHERE id = ?', [users[0].ming_ben_gua]);
        if (hexRows.length) {
          sharerGuaSymbol = hexRows[0].symbol || '';
          sharerGuaName = hexRows[0].name || '';
        }
      }
      res.json({ success: true, data: { type: share.type, scene: share.scene, sharerGuaId: users[0].ming_ben_gua, sharerGuaSymbol: sharerGuaSymbol, sharerGuaName: sharerGuaName, sharerNickname: users[0].nickname, sharerOpenid: users[0].openid } });
    } finally {
      conn.release();
    }
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

module.exports = router;
