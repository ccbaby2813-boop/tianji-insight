// pages/about/about.js - 关于页面
const api = require('../../utils/api.js');
const storage = require('../../utils/storage.js');
const i18n = require('../../utils/i18n.js');

Page({
  data: {
    version: '',
    displayVersion: '',
    t: i18n.page('about'),
    lang: i18n.getLang()
  },

  onLoad() {
    const v = getApp().globalData.version || '1.0.0';
    const t = i18n.page('about');
    this.setData({ version: v, displayVersion: t.version.replace('{v}', v) });
  },

  onShow() {

    i18n.applyNavTitle('pages/about/about');
    this.applyI18n();
  },

  applyI18n() {
    const t = i18n.page('about');
    const v = this.data.version;
    this.setData({ t, lang: i18n.getLang(), displayVersion: t.version.replace('{v}', v) });
  },

  goToAgreement() {
    wx.navigateTo({ url: '/sub/legal/agreement/index' });
  },

  goToPrivacy() {
    wx.navigateTo({ url: '/sub/legal/privacy/index' });
  },

  async requestDelete() {
    const t = i18n.page('about');

    const firstConfirm = await new Promise((resolve) => {
      wx.showModal({
        title: t.deleteTitle,
        content: t.deleteContent,
        confirmText: t.deleteConfirm,
        confirmColor: '#C8A55B',
        cancelText: t.deleteCancel,
        success: (res) => resolve(res.confirm),
      });
    });

    if (!firstConfirm) return;

    const secondConfirm = await new Promise((resolve) => {
      wx.showModal({
        title: t.deleteFinalTitle,
        content: t.deleteFinalContent,
        confirmText: t.deleteFinalConfirm,
        confirmColor: '#FF4D4F',
        cancelText: t.deleteConfirm,
        success: (res) => resolve(res.confirm),
      });
    });

    if (!secondConfirm) return;

    try {
      wx.showLoading({ title: t.deleteLoading, mask: true });
      const app = getApp();
      const openid = app.globalData.openid;
      if (!openid) {
        wx.hideLoading();
        wx.showToast({ title: t.deleteLoginRequired, icon: 'none' });
        return;
      }
      const result = await api.request('/api/user/profile/' + encodeURIComponent(openid) + '/request-delete', 'POST');
      wx.hideLoading();
      if (result.success) {
        app.globalData.openid = '';
        app.globalData.token = '';
        app.globalData.profile = null;
        app.globalData.hasProfile = false;
        storage.remove('token');
        app.globalData.points = 0;
        app.globalData.vipDecodeRemaining = 0;
        app.globalData.planType = 'free';
        
        wx.showToast({ title: t.deleteSuccess, icon: 'success' });
        setTimeout(() => {
          wx.reLaunch({ url: '/pages/index/index' });
        }, 2000);
      } else {
        wx.showModal({
          title: i18n.page('common').cancel,
          content: result.message || i18n.t('networkError'),
          showCancel: false
        });
      }
    } catch (err) {
      wx.hideLoading();
      const t = i18n.page('about');
      wx.showToast({ title: t.toastDownloadFail, icon: 'none' });
    }
  },

  downloadApp() {
    const app = getApp();
    const t = i18n.page('about');
    if (!app.globalData.isMpWeixin) {
      wx.navigateTo({
        url: '/pages/webview/index?url=' + encodeURIComponent('https://claw-book.cn')
      });
    } else {
      wx.setClipboardData({
        data: 'https://claw-book.cn',
        success: () => {
          wx.showToast({ title: t.toastWebsiteCopied, icon: 'success' });
        }
      });
    }
  },
});