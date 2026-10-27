// src/services/algorithms.js - 梅花易数计算（完整版）
const { HEXAGRAM_TABLE, HEXAGRAM_NAME_TO_ID, HEXAGRAMS } = require('../../config/hexagrams');

/**
 * 八卦数值→名称映射
 * 1=乾, 2=兑, 3=离, 4=震, 5=巽, 6=坎, 7=艮, 8=坤
 */
const BAGUA_NUM_TO_NAME = {
  1: '乾', 2: '兑', 3: '离', 4: '震',
  5: '巽', 6: '坎', 7: '艮', 8: '坤'
};

function mod8(n) {
  const r = n % 8;
  return r === 0 ? 8 : r;
}

/**
 * 地支对应：子=1, 丑=2, 寅=3, 卯=4, 辰=5, 巳=6, 午=7, 未=8, 申=9, 酉=10, 戌=11, 亥=12
 * 年地支数 = (year - 4) % 12 + 1
 */
function getYearDizhiNum(year) {
  return (year - 4) % 12 + 1;
}

/**
 * 易经人格计算
 * 上卦 = mod8(年地支数 + 月 + 日)
 * 下卦 = mod8(年地支数 + 月 + 日 + 时辰)
 * HEXAGRAM_TABLE 索引 = 卦数 - 1
 * @param {number} year - 出生年
 * @param {number} month - 出生月
 * @param {number} day - 出生日
 * @param {number} shichen - 时辰(1-12)
 * @returns {{ id, full_name, gua_ge, renGe, upperName, lowerName, upperNum, lowerNum }}
 */
function calculateGua(year, month, day, shichen) {
  const yearDizhiNum = getYearDizhiNum(year);

  const upperSum = yearDizhiNum + month + day;
  const lowerSum = yearDizhiNum + month + day + shichen;

  const upperNum = mod8(upperSum);
  const lowerNum = mod8(lowerSum);

  const upperName = BAGUA_NUM_TO_NAME[upperNum];
  const lowerName = BAGUA_NUM_TO_NAME[lowerNum];

  // 查 HEXAGRAM_TABLE[upperNum-1][lowerNum-1] → full_name
  const fullName = HEXAGRAM_TABLE[upperNum - 1][lowerNum - 1];

  // 查 HEXAGRAM_NAME_TO_ID 得到 id
  const guaId = HEXAGRAM_NAME_TO_ID[fullName];

  // 查 HEXAGRAMS 得到完整人格信息
  const gua = HEXAGRAMS[fullName];

  return {
    id: guaId,
    full_name: fullName,
    gua_ge: gua ? gua.gua_ge : '',
    renGe: gua ? gua.renGe : '',
    upperName,
    lowerName,
    upperNum,
    lowerNum
  };
}

/**
 * 计算动爻
 * 动爻 = (年地支数 + 月 + 日 + 时辰) % 6 (0取6)
 */
function calculateMovingYao(year, month, day, shichen) {
  const yearDizhiNum = getYearDizhiNum(year);
  const sum = yearDizhiNum + month + day + shichen;
  const r = sum % 6;
  return r === 0 ? 6 : r;
}

/**
 * 获取本卦、互卦、变卦
 */
function getGuaVariations(year, month, day, shichen) {
  const { upperName, lowerName, upperNum, lowerNum, full_name } = calculateGua(year, month, day, shichen);
  const movingYao = calculateMovingYao(year, month, day, shichen);

  return {
    benGua: { upper: upperName, lower: lowerName, fullName: full_name },
    movingYao,
    upperNum,
    lowerNum
  };
}

module.exports = {
  calculateGua,
  calculateMingBenGua: calculateGua,
  calculateMovingYao,
  getGuaVariations,
  mod8
};
