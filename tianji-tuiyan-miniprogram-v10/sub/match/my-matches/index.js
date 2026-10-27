const api = require('../../../utils/api.js');
const soundManager = require('../../../utils/audio.js');
const shareUtil = require('../../../utils/share.js');
const i18n = require('../../../utils/i18n.js'); // v19.2

Page({
  data: {
    pageState: 'loading',
    errorMsg: '',
    friends: [],
    friendCount: 0,
    // v19.2 双语字典
    t: {}
  },

  // v19.2 加载 match 模块双语字典
  applyI18n() {
    const dict = i18n.page('match');
    const state = this.data.pageState;
    const count = this.data.friendCount || 0;
    let titleSubText = '';
    if (state === 'loaded') {
      titleSubText = i18n.fill(dict.friendCountTip || '已有 {n} 位有缘人', { n: count });
    } else {
      titleSubText = dict.titleSubEmpty || '';
    }
    this.setData({ t: dict, titleSubText: titleSubText });
  },

  async onShow() {

    i18n.applyNavTitle('sub/match/my-matches/index');
    this.setData({ lang: i18n.getLang() });
    soundManager.init();
    // v19.2 加载双语字典
    this.applyI18n();
    const app = getApp();
    if (app.globalData.loginPromise) {
      await app.globalData.loginPromise;
    }
    if (app.globalData.token) {
      this.loadFriends();
    } else {
      const t = this.data.t || {};
      this.setData({ pageState: 'error', errorMsg: t.loginFirstReq || '请先登录' });
    }
  },

  async loadFriends() {
    this.setData({ pageState: 'loading' });
    try {
      const res = await api.request('/api/letter/friends' + (i18n.isEn() ? '?lang=en' : ''), 'GET');
      const friends = (res && res.data && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
      if (friends.length) {
        const list = friends.map(item => ({
          matchId: item.matchId || '',
          friendOpenid: item.friendOpenid || '',
          friendNickname: item.friendNickname || (i18n.isEn() ? 'Kindred' : '有缘人'),
          friendGua: item.friendGua || 0,
          friendGuaName: item.friendGuaName || '',
          friendGuaGe: item.friendGuaGe || '',
          friendIsVip: !!item.friendIsVip,
          lastLetter: item.lastLetter || '',
          lastLetterTime: this.formatTime(item.lastLetterTime),
          unreadCount: item.unreadCount || 0,
          avatarChar: (item.friendNickname || '缘').charAt(0),
          // v1.3.1 头像改用本命卦 Unicode 卦符
          guaSymbol: item.friendGua ? String.fromCharCode(0x4DC0 + (item.friendGua - 1)) : ''
        }));
        this.setData({ pageState: 'loaded', friends: list, friendCount: list.length });
        // v19.2 刷新 friendCount 提示
        this.applyI18n();
      } else {
        this.setData({ pageState: 'empty', friends: [], friendCount: 0 });
        this.applyI18n();
      }
    } catch (e) {
      const t = this.data.t || {};
      this.setData({ pageState: 'error', errorMsg: t.loadFail || '加载失败，请检查网络' });
    }
  },

  formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr.replace(/-/g, '/'));
    const now = new Date();
    const diff = now - d;
    const t = this.data.t || {};
    if (diff < 60000) return t.timeJustNow || '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + (t.timeMinAgo || '分钟前');
    if (diff < 86400000) return Math.floor(diff / 3600000) + (t.timeHourAgo || '小时前');
    if (diff < 172800000) return t.timeYesterday || '昨天';
    if (diff < 604800000) return Math.floor(diff / 86400000) + (t.timeDayAgo || '天前');
    const en = i18n.isEn();
    return en ? (d.getMonth() + 1) + '/' + d.getDate() : (d.getMonth() + 1) + '月' + d.getDate() + '日';
  },

  goMatchPool() {
    soundManager.play('click');
    wx.navigateTo({ url: '/sub/match/match-pool/index' });
  },

  onFriendTap(e) {
    soundManager.play('click');
    const item = e.currentTarget.dataset.item;
    if (!item || !item.friendOpenid) return;
    const url = '/sub/match/letter-thread/index?friendOpenid=' + item.friendOpenid
      + '&friendNickname=' + encodeURIComponent(item.friendNickname)
      + '&friendGuaName=' + encodeURIComponent(item.friendGuaName)
      + '&friendGuaGe=' + encodeURIComponent(item.friendGuaGe);
    wx.navigateTo({ url });
  },

  onWriteTap(e) {
    soundManager.play('click');
    const item = e.currentTarget.dataset.item;
    if (!item || !item.friendOpenid) return;
    const url = '/sub/match/letter-write/index?receiverOpenid=' + item.friendOpenid
      + '&receiverNickname=' + encodeURIComponent(item.friendNickname)
      + '&receiverIsVip=' + (item.friendIsVip ? 1 : 0);
    wx.navigateTo({ url });
  },

  retry() {
    soundManager.play('click');
    this.loadFriends();
  },

  onShareAppMessage() {
    return {
      title: i18n.page('match').shareMyMatches,
      path: '/pages/index/index',
      imageUrl: ''
    };
  },

  // App端分享按钮点击（分享 H5 官网链接替代小程序卡片）
  onShareTap() {
    const shareInfo = this.onShareAppMessage();
    shareUtil.shareWebPageMessage({
      webpageUrl: shareUtil.H5_WEB_BASE,
      title: shareInfo.title,
      description: shareInfo.description || ''
    });
  }
});
