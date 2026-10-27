const api = require('../../../utils/api.js');
const soundManager = require('../../../utils/audio.js');
const router = require('../../../utils/router.js');
const storage = require('../../../utils/storage.js');
const i18n = require('../../../utils/i18n.js');
// 末项用 i18n，初始即正确语言（修复英文态回显中文'不确定'）
const SC = ['23:00-01:00','01:00-03:00','03:00-05:00','05:00-07:00','07:00-09:00','09:00-11:00','11:00-13:00','13:00-15:00','15:00-17:00','17:00-19:00','19:00-21:00','21:00-23:00', i18n.page('editProfile').uncertain];
Page({
  data: { nickname:'',birthDate:'',shichenIndex:6,shichenLabel:'11:00-13:00',gender:'',boundEmail:'',canSubmit:false,isFormChanged:false,isSubmitting:false,maxDate:'',shichenOptions:SC,originalData:{},isApp:false,t: i18n.page('editProfile'), lang: i18n.getLang() },
  onLoad() {
    soundManager.init();
    const now = new Date();
    this.setData({ maxDate: `${now.getFullYear()-18}-12-31` });
    const app = getApp();
    this.setData({ isApp: !app.globalData.isMpWeixin });
    if (app.globalData.loginPromise) {
      app.globalData.loginPromise.then(() => this.loadProfile()).catch(() => {
        const t = i18n.page('editProfile');
        wx.showToast({ title: t.loginFailed, icon: 'none' });
      });
    } else {
      this.loadProfile();
    }
  },
  onShow() {

    i18n.applyNavTitle('sub/profile/edit-profile/index');
    this.applyI18n();
    // v3.4 从绑定邮箱页返回时刷新绑定状态（首次 onLoad 已加载，避免双拉）
    if (this._loadedOnce) this.loadProfile();
    this._loadedOnce = true;
  },
  applyI18n() {
    const t = i18n.page('editProfile');
    const SCLocalized = [
      '23:00-01:00','01:00-03:00','03:00-05:00','05:00-07:00',
      '07:00-09:00','09:00-11:00','11:00-13:00','13:00-15:00',
      '15:00-17:00','17:00-19:00','19:00-21:00','21:00-23:00',
      t.uncertain
    ];
    this.setData({ t, lang: i18n.getLang(), shichenOptions: SCLocalized });
  },
  async loadProfile() {
    const app = getApp();
    // 从后端实时获取最新档案（不走内存缓存，防止编辑陈旧数据）
    try {
      const openid = app.globalData.openid;
      if (!openid) return;
      const res = await api.request('/api/user/profile/' + encodeURIComponent(openid), 'GET');
      if (!res.success || !res.data) return;
      const p = res.data;
      // 更新全局缓存
      app.globalData.profile = p;
      app.globalData.hasProfile = true;
      // 如果用户已经开始了编辑，不要覆盖表单
      if (this._hasUserInput) return;
      const d = {
        nickname: p.nickname || '',
        birthDate: `${p.birth_year}-${String(p.birth_month).padStart(2,'0')}-${String(p.birth_day).padStart(2,'0')}`,
        gender: p.gender || '',
        boundEmail: p.email || ''
      };
      const sc = p.birth_shichen;
      d.shichenIndex = (sc >= 1 && sc <= 12) ? sc - 1 : 6;
      d.shichenLabel = SC[d.shichenIndex] || SC[6];
      this.setData({ ...d, originalData: JSON.stringify({ nickname: d.nickname, birthDate: d.birthDate, shichenIndex: d.shichenIndex, gender: d.gender }) });
    } catch(e) {
      console.error('[edit-profile] loadProfile failed:', e);
      const t = i18n.page('editProfile');
      wx.showToast({ title: t.loadFailed, icon: 'none' });
    }
  },
  onInput(e) {
    const k = e.currentTarget.dataset.key;
    let v = e.detail.value;
    if (k === 'nickname') v = v.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    this._hasUserInput = true;
    this.setData({ [k]: v });
    this.checkChanged();
  },
  onBirthDateChange(e) {
    this._hasUserInput = true;
    this.setData({ birthDate: e.detail.value });
    this.checkChanged();
  },
  onShichen(e) {
    this._hasUserInput = true;
    const idx = parseInt(e.detail.value);
    this.setData({ shichenIndex: idx, shichenLabel: SC[idx] });
    this.checkChanged();
  },
  onGender(e) {
    this._hasUserInput = true;
    this.setData({ gender: e.currentTarget.dataset.val });
    this.checkChanged();
  },
  checkChanged() {
    const d = this.data;
    const cur = JSON.stringify({ nickname: d.nickname, birthDate: d.birthDate, shichenIndex: d.shichenIndex, gender: d.gender });
    this.setData({
      canSubmit: cur !== d.originalData && d.nickname && d.birthDate && d.gender,
      isFormChanged: cur !== d.originalData
    });
  },
  async onSubmit() {
    if (!this.data.canSubmit || this.data.isSubmitting) return;
    soundManager.play('button-tap');
    this.setData({ isSubmitting: true });
    const t = i18n.page('editProfile');
    const d = this.data;
    // 直接用索引计算：索引0-11对应时辰1-12，索引12(不确定)对应7
    const sc = (d.shichenIndex >= 0 && d.shichenIndex <= 11) ? d.shichenIndex + 1 : 7;
    // 🔴 v3.4 修复：birthDate 防御性校验，避免空值或格式异常导致 NaN 入库
    const parts = (d.birthDate || '').split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    if (!year || !month || !day) {
      const t = i18n.page('editProfile');
      wx.showToast({ title: t.pickBirthDate, icon: 'none' });
      this.setData({ isSubmitting: false });
      return;
    }
    try {
      const app = getApp();
      const profileData = {
        nickname: d.nickname,
        birth_year: year,
        birth_month: month,
        birth_day: day,
        birth_shichen: sc,
        gender: d.gender,
        lang: (require('../../../utils/i18n.js')).getLang() // v19.2 返回卦信息按语言输出
      };
      // 统一用 POST：INSERT ... ON DUPLICATE KEY UPDATE 同时支持新建和修改
      const res = await api.request('/api/user/profile', 'POST', profileData);
      if (res.success && res.data) {
        // 用后端返回的完整数据更新全局档案（包含易经人格字段）
        app.globalData.profile = { ...res.data };
        app.globalData.hasProfile = true;
        soundManager.play('profile-save');
        wx.showToast({ title: t.saveSuccess, icon: 'success' });

        // 处理待匹配的易缘分享链接（同建档页逻辑）
        if (app.globalData.pendingMatchGuaId) {
          const myGuaId = res.data.ming_ben_gua;
          const sharerGuaId = app.globalData.pendingMatchGuaId;
          const sharerOpenid = app.globalData.pendingMatchOpenid || '';
          const sharerNickname = app.globalData.pendingMatchNickname || '';
          app.globalData.pendingMatchGuaId = 0;
          app.globalData.pendingMatchOpenid = '';
          app.globalData.pendingMatchNickname = '';
          setTimeout(() => {
            var url = '/sub/match/match/index?sharerGuaId=' + sharerGuaId + '&myGuaId=' + myGuaId;
            if (sharerOpenid) url += '&sharerOpenid=' + encodeURIComponent(sharerOpenid);
            if (sharerNickname) url += '&sharerNickname=' + encodeURIComponent(sharerNickname);
            wx.redirectTo({ url: url });
          }, 1500);
          return;
        }

        // 检查是否有待推演问题（同建档页逻辑）
        const storage = require('../../../utils/storage.js');
        const pendingQuestion = storage.get('pendingQuestion');
        if (pendingQuestion) {
          storage.remove('pendingQuestion');
          setTimeout(() => {
            wx.redirectTo({
              url: '/pages/index/index?autoDivine=1&question=' + encodeURIComponent(pendingQuestion)
            });
          }, 1500);
          return;
        }

        setTimeout(() => router.safeNavigateBack(1, '/pages/my/index'), 1500);
      } else {
        wx.showToast({ title: res.message || t.saveFailed, icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: t.networkError, icon: 'none' });
    } finally {
      this.setData({ isSubmitting: false });
    }
  },

  // v3.4 绑定邮箱（账号安全，原在"我的"页）
  goToBindEmail() {
    soundManager.play('click');
    wx.navigateTo({ url: '/sub/profile/bind-email/index' });
  },

  goLogin() {
    wx.redirectTo({ url: '/pages/login/login' });
  },

  goWechatLogin() {
    // v16.15 App端使用 wx.weixinAppLogin 直接唤起微信 App 登录
    const app = getApp();
    if (!app.globalData.isMpWeixin) {
      // App端：使用 wx.weixinAppLogin
      if (typeof wx.weixinAppLogin !== 'function') {
        wx.showToast({ title: i18n.page('my').toastWechatUnsupported, icon: 'none' });
        return;
      }
      wx.showLoading({ title: i18n.page('my').toastWechatLoading, mask: true });
      wx.weixinAppLogin({
        success: async (res) => {
          if (!res.code) {
            wx.hideLoading();
            wx.showToast({ title: i18n.page('my').toastWechatCodeFail, icon: 'none' });
            return;
          }
          try {
            const result = await api.request('/api/auth/miniapp-login', 'POST', { code: res.code });
            wx.hideLoading();
            if (result.success) {
              app.globalData.openid = result.data.openid;
              app.globalData.token = result.data.token;
              wx.setStorageSync('token', result.data.token);
              wx.showToast({ title: i18n.page('my').toastLoginOk, icon: 'success' });
              this.loadProfile();
            } else {
              wx.showToast({ title: result.message || i18n.page('my').toastLoginFail, icon: 'none' });
            }
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: i18n.page('my').toastNetRetry, icon: 'none' });
          }
        },
        fail: (err) => {
          wx.hideLoading();
          let msg = i18n.page('my').toastWechatUnavailable;
          if (err && err.errMsg && err.errMsg.includes('取消')) msg = i18n.page('my').toastLoginCancelled;
          wx.showToast({ title: msg, icon: 'none' });
        }
      });
    } else {
      // 小程序端：使用 wx.login
      wx.login({
        success: (res) => {
          var code = res.code;
          if (!code) {
            wx.showToast({ title: i18n.page('my').toastWechatCodeFail, icon: 'none' });
            return;
          }
          api.request('/api/auth/login', 'POST', { code: code }).then(result => {
            if (result.success) {
              app.globalData.openid = result.data.openid;
              app.globalData.token = result.data.token;
              wx.setStorageSync('token', result.data.token);
              wx.showToast({ title: i18n.page('my').toastLoginOk, icon: 'success' });
              this.loadProfile();
            } else {
              wx.showToast({ title: result.message || i18n.page('my').toastLoginFail, icon: 'none' });
            }
          }).catch(err => {
            wx.showToast({ title: i18n.page('my').toastLoginFail, icon: 'none' });
          });
        },
        fail: (err) => {
          wx.showToast({ title: i18n.page('my').toastWechatCodeFail, icon: 'none' });
        }
      });
    }
  }
});
