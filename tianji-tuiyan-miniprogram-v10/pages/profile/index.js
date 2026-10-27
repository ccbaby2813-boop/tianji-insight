/**
 * pages/profile/index.js - 建档页
 * 修复：建档完成后处理易缘匹配分享跳转
 */
const api = require('../../utils/api.js');
const soundManager = require('../../utils/audio.js');
const storage = require('../../utils/storage.js');
const i18n = require('../../utils/i18n.js'); // v19.1 双语

Page({
  data: {
    t: i18n.page('profile'), // v19.1 页面文案字典（data 初始化，避免首帧空白）
    lang: i18n.getLang(),
    nickname: '',
    birthDate: '',
    shichenIndex: 6,
    shichenLabel: '11:00-13:00',
    gender: '',
    agreed: false,
    canSubmit: false,
    isSubmitting: false,
    maxDate: '',
    shichenOptions: ['23:00-01:00','01:00-03:00','03:00-05:00','05:00-07:00','07:00-09:00','09:00-11:00','11:00-13:00','13:00-15:00','15:00-17:00','17:00-19:00','19:00-21:00','21:00-23:00','不确定']
  },

  onLoad(options) {
    soundManager.init();
    const now = new Date();
    this.setData({ maxDate: `${now.getFullYear() - 18}-12-31` });

    // 标记是否来自易缘匹配分享
    this.isFromMatch = options.fromMatch === '1';
    if (this.isFromMatch) {
      wx.setNavigationBarTitle({ title: i18n.page('profile').navMatchTitle });
    }
  },

  onShow() {

    i18n.applyNavTitle('pages/profile/index', this.isFromMatch ? i18n.page('profile').navMatchTitle : undefined);
    // v19.1 双语：刷新文案字典与时辰选项（"不确定"需随语言切换）
    const t = i18n.page('profile');
    const slots = ['23:00-01:00','01:00-03:00','03:00-05:00','05:00-07:00','07:00-09:00','09:00-11:00','11:00-13:00','13:00-15:00','15:00-17:00','17:00-19:00','19:00-21:00','21:00-23:00'];
    const options = slots.concat([t.shichenUnsure]);
    const idx = this.data.shichenIndex;
    this.setData({ t: t, lang: i18n.getLang(), shichenOptions: options, shichenLabel: options[idx] || options[6] });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    let val = e.detail.value;
    if (key === 'nickname') val = val.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    this.setData({ [key]: val });
    this.checkCanSubmit();
  },

  onBirthDateChange(e) {
    this.setData({ birthDate: e.detail.value });
    this.checkCanSubmit();
  },

  onShichen(e) {
    const idx = parseInt(e.detail.value);
    this.setData({ shichenIndex: idx, shichenLabel: this.data.shichenOptions[idx] });
    this.checkCanSubmit();
  },

  onGender(e) {
    this.setData({ gender: e.currentTarget.dataset.val });
    this.checkCanSubmit();
  },

  onAgreement(e) {
    this.setData({ agreed: e.detail.value.length > 0 });
    this.checkCanSubmit();
  },

  checkCanSubmit() {
    const d = this.data;
    const can = d.nickname && d.nickname.length <= 10 && d.birthDate && d.gender && d.agreed;
    this.setData({ canSubmit: can });
  },

  showAgreement() { wx.navigateTo({ url: '/sub/legal/agreement/index' }); },
  showPrivacy() { wx.navigateTo({ url: '/sub/legal/privacy/index' }); },

  async onSubmit() {
    if (!this.data.canSubmit || this.data.isSubmitting) return;
    soundManager.play('button-tap');
    this.setData({ isSubmitting: true });

    const d = this.data;
    const shichen = (d.shichenIndex >= 0 && d.shichenIndex <= 11) ? d.shichenIndex + 1 : 7;

    // 🔴 v3.4 修复：birthDate 防御性校验，避免空值或格式异常导致 NaN 入库
    const parts = (d.birthDate || '').split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    if (!year || !month || !day) {
      wx.showToast({ title: i18n.page('profile').toastBirthRequired, icon: 'none' });
      this.setData({ isSubmitting: false });
      return;
    }

    try {
      const result = await api.request('/api/user/profile', 'POST', {
        nickname: d.nickname,
        birth_year: year,
        birth_month: month,
        birth_day: day,
        birth_shichen: shichen,
        gender: d.gender,
        lang: i18n.getLang() // v19.2 建档返回卦信息按语言输出
      });

      if (result.success && result.data) {
        soundManager.play('profile-save');
        const app = getApp();
        app.globalData.hasProfile = true;
        app.globalData.profile = result.data;

        // 判断跳转逻辑（4种场景）
        if (this.isFromMatch) {
          // 场景C：易缘短码引导建档 → 跳转match页看易缘匹配
          this.navigateToMatch(app, result.data.ming_ben_gua);
        } else if (app.navigateToMatchIfNeeded()) {
          // 场景B：有待处理的匹配分享
        } else {
          // 检查是否有缓存的 pending_question（场景A：首页输入问题后推演）
          const pendingQuestion = storage.get('pendingQuestion');
          if (pendingQuestion) {
            storage.remove('pendingQuestion');
            // 自动推演
            wx.redirectTo({
              url: '/pages/index/index?autoDivine=1&question=' + encodeURIComponent(pendingQuestion)
            });
          } else {
            // 场景D：无特殊场景 → 易经人格详情页
            wx.redirectTo({ url: '/sub/learn/native-gua/index?guaId=' + result.data.ming_ben_gua });
          }
        }
      } else {
        wx.showToast({ title: result.message || i18n.page('profile').toastFail, icon: 'none' });
      }
    } catch (e) {
      console.error('onSubmit error:', e);
      wx.showToast({ title: i18n.page('common').networkError, icon: 'none' });
    } finally {
      this.setData({ isSubmitting: false });
    }
  },

  /**
   * 易缘匹配场景：建档后自动跳转匹配
   * 逻辑：当前用户的卦 + 分享者的卦 → 匹配页
   */
  async navigateToMatch(app, myGuaId) {
    try {
      // 获取分享短码中的分享者卦
      const sharerGuaId = app.globalData.pendingMatchGuaId;
      const sharerOpenid = app.globalData.pendingMatchOpenid || '';
      const sharerNickname = app.globalData.pendingMatchNickname || '';
      if (sharerGuaId && sharerGuaId > 0) {
        app.globalData.pendingMatchGuaId = 0;
        app.globalData.pendingMatchOpenid = '';
        app.globalData.pendingMatchNickname = '';
        var url = '/sub/match/match/index?sharerGuaId=' + sharerGuaId + '&myGuaId=' + myGuaId;
        if (sharerOpenid) url += '&sharerOpenid=' + encodeURIComponent(sharerOpenid);
        if (sharerNickname) url += '&sharerNickname=' + encodeURIComponent(sharerNickname);
        wx.redirectTo({ url: url });
      } else {
        // 没有短码，直接去易经人格
        wx.redirectTo({ url: '/sub/learn/native-gua/index?guaId=' + myGuaId });
      }
    } catch (e) {
      console.error('navigateToMatch error:', e);
      wx.redirectTo({ url: '/sub/learn/native-gua/index?guaId=' + (app.globalData.profile.ming_ben_gua || 1) });
    }
  },

  goLogin() {
    wx.redirectTo({ url: '/pages/login/login' });
  }
});
