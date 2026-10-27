// src/services/qimen.js - 奇门遁甲排盘（标准完整版 v12.1 2026-08-05）
// 标准算法: 定局->排地盘->找旬首->值符随时干->值使随时支->排八神
// v12.1 修复：值符星/值使门改由"时柱旬首"决定（时家奇门标准），原用日柱旬首导致同旬10天内星门完全不变
// v12.0 新增：AI格式化输出函数(formatDiPan/formatBaShenLayout/buildGongCrossReference/formatFullQimenSummary)
// v11.0 新增：八神排盘、日干/时干落宫
const QIMEN = require('../../config/qimen-config');
const ganzhi = require('../../utils/ganzhi');

// 天干地支
const TIAN_GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

// 三奇六仪
const SAN_QI_LIU_YI = ['戊', '己', '庚', '辛', '壬', '癸', '丁', '丙', '乙'];

// 九星原始宫位 (1-9洛书宫)
// 一蓬二芮三冲四辅五禽六心七柱八任九英
const JIU_XING_BY_GONG = [null, '天蓬', '天芮', '天冲', '天辅', '天禽', '天心', '天柱', '天任', '天英'];

// 八门原始宫位 (1-9洛书宫，中5无门=null)
// 一休二死三伤四杜五(无)六开七惊八生九景
const MEN_BY_GONG = [null, '休门', '死门', '伤门', '杜门', null, '开门', '惊门', '生门', '景门'];

// 八神固定顺序（阳遁顺飞、阴遁逆飞）
const BA_SHEN_ORDER = ['值符', '螣蛇', '太阴', '六合', '白虎', '玄武', '九地', '九天'];

// 五鼠遁: 日干 -> 子时天干索引
// 甲己->0(甲), 乙庚->2(丙), 丙辛->4(戊), 丁壬->6(庚), 戊癸->8(壬)
const WU_SHU_DUN = [0, 2, 4, 6, 8, 0, 2, 4, 6, 8];

// 六甲旬首映射: 旬首在60甲子索引 -> 地盘天干
// 甲子旬(0-9)->戊, 甲戌旬(10-19)->己, 甲申旬(20-29)->庚
// 甲午旬(30-39)->辛, 甲辰旬(40-49)->壬, 甲寅旬(50-59)->癸
const XUN_SHOU_TIAN_GAN = {
  0: '戊', 10: '己', 20: '庚', 30: '辛', 40: '壬', 50: '癸'
};

/** 日干支在60甲子中的索引 */
function riZhiIndex(dayGanZhi) {
  const ganIdx = TIAN_GAN.indexOf(dayGanZhi[0]);
  const zhiIdx = DI_ZHI.indexOf(dayGanZhi[1]);
  for (let i = 0; i < 60; i++) {
    if (i % 10 === ganIdx && i % 12 === zhiIdx) return i;
  }
  return -1;
}

/** 找旬首天干 (日干支->六甲旬->地盘天干) */
function findXunShouTianGan(riZhu) {
  const idx = riZhiIndex(riZhu);
  if (idx < 0) return null;
  const xunStart = Math.floor(idx / 10) * 10;
  return XUN_SHOU_TIAN_GAN[xunStart];
}

/** 排地盘三奇六仪
 *  阳遁: 从ju宫起顺排(戊己庚辛壬癸丁丙乙)
 *  阴遁: 从ju宫起逆排(戊己庚辛壬癸丁丙乙)
 */
function paiDiPan(dun, ju) {
  const diPan = {};
  const gongOrder = dun === 1
    ? Array.from({length: 9}, (_, i) => ((ju - 1 + i) % 9) + 1)  // 阳遁顺飞
    : Array.from({length: 9}, (_, i) => ((ju - 1 - i + 9) % 9) + 1);  // 阴遁逆飞
  for (let i = 0; i < 9; i++) {
    diPan[gongOrder[i]] = SAN_QI_LIU_YI[i];
  }
  return diPan;
}

/** 找天干在地盘中的宫位 */
function findGanGong(diPan, gan) {
  for (const [gong, g] of Object.entries(diPan)) {
    if (g === gan) return Number(gong);
  }
  return -1; // 未找到返回-1，与中五宫(5)区分，调用方需处理
}

/** 计算时干 (五鼠遁) */
function getShiGanIndex(dayGanIdx, shiZhiIdx) {
  const ziGan = WU_SHU_DUN[dayGanIdx];
  return (ziGan + shiZhiIdx) % 10;
}

/** 宫位->八卦 */
function gongToGua(gong) {
  const map = {1:'坎', 2:'坤', 3:'震', 4:'巽', 5:'中', 6:'乾', 7:'兑', 8:'艮', 9:'离'};
  return map[gong] || '中';
}

/** 洛书飞宫序列 */
function getGongSequence(dun) {
  return dun === 1
    ? [1, 2, 3, 4, 5, 6, 7, 8, 9]   // 阳遁顺飞
    : [9, 8, 7, 6, 5, 4, 3, 2, 1];  // 阴遁逆飞
}

/** 排八神盘
 *  值符神随值符星落宫，阳遁顺排、阴遁逆排
 *  @param {number} dunNum - 1=阳遁, 2=阴遁
 *  @param {number} zhiFuGong - 值符星最终落宫
 *  @returns {Array<{name, gong}>}
 */
function paiBaShen(dunNum, zhiFuGong) {
  const layout = [];
  const gongSeq = getGongSequence(dunNum);
  const startIdx = gongSeq.indexOf(zhiFuGong === 5 ? 2 : zhiFuGong); // 中五寄坤二

  for (let i = 0; i < 8; i++) {
    const gongIdx = (startIdx + i) % 9;
    const shenOrder = dunNum === 1 ? BA_SHEN_ORDER : ['值符', '九天', '九地', '玄武', '白虎', '六合', '太阴', '螣蛇'];
    layout.push({ name: shenOrder[i], gong: gongSeq[gongIdx] });
  }
  return layout;
}

/** 落宫含义映射（算法层注入） */
const GONG_MEANING = {
  '坎': { wuxing: '水', fangwei: '正北', lingyu: '人际/流动/隐忍', jixiong: '险陷', shiyi: '以柔克刚，顺势而为' },
  '坤': { wuxing: '土', fangwei: '西南', lingyu: '包容/承载/母亲', jixiong: '顺从', shiyi: '厚德载物，稳扎稳打' },
  '震': { wuxing: '木', fangwei: '正东', lingyu: '行动/变革/启动', jixiong: '动荡', shiyi: '果断出击，乘势而上' },
  '巽': { wuxing: '木', fangwei: '东南', lingyu: '沟通/渗透/风动', jixiong: '入', shiyi: '灵活应变，以退为进' },
  '乾': { wuxing: '金', fangwei: '西北', lingyu: '领导/权威/开创', jixiong: '刚健', shiyi: '大展宏图，果断决策' },
  '兑': { wuxing: '金', fangwei: '正西', lingyu: '交流/喜悦/表达', jixiong: '悦', shiyi: '以和为贵，善于沟通' },
  '艮': { wuxing: '土', fangwei: '东北', lingyu: '阻碍/停止/坚守', jixiong: '止', shiyi: '稳守不动，待机而行' },
  '离': { wuxing: '火', fangwei: '正南', lingyu: '展示/光明/依附', jixiong: '丽', shiyi: '光明正大，展现才华' },
  '中': { wuxing: '土', fangwei: '中央', lingyu: '核心/统领/枢纽', jixiong: '中', shiyi: '守正持中，统筹全局' },
};

/** 获取落宫完整描述 */
function getGongFullDesc(gongName) {
  const info = GONG_MEANING[gongName];
  if (!info) return '';
  return `${info.fangwei}·${info.lingyu}`;
}

/** 获取落宫适宜建议 */
function getGongShiYi(gongName) {
  const info = GONG_MEANING[gongName];
  return info ? info.shiyi : '';
}

/** 五行生克 */
function getWuxingRelation(a, b) {
  if (!a || !b) return { rel: '无关', desc: '五行数据不完整' };
  if (a === b) return { rel: '比和', desc: '同频共振，气场相合' };
  const wx = QIMEN.WU_XING;
  if (!wx) return { rel: '无关', desc: '五行配置缺失' };
  if (wx[a]?.sheng === b) return { rel: '我生', desc: '你滋养当前局，付出较多但收获也丰' };
  if (wx[b]?.sheng === a) return { rel: '生我', desc: '当前局滋养你，得天时之助' };
  if (wx[a]?.ke === b) return { rel: '我克', desc: '你掌控当前局，能驾驭但需费力' };
  if (wx[b]?.ke === a) return { rel: '克我', desc: '当前局压制你，需以柔克刚' };
  return { rel: '无关', desc: '五行无直接生克，各自发展' };
}

/**
 * 奇门遁甲完整排盘（标准算法 v11.0）
 *
 * 排盘步骤:
 * 1. 节气+三元 -> 定局(阳/阴遁 + 局数)
 * 2. 排地盘三奇六仪
 * 3. 日干支 -> 日柱旬首（日干为甲时落宫用）；时干支 -> 时柱旬首（v12.1 定值符星/值使门）
 * 4. 时柱旬首宫 -> 原始值符星、原始值使门
 * 5. 值符随时干: 时干在地盘的位置 -> 值符落宫
 * 6. 值使随时支: 从旬首宫起, 飞(时辰-1)步 -> 值使落宫
 * 7. 排八神: 值符神随值符宫, 阳顺阴逆
 * 8. 日干/时干落宫 -> 所临八神
 *
 * @param {number} year - 年
 * @param {number} month - 月
 * @param {number} day - 日
 * @param {number} shichen - 时辰编号 1-12 (子=1,...,亥=12)
 * @param {string} userGuaWuxing - 用户易经人格五行
 */
function calculateQimen(year, month, day, shichen, userGuaWuxing) {
  // 参数验证
  if (!Number.isInteger(shichen) || shichen < 1 || shichen > 12) {
    return { error: '时辰参数无效: ' + shichen + '（应为1-12）' };
  }

  // 1. 节气 + 三元
  const jieQi = ganzhi.getJieQi(month, day, year);
  const sanYuan = ganzhi.getSanYuan(year, month, day);

  // 2. 定局
  const juInfo = QIMEN.JIE_QI_DING_JU[jieQi]?.[sanYuan];
  if (!juInfo) return { error: '节气定局失败: ' + jieQi + '/' + sanYuan };

  const dunNum = juInfo.dun === '阳' ? 1 : 2; // 1=阳遁, 2=阴遁
  const ju = juInfo.ju;
  const dun = juInfo.dun;
  const qimenJuName = dun + '遁' + ju + '局';
  const qimenJuDesc = QIMEN.JU_YI?.[dun]?.[ju]?.desc || '';

  // 3. 排地盘三奇六仪
  const diPan = paiDiPan(dunNum, ju);

  // 4. 日干支 -> 日柱旬首天干 -> 地盘旬首宫（日干为甲时落此）
  const riZhu = ganzhi.getRiZhu(year, month, day);
  if (!riZhu || typeof riZhu !== 'string' || riZhu.length < 2) {
    return { error: '日柱计算失败' };
  }
  const riXunShouTG = findXunShouTianGan(riZhu);
  if (!riXunShouTG) return { error: '日柱旬首定位失败: ' + riZhu };
  const riXunShouGong = findGanGong(diPan, riXunShouTG);
  if (riXunShouGong < 0) return { error: '日柱旬首天干' + riXunShouTG + '未在地盘中找到' };

  // 4b. v12.1 修复：时家奇门标准——值符星/值使门由"时柱旬首"决定
  // 原实现用日柱旬首，导致日柱同旬期间（最长10天）值符星/值使门完全不变，与时辰脱节
  const shichenName = DI_ZHI[shichen - 1];
  const shiZhu = ganzhi.getShiZhu(riZhu, shichenName);
  const xunShouTG = findXunShouTianGan(shiZhu);
  if (!xunShouTG) return { error: '时柱旬首定位失败: ' + shiZhu };
  const xunShouGong = findGanGong(diPan, xunShouTG);
  if (xunShouGong < 0) return { error: '时柱旬首天干' + xunShouTG + '未在地盘中找到' };

  // 中五宫寄坤二宫：奇门遁甲中五宫无门，寄至坤二宫
  const xunShouGongForMen = xunShouGong === 5 ? 2 : xunShouGong;

  // 原始值符星、值使门 = 旬首宫对应的星门
  const zhiFuStarNameOrig = JIU_XING_BY_GONG[xunShouGong];
  const zhiShiMenNameOrig = MEN_BY_GONG[xunShouGongForMen];

  // 5. 值符随时干: 时干在地盘的位置 -> 值符落宫
  const dayGanIdx = TIAN_GAN.indexOf(riZhu[0]);
  if (dayGanIdx < 0) return { error: '日干解析失败: ' + riZhu };
  const shiZhiIdx = shichen - 1; // 子=0, 丑=1, ..., 亥=11
  const shiGanIdx = getShiGanIndex(dayGanIdx, shiZhiIdx);
  const shiGan = TIAN_GAN[shiGanIdx];
  // 甲隐于旬首：时干为甲时值符落于旬首宫，否则查地盘
  const zhiFuFinalGongRaw = shiGan === '甲' ? xunShouGong : findGanGong(diPan, shiGan);
  if (zhiFuFinalGongRaw < 0) return { error: '时干' + shiGan + '未在地盘中找到' };
  const zhiFuFinalGong = zhiFuFinalGongRaw === 5 ? 2 : zhiFuFinalGongRaw; // 中五寄坤二
  const zhiFuStarName = zhiFuStarNameOrig;

  // 6. 值使随时支: 从旬首宫起, 沿飞宫方向飞(时辰-1)步
  const zhuanBu = shichen - 1;
  const gongSeq = getGongSequence(dunNum);
  const menStartGong = xunShouGongForMen;
  const menOrigSeqIdx = gongSeq.indexOf(menStartGong);
  if (menOrigSeqIdx < 0) return { error: '值使门起始宫位异常: ' + menStartGong };
  const menFinalSeqIdx = (menOrigSeqIdx + zhuanBu) % 9;
  let zhiShiFinalGong = gongSeq[menFinalSeqIdx];
  if (zhiShiFinalGong === 5) zhiShiFinalGong = 2; // 落中五宫寄坤二宫
  const zhiShiMenName = zhiShiMenNameOrig;

  // 7. 排八神（v11.0 新增）
  const baShenLayout = paiBaShen(dunNum, zhiFuFinalGong === 5 ? 2 : zhiFuFinalGong);

  // 8. 日干落宫和时干落宫
  const riGan = riZhu[0];
  // 甲隐于旬首：日干为甲时落于日柱旬首宫，否则查地盘
  const riGanGong = riGan === '甲' ? riXunShouGong : findGanGong(diPan, riGan);
  if (riGanGong < 0) return { error: '日干' + riGan + '未在地盘中找到' };
  const shiGanGong = zhiFuFinalGongRaw; // 时干落宫=值符落宫（值符随时干）

  // 日干宫和时干宫所临八神
  const effectiveRiGanGong = riGanGong === 5 ? 2 : riGanGong;
  const effectiveShiGanGong = shiGanGong === 5 ? 2 : shiGanGong;
  const riGanShenEntry = baShenLayout.find(s => s.gong === effectiveRiGanGong);
  const shiGanShenEntry = baShenLayout.find(s => s.gong === effectiveShiGanGong);
  const riGanShenName = riGanShenEntry ? riGanShenEntry.name : '';
  const shiGanShenName = shiGanShenEntry ? shiGanShenEntry.name : '';

  // 9. 详细信息
  const zhiFuStar = QIMEN.JIU_XING[zhiFuStarName] || { luck: '平', meaning: '', wuxing: '土' };
  const zhiShiMen = QIMEN.BA_MEN[zhiShiMenName] || { luck: '平', meaning: '', shiYi: '' };
  const riGanShen = QIMEN.BA_SHEN[riGanShenName] || null;
  const shiGanShen = QIMEN.BA_SHEN[shiGanShenName] || null;

  // 10. 宫位->八卦（中五宫寄坤二宫）
  const zhiFuGongName = gongToGua(zhiFuFinalGong === 5 ? 2 : zhiFuFinalGong);
  const zhiShiGongName = gongToGua(zhiShiFinalGong === 5 ? 2 : zhiShiFinalGong);

  // 11. 五行生克
  const juGong = QIMEN.LUO_SHU[String(ju)] || QIMEN.LUO_SHU['5'];
  const juWuxing = juGong?.wuxing || '土';
  const wuxingRel = getWuxingRelation(userGuaWuxing, juWuxing);

  // 12. 节气含义
  const jieQiMeaning = QIMEN.JIE_QI_MEANING?.[jieQi]?.desc || '';

  return {
    jieQi, sanYuan, dun, ju, qimenJuName, qimenJuDesc,
    jieQiMeaning, // v11.0 新增
    diPan, riZhu, shiZhu, xunShouTG, xunShouGong,
    riXunShouTG, riXunShouGong, // v12.1 新增：日柱旬首（日干为甲落宫用）
    zhiFuGongOriginal: gongToGua(xunShouGong),
    zhiShiMenOriginal: zhiShiMenNameOrig,
    zhiFuStarName,
    zhiFuStarDesc: zhiFuStar.meaning,
    zhiFuStarLuck: zhiFuStar.luck,
    zhiShiMenName,
    zhiShiMenLuck: zhiShiMen.luck,
    zhiShiMenDesc: zhiShiMen.meaning,
    zhiShiMenShiYi: zhiShiMen.shiYi || '',
    zhiFuGongName,
    zhiFuGongDesc: getGongFullDesc(zhiFuGongName),
    zhiFuGongShiYi: getGongShiYi(zhiFuGongName),
    zhiShiGongName,
    zhiShiGongDesc: getGongFullDesc(zhiShiGongName),
    zhiShiGongShiYi: getGongShiYi(zhiShiGongName),
    // 时干时支
    shiGan,
    shiZhi: DI_ZHI[shiZhiIdx],
    wuxingRelation: wuxingRel.rel,
    wuxingRelationDesc: wuxingRel.desc,
    userGuaWuxing,
    juWuxing,
    // v11.0 新增：八神
    baShenLayout,
    // v11.0 新增：日干/时干落宫及所临八神
    riGan, riGanGong,
    riGanShenName,
    riGanShenJiXiong: riGanShen?.jixiong || '',
    riGanShenMeaning: riGanShen?.meaning || '',
    riGanShenDesc: riGanShen?.desc || '',
    riGanShenRole: riGanShen?.role || '',
    shiGan, shiGanGong,
    shiGanShenName,
    shiGanShenJiXiong: shiGanShen?.jixiong || '',
    shiGanShenMeaning: shiGanShen?.meaning || '',
    shiGanShenDesc: shiGanShen?.desc || '',
    shiGanShenRole: shiGanShen?.role || ''
  };
}

// ==================== AI格式化输出函数 (v12.0) ====================

const GONG_NAMES = {1:'坎',2:'坤',3:'震',4:'巽',5:'中',6:'乾',7:'兑',8:'艮',9:'离'};
const GONG_WUXING = {1:'水',2:'土',3:'木',4:'木',5:'土',6:'金',7:'金',8:'土',9:'火'};
const GONG_FANGWEI = {1:'正北',2:'西南',3:'正东',4:'东南',5:'中央',6:'西北',7:'正西',8:'东北',9:'正南'};

/** 格式化地盘三奇六仪分布 */
function formatDiPan(diPan) {
  const lines = [];
  for (let g = 1; g <= 9; g++) {
    const gan = diPan[g];
    if (gan == null) continue;
    const ganInfo = QIMEN.SAN_QI_LIU_YI[gan] || {};
    lines.push(`宫${g}(${GONG_NAMES[g]}·${GONG_FANGWEI[g]}·${GONG_WUXING[g]}): ${gan}[${ganInfo.category || ''}] - ${ganInfo.meaning || ''}`);
  }
  return lines.join('\n');
}

/** 格式化全盘八神分布 */
function formatBaShenLayout(baShenLayout) {
  if (!baShenLayout || !baShenLayout.length) return '';
  return baShenLayout.map(s => {
    const info = QIMEN.BA_SHEN[s.name] || {};
    return `${s.name}(${info.jixiong || ''})落${GONG_NAMES[s.gong] || '?'}宫·${GONG_WUXING[s.gong] || ''}·${info.meaning || ''}`;
  }).join('\n');
}

/** 构建九宫交叉引用（每宫汇总地盘/八神/旬首/日干/时干） */
function buildGongCrossReference(qimenResult) {
  const lines = [];
  for (let g = 1; g <= 9; g++) {
    const parts = [];
    const gan = qimenResult.diPan[g];
    if (gan) {
      const ganInfo = QIMEN.SAN_QI_LIU_YI[gan] || {};
      parts.push(`地盘:${gan}(${ganInfo.meaning || ''})`);
    }
    // v15.0: 九宫全盘不再列出每宫八神（八神只在日干/时干所临处单独展示，避免AI重复提及无关八神）
    if (qimenResult.xunShouGong === g || (g === 2 && qimenResult.xunShouGong === 5)) parts.push('【旬首落此】');
    if (qimenResult.riGanGong === g || (g === 2 && qimenResult.riGanGong === 5)) {
      parts.push(`日干${qimenResult.riGan}落此`);
    }
    if (qimenResult.shiGanGong === g || (g === 2 && qimenResult.shiGanGong === 5)) {
      parts.push(`时干${qimenResult.shiGan}落此(值符)`);
    }
    lines.push(`宫${g}(${GONG_NAMES[g]}·${GONG_WUXING[g]}): ${parts.join(' | ') || '(空)'}`);
  }
  return lines.join('\n');
}

/** 一键生成所有AI格式化文本 */
function formatFullQimenSummary(qimenResult) {
  return {
    diPanFormatted: formatDiPan(qimenResult.diPan),
    baShenFormatted: formatBaShenLayout(qimenResult.baShenLayout),
    gongCrossReference: buildGongCrossReference(qimenResult),
    xunShouDesc: `旬首${qimenResult.xunShouTG}落${GONG_NAMES[qimenResult.xunShouGong] || '?'}宫(${GONG_WUXING[qimenResult.xunShouGong] || '?'})`,
    riGanDesc: `日干${qimenResult.riGan}落${GONG_NAMES[qimenResult.riGanGong === 5 ? 2 : qimenResult.riGanGong] || '?'}宫，所临八神：${qimenResult.riGanShenName}`,
    shiGanDesc: `时干${qimenResult.shiGan}落${GONG_NAMES[qimenResult.shiGanGong === 5 ? 2 : qimenResult.shiGanGong] || '?'}宫，所临八神：${qimenResult.shiGanShenName}`,
    shiZhuDesc: `时柱${qimenResult.shiGan}${qimenResult.shiZhi}，时干落${GONG_NAMES[qimenResult.shiGanGong === 5 ? 2 : qimenResult.shiGanGong] || '?'}宫`
  };
}

module.exports = {
  calculateQimen,
  getJiuXingArray: () => Object.entries(QIMEN.JIU_XING).map(([n,i])=>({name:n,...i})),
  getBaMenArray: () => Object.entries(QIMEN.BA_MEN).map(([n,i])=>({name:n,...i})),
  getWuxingRelation,
  formatDiPan, formatBaShenLayout, buildGongCrossReference, formatFullQimenSummary,
  paiDiPan, findXunShouTianGan, findGanGong, getShiGanIndex
};
