// src/utils/content-safety.js - AI 输出侧内容安全审核
// [SEC-FIX] P2-7: 对 AI 生成的用户可见文本做硬性合规检查，命中高风险类别则拒绝下发，
// 用于上架审核（App Store / 微信小程序）及平台内容安全要求。
// 注意：关键词保持高置信、低误伤（避免"六合"等占卜术语被误伤），仅覆盖必须拦截的高风险类别。

const UNSAFE_PATTERNS = [
  // 政治敏感与邪教
  { re: /法轮功|天安门事件|六四事件|白纸运动|藏独|疆独|台独|港独|全能神|邪教组织/i, tag: 'political' },
  // 色情露骨
  { re: /色情交易|淫秽|裸聊|约炮|嫖娼|卖淫/i, tag: 'porn' },
  // 毒品
  { re: /冰毒|海洛因|摇头丸|大麻|可卡因|毒品交易|制毒|吸毒/i, tag: 'drug' },
  // 赌博
  { re: /六合彩|百家乐|老虎机|网络赌博|网赌|赌球|博彩投注/i, tag: 'gambling' },
  // 暴恐/武器
  { re: /制造炸弹|枪支买卖|恐怖袭击|圣战|杀人指南/i, tag: 'violence' }
];

/**
 * 检查单段文本是否安全
 * @param {string} text
 * @returns {{ ok: boolean, hit?: string }}
 */
function checkTextSafety(text) {
  if (!text || typeof text !== 'string') return { ok: true };
  for (const p of UNSAFE_PATTERNS) {
    if (p.re.test(text)) return { ok: false, hit: p.tag };
  }
  return { ok: true };
}

/**
 * 检查 AI 输出对象中的用户可见字段是否安全
 * @param {object} data 含 jieDu/panCi/liShiDuiBiao/ziChaoTag/vipText 等字段的对象或字符串
 * @returns {{ ok: boolean, hit?: string }}
 */
function checkOutputSafety(data) {
  const pieces = [];
  if (typeof data === 'string') {
    pieces.push(data);
  } else if (data && typeof data === 'object') {
    for (const k of ['jieDu', 'panCi', 'liShiDuiBiao', 'ziChaoTag', 'vipText', 'vip_decode_text', 'summary', 'text']) {
      if (typeof data[k] === 'string') pieces.push(data[k]);
    }
  }
  const joined = pieces.join('\n');
  if (!joined) return { ok: true };
  return checkTextSafety(joined);
}

module.exports = { checkTextSafety, checkOutputSafety };
