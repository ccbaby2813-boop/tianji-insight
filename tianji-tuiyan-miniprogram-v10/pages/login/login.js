// pages/login/login.js
// v19.4 邮箱登录页：注册 / 登录 / 找回密码
const api = require('../../utils/api.js');
const storage = require('../../utils/storage.js');
const i18n = require('../../utils/i18n.js');

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

Page({
  data: {
    mode: 'email',
    emailMode: 'signin', // signin | signup | forgot
    email: '',
    epassword: '',
    ecode: '',
    newPassword: '',
    ecountdown: 0,
    esending: false,
    esubmitting: false,
    agreed: false,
    t: {},
    lang: 'zh',
    isSubmitDisabled: true,
    submitBtnText: ''
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
    this.updateSubmitState();
  },

  onShow() {
    this.setData({
      t: i18n.page('login'),
      lang: i18n.getLang()
    });
    this.updateSubmitState();
  },

  onLoad() {
    const app = getApp();
    if (app.globalData.openid && app.globalData.token) {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
    } else {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  switchEmailMode(e) {
    const mode = e.currentTarget.dataset.mode;
    // 切换模式时重置协议勾选状态
    this.setData({ 
      emailMode: mode, 
      ecode: '', 
      epassword: '', 
      newPassword: '',
      agreed: false  // 每次切换模式都重置勾选
    });
    this.updateSubmitState();
  },

  onEmailInput(e) {
    this.setData({ email: e.detail.value.trim().slice(0, 100) });
    this.updateSubmitState();
  },

  onEpasswordInput(e) {
    this.setData({ epassword: e.detail.value.slice(0, 40) });
    this.updateSubmitState();
  },

  onNewPasswordInput(e) {
    this.setData({ newPassword: e.detail.value.slice(0, 40) });
    this.updateSubmitState();
  },

  onEcodeInput(e) {
    this.setData({ ecode: e.detail.value.replace(/[^\d]/g, '').slice(0, 6) });
    this.updateSubmitState();
  },

  updateSubmitState() {
    const { emailMode, email, epassword, ecode, newPassword, esubmitting, agreed, t } = this.data;
    const validEmail = EMAIL_RE.test(email);
    // 仅注册模式需要协议勾选
    const needAgree = emailMode === 'signup';
    let disabled = esubmitting || (needAgree && !agreed) || !validEmail;
    let btnText = '';

    if (emailMode === 'signin') {
      disabled = disabled || !epassword || epassword.length < 6;
      btnText = t.signinBtn;
    } else if (emailMode === 'signup') {
      disabled = disabled || !/^\d{6}$/.test(ecode) || !epassword || epassword.length < 6;
      btnText = t.signupBtn;
    } else if (emailMode === 'forgot') {
      disabled = disabled || !/^\d{6}$/.test(ecode) || !newPassword || newPassword.length < 6;
      btnText = t.resetBtn;
    }

    this.setData({ isSubmitDisabled: disabled, submitBtnText: btnText });
  },

  async sendEmailCode() {
    const t = this.data.t;
    if (this.data.esending || this.data.ecountdown > 0) return;
    // 仅注册模式需要先勾选协议
    if (this.data.emailMode === 'signup' && !this.data.agreed) {
      wx.showToast({ title: t.toastAgreeFirst, icon: 'none' });
      return;
    }
    if (!EMAIL_RE.test(this.data.email)) {
      wx.showToast({ title: t.toastEmailInvalid, icon: 'none' });
      return;
    }
    const purpose = this.data.emailMode === 'forgot' ? 'reset' : 'register';
    this.setData({ esending: true });
    try {
      const res = await api.request('/api/auth/email-send-code', 'POST', {
        email: this.data.email,
        purpose: purpose
      });
      if (res.success) {
        wx.showToast({ title: t.toastCodeSent, icon: 'success' });
        let count = 60;
        this.setData({ ecountdown: count });
        this.etimer = setInterval(() => {
          count--;
          this.setData({ ecountdown: count });
          if (count <= 0) clearInterval(this.etimer);
        }, 1000);
      } else {
        wx.showToast({ title: res.message || t.toastSendFail, icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: i18n.t('networkError'), icon: 'none' });
    } finally {
      this.setData({ esending: false });
    }
  },

  async submitAction() {
    const t = this.data.t;
    const mode = this.data.emailMode;
    if (this.data.esubmitting) return;
    // 仅注册模式需要协议勾选
    if (mode === 'signup' && !this.data.agreed) {
      wx.showToast({ title: t.toastAgreeFirst, icon: 'none' });
      return;
    }
    if (!EMAIL_RE.test(this.data.email)) {
      wx.showToast({ title: t.toastEmailInvalid, icon: 'none' });
      return;
    }

    if (mode === 'forgot') {
      if (!/^\d{6}$/.test(this.data.ecode)) {
        wx.showToast({ title: t.toastCodeRequired, icon: 'none' });
        return;
      }
      if (!this.data.newPassword || this.data.newPassword.length < 6) {
        wx.showToast({ title: t.toastPasswordShort, icon: 'none' });
        return;
      }
      await this.doResetPassword();
    } else {
      if (!this.data.epassword || this.data.epassword.length < 6) {
        wx.showToast({ title: t.toastPasswordShort, icon: 'none' });
        return;
      }
      if (mode === 'signup' && !/^\d{6}$/.test(this.data.ecode)) {
        wx.showToast({ title: t.toastCodeRequired, icon: 'none' });
        return;
      }
      await this.doEmailAuth();
    }
  },

  async doEmailAuth(confirmMerge) {
    const t = this.data.t;
    const isSignup = this.data.emailMode === 'signup';
    this.setData({ esubmitting: true });
    wx.showLoading({ title: t.logging, mask: true });
    try {
      const url = isSignup ? '/api/auth/email-register' : '/api/auth/email-login';
      const payload = isSignup
        ? { email: this.data.email, code: this.data.ecode, password: this.data.epassword }
        : { email: this.data.email, password: this.data.epassword };
      if (confirmMerge) payload.confirmMerge = true;
      const res = await api.request(url, 'POST', payload);
      wx.hideLoading();
      if (res.success && res.data && res.data.openid) {
        await this.loginSuccess(res.data);
      } else if (isSignup && res.code === 'MERGE_CONFIRM') {
        // v19.4 邮箱已被微信账号绑定（无密码）：弹窗确认后合并两账号
        const nickname = (res.data && res.data.boundNickname) || '';
        const content = t.mergeContent.replace('{nickname}', nickname);
        wx.showModal({
          title: t.mergeTitle,
          content: content,
          confirmText: t.mergeConfirm,
          cancelText: t.mergeCancel,
          success: (m) => {
            if (m.confirm) {
              this.doEmailAuth(true);
            }
          }
        });
      } else {
        wx.showToast({ title: res.message || (isSignup ? t.toastSignupFail : t.toastLoginFail), icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: i18n.t('networkError'), icon: 'none' });
    } finally {
      this.setData({ esubmitting: false });
    }
  },

  async doResetPassword() {
    const t = this.data.t;
    this.setData({ esubmitting: true });
    wx.showLoading({ title: t.logging, mask: true });
    try {
      const res = await api.request('/api/auth/email-reset-password', 'POST', {
        email: this.data.email,
        code: this.data.ecode,
        newPassword: this.data.newPassword
      });
      wx.hideLoading();
      if (res.success) {
        wx.showToast({ title: t.toastResetSuccess, icon: 'success' });
        setTimeout(() => {
          this.setData({ emailMode: 'signin', ecode: '', epassword: '', newPassword: '' });
          this.updateSubmitState();
        }, 1200);
      } else {
        wx.showToast({ title: t.toastResetFail, icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: i18n.t('networkError'), icon: 'none' });
    } finally {
      this.setData({ esubmitting: false });
    }
  },

  async loginSuccess(data) {
    const app = getApp();
    const { openid, token, quota_remaining, plan_type } = data;
    app.globalData.openid = openid;
    app.globalData.token = token;
    storage.set('token', token);
    if (quota_remaining !== undefined) app.globalData.quota = quota_remaining;
    if (plan_type) app.globalData.planType = plan_type;
    await app.checkProfile(openid);
    app.handlePendingShare();
    wx.showToast({ title: i18n.t('loginSuccess'), icon: 'success' });
    setTimeout(() => { wx.reLaunch({ url: '/pages/index/index' }); }, 800);
  },

  goAgreement() {
    wx.navigateTo({ url: '/sub/legal/agreement/index' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/sub/legal/privacy/index' });
  },

  onUnload() {
    if (this.etimer) clearInterval(this.etimer);
  }
});
