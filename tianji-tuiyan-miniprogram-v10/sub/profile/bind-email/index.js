// sub/profile/bind-email/index.js - 绑定邮箱（v19.4 账号安全）
// 流程：邮箱 + 验证码(purpose=bind) + 密码 → POST /api/auth/email-bind
//   场景A 邮箱未占用 → 直接绑定；场景B 邮箱已有独立账号 → 弹窗确认合并（confirmMerge）
const api = require('../../../utils/api.js');
const i18n = require('../../../utils/i18n.js');

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

Page({
  data: {
    t: i18n.page('bindEmail'), // data 初始化，避免首帧空白
    lang: i18n.getLang(),
    email: '',
    ecode: '',
    password: '',
    countdown: 0,
    sending: false,
    submitting: false,
    boundEmail: ''
  },

  onLoad() {
    // 未登录（入口已保护，此处兜底）→ 回登录页
    const app = getApp();
    if (!(app.globalData.openid && app.globalData.token)) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    // 读取当前账号已绑定的邮箱（档案缓存里带 email 字段）
    const bound = (app.globalData.profile && app.globalData.profile.email) || '';
    this.setData({ boundEmail: bound });
  },

  onShow() {

    i18n.applyNavTitle('sub/profile/bind-email/index');
    this.setData({
      t: i18n.page('bindEmail'),
      lang: i18n.getLang()
    });
  },

  onEmailInput(e) {
    this.setData({ email: e.detail.value.trim().slice(0, 100) });
  },

  onEcodeInput(e) {
    this.setData({ ecode: e.detail.value.replace(/[^\d]/g, '').slice(0, 6) });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value.slice(0, 40) });
  },

  async sendCode() {
    const t = this.data.t;
    if (this.data.sending || this.data.countdown > 0) return;
    if (!EMAIL_RE.test(this.data.email)) {
      wx.showToast({ title: t.toastEmailInvalid, icon: 'none' });
      return;
    }
    this.setData({ sending: true });
    try {
      const res = await api.request('/api/auth/email-send-code', 'POST', {
        email: this.data.email,
        purpose: 'bind'
      });
      if (res.success) {
        wx.showToast({ title: t.toastCodeSent, icon: 'success' });
        let count = 60;
        this.setData({ countdown: count });
        this.timer = setInterval(() => {
          count--;
          this.setData({ countdown: count });
          if (count <= 0) clearInterval(this.timer);
        }, 1000);
      } else {
        wx.showToast({ title: res.message || t.toastSendFail, icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: i18n.t('networkError'), icon: 'none' });
    } finally {
      this.setData({ sending: false });
    }
  },

  async submitBind(confirmMerge) {
    const t = this.data.t;
    if (this.data.submitting) return;
    if (!EMAIL_RE.test(this.data.email)) {
      wx.showToast({ title: t.toastEmailInvalid, icon: 'none' });
      return;
    }
    if (!/^\d{6}$/.test(this.data.ecode)) {
      wx.showToast({ title: t.toastCodeRequired, icon: 'none' });
      return;
    }
    if (!this.data.password || this.data.password.length < 6) {
      wx.showToast({ title: t.toastPasswordShort, icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: t.submitting, mask: true });
    try {
      const payload = { email: this.data.email, code: this.data.ecode, password: this.data.password };
      if (confirmMerge) payload.confirmMerge = true;
      const res = await api.request('/api/auth/email-bind', 'POST', payload);
      wx.hideLoading();
      if (res.success && res.data && res.data.bound) {
        // 绑定/合并成功：同步档案缓存，返回「我的」页
        const app = getApp();
        if (app.globalData.profile) app.globalData.profile.email = this.data.email.toLowerCase();
        this.setData({ boundEmail: this.data.email.toLowerCase() });
        wx.showToast({ title: res.data.merged ? t.toastMergeSuccess : t.toastBindSuccess, icon: 'success' });
        setTimeout(() => wx.navigateBack(), 1200);
      } else if (res.success && res.data && res.data.mergeable) {
        // 邮箱已有独立账号：弹窗确认合并
        const nickname = (res.data.mergeSummary && res.data.mergeSummary.nickname) || '';
        const content = t.mergeContent.replace('{nickname}', nickname);
        wx.showModal({
          title: t.mergeTitle,
          content: content,
          confirmText: t.mergeConfirm,
          cancelText: t.mergeCancel,
          success: (m) => {
            if (m.confirm) {
              this.submitBind(true);
            }
          }
        });
      } else {
        wx.showToast({ title: res.message || t.toastBindFail, icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: i18n.t('networkError'), icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer);
  }
});
