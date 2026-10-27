// src/routes/gua.js - 易经人格路由
const express = require('express');
const router = express.Router();
const db = require('../middleware/db');
const { HEXAGRAMS, HEXAGRAM_NAME_TO_ID } = require('../../config/hexagrams');
const HEXAGRAMS_EN = require('../../config/hexagrams-en'); // v19.0 64卦英文名表（短字段）
const HEXAGRAMS_EN_LONG = require('../../config/hexagrams-en-long'); // v20 方案B：64卦长文英文静态文件

// v20 lang=en：短字段查英文名表 + 长文直接读静态英文文件（Redis/AI 零依赖）
const TRIGRAM_EN = { '乾': 'Heaven', '坤': 'Earth', '震': 'Thunder', '巽': 'Wind', '坎': 'Water', '离': 'Fire', '艮': 'Mountain', '兑': 'Lake' };
const WUXING_EN = { '金': 'Metal', '木': 'Wood', '水': 'Water', '火': 'Fire', '土': 'Earth' };

function applyEnglish(gua) {
  const en = HEXAGRAMS_EN[gua.id] || {};
  const short = {
    name: en.name || gua.name,
    full_name: en.name || gua.full_name,
    gua_ge: en.gua_ge || gua.gua_ge,
    social_tag: en.social_tag || gua.social_tag,
    wuxing: WUXING_EN[gua.wuxing] || gua.wuxing,
    upper: TRIGRAM_EN[gua.upper] || gua.upper,
    lower: TRIGRAM_EN[gua.lower] || gua.lower
  };
  // v20：长文直接读静态英文文件，缺失的键降级保留中文
  const longEn = HEXAGRAMS_EN_LONG[gua.id] || {};
  return { ...gua, ...short, ...longEn };
}

/**
 * v20：64 卦 judgment + image 英文，直接从静态长文文件构建（内存缓存一次）
 */
let _listTextsCache = null;

function getListTextsEn() {
  if (_listTextsCache) return _listTextsCache;
  const result = {};
  for (const [id, g] of Object.entries(HEXAGRAMS_EN_LONG)) {
    result[id] = { judgment: g.judgment || '', image: g.image || '' };
  }
  _listTextsCache = result;
  return result;
}

// GET /api/gua/list
router.get('/list', async (req, res) => {
  try {
    const langEn = req.query.lang === 'en';
    const [rows] = await db.query('SELECT id, name, full_name, symbol, judgment, image, upper, lower FROM hexagrams ORDER BY id');
    const configMap = {};
    for (const [, gua] of Object.entries(HEXAGRAMS)) {
      configMap[gua.id] = gua;
    }

    // v20: judgment/image 英文直接读静态文件（零依赖）
    const textsEn = langEn ? getListTextsEn() : {};

    if (rows.length >= 64) {
      const enriched = rows.map(r => {
        const cfg = configMap[r.id] || {};
        const item = {
          ...r,
          upper: r.upper || cfg.upper || '',
          lower: r.lower || cfg.lower || '',
          wuxing: cfg.wuxing || '',
          gua_ge: cfg.gua_ge || '',
          social_tag: cfg.social_tag || ''
        };
        if (langEn) {
          const en = HEXAGRAMS_EN[r.id] || {};
          const tEn = textsEn[r.id] || {};
          item.name = en.name || item.name;
          item.full_name = en.name || item.full_name;
          item.gua_ge = en.gua_ge || item.gua_ge;
          item.social_tag = en.social_tag || item.social_tag;
          item.wuxing = WUXING_EN[item.wuxing] || item.wuxing;
          item.upper = TRIGRAM_EN[item.upper] || item.upper;
          item.lower = TRIGRAM_EN[item.lower] || item.lower;
          if (tEn.judgment) item.judgment = tEn.judgment;
          if (tEn.image) item.image = tEn.image;
        }
        return item;
      });
      return res.json({ success: true, data: enriched });
    }

    const dbMap = {};
    for (const r of rows) { dbMap[r.id] = r; }
    const list = [];
    for (const [, gua] of Object.entries(HEXAGRAMS)) {
      const dbRow = dbMap[gua.id] || {};
      const item = {
        id: gua.id,
        name: dbRow.name || gua.name || '',
        full_name: dbRow.full_name || gua.full_name || '',
        symbol: dbRow.symbol || gua.symbol || '',
        judgment: dbRow.judgment || '',
        image: dbRow.image || '',
        upper: dbRow.upper || gua.upper || '',
        lower: dbRow.lower || gua.lower || '',
        wuxing: gua.wuxing || '',
        gua_ge: gua.gua_ge || '',
        social_tag: gua.social_tag || ''
      };
      if (langEn) {
        const en = HEXAGRAMS_EN[gua.id] || {};
        const tEn = textsEn[gua.id] || {};
        item.name = en.name || item.name;
        item.full_name = en.name || item.full_name;
        item.gua_ge = en.gua_ge || item.gua_ge;
        item.social_tag = en.social_tag || item.social_tag;
        item.wuxing = WUXING_EN[item.wuxing] || item.wuxing;
        item.upper = TRIGRAM_EN[item.upper] || item.upper;
        item.lower = TRIGRAM_EN[item.lower] || item.lower;
        if (tEn.judgment) item.judgment = tEn.judgment;
        if (tEn.image) item.image = tEn.image;
      }
      list.push(item);
    }
    list.sort((a, b) => a.id - b.id);
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

// GET /api/gua/:id
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id < 1 || id > 64) return res.status(404).json({ success: false, code: 'GUA_NOT_FOUND' });
    const { HEXAGRAMS } = require('../../config/hexagrams');
    let configData = null;
    for (const [, gua] of Object.entries(HEXAGRAMS)) {
      if (gua.id === id) { configData = gua; break; }
    }
    if (!configData) {
      const [rows] = await db.query('SELECT * FROM hexagrams WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, code: 'GUA_NOT_FOUND' });
      return res.json({ success: true, data: rows[0] });
    }
    const [rows] = await db.query('SELECT image, description, judgment FROM hexagrams WHERE id = ?', [id]);
    const dbExtra = rows.length ? { image: rows[0].image || '', description: rows[0].description || '', judgment: rows[0].judgment || '' } : { image: '', description: '', judgment: '' };
    let data = { ...configData, ...dbExtra };
    // v20 双语：?lang=en 返回英文版（静态文件直读，零依赖）
    if (req.query.lang === 'en') data = applyEnglish(data);
    res.json({ success: true, data });
  } catch (err) { console.error('[gua/:id route error]', err.message, err.stack); res.status(500).json({ success: false, code: 'DB_ERROR', message: '数据库操作失败' }); }
});

module.exports = router;
