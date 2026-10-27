/**
 * pages/my/index.js - 我的页面
 */
const api = require('../../utils/api.js');
const storage = require('../../utils/storage.js');
const soundManager = require('../../utils/audio.js');
const rewardAd = require('../../utils/rewardAd.js');
const i18n = require('../../utils/i18n.js'); // v19.1 双语

Page({
  data: {
    t: i18n.page('my'), // v19.1 页面文案字典（data 初始化，避免首帧空白）
    lang: i18n.getLang(),
    statusBarHeight: 20,
    pageState: 'loading',
    errorMsg: '',
    profile: {},
    hasCollectionTitle: false,
    collectionTitle: '',
    newCardCount: 0,
    newMatchCount: 0,
    unreadLetterCount: 0,
    isLoggedIn: false,
    isApp: false,
    // v17.0 积分体系
    points: 0,
    todayCheckedIn: false,
    checkinStreak: 0,
    extraVipDecode: 0,
    isMpWeixin: false,
    // v17.1 签到弹窗
    showCheckinModal: false,
    checkinModalPlan: 'free',
    checkinTodayLabel: '',
    checkinLevelTitle: '',
    checkinLevelSub: '',
    checkinRightsTitle: '',
    checkinDays: [],
    checkinToBonus: 7,
    hasPromptedCheckin: false,
    showLanguagePicker: false
  },

  async onShow() {

    i18n.applyNavTitle('pages/my/index');
    // 🔴 v3.5 迁移：getWindowInfo 取代 getSystemInfoSync 取 statusBarHeight
    let statusBarHeight = 20;
    try {
      statusBarHeight = wx.getWindowInfo().statusBarHeight || 20;
    } catch (e) {
      statusBarHeight = (wx.getSystemInfoSync() || {}).statusBarHeight || 20;
    }
    this.setData({ statusBarHeight: statusBarHeight });
    soundManager.init();
    
    // 检测登录状态和 APP 环境
    const app = getApp();
    const isLoggedIn = !!(app.globalData.openid && app.globalData.token);
    const isApp = !app.globalData.isMpWeixin;
    // v17.0：激励视频广告仅微信小程序端支持
    this.setData({ isLoggedIn, isApp, isMpWeixin: !!app.globalData.isMpWeixin });
    
    // 等待登录完成后再加载数据
    if (app.globalData.loginPromise) {
      await app.globalData.loginPromise;
      // 登录完成后重新检查状态
      const loggedIn = !!(app.globalData.openid && app.globalData.token);
      this.setData({ isLoggedIn: loggedIn });
    }
    // v19.1 双语：刷新文案字典与签到派生文案
    this.setData({ t: i18n.page('my'), lang: i18n.getLang() });
    this.refreshCheckinData();
    this.loadProfile();
    this.loadPointsBalance();
  },

  async loadProfile() {
    try {
      const app = getApp();
      const openid = app.globalData.openid;
      // v2.3.5 修正：所有用户均为游客身份，游客可正常浏览"我的"页（无需建档引导）
      if (!openid) {
        this.setData({ pageState: 'loaded', profile: { planType: 'free', quota: 3 } });
        return;
      }

      // 先从全局状态取
      if (app.globalData.hasProfile && app.globalData.profile) {
        const p = app.globalData.profile;
        this.setData({
          pageState: 'loaded',
          profile: {
            gua_name: p.gua_ge_name || '',
            gua_ge: p.gua_ge || '',
            symbol: p.symbol || this.getSymbol(p.ming_ben_gua),
            wuxing: p.wuxing || '',
            wuxingClass: this.wuxingToPinyin(p.wuxing),
            rarity: p.rarity || '',
            planType: p.plan_type || 'free',
            quota: p.quota_remaining !== undefined ? p.quota_remaining : 3,
            email: p.email || ''
          }
        });
        this.checkCollectionTitle(openid);
        this.checkNewMatches(openid);
        this.checkUnreadLetters();
        return;
      }

      // 否则从后端拉取（v19.2 英文态带 lang）
      const result = await api.request('/api/user/profile/' + encodeURIComponent(openid) + (i18n.isEn() ? '?lang=en' : ''), 'GET');
      if (result.success && result.data) {
        app.globalData.hasProfile = true;
        app.globalData.profile = result.data;
        this.setData({
          pageState: 'loaded',
          profile: {
            gua_name: result.data.gua_ge_name || '',
            gua_ge: result.data.gua_ge || '',
            symbol: result.data.symbol || this.getSymbol(result.data.ming_ben_gua),
            wuxing: result.data.wuxing || '',
            wuxingClass: this.wuxingToPinyin(result.data.wuxing),
            rarity: result.data.rarity || '',
            planType: result.data.plan_type || 'free',
            quota: result.data.quota_remaining !== undefined ? result.data.quota_remaining : 3,
            email: result.data.email || ''
          }
        });
        this.checkCollectionTitle(openid);
        this.checkNewMatches(openid);
        this.checkUnreadLetters();
      } else {
        // v2.3.5 接口异常时也正常展示"我的"页（默认免费额度），不再阻塞建档
        this.setData({ pageState: 'loaded', profile: { planType: 'free', quota: 3 } });
      }
    } catch (e) {
      console.error('loadProfile error:', e);
      this.setData({ pageState: 'error' });
    }
  },

  // v17.0 积分余额与签到状态
  async loadPointsBalance() {
    const app = getApp();
    if (!app.globalData.openid || !app.globalData.token) return;
    try {
      const res = await api.requestWithAuth('/api/points/balance', 'GET');
      if (res.success && res.data) {
        app.globalData.points = res.data.points;
        const patch = {
          points: res.data.points || 0,
          todayCheckedIn: !!res.data.todayCheckedIn,
          checkinStreak: res.data.streak || 0,
          extraVipDecode: res.data.extraVipDecode || 0
        };
        this.setData(patch, () => this.refreshCheckinData());
      }
    } catch (e) {
      console.error('loadPointsBalance error:', e);
    }
  },

  // v17.1 签到弹窗：根据当前积分余额与签到状态，计算 7 日连签轨道与免费/VIP 权益文案
  refreshCheckinData() {
    const t = i18n.page('my');
    const planType = (this.data.profile && this.data.profile.planType) || 'free';
    const isVip = planType === 'monthly' || planType === 'yearly';
    const streak = this.data.checkinStreak || 0;
    const todayCheckedIn = !!this.data.todayCheckedIn;

    // 连续签到"当周"已亮格数：已签则今天算一格，否则以已连签的天数计
    const completed = todayCheckedIn ? ((streak - 1) % 7) + 1 : (streak % 7);
    // 距下次"连签7日"大奖还剩几天（达成当天为 0）
    const toBonus = 7 - completed;

    const days = [];
    for (let i = 1; i <= 7; i++) {
      const checked = i <= completed;
      const isToday = todayCheckedIn && i === completed;
      days.push({
        label: i18n.fill(t.dayN, { n: i }),
        checked,
        isToday,
        isBonus: i === 7
      });
    }

    const levelTitle = isVip ? t.levelVip : t.levelFree;
    const levelSub = isVip ? t.levelSubVip : t.levelSubFree;
    const rightsTitle = isVip ? t.rightsVip : t.rightsFree;
    const todayLabel = todayCheckedIn ? t.todaySigned : t.todayUnsigned;

    this.setData({
      checkinModalPlan: isVip ? 'vip' : 'free',
      checkinTodayLabel: todayLabel,
      checkinStatusText: i18n.fill(t.checkinStatus, { s: todayLabel, n: streak }),
      streakText: i18n.fill(t.streakDays, { n: streak }),
      progressLeftText: i18n.fill(t.progressLeft, { n: toBonus }),
      checkinLevelTitle: levelTitle,
      checkinLevelSub: levelSub,
      checkinRightsTitle: rightsTitle,
      checkinDays: days,
      checkinToBonus: toBonus
    });
  },

  // v17.1 打开签到弹窗（允许已签用户回看签到情况与权益）
  openCheckinModal() {
    soundManager.play('click');
    this.refreshCheckinData();
    this.setData({ showCheckinModal: true });
  },

  closeCheckinModal() {
    soundManager.play('click');
    this.setData({ showCheckinModal: false });
  },

  onLanguageTap() {
    this.setData({ showLanguagePicker: true });
  },
  closeLanguagePicker() {
    this.setData({ showLanguagePicker: false });
  },
  selectLanguage(e) {
    const lang = e.currentTarget.dataset.lang;
    if (lang !== i18n.getLang()) {
      i18n.setLang(lang);
      this.setData({ t: i18n.page('my'), lang: i18n.getLang() });
      wx.showToast({ title: i18n.page('my').toastLangSwitched, icon: 'none', duration: 1200 });
    }
    this.setData({ showLanguagePicker: false });
  },

  // 空事件：阻止点击向遮罩穿透
  noop() {},

  // v17.1 弹窗内签到：免费/VIP 通用，签到后留在弹窗内更新成功态
  submitCheckinModal() {
    const t = i18n.page('my');
    if (this.data.todayCheckedIn) {
      wx.showToast({ title: t.toastAlreadyChecked, icon: 'none' });
      return;
    }
    soundManager.play('click');
    api.requestWithAuth('/api/points/checkin', 'POST', {}).then((res) => {
      if (res.success) {
        const app = getApp();
        app.globalData.points = res.data.points;
        this.setData({
          points: res.data.points || 0,
          todayCheckedIn: true,
          checkinStreak: res.data.streak || 0,
          extraVipDecode: res.data.extraVipDecode || 0
        }, () => {
          const gainedList = [];
          const gained = res.data.gained || 0;
          if (gained > 0) gainedList.push('+' + gained + t.pointsUnit);
          if (res.data.isStreakBonus) gainedList.push(t.deepReward);
          wx.showToast({
            title: i18n.fill(t.toastCheckinOk, { g: gainedList.join(' ') || '+10' }),
            icon: 'none'
          });
          this.refreshCheckinData();
        });
      } else {
        wx.showToast({ title: res.message || t.toastCheckinFail, icon: 'none' });
      }
    }).catch((e) => {
      wx.showToast({ title: e.message || t.toastCheckinFail, icon: 'none' });
    });
  },

  // v17.1 顶部签到入口：打开签到弹窗（展示连签情况与免费/VIP 权益）
  onCheckin() {
    this.openCheckinModal();
  },

  // v17.0 看视频得积分（仅微信小程序端）
  onWatchAd() {
    const t = i18n.page('my');
    if (!this.data.isMpWeixin) {
      wx.showToast({ title: t.toastAdUnsupported, icon: 'none' });
      return;
    }
    soundManager.play('click');
    rewardAd.showAndReward(async () => {
      try {
        const res = await api.requestWithAuth('/api/points/ad-reward', 'POST', {});
        if (res.success) {
          const app = getApp();
          app.globalData.points = res.data.points;
          this.setData({ points: res.data.points || 0 });
          wx.showToast({ title: t.toastPlus10, icon: 'none' });
        } else {
          wx.showToast({ title: res.message || t.toastClaimFail, icon: 'none' });
        }
      } catch (e) {
        wx.showToast({ title: e.message || t.toastClaimFail, icon: 'none' });
      }
    });
  },

  getSymbol(guaId) {
    if (!guaId || guaId < 1 || guaId > 64) return '䷀';
    return String.fromCodePoint(0x4DC0 + guaId - 1);
  },

  // 五行中文转拼音（WXSS 不支持中文类名，需用拼音映射）
  wuxingToPinyin(w) {
    const map = { '金': 'jin', '木': 'mu', '水': 'shui', '火': 'huo', '土': 'tu' };
    return map[w] || 'jin';
  },

  // [NEW] 检查收集成就称号 + 新卡角标
  async checkCollectionTitle(openid) {
    try {
      const res = await api.request(
        '/api/user/gua-collection/count/' + encodeURIComponent(openid),
        'GET'
      );
      if (res.success && res.data) {
        const total = res.data.total || 0;
        const lastViewed = wx.getStorageSync('last_viewed_collection_count') || 0;
        const newCount = Math.max(0, total - lastViewed);
        if (res.data.achievementUnlocked) {
          this.setData({
            hasCollectionTitle: true,
            collectionTitle: i18n.page('my').collectionTitleDefault,
            newCardCount: newCount
          });
        } else {
          this.setData({ newCardCount: newCount });
        }
      }
    } catch (e) {
      console.error('checkCollectionTitle:', e);
    }
  },

  async checkNewMatches(openid) {
    try {
      const res = await api.request(
        '/api/match/history/' + encodeURIComponent(openid) + '?page=1&pageSize=100',
        'GET'
      );
      // 🔴 v3.4 修复：兼容数组和分页对象两种返回格式
      if (res.success && res.data) {
        const list = Array.isArray(res.data) ? res.data : (Array.isArray(res.data.list) ? res.data.list : []);
        // 去重逻辑同 my-matches 页
        const seen = {};
        let count = 0;
        for (const item of list) {
          if (item.user_a_openid === openid && item.user_b_openid === openid) continue;
          // v2.0 防御：gua字段缺失时跳过，避免生成 'NaN-NaN' key
          if (!item.user_a_gua || !item.user_b_gua) continue;
          const key = item.relationship_key || (Math.min(item.user_a_gua, item.user_b_gua) + '-' + Math.max(item.user_a_gua, item.user_b_gua));
          if (!seen[key]) { seen[key] = true; count++; }
        }
        const lastViewed = wx.getStorageSync('last_viewed_match_count') || 0;
        const newCount = Math.max(0, count - lastViewed);
        this.setData({ newMatchCount: newCount });
      }
    } catch (e) { console.error('checkNewMatches:', e); }
  },

  goToNativeGua() {
    soundManager.play('click');
    const app = getApp();
    const guaId = app.globalData.profile && app.globalData.profile.ming_ben_gua;
    if (guaId) {
      wx.navigateTo({ url: '/sub/learn/native-gua/index?guaId=' + guaId });
    } else {
      wx.showToast({ title: i18n.page('my').toastNeedProfile, icon: 'none' });
    }
  },
  goToEditProfile() { soundManager.play('click'); wx.navigateTo({ url: '/sub/profile/edit-profile/index' }); },

  goToMatch() {
    soundManager.play('click');
    // v2.0 修复：进入匹配页时清零新匹配角标
    const total = this.data.newMatchCount + (wx.getStorageSync('last_viewed_match_count') || 0);
    wx.setStorageSync('last_viewed_match_count', total);
    this.setData({ newMatchCount: 0 });
    wx.navigateTo({ url: '/sub/match/match/index' });
  },
  goToLearn() {
    soundManager.play('click');
    // v2.0 修复：进入学习页时清零新收集角标
    const total = this.data.newCardCount + (wx.getStorageSync('last_viewed_collection_count') || 0);
    wx.setStorageSync('last_viewed_collection_count', total);
    this.setData({ newCardCount: 0 });
    wx.navigateTo({ url: '/sub/learn/learn/index' });
  },
  goToMyMatches() { soundManager.play('click'); wx.navigateTo({ url: '/sub/match/my-matches/index' }); },
  goToVip() { soundManager.play('click'); wx.navigateTo({ url: '/sub/vip/vip/index' }); },
  goToProfile() { soundManager.play('click'); wx.navigateTo({ url: '/pages/profile/index' }); },
  // 游客模式：跳转邮箱登录页
  goLogin() { soundManager.play('click'); wx.navigateTo({ url: '/pages/login/login' }); },
  goToAbout() { soundManager.play('click'); wx.navigateTo({ url: '/pages/about/about' }); },
  // 微信登录（APP 端）
  // v16.15 改用 wx.weixinAppLogin() 直接唤起微信 App 登录
  // 官方文档：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/api/auth/wx.weixinAppLogin.html
  goWechatLogin() {
    soundManager.play('click');
    const app = getApp();
    const t = i18n.page('my');
    // 小程序环境已静默登录，无需再走此按钮
    if (app.globalData.isMpWeixin) {
      wx.showToast({ title: t.toastWechatLoggedIn, icon: 'none' });
      return;
    }
    // 已登录时隐藏按钮，此处做兜底
    if (app.globalData.openid && app.globalData.token) {
      this.setData({ isLoggedIn: true });
      wx.showToast({ title: t.toastLoggedIn, icon: 'none' });
      return;
    }
    wx.showLoading({ title: t.toastWechatLoading, mask: true });

    // App端使用 wx.weixinAppLogin 直接唤起微信 App
    if (typeof wx.weixinAppLogin !== 'function') {
      wx.hideLoading();
      wx.showToast({ title: t.toastWechatUnsupported, icon: 'none' });
      return;
    }

    wx.weixinAppLogin({
      success: async (res) => {
        if (!res.code) {
          wx.hideLoading();
          wx.showToast({ title: t.toastWechatCodeFail, icon: 'none' });
          return;
        }
        try {
          // App端使用 /api/auth/miniapp-login（code2Verifyinfo 换取小程序 openid）
          const result = await api.request('/api/auth/miniapp-login', 'POST', { code: res.code });
          wx.hideLoading();
          if (result.success && result.data && result.data.openid) {
            const { openid, token, quota_remaining, plan_type } = result.data;
            app.globalData.openid = openid;
            app.globalData.token = token;
            storage.set('token', token);
            if (quota_remaining !== undefined) app.globalData.quota = quota_remaining;
            if (plan_type) app.globalData.planType = plan_type;
            await app.checkProfile(openid);
            app.handlePendingShare();
            this.setData({ isLoggedIn: true });
            this.loadProfile();
            wx.showToast({ title: t.toastLoginOk, icon: 'success' });
          } else {
            wx.showToast({ title: result.message || t.toastLoginFail, icon: 'none' });
          }
        } catch (e) {
          wx.hideLoading();
          console.error('[goWechatLogin] 登录接口异常:', e);
          wx.showToast({ title: t.toastNetRetry, icon: 'none' });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('[goWechatLogin] 登录失败:', JSON.stringify(err));
        // 显示详细错误信息便于调试
        const errCode = err && err.errCode;
        const errMsg = err && err.errMsg;
        const isEn = i18n.isEn();
        let msg = isEn ? 'WeChat login failed' : '微信登录失败';
        if (errCode === 10001005) {
          msg = isEn ? 'Multi-platform app has no identity management enabled' : '多端应用未接入身份管理';
        } else if (errCode === 10001007) {
          msg = isEn ? 'Multi-platform app is not bound to a mobile app' : '多端应用未绑定移动应用';
        } else if (errCode === 10001015) {
          msg = isEn ? 'Not supported in the mobile app assistant. Build a release package first' : '不支持在移动应用助手中测试，需构建正式包';
        } else if (errMsg && (errMsg.includes('签名') || errMsg.includes('sign'))) {
          msg = isEn ? 'Signature check failed. Check the Open Platform config' : '签名校验失败，请检查开放平台配置';
        } else if (errMsg && (errMsg.includes('未安装') || errMsg.includes('install'))) {
          msg = isEn ? 'WeChat is not installed' : '未安装微信';
        } else if (errMsg && (errMsg.includes('取消') || errMsg.includes('cancel'))) {
          msg = isEn ? 'Login cancelled' : '已取消登录';
        } else {
          // 显示原始错误信息便于调试
          msg = (isEn ? 'WeChat login failed[' : '微信登录失败[') + (errCode || 'unknown') + ']:' + ((errMsg || (isEn ? 'Unknown error' : '未知错误')).substring(0, 30));
        }
        wx.showToast({ title: msg, icon: 'none', duration: 3000 });
      }
    });
  },

  // 邮箱登录
  goEmailLogin() {
    soundManager.play('click');
    wx.navigateTo({ url: '/pages/login/login' });
  },

  // 退出登录
  handleLogout() {
    const t = i18n.page('my');
    wx.showModal({
      title: t.mLogoutTitle,
      content: t.mLogoutContent,
      confirmText: t.confirm,
      cancelText: t.cancel,
      success: (res) => {
        if (res.confirm) {
          const app = getApp();
          app.globalData.openid = '';
          app.globalData.token = '';
          app.globalData.profile = null;
          app.globalData.hasProfile = false;
          storage.remove('token');
          this.setData({ isLoggedIn: false, profile: {} });
          wx.showToast({ title: t.toastLoggedOut, icon: 'success' });
        }
      }
    });
  },

  // 注销账号（Google Play 数据安全要求：App 内提供删除账号入口）
  handleDeleteAccount() {
    const t = i18n.page('my');
    wx.showModal({
      title: t.deleteAccount,
      content: t.mDeleteContent,
      confirmText: t.confirm,
      confirmColor: '#E64340',
      cancelText: t.cancel,
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ mask: true });
        const app = getApp();
        const openid = app.globalData.openid;
        api.request('/api/user/profile/' + openid + '/request-delete', 'POST', {})
          .then((r) => {
            wx.hideLoading();
            if (r && r.success) {
              app.globalData.openid = '';
              app.globalData.token = '';
              app.globalData.profile = null;
              app.globalData.hasProfile = false;
              storage.remove('token');
              this.setData({ isLoggedIn: false, profile: {} });
              wx.showToast({ title: t.toastDeleted, icon: 'success' });
            } else {
              wx.showToast({ title: (r && r.message) || t.toastNetError, icon: 'none' });
            }
          })
          .catch(() => {
            wx.hideLoading();
            wx.showToast({ title: t.toastNetError, icon: 'none' });
          });
      }
    });
  },

  // 易缘传书入口
  goToLetterMatch() {
    soundManager.play('click');
    wx.navigateTo({ url: '/sub/match/match-pool/index' });
  },

  // 检查未读信件数量
  async checkUnreadLetters() {
    try {
      const res = await api.request('/api/letter/unread-count', 'GET');
      // 🔴 v3.4 修复：简化逻辑，仅信任 success=true 的响应，失败时保留现有角标
      if (res && res.success && res.data && typeof res.data.unreadCount === 'number') {
        const c = res.data.unreadCount;
        this.setData({ unreadLetterCount: c });
        // v3.4.1 L8：原生 tabBar「我的」tab 红点（index=1）
        try {
          if (c > 0) {
            wx.showTabBarRedDot({ index: 1 });
          } else {
            wx.hideTabBarRedDot({ index: 1 });
          }
        } catch (e) { /* 自定义 tabBar 等环境不支持时静默 */ }
      }
    } catch (e) { /* 静默失败，保留现有角标 */ }
  }
});
