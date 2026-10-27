// utils/i18n.js - 轻量双语模块（v19.0 中英双语改造）
// 用法：
//   页面 onShow: this.setData({ t: i18n.page('login'), lang: i18n.getLang(), langLabel: i18n.langLabel() })
//   wxml: {{t.title}}
//   js 中取文案: i18n.page('login').toastPhoneInvalid
//   切换语言: i18n.setLang('en') 后重新 setData 当前页字典
const zh = require('../i18n/zh-CN.js');
const en = require('../i18n/en-US.js');
const env = require('../config/env.js');

const dicts = { zh, en };
const STORAGE_KEY = 'tianji_lang';

// v2.9 渠道默认语言：App 端读取 config/env.js 的 DEFAULT_LANG（google→en，cn→zh）；小程序端固定中文。
// 用户已手动选择过语言则优先用户选择（见下方初始化逻辑）。
let channelDefault = 'zh';
try {
  const app = getApp();
  if (app && app.globalData && app.globalData.isMpWeixin !== undefined) {
    channelDefault = app.globalData.isMpWeixin ? 'zh' : (env.DEFAULT_LANG || 'zh');
  }
} catch (e) { /* 初始化阶段 getApp 不可用，走下方 storage 逻辑兜底 */ }

// v20 页面导航标题（中文与各页面 json 的 navigationBarTitleText 一致；英文态覆盖）
const NAV_TITLES = {
  'pages/index/index': { zh: '天機推演', en: 'I Ching Insight' },
  'pages/my/index': { zh: '天機推演', en: 'I Ching Insight' },
  'pages/webview/index': { zh: '天机推演', en: 'I Ching Insight' },
  'pages/about/about': { zh: '关于我们', en: 'About Us' },
  'pages/profile/index': { zh: '建立你的专属档案', en: 'Create Your Profile' },
  'pages/result/index': { zh: '推演结果', en: 'Your Insight' },
  'sub/learn/learn/index': { zh: '易学知识库', en: 'I Ching Knowledge Base' },
  'sub/learn/achievement/index': { zh: '震惊三界', en: 'Astounding the Three Realms' },
  'sub/learn/native-gua/index': { zh: '易经人格详情', en: 'Archetype Details' },
  'sub/legal/agreement/index': { zh: '用户服务协议', en: 'User Agreement' },
  'sub/legal/privacy/index': { zh: '隐私保护政策', en: 'Privacy Policy' },
  'sub/match/match-pool/index': { zh: '易缘匹配', en: 'Soul Match' },
  'sub/match/match/index': { zh: '易缘匹配', en: 'Soul Match' },
  'sub/match/my-matches/index': { zh: '易缘传书', en: 'Fate Letters' },
  'sub/match/letter-thread/index': { zh: '信件往来', en: 'Correspondence' },
  'sub/match/letter-write/index': { zh: '写信传情', en: 'Write a Letter' },
  'sub/profile/bind-email/index': { zh: '绑定邮箱', en: 'Bind Email' },
  'sub/profile/edit-profile/index': { zh: '修改档案', en: 'Edit Profile' },
  'sub/vip/vip/index': { zh: '易学会员', en: 'Membership' }
};

// v2.9 默认语言：优先用户手动选择（storage），其次渠道默认（App google→en / cn→zh，小程序→zh）
let current = channelDefault || 'zh';
try {
  const saved = wx.getStorageSync(STORAGE_KEY);
  if (saved === 'en' || saved === 'zh') current = saved;
} catch (e) { /* storage 不可用时用渠道默认 */ }

module.exports = {
  /** 当前语言：'zh' | 'en' */
  getLang() {
    return current;
  },

  isEn() {
    return current === 'en';
  },

  /** 切换语言并持久化；返回切换后的语言 */
  setLang(lang) {
    if (!dicts[lang]) return current;
    current = lang;
    try { wx.setStorageSync(STORAGE_KEY, lang); } catch (e) { /* 忽略存储失败 */ }
    this.updateTabBar();
    return current;
  },

  /** 更新 tabBar 文案（在语言切换后调用） */
  updateTabBar() {
    if (!wx.setTabBarItem) return;
    const tabBar = dicts[current].tabBar || {};
    const items = tabBar.list || [];
    items.forEach(function(item, index) {
      wx.setTabBarItem({ index: index, text: item.text || '' });
    });
  },

  /** 切换按钮显示文案：当前中文显示 EN，当前英文显示 中 */
  langLabel() {
    return current === 'zh' ? dicts.en.common.langSwitchLabel : dicts.zh.common.langSwitchLabel;
  },

  /** 取整页字典，如 i18n.page('login') */
  page(name) {
    const d = dicts[current] || zh;
    return d[name] || {};
  },

  /**
   * v20 应用页面导航标题：按当前语言设置标题（英文态覆盖 json 中文标题，切回中文时恢复）
   * @param {string} pagePath 页面路径，如 'pages/index/index'、'sub/vip/vip/index'
   * @param {string} [overrideTitle] 可选覆盖标题（如 profile 页 fromMatch 场景传 i18n.page('profile').navMatchTitle）
   */
  applyNavTitle(pagePath, overrideTitle) {
    if (!wx.setNavigationBarTitle) return;
    if (overrideTitle) {
      wx.setNavigationBarTitle({ title: overrideTitle });
      return;
    }
    const t = NAV_TITLES[pagePath];
    if (t) wx.setNavigationBarTitle({ title: t[current] || t.zh });
  },

  /** 全局通用文案 */
  common() {
    return this.page('common');
  },

  /** 单条通用文案 */
  t(key) {
    const c = this.common();
    return c[key] !== undefined ? c[key] : key;
  },

  /** 模板填充：i18n.fill('今日剩{n}次', {n: 3}) → '今日剩3次' */
  fill(tpl, params) {
    return String(tpl === undefined || tpl === null ? '' : tpl).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] !== undefined ? params[k] : m;
    });
  }
};
