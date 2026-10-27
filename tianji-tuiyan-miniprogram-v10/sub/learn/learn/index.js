const api = require('../../../utils/api.js');
const soundManager = require('../../../utils/audio.js');
const shareUtil = require('../../../utils/share.js');
const i18n = require('../../../utils/i18n.js');

Page({
  data: {
    activeTab: 0,
    guaList: [],
    showGuaModal: false,
    modalGua: {},
    compassSize: 580,
    showRingModal: false,
    ringDetail: {},
    // [NEW] 收集系统
    collectedMap: {},
    collectionCount: 0,
    achievementUnlocked: false,
    completionOrder: null,
    showWelcomePopup: false,
    welcomeGua: {},
    countBouncing: false,
    newCardCount: 0,
    // v2.0 罗盘交互引导
    showCompassGuide: false,
    t: {},
    countRemainText: ''
  },

  onLoad() {
    soundManager.init();
    this.applyI18n();
    this.loadGuaList();
    this._setCompassSize();
  },

  applyI18n() {
    const dict = i18n.page('learn');
    const remain = 64 - (this.data.collectionCount || 0);
    const countRemainText = remain > 0
      ? i18n.fill(dict.collectRemain || '还差 {n} 张', { n: remain })
      : '';
    this.setData({ t: dict, countRemainText: countRemainText });
  },

  _setCompassSize() {
    // 🔴 v3.5 迁移：getWindowInfo 取代 getSystemInfoSync 取 windowWidth/Height
    var winW = 375, winH = 667;
    try {
      var winInfo = wx.getWindowInfo();
      winW = winInfo.windowWidth || 375;
      winH = winInfo.windowHeight || 667;
    } catch (e) {
      var sysInfo = wx.getSystemInfoSync();
      winW = sysInfo.windowWidth || 375;
      winH = sysInfo.windowHeight || 667;
    }
    var rpxRatio = winW / 750;
    var availWRpx = 710;
    var availHRpx = (winH / rpxRatio) - 100 - 80 - 48;
    // 外环半径 = size * 0.68，元素需完全可见，所以乘以较小系数
    var size = Math.floor(Math.min(availWRpx, availHRpx) * 1.65);
    this.setData({ compassSize: size });
  },

  async onShow() {

    i18n.applyNavTitle('sub/learn/learn/index');
    this.setData({ lang: i18n.getLang() });
    this.applyI18n();
    if (this.data.guaList.length === 0) {
      this.loadGuaList();
    }
    // 等待登录完成后刷新收集状态（包含collectedMap映射）
    const app = getApp();
    if (app.globalData.loginPromise) {
      await app.globalData.loginPromise;
    }
    await this.loadCollection();
    await this.checkAchievement();
    this.checkWelcomePopup();
  },

  switchTab(e) {
    const tab = parseInt(e.currentTarget.dataset.tab, 10);
    this.setData({ activeTab: tab });
    // 切换到64种人格Tab，清除新卡角标
    if (tab === 0 && this.data.newCardCount > 0) {
      wx.setStorageSync('last_viewed_collection_count', this.data.collectionCount);
      this.setData({ newCardCount: 0 });
    }
    // v2.0 首次切换到奇门遁甲Tab，显示罗盘交互引导
    if (tab === 1 && !wx.getStorageSync('compass_guide_shown')) {
      setTimeout(() => {
        this.setData({ showCompassGuide: true });
      }, 500);
    }
  },

  // v2.0 关闭罗盘交互引导
  onCloseCompassGuide() {
    wx.setStorageSync('compass_guide_shown', true);
    this.setData({ showCompassGuide: false });
  },

  // 五行转拼音（WXSS不支持中文类名；兼容后端中/英文 wuxing 字段）
  wuxingToPinyin(wuxing) {
    const map = {
      '金': 'jin', '木': 'mu', '水': 'shui', '火': 'huo', '土': 'tu',
      'Metal': 'jin', 'Wood': 'mu', 'Water': 'shui', 'Fire': 'huo', 'Earth': 'tu',
      'metal': 'jin', 'wood': 'mu', 'water': 'shui', 'fire': 'huo', 'earth': 'tu'
    };
    return map[wuxing] || 'jin';
  },

  async loadGuaList() {
    try {
      const lang = i18n.isEn() ? 'en' : 'zh';
      const res = await api.request('/api/gua/list?lang=' + encodeURIComponent(lang), 'GET');
      if (res.success && res.data) {
        // 平铺数组，4列由CSS Grid处理
        const list = res.data.map(item => ({
          ...item,
          wuxingClass: this.wuxingToPinyin(item.wuxing)
        }));
        this.setData({ guaList: list });
      }
    } catch (e) { console.error('loadGuaList:', e); }
  },

  // [NEW] 加载收集状态
  async loadCollection() {
    try {
      const app = getApp();
      const openid = app.globalData.openid;
      if (!openid) return;
      const res = await api.request(
        '/api/user/gua-collection/' + encodeURIComponent(openid),
        'GET'
      );
      if (res.success && res.data) {
        const map = {};
        for (const item of res.data.collected) {
          map[item.gua_id] = true;
        }
        const total = res.data.total || 0;
        this.setData({
          collectedMap: map,
          collectionCount: total
        });
        // 新卡角标计算
        const lastViewed = wx.getStorageSync('last_viewed_collection_count') || 0;
        const newCount = Math.max(0, total - lastViewed);
        if (this.data.activeTab === 0 && newCount > 0) {
          // 已在64种人格Tab，视为已查看
          wx.setStorageSync('last_viewed_collection_count', total);
          this.setData({ newCardCount: 0 });
        } else {
          this.setData({ newCardCount: newCount });
        }
      }
    } catch (e) { console.error('loadCollection:', e); }
  },

  // [NEW] 快速检查收集数量和成就状态
  async checkAchievement() {
    try {
      const app = getApp();
      const openid = app.globalData.openid;
      if (!openid) return;
      const res = await api.request(
        '/api/user/gua-collection/count/' + encodeURIComponent(openid),
        'GET'
      );
      if (res.success && res.data) {
        const prev = this.data.collectionCount;
        this.setData({
          collectionCount: res.data.total,
          achievementUnlocked: res.data.achievementUnlocked,
          completionOrder: res.data.completionOrder
        });
        // 数量增加时触发弹跳动画
        if (res.data.total > prev && prev > 0) {
          this.setData({ countBouncing: true });
          setTimeout(() => { this.setData({ countBouncing: false }); }, 180);
        }
      }
    } catch (e) { console.error('checkAchievement:', e); }
  },

  // [NEW] 首次进入知识库欢迎弹窗
  checkWelcomePopup() {
    const app = getApp();
    if (app.globalData.hasProfile && !wx.getStorageSync('collection_welcome_shown')) {
      wx.setStorageSync('collection_welcome_shown', true);
      const p = app.globalData.profile;
      this.setData({
        showWelcomePopup: true,
        welcomeGua: {
          full_name: p.gua_ge_name || '',
          gua_ge: p.gua_ge || ''
        }
      });
    }
  },

  // [NEW] 收集进度条点击
  onCollectionTap() {
    if (this.data.achievementUnlocked && this.data.collectionCount >= 64) {
      soundManager.play('click');
      wx.navigateTo({
        url: '/sub/learn/achievement/index?order=' + (this.data.completionOrder || '')
      });
    }
  },

  // [NEW] 关闭欢迎弹窗
  onCloseWelcome() {
    this.setData({ showWelcomePopup: false });
  },

  async onGuaTap(e) {
    const item = e.currentTarget.dataset.item;
    if (item && item.id) {
      // 未收集的人格类型 → 提示
      if (!this.data.collectedMap[item.id]) {
        const dict = i18n.page('learn');
        wx.showToast({
          title: dict.tipCollectInMatch || '请在易缘匹配中收集性格卡牌',
          icon: 'none',
          duration: 2000
        });
        return;
      }
      // 已收集 → 打开详情弹窗
      try {
        const lang = i18n.isEn() ? 'en' : 'zh';
        const res = await api.request('/api/gua/' + item.id + '?lang=' + encodeURIComponent(lang), 'GET');
        if (res.success && res.data) {
          this.setData({ showGuaModal: true, modalGua: res.data });
        }
      } catch (err) {
        console.error('onGuaTap:', err);
        this.setData({ showGuaModal: true, modalGua: item });
      }
    }
  },

  // 罗盘环点击 → 弹出详情
  onRingTap(e) {
    soundManager.play('click');
    const detail = e.detail.detail || {};
    if (detail.title) {
      this.setData({ showRingModal: true, ringDetail: detail });
    }
  },

  hideGuaModal() { this.setData({ showGuaModal: false }); },
  hideRingModal() { this.setData({ showRingModal: false }); },
  stop() {},
  // v2.0 阻止弹窗穿透的空函数
  noop() {},
  onShareAppMessage() {
    const dict = i18n.page('learn');
    return {
      title: dict.learnShareTitle || '天机推演 - 易学知识库',
      path: '/sub/learn/learn/index',
      imageUrl: ''
    };
  },

  // 🔴 v3.5 新增：分享到朋友圈
  onShareTimeline() {
    const dict = i18n.page('learn');
    return {
      title: dict.learnShareTitle || '天机推演 - 易学知识库',
      query: '',
      imageUrl: ''
    };
  },

  // App端分享按钮点击：分享 H5 官网链接（替代小程序卡片）
  onShareTap() {
    const shareInfo = this.onShareAppMessage();
    shareUtil.shareWebPageMessage({
      webpageUrl: shareUtil.H5_WEB_BASE,
      title: shareInfo.title,
      description: shareInfo.description || ''
    });
  }
});
