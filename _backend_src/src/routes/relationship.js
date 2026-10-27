// src/routes/relationship.js - 易缘匹配路由
const express = require('express');
const router = express.Router();
const db = require('../middleware/db');
const relationshipData = require('../../config/relationship');
const relationshipDataEn = require('../../config/relationship-en'); // v20 方案B：2080条英文静态文件
const { HEXAGRAMS } = require('../../config/hexagrams');
const HEXAGRAMS_EN = require('../../config/hexagrams-en'); // v19.0

// 根据卦ID查找卦信息（纯内存查找，无需DB）
function findGuaById(id) {
  for (const [, gua] of Object.entries(HEXAGRAMS)) {
    if (gua.id === id) return gua;
  }
  return null;
}

const WUXING_EN = { '金': 'Metal', '木': 'Wood', '水': 'Water', '火': 'Fire', '土': 'Earth' };

// v20 方案B：lang=en 直接读静态英文文件（Redis/AI 零依赖，毫秒级）
function applyEnglishRel(relData, guaA, guaB, key) {
  const mk = (info) => {
    if (!info) return null;
    const en = HEXAGRAMS_EN[info.id] || {};
    return { name: en.name || info.name, full_name: en.name || info.full_name, gua_ge: en.gua_ge || info.gua_ge || '', symbol: info.symbol, wuxing: WUXING_EN[info.wuxing] || info.wuxing || '' };
  };
  const translated = relationshipDataEn[key] || relData; // 静态文件缺失时降级中文
  return {
    ...translated,
    relationship_key: key,
    guaA: mk(guaA),
    guaB: mk(guaB)
  };
}

// GET /api/relationship/lazy - 懒加载易经人格列表（64卦分页，前端按需加载）
// 注：此接口返回 hexagrams 分页数据，与 GET /api/gua/list 功能重叠但支持分页
router.get('/lazy', async (req, res) => {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const conn = await db.get();
    try {
      const [rows] = await conn.query('SELECT id, name, full_name, symbol, upper, lower FROM hexagrams ORDER BY id LIMIT ? OFFSET ?', [parseInt(pageSize), offset]);
      const [countRows] = await conn.query('SELECT COUNT(*) as total FROM hexagrams');
      res.json({ success: true, data: { list: rows, total: countRows[0].total, page: parseInt(page), pageSize: parseInt(pageSize) } });
    } finally { conn.release(); }
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/relationship/:guaA/:guaB（必须在最后定义，避免匹配到 /lazy 等路径）
router.get('/:guaA/:guaB', async (req, res) => {
  try {
    const guaA = parseInt(req.params.guaA);
    const guaB = parseInt(req.params.guaB);
    if (isNaN(guaA) || isNaN(guaB) || guaA < 1 || guaA > 64 || guaB < 1 || guaB > 64) {
      return res.status(400).json({ success: false, code: 'INVALID_PARAM' });
    }
    // 查找 relationship data
    const key = `${Math.min(guaA, guaB)}-${Math.max(guaA, guaB)}`;
    const relData = relationshipData[key];
    if (!relData) {
      return res.status(404).json({ success: false, code: 'RECORD_NOT_FOUND', message: '关系解读不存在' });
    }
    // 附带双方卦的详细信息（供前端展示卦名、卦格）
    const infoA = findGuaById(guaA);
    const infoB = findGuaById(guaB);
    // v20 双语：?lang=en 返回英文版（静态文件直读，毫秒级）
    if (req.query.lang === 'en') {
      const data = applyEnglishRel(relData, infoA, infoB, key);
      return res.json({ success: true, data });
    }
    res.json({
      success: true,
      data: {
        ...relData,
        relationship_key: key,
        guaA: infoA ? { name: infoA.name, full_name: infoA.full_name, gua_ge: infoA.gua_ge || '', symbol: infoA.symbol, wuxing: infoA.wuxing || '' } : null,
        guaB: infoB ? { name: infoB.name, full_name: infoB.full_name, gua_ge: infoB.gua_ge || '', symbol: infoB.symbol, wuxing: infoB.wuxing || '' } : null
      }
    });
  } catch (err) { res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' }); }
});

module.exports = router;
