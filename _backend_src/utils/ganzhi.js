// utils/ganzhi.js - 天干地支计算（v9 精确版）
// P2修复：年柱按立春切换，节气用lunar-javascript精确计算

const TIAN_GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

// 地支序数（子=1, 丑=2, ... 亥=12）
function diZhiNum(dz) {
  const idx = DI_ZHI.indexOf(dz);
  return idx >= 0 ? idx + 1 : 0;
}

// 获取立春的精确日期和时间（使用lunar-javascript）
function getLiChunDate(year) {
  try {
    const { Solar } = require('lunar-javascript');
    // 立春通常在2月3-5日之间，用lunar-javascript精确获取
    // 遍历2月1-10日找到立春
    for (let day = 1; day <= 10; day++) {
      const solar = Solar.fromYmd(year, 2, day);
      const lunar = solar.getLunar();
      const jieQi = lunar.getJieQi();
      if (jieQi === '立春') {
        return new Date(year, 1, day); // month is 0-indexed
      }
    }
  } catch (e) {
    // fallback to approximate date
  }
  return new Date(year, 1, 4); // 默认2月4日
}

// 计算年柱（P2修复：按立春切换）
function getNianZhu(year, month, day) {
  let actualYear = year;
  // 如果传了month和day，检查是否在立春之前
  if (month !== undefined && day !== undefined) {
    const liChun = getLiChunDate(year);
    const inputDate = new Date(year, month - 1, day);
    if (inputDate < liChun) {
      actualYear = year - 1; // 立春前用上一年
    }
  } else if (month === undefined) {
    // 只传year时，用公历年份（向后兼容）
    actualYear = year;
  }
  const ganIdx = ((actualYear - 4) % 10 + 10) % 10;
  const zhiIdx = ((actualYear - 4) % 12 + 12) % 12;
  return TIAN_GAN[ganIdx] + DI_ZHI[zhiIdx];
}

// 计算月柱（使用 lunar-javascript 精确节气月）
function getYueZhu(year, month, day) {
  try {
    const { Solar } = require('lunar-javascript');
    const solar = Solar.fromYmd(year, month, day || 1);
    const lunar = solar.getLunar();
    return lunar.getMonthInGanZhi();
  } catch (e) {
    // fallback: 简化版（基于节气近似）
    const nianGan = (year - 4) % 10;
    const yueGanStart = [2, 4, 6, 8, 10, 12, 14, 16, 18, 0][nianGan];
    const ganIdx = (yueGanStart + month - 1) % 10;
    const zhiIdx = (month + 1) % 12;
    return TIAN_GAN[ganIdx] + DI_ZHI[zhiIdx];
  }
}

// 计算日柱（简化公式，基于已知锚点）
function getRiZhu(year, month, day) {
  const anchor = new Date(2000, 0, 1);
  const target = new Date(year, month - 1, day);
  const days = Math.floor((target - anchor) / (1000 * 60 * 60 * 24));
  const ganIdx = ((days + 4) % 10 + 10) % 10;
  const zhiIdx = ((days + 6) % 12 + 12) % 12;
  return TIAN_GAN[ganIdx] + DI_ZHI[zhiIdx];
}

// 计算时柱（五鼠遁：日上起时法）
// 甲己日起甲子 (0)，乙庚日起丙子 (2)，丙辛日起戊子 (4)，丁壬日起庚子 (6)，戊癸日起壬子 (8)
function getShiZhu(dayGanZhi, shichen) {
  const dayGanIdx = TIAN_GAN.indexOf(dayGanZhi[0]);
  const WU_SHU_DUN = [0, 2, 4, 6, 8, 0, 2, 4, 6, 8];
  const shiGanStart = WU_SHU_DUN[dayGanIdx];
  const shiIdx = diZhiNum(shichen) - 1;
  const ganIdx = (shiGanStart + shiIdx) % 10;
  return TIAN_GAN[ganIdx] + DI_ZHI[shiIdx];
}

// 根据小时判断时辰
function getShiChenByHour(hour) {
  if (hour >= 23 || hour < 1) return '子';
  if (hour < 3) return '丑';
  if (hour < 5) return '寅';
  if (hour < 7) return '卯';
  if (hour < 9) return '辰';
  if (hour < 11) return '巳';
  if (hour < 13) return '午';
  if (hour < 15) return '未';
  if (hour < 17) return '申';
  if (hour < 19) return '酉';
  if (hour < 21) return '戌';
  return '亥';
}

// 判断节气（P2修复：使用lunar-javascript精确计算）
function getJieQi(month, day, year) {
  try {
    const { Solar } = require('lunar-javascript');
    const actualYear = year || new Date().getFullYear();
    const solar = Solar.fromYmd(actualYear, month, day);
    const lunar = solar.getLunar();
    // getPrevJieQi 返回当前日期的上一个节气
    const prev = lunar.getPrevJieQi();
    return prev.getName ? prev.getName() : (typeof prev === 'string' ? prev : '冬至');
  } catch (e) {
    // fallback到固定日期
    return getJieQiFallback(month, day);
  }
}

// 固定日期fallback
function getJieQiFallback(month, day) {
  const jieqi = [
    { name: '小寒', month: 1, day: 5 },
    { name: '大寒', month: 1, day: 20 },
    { name: '立春', month: 2, day: 4 },
    { name: '雨水', month: 2, day: 19 },
    { name: '惊蛰', month: 3, day: 5 },
    { name: '春分', month: 3, day: 21 },
    { name: '清明', month: 4, day: 5 },
    { name: '谷雨', month: 4, day: 20 },
    { name: '立夏', month: 5, day: 5 },
    { name: '小满', month: 5, day: 21 },
    { name: '芒种', month: 6, day: 5 },
    { name: '夏至', month: 6, day: 21 },
    { name: '小暑', month: 7, day: 7 },
    { name: '大暑', month: 7, day: 23 },
    { name: '立秋', month: 8, day: 7 },
    { name: '处暑', month: 8, day: 23 },
    { name: '白露', month: 9, day: 7 },
    { name: '秋分', month: 9, day: 23 },
    { name: '寒露', month: 10, day: 8 },
    { name: '霜降', month: 10, day: 23 },
    { name: '立冬', month: 11, day: 7 },
    { name: '小雪', month: 11, day: 22 },
    { name: '大雪', month: 12, day: 7 },
    { name: '冬至', month: 12, day: 21 },
  ];
  let result = '冬至';
  for (let i = jieqi.length - 1; i >= 0; i--) {
    if (month > jieqi[i].month || (month === jieqi[i].month && day >= jieqi[i].day)) {
      result = jieqi[i].name;
      break;
    }
  }
  return result;
}

// 计算三元（上元/中元/下元）
function getSanYuan(year, month, day) {
  const anchor = new Date(2000, 0, 1);
  const target = new Date(year, month - 1, day);
  const days = Math.floor((target - anchor) / (1000 * 60 * 60 * 24));
  const fuTou = days % 60;
  const yuan = Math.floor((fuTou % 15) / 5);
  return ['上元', '中元', '下元'][yuan];
}

module.exports = {
  TIAN_GAN,
  DI_ZHI,
  diZhiNum,
  getNianZhu,
  getYueZhu,
  getRiZhu,
  getShiZhu,
  getShiChenByHour,
  getJieQi,
  getSanYuan,
};
