// src/routes/solar-term.js - 节气养生路由
// 提供节气养生功能的 3 个 API：
//   GET /api/solar-term/current           - 当前节气基础信息（L1，无需登录）
//   GET /api/solar-term/advice?gua_ge=飞龙格 - 卦格专属养生建议（L3，需登录，全免费）
//   GET /api/solar-term/all               - 24 节气列表（无需登录）
//
// 数据层级：
//   L1 = solar_term_basic 表 / config/jieqi-health.js（24 节气通用养生）
//   L2 = config/wuxing-relation.js（25 条五行关系规则矩阵，运行时组合）
//   L3 = solar_term_health_advice 表（1536 条卦格专属建议，需 AI 生成 + 审核）
//
// 依赖：
//   lunar-javascript - 精确计算当前节气
//   config/jieqi-wuxing.js - 节气五行归属
//   config/jieqi-health.js - L1 通用养生配置（数据库无数据时回退）
//   config/wuxing-relation.js - L2 五行关系规则矩阵
//   config/hexagrams.js - 64 卦格数据（gua_ge → wuxing 映射）

const express = require('express');
const router = express.Router();
const db = require('../middleware/db');
const { verifyToken } = require('../middleware/auth');
const { Solar } = require('lunar-javascript');
const { JIE_QI_WUXING, JIE_QI_BY_NAME, WUXING_ORGAN_MAP } = require('../../config/jieqi-wuxing');
const { JIE_QI_HEALTH } = require('../../config/jieqi-health');
const { WUXING_RELATION, RELATION_TYPE_STRATEGY } = require('../../config/wuxing-relation');
const { HEXAGRAMS } = require('../../config/hexagrams');

// v20 方案B：英文静态文件直读（Redis/AI 零依赖）
const { JIE_QI_HEALTH: JIE_QI_HEALTH_EN_ARR, SEASON_CLASSIC: SEASON_CLASSIC_EN } = require('../../config/jieqi-health-en');
const { JIE_QI_WUXING: JIE_QI_WUXING_EN, WUXING_ORGAN_MAP_EN } = require('../../config/jieqi-wuxing-en');
const { WUXING_RELATION: WUXING_RELATION_EN, RELATION_TYPE_STRATEGY: RELATION_TYPE_STRATEGY_EN } = require('../../config/wuxing-relation-en');
const HEXAGRAMS_EN = require('../../config/hexagrams-en');
// L3 英文文件由 gen-l3-en.js 生成（1536条），尚未生成时 require 失败降级中文
let L3_ADVICE_EN = null;
try { L3_ADVICE_EN = require('../../config/solar-advice-en'); } catch (_) { L3_ADVICE_EN = null; }

// 英文术语映射（WUXING_ORGAN_MAP_EN 中 flavor/direction/color/desc 为中文残留，此处程序化补齐）
const FLAVOR_EN = { '酸': 'Sour', '苦': 'Bitter', '甘': 'Sweet', '辛': 'Pungent', '咸': 'Salty' };
const DIRECTION_EN = { '东': 'East', '南': 'South', '中': 'Center', '西': 'West', '北': 'North' };
const COLOR_EN = { '青': 'Green', '赤': 'Red', '黄': 'Yellow', '白': 'White', '黑': 'Black' };
const WUXING_EN = { '金': 'Metal', '木': 'Wood', '水': 'Water', '火': 'Fire', '土': 'Earth' };
const ORGAN_EN = { '肝': 'Liver', '心': 'Heart', '脾': 'Spleen', '肺': 'Lungs', '肾': 'Kidneys' };
const SEASON_EN = { '春': 'Spring', '夏': 'Summer', '秋': 'Autumn', '冬': 'Winter', '长夏': 'Late Summer', '春末': 'Late Spring', '夏末': 'Late Summer', '秋末': 'Late Autumn', '冬末': 'Late Winter' };
const ORGAN_DESC_EN = {
  Wood: 'The liver governs the free flow of qi, stores blood, and rules the tendons. Anger harms the liver; grief counteracts anger.',
  Fire: 'The heart governs blood and vessels, houses the spirit, and opens to the tongue. Excess joy harms the heart; fear counteracts joy.',
  Earth: 'The spleen governs transformation and transportation, houses thought, and rules the muscles. Overthinking harms the spleen; anger counteracts thought.',
  Metal: 'The lungs govern qi, house the corporeal soul, and rule the skin and body hair. Grief harms the lungs; joy counteracts grief.',
  Water: 'The kidneys govern water, store essence, and rule the bones. Fear harms the kidneys; contemplation counteracts fear.'
};

/** v20 lang=en：wuxingInfo 英文化（flavor/direction/color/desc 程序化补齐） */
function toWuxingInfoEn(infoEn, wuxingEnName) {
  if (!infoEn) return null;
  return {
    organ: infoEn.organ || '',
    emotion: infoEn.emotion || '',
    season: infoEn.season || '',
    flavor: FLAVOR_EN[infoEn.flavor] || infoEn.flavor || '',
    direction: DIRECTION_EN[infoEn.direction] || infoEn.direction || '',
    color: COLOR_EN[infoEn.color] || infoEn.color || '',
    desc: ORGAN_DESC_EN[wuxingEnName] || infoEn.desc || ''
  };
}

// ==================== 辅助函数 ====================

/**
 * 获取当前节气信息（名称 + 进入天数）
 * @returns {object} { name: string, daysIn: number }
 */
function getCurrentJieQiInfo() {
  const now = new Date();
  const solar = Solar.fromDate(now);
  const lunar = solar.getLunar();
  const current = lunar.getCurrentJieQi();
  const prev = lunar.getPrevJieQi();
  let jieQi, daysIn;
  if (current) {
    jieQi = current;
    daysIn = 1;
  } else {
    jieQi = prev;
    const jieQiSolar = jieQi.getSolar();
    const jieQiDate = new Date(jieQiSolar.getYear(), jieQiSolar.getMonth() - 1, jieQiSolar.getDay());
    const diffTime = now - jieQiDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
    daysIn = diffDays;
  }
  return { name: jieQi.getName(), daysIn };
}

/**
 * 获取当前节气名（精确到节气日时刻）
 * 逻辑：当天是节气日且时间已过节气时刻 → 返回该节气；否则返回上一个节气
 * @returns {string} 节气名，如 "小暑"
 */
function getCurrentJieQiName() {
  const { name } = getCurrentJieQiInfo();
  return name;
}

/**
 * 根据节气名获取索引（0-23，立春=0）
 * @param {string} name 节气名
 * @returns {number} 索引，未找到返回 -1
 */
function getJieQiIndex(name) {
  return JIE_QI_BY_NAME[name] !== undefined ? JIE_QI_BY_NAME[name] : -1;
}

/**
 * 从 L1 配置文件构建节气基础数据（数据库无数据时回退用）
 * @param {number} index 节气索引
 * @returns {object|null}
 */
function buildBasicFromConfig(index) {
  const health = JIE_QI_HEALTH.find(h => h.index === index);
  const wuxing = JIE_QI_WUXING.find(w => w.index === index);
  if (!health || !wuxing) return null;
  return {
    solar_term_index: health.index,
    name: health.name,
    wuxing: health.wuxing,
    organ: health.organ,
    season: wuxing.season,
    season_desc: wuxing.seasonDesc,
    date_range: health.dateRange,
    wu_hou: JSON.stringify(health.wuHou),
    keywords: JSON.stringify(health.keywords),
    plain_summary: health.plainSummary || '',
    neijing_quote: health.neijingQuote,
    neijing_source: health.neijingSource,
    neijing_interpretation: health.neijingInterpretation,
    neijing_plain: health.neijingPlain || '',
    neijing_action: JSON.stringify(health.neijingAction || []),
    general_yi_food: JSON.stringify(health.generalYi.food),
    general_yi_recipes: JSON.stringify(health.generalYi.recipes || []),
    general_yi_activity: JSON.stringify(health.generalYi.activity),
    general_yi_emotion: JSON.stringify(health.generalYi.emotion),
    general_ji: JSON.stringify(health.generalJi)
  };
}

/**
 * 解析数据库行的 JSON 字段（mysql2 返回的 JSON 字段可能是字符串或已解析对象）
 * @param {object} row 数据库行
 * @returns {object} 解析后的对象
 */
function parseBasicRow(row) {
  const parse = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try { return JSON.parse(v); } catch { return []; }
    }
    return v;
  };
  return {
    index: row.solar_term_index,
    name: row.name,
    wuxing: row.wuxing,
    organ: row.organ,
    season: row.season,
    seasonDesc: row.season_desc || '',
    dateRange: row.date_range || '',
    wuHou: parse(row.wu_hou),
    keywords: parse(row.keywords),
    plainSummary: row.plain_summary || '',
    neijingQuote: row.neijing_quote || '',
    neijingSource: row.neijing_source || '',
    neijingInterpretation: row.neijing_interpretation || '',
    neijingPlain: row.neijing_plain || '',
    neijingAction: parse(row.neijing_action),
    generalYi: {
      food: parse(row.general_yi_food),
      recipes: parse(row.general_yi_recipes),
      activity: parse(row.general_yi_activity),
      emotion: parse(row.general_yi_emotion)
    },
    generalJi: parse(row.general_ji)
  };
}

/**
 * 根据卦格名查找卦格数据（id, name, wuxing, gua_ge, full_name）
 * @param {string} guaGe 卦格名，如 "飞龙格"
 * @returns {object|null}
 */
function findGuaByGe(guaGe) {
  for (const [, gua] of Object.entries(HEXAGRAMS)) {
    if (gua.gua_ge === guaGe) {
      return {
        id: gua.id,
        name: gua.name,
        full_name: gua.full_name,
        wuxing: gua.wuxing,
        gua_ge: gua.gua_ge
      };
    }
  }
  return null;
}

/**
 * 根据 L2 规则矩阵动态生成卦格×节气关系数据（L3 数据缺失时回退用）
 * @param {string} guaWuxing 卦格五行
 * @param {string} termWuxing 节气五行
 * @returns {object} 关系数据
 */
function buildRelationFromL2(guaWuxing, termWuxing) {
  const key = `${guaWuxing}-${termWuxing}`;
  const relation = WUXING_RELATION[key];
  if (!relation) return null;
  const strategy = RELATION_TYPE_STRATEGY[relation.type] || {};
  return {
    element_interaction: relation.title,
    relation_type: relation.type,
    corresponding_organ: relation.guaOrgan && relation.termOrgan
      ? `${relation.guaOrgan}·${relation.termOrgan}` : '',
    warning: relation.warning || '',
    principle: relation.principle || '',
    strategy: relation.strategy || [],
    classic_quote: strategy.classicQuote || '',
    classic_source: strategy.classicSource || '',
    classic_interpretation: strategy.desc || ''
  };
}

// ==================== 路由 ====================

/**
 * GET /api/solar-term/current
 * 当前节气基础信息（L1，无需登录）
 * 返回：节气基本信息 + 物候 + 关键词 + 内经原文 + 通用宜忌 + 季节总纲
 */
router.get('/current', async (req, res) => {
  try {
    // 获取当前节气（含天数）
    const { name: jieQiName, daysIn } = getCurrentJieQiInfo();
    const index = getJieQiIndex(jieQiName);
    if (index < 0) {
      return res.status(500).json({ success: false, code: 'JIE_QI_NOT_FOUND', message: '节气计算异常' });
    }

    // v20 lang=en：L1 直接读英文静态文件（结构与中文响应一致，缺失降级中文）
    if (req.query.lang === 'en') {
      const h = JIE_QI_HEALTH_EN_ARR.find(x => x.index === index);
      if (h) {
        const wuxingInfoEn = WUXING_ORGAN_MAP_EN[h.wuxing] || null;
        return res.json({
          success: true,
          data: { ...h, daysIn, wuxingInfo: toWuxingInfoEn(wuxingInfoEn, h.wuxing) }
        });
      }
    }

    // 优先从数据库查询 L1 数据
    let row = null;
    try {
      const [rows] = await db.query(
        'SELECT * FROM solar_term_basic WHERE solar_term_index = ? LIMIT 1',
        [index]
      );
      if (rows.length > 0) row = rows[0];
    } catch (dbErr) {
      // 表可能未创建，回退到配置文件
      console.warn('[solar-term] solar_term_basic 表查询失败，回退到配置文件:', dbErr.message);
    }

    // 数据库无数据则从配置文件构建
    if (!row) {
      row = buildBasicFromConfig(index);
      if (!row) {
        return res.status(404).json({ success: false, code: 'JIE_QI_DATA_MISSING', message: '节气数据未配置' });
      }
    }

    const basic = parseBasicRow(row);

    // 附加节气五行归属详情
    const wuxingInfo = WUXING_ORGAN_MAP[basic.wuxing] || null;

    res.json({
      success: true,
      data: {
        ...basic,
        daysIn,
        wuxingInfo
      }
    });
  } catch (err) {
    console.error('[solar-term/current] 错误:', err.message);
    res.status(500).json({ success: false, code: 'SERVER_ERROR', message: '服务器内部错误' });
  }
});

/**
 * GET /api/solar-term/advice?gua_ge=飞龙格
 * 卦格专属养生建议（L3，需登录，全免费）
 * 查询参数：gua_ge - 卦格名（必填，如 "飞龙格"）
 *
 * 返回逻辑：
 *   - 所有已登录用户：返回完整建议（推荐饮食/活动/情志、禁忌、经典原文）
 *   - L3 数据未生成时：用 L2 规则矩阵动态生成基础建议
 */
router.get('/advice', verifyToken, async (req, res) => {
  try {
    const { gua_ge } = req.query;
    if (!gua_ge) {
      return res.status(400).json({ success: false, code: 'PARAM_MISSING', message: '缺少 gua_ge 参数' });
    }

    // 查找卦格数据
    const gua = findGuaByGe(gua_ge);
    if (!gua) {
      return res.status(404).json({ success: false, code: 'GUA_NOT_FOUND', message: `未找到卦格：${gua_ge}` });
    }

    // 获取当前节气
    const jieQiName = getCurrentJieQiName();
    const termIndex = getJieQiIndex(jieQiName);
    if (termIndex < 0) {
      return res.status(500).json({ success: false, code: 'JIE_QI_NOT_FOUND', message: '节气计算异常' });
    }

    const termWuxing = JIE_QI_WUXING.find(w => w.index === termIndex);
    if (!termWuxing) {
      return res.status(500).json({ success: false, code: 'JIE_QI_WUXING_MISSING', message: '节气五行配置缺失' });
    }

    // 查询 L3 卦格专属建议（优先已审核 status=1）
    let l3Row = null;
    try {
      const [rows] = await db.query(
        'SELECT * FROM solar_term_health_advice WHERE solar_term_index = ? AND gua_index = ? AND status = 1 LIMIT 1',
        [termIndex, gua.id]
      );
      if (rows.length > 0) l3Row = rows[0];
    } catch (dbErr) {
      // 表可能未创建，回退到 L2 规则矩阵
      console.warn('[solar-term/advice] solar_term_health_advice 表查询失败，回退到 L2:', dbErr.message);
    }

    // v20 lang=en：英文静态文件（L3 优先 solar-advice-en，L2 用 wuxing-relation-en）
    const langEn = req.query.lang === 'en';
    const l3En = (langEn && L3_ADVICE_EN) ? L3_ADVICE_EN[`${termIndex}-${gua.id}`] : null;
    const relationEn = langEn ? (WUXING_RELATION_EN[`${gua.wuxing}-${termWuxing.wuxing}`] || null) : null;
    const strategyEn = relationEn ? (RELATION_TYPE_STRATEGY_EN[relationEn.type] || {}) : {};
    const guaEn = langEn ? (HEXAGRAMS_EN[gua.id] || {}) : {};
    const termEn = langEn ? (JIE_QI_WUXING_EN.find(w => w.index === termIndex) || {}) : {};

    // 构建关系数据（L3 优先，L2 回退）
    const relation = buildRelationFromL2(gua.wuxing, termWuxing.wuxing);
    if (!relation) {
      return res.status(500).json({ success: false, code: 'RELATION_MISSING', message: '五行关系配置缺失' });
    }

    // 节气基础信息（精简）
    const termBasic = langEn ? {
      index: termIndex,
      name: termEn.nameEn || jieQiName,
      wuxing: WUXING_EN[termWuxing.wuxing] || termWuxing.wuxing,
      organ: ORGAN_EN[termWuxing.organ] || termWuxing.organ,
      season: SEASON_EN[termWuxing.season] || termWuxing.season,
      dateRange: termEn.dateRange || termWuxing.dateRange
    } : {
      index: termIndex,
      name: jieQiName,
      wuxing: termWuxing.wuxing,
      organ: termWuxing.organ,
      season: termWuxing.season,
      dateRange: termWuxing.dateRange
    };

    // 卦格基础信息
    const guaInfo = langEn ? {
      id: gua.id,
      name: guaEn.name || gua.name,
      full_name: guaEn.name || gua.full_name,
      gua_ge: guaEn.gua_ge || gua.gua_ge,
      wuxing: WUXING_EN[gua.wuxing] || gua.wuxing
    } : {
      id: gua.id,
      name: gua.name,
      full_name: gua.full_name,
      gua_ge: gua.gua_ge,
      wuxing: gua.wuxing
    };

    // 组装返回数据
    const baseData = {
      term: termBasic,
      gua: guaInfo,
      relation: langEn ? {
        type: relationEn ? (relationEn.typeEn || relationEn.type) : relation.relation_type,
        title: relationEn ? relationEn.title : relation.element_interaction,
        correspondingOrgan: relationEn
          ? [relationEn.guaOrgan, relationEn.termOrgan].filter(Boolean).map(o => ORGAN_EN[o] || o).join(' · ')
          : relation.corresponding_organ,
        warning: relationEn ? relationEn.warning : relation.warning,
        principle: relationEn ? relationEn.principle : relation.principle
      } : {
        type: relation.relation_type,
        title: relation.element_interaction,
        correspondingOrgan: relation.corresponding_organ,
        warning: relation.warning,
        principle: relation.principle
      }
    };

    if (l3Row) {
      // L3 数据存在，返回完整内容
      const parse = (v) => {
        if (!v) return [];
        if (Array.isArray(v)) return v;
        if (typeof v === 'string') {
          try { return JSON.parse(v); } catch { return []; }
        }
        return v;
      };

      const useEn = langEn && l3En;
      baseData.relation.warning = useEn ? (l3En.warning || relationEn.warning || relation.warning) : (l3Row.warning || relation.warning);
      if (useEn && relationEn && relationEn.principle) baseData.relation.principle = relationEn.principle;

      const detail = useEn ? {
        recommendFood: l3En.recommendFood || [],
        recommendActivity: l3En.recommendActivity || [],
        recommendEmotion: l3En.recommendEmotion || [],
        recommendAvoid: l3En.recommendAvoid || [],
        classicQuote: l3En.classicQuote || '',
        classicSource: l3En.classicSource || '',
        classicInterpretation: l3En.classicInterpretation || ''
      } : {
        recommendFood: parse(l3Row.recommend_food),
        recommendActivity: parse(l3Row.recommend_activity),
        recommendEmotion: parse(l3Row.recommend_emotion),
        recommendAvoid: parse(l3Row.recommend_avoid),
        classicQuote: l3Row.classic_quote || '',
        classicSource: l3Row.classic_source || '',
        classicInterpretation: l3Row.classic_interpretation || ''
      };

      return res.json({ success: true, data: { ...baseData, detail } });
    } else {
      // L3 数据未生成，用 L2 规则矩阵返回基础建议
      const detail = langEn ? {
        recommendFood: [],
        recommendActivity: relationEn ? (relationEn.strategy || []) : (relation.strategy || []),
        recommendEmotion: [],
        recommendAvoid: [],
        classicQuote: strategyEn.classicQuote || relation.classic_quote,
        classicSource: strategyEn.classicSource || relation.classic_source,
        classicInterpretation: strategyEn.desc || relation.classic_interpretation
      } : {
        recommendFood: [],
        recommendActivity: relation.strategy || [],
        recommendEmotion: [],
        recommendAvoid: [],
        classicQuote: relation.classic_quote,
        classicSource: relation.classic_source,
        classicInterpretation: relation.classic_interpretation
      };
      return res.json({
        success: true,
        data: {
          ...baseData,
          detail,
          source: 'L2_FALLBACK',
          hint: langEn
            ? 'Personal advice for your hexagram pattern is being generated — showing general Five-Element guidance for now.'
            : '卦格专属建议生成中，当前展示五行关系通用建议'
        }
      });
    }
  } catch (err) {
    console.error('[solar-term/advice] 错误:', err.message);
    res.status(500).json({ success: false, code: 'SERVER_ERROR', message: '服务器内部错误' });
  }
});

/**
 * GET /api/solar-term/all
 * 24 节气列表（无需登录）
 * 返回精简字段：index, name, wuxing, organ, season, dateRange
 */
router.get('/all', async (req, res) => {
  try {
    // v20 lang=en：直接从英文静态文件构建（键为中文，输出时映射英文）
    if (req.query.lang === 'en') {
      const listEn = JIE_QI_WUXING_EN.map(w => ({
        index: w.index,
        name: w.nameEn || w.name,
        wuxing: WUXING_EN[w.wuxing] || w.wuxing,
        organ: ORGAN_EN[w.organ] || w.organ,
        season: SEASON_EN[w.season] || w.season,
        dateRange: w.dateRange || ''
      }));
      return res.json({ success: true, data: listEn });
    }

    // 优先从数据库查询
    let rows = [];
    try {
      const [dbRows] = await db.query(
        'SELECT solar_term_index, name, wuxing, organ, season, date_range FROM solar_term_basic ORDER BY solar_term_index'
      );
      if (dbRows.length === 24) rows = dbRows;
    } catch (dbErr) {
      console.warn('[solar-term/all] solar_term_basic 表查询失败，回退到配置文件:', dbErr.message);
    }

    // 数据库数据不全则从配置文件构建
    if (rows.length < 24) {
      const list = JIE_QI_WUXING.map(w => ({
        index: w.index,
        name: w.name,
        wuxing: w.wuxing,
        organ: w.organ,
        season: w.season,
        dateRange: w.dateRange
      }));
      return res.json({ success: true, data: list });
    }

    const list = rows.map(r => ({
      index: r.solar_term_index,
      name: r.name,
      wuxing: r.wuxing,
      organ: r.organ,
      season: r.season,
      dateRange: r.date_range || ''
    }));

    res.json({ success: true, data: list });
  } catch (err) {
    console.error('[solar-term/all] 错误:', err.message);
    res.status(500).json({ success: false, code: 'SERVER_ERROR', message: '服务器内部错误' });
  }
});

module.exports = router;
