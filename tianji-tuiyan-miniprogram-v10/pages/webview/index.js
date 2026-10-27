/**
 * pages/webview/index.js - 网页容器页
 * 用于 APP 端打开外部网页（如官网下载页）
 */
const i18n = require('../../utils/i18n.js');

Page({
  onShow() {
    i18n.applyNavTitle('pages/webview/index');
  },
  data: {
    url: '',
    t: {}
  },

  onLoad(options) {
    this.setData({ t: i18n.page('common') });
    if (options.url) {
      this.setData({ url: decodeURIComponent(options.url) });
      // v3.4.1 外链加载提示（web-view 原生组件覆盖普通 view，用原生 loading 提示）
      wx.showLoading({ title: i18n.page('common').toastLoading || 'Loading...', mask: true });
    } else {
      wx.showToast({ title: i18n.page('common').toastNoUrl, icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    }
  },

  onWebMessage(e) {
    console.log('[webview] 收到网页消息:', e.detail);
  },

  onWebLoad(e) {
    console.log('[webview] 网页加载完成:', e.detail);
    wx.hideLoading();
  },

  onWebError(e) {
    console.error('[webview] 网页加载失败:', e.detail);
    wx.hideLoading();
    wx.showToast({ title: i18n.page('common').toastWebLoadFail, icon: 'none' });
  },

  onUnload() {
    wx.hideLoading();
  },

  onShareAppMessage() {
    return {
      title: i18n.page('common').appName,
      path: '/pages/index/index'
    };
  }
});
