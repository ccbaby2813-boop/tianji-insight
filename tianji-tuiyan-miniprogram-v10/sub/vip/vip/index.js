const api = require('../../../utils/api.js');
const i18n = require('../../../utils/i18n.js'); // v19.1 双语
const env = require('../../../config/env.js'); // v20.2 渠道（google/cn）用于支付分流

Page({
  data: { t: i18n.page('vip'), lang: i18n.getLang(),
    plan:'yearly', isVip:false, remainDays:0, remainDaysText:'', vipDecodeRemaining:0,
    showBindDialog:false, bindPhone:'', bindCode:'', countdown:0, sendingCode:false, binding:false, buying:false,
    // v20.2 渠道价格展示：Google 版不显示 ¥ 价格（以 Play 商店定价为准）
    priceMonthly:'', priceYearly:'', isGoogleChannel:false },
  onLoad() {
    // v18.6：移除 onLoad 触发（onShow 首次进入必触发，此前双调 loadVip 会两次唤起微信登录）
    // v20.2 Google Play Billing：仅海外版 App 注册支付结果监听（小程序端无此能力）
    const app = getApp();
    if (env.CHANNEL === 'google' && app && app.globalData && app.globalData.isMpWeixin === false) {
      try {
        const billing = wx.miniapp && wx.miniapp.GooglePlayBilling;
        if (billing && typeof billing.onPurchasesUpdatedMethod === 'function') {
          billing.onPurchasesUpdatedMethod((res) => {
            console.log('[GoogleBilling] onPurchasesUpdatedMethod', res && res.responseCode, (res && res.purchases && res.purchases.length) || 0);
            if (res && res.responseCode === 0 && Array.isArray(res.purchases)) {
              res.purchases.forEach((p) => {
                const token = p.token || p.purchaseToken;
                const pid = p.productId || (p.products && p.products[0]) || '';
                if (token) this._handleGooglePurchase(token, pid);
              });
            } else if (res && res.responseCode !== 0) {
              wx.hideLoading();
              const vt = i18n.page('vip');
              // 1=用户取消 / -1=RESULT_USER_CANCELED
              if (res.responseCode === 1 || res.responseCode === -1) {
                wx.showToast({ title: vt.toastCancelled, icon: 'none' });
              } else {
                wx.showModal({ title: vt.mPayFail, content: (res && res.debugMessage) || vt.unknownError, showCancel: false });
              }
            }
          });
        }
      } catch (e) {
        console.error('[GoogleBilling] 注册监听失败:', e);
      }
    }
  },
  onShow() {

    i18n.applyNavTitle('sub/vip/vip/index');
    // v19.1 双语：刷新文案字典与派生文案
    var t = i18n.page('vip');
    this.setData({
      t: t,
      lang: i18n.getLang(),
      remainDaysText: this.data.isVip ? i18n.fill(t.remainDays, { n: this.data.remainDays }) : ''
    });
    // v20.2 渠道价格展示：Google 版不显示 ¥（以 Play 商店定价为准），国内版显示原价
    const app = getApp();
    const isGoogleApp = env.CHANNEL === 'google' && app && app.globalData && app.globalData.isMpWeixin === false;
    this.setData({
      isGoogleChannel: !!isGoogleApp,
      priceMonthly: isGoogleApp ? t.gpPriceMonthly : t.planMonthlyPrice,
      priceYearly: isGoogleApp ? t.gpPriceYearly : t.planYearlyPrice
    });
    this.loadVip();
  },
  async loadVip() {
    try {
      const app = getApp();
      // 未登录时引导登录（v18.6：await 等待登录完成后再拉取，登录成功页面立即刷新）
      if (!app || !app.globalData || !app.globalData.openid) {
        if (app && typeof app.login === 'function') {
          // App端调用 app.login() 会唤起 wx.weixinAppLogin（app.js 已加并发锁，不会重复唤起）
          await app.login();
          // 登录成功则继续拉取；仍未登录（用户取消等）则静默返回
          if (!app.globalData || !app.globalData.openid) return;
        } else {
          return;
        }
      }
      const res = await api.request('/api/payment/vip-info/' + encodeURIComponent(app.globalData.openid), 'GET');
      if(res.success && res.data) {
        const d = res.data;
        if(d.plan_type!=='free'){
          // 🔴 v15.3.4 修复 iOS 兼容：后端返回 "yyyy-MM-dd HH:mm:ss"，iOS 不支持，需替换为 "yyyy/MM/dd HH:mm:ss"
          const expStr = (d.expire_at || '').replace(/-/g, '/');
          const exp = new Date(expStr);
          const days = Math.ceil((exp - Date.now()) / 864e5);
          const vipRemaining = d.vipDecodeRemaining !== undefined ? d.vipDecodeRemaining : 0;
          this.setData({
            isVip: true,
            remainDays: Math.max(days, 0),
            remainDaysText: i18n.fill(i18n.page('vip').remainDays, { n: Math.max(days, 0) }),
            vipDecodeRemaining: vipRemaining
          });
          app.globalData.vipDecodeRemaining = vipRemaining;
          // 同步quota和planType，防止付费后超级推演页误判配额不足
          if (d.quota_remaining !== undefined) app.globalData.quota = d.quota_remaining;
          app.globalData.planType = d.plan_type;
        } else {
          this.setData({ isVip: false, vipDecodeRemaining: 0 });
          app.globalData.vipDecodeRemaining = 0;
          app.globalData.planType = 'free';
        }
      }
    } catch(e) {
      // 网络异常时保留现有状态，不误切为非VIP界面
      console.error('loadVip:', e);
    }
  },
  selectPlan(e) { this.setData({ plan: e.currentTarget.dataset.plan }); },

  async buyVip() {
    // v3.4.1 防重入：双击/连点只允许一次进入购买流程
    if (this.data.buying) return;
    this.setData({ buying: true });
    try {
      // v20.2 海外版（Google Play）：无需手机号绑定，直接走 Google Play Billing
      const app = getApp();
      if (env.CHANNEL === 'google' && app && app.globalData && app.globalData.isMpWeixin === false) {
        return this._doBuyVip();
      }
      // 购买前检查手机号绑定状态（国内版：VIP需以手机号作为统一身份主键）
      try {
        const bindRes = await api.requestWithAuth('/api/auth/binding-status', 'GET');
        if (!bindRes.success || !bindRes.data) {
          wx.showToast({ title: bindRes.message || i18n.page('vip').toastNetRetry, icon: 'none' });
          return;
        }
        if (bindRes.data.isBound) {
          // 已绑定手机号，继续原有购买流程
          return this._doBuyVip();
        }
        // 未绑定手机号，弹出绑定弹窗
        this.openBindDialog();
      } catch (e) {
        console.error('[buyVip] binding-status check error:', e);
        wx.showToast({ title: i18n.page('vip').toastNetRetry, icon: 'none' });
      }
    } finally {
      // 支付流程耗时较长，短暂锁定后恢复
      setTimeout(() => this.setData({ buying: false }), 1500);
    }
  },

  // 原有VIP购买流程（确认已绑定手机号后调用；海外版直接调用）
  async _doBuyVip() {
    // v20.2 海外版（Google Play）：走 Google Play Billing
    const app = getApp();
    if (env.CHANNEL === 'google' && app && app.globalData && app.globalData.isMpWeixin === false) {
      const productId = this.data.plan === 'monthly' ? 'vip_monthly' : 'vip_yearly';
      return this._checkPayThenBuy(productId);
    }
    wx.showLoading({ title: i18n.page('vip').toastPaying, mask: true });
    try {
      const productId = this.data.plan === 'monthly' ? 'vip_monthly' : 'vip_yearly';

      /* #ifdef MP-WEIXIN */
      // 小程序端：虚拟支付流程
      // 每次支付前获取最新微信登录code，传给后端实时换取session_key
      if (getApp().globalData.isMpWeixin) {
        let code = '';
        try {
          const loginRes = await new Promise((resolve, reject) => {
            wx.login({ timeout: 10000, success: resolve, fail: reject });
          });
          code = loginRes.code;
        } catch (e) {
          console.error('[buyVip] wx.login failed:', e);
        }

      const signRes = await api.request('/api/payment/create-order', 'POST', { productId, code });

      if (!signRes.success || !signRes.data) {
        wx.hideLoading();
        const vt = i18n.page('vip');
        if (signRes.code === 'SESSION_KEY_MISSING') {
          wx.showModal({ title: vt.mLoginExpired, content: vt.mLoginExpiredContent, showCancel: false });
        } else {
          wx.showModal({ title: vt.mPayFail, content: signRes.message || vt.unknownError, showCancel: false });
        }
        return;
      }

      const { signData, paySig, signature, mode } = signRes.data;

      // 从 signData 中提取 outTradeNo，用于后续轮询查单
      let outTradeNo = '';
      try { const sd = JSON.parse(signData); outTradeNo = sd.outTradeNo || ''; } catch(e) {}

      wx.requestVirtualPayment({
        signData: signData,
        paySig: paySig,
        signature: signature,
        mode: mode,
        success: () => {
          wx.hideLoading();
          wx.showToast({ title: i18n.page('vip').toastBought, icon: 'success' });
          const planType = this.data.plan === 'yearly' ? 'yearly' : 'monthly';
          const remainDays = planType === 'yearly' ? 365 : 30;
          this.setData({ isVip: true, remainDays: remainDays });
          const app = getApp();
          if (app && app.globalData) {
            app.globalData.planType = planType;
            app.globalData.quota = 20;
            app.globalData.vipDecodeRemaining = 1;
            // 🔴 v3.5 修复：清除 profile 缓存，让"我的"页 onShow 时重新拉取后端最新 VIP 状态
            app.globalData.hasProfile = false;
            app.globalData.profile = null;
          }
          this.setData({ vipDecodeRemaining: 1 });

          if (outTradeNo) {
            this._pollDelivery(outTradeNo);
          } else {
            this._pollTimer = setTimeout(() => { this.loadVip(); }, 5000);
          }
        },
        fail: (err) => {
          wx.hideLoading();
          console.error('[requestVirtualPayment] fail:', err.errMsg || String(err));
          const msg = err.errMsg || '';
          if (msg.indexOf('cancel') > -1) {
            wx.showToast({ title: i18n.page('vip').toastCancelled, icon: 'none' });
          } else {
            wx.showModal({ title: i18n.page('vip').mPayFail, content: msg, showCancel: false });
          }
        }
      });
      } // end if (isMpWeixin)
      /* #endif */

      /* #ifdef APP-PLUS */
      // App端：走微信APP支付（原生App内不能使用H5支付，须使用开放平台移动应用AppID的APP支付）
      if (!getApp().globalData.isMpWeixin) {
      const app = getApp();
      // 🔴 修复：openid由JWT携带，不在body中冗余发送（避免与后端校验冲突）
      // APP支付使用 create-app-order，后端返回 payParams（appid/partnerid/prepayid/noncestr/timestamp/sign）
      const orderRes = await api.request('/api/payment/create-app-order', 'POST', { productId: productId });

      wx.hideLoading();

      if (!orderRes.success || !orderRes.data) {
        const vt = i18n.page('vip');
        wx.showModal({ title: vt.mPayFail, content: orderRes.message || vt.unknownError, showCancel: false });
        return;
      }

      // App端微信支付：调用wx.requestPayment（uni-app APP平台需 provider=wxpay + orderInfo）
      const pp = (orderRes.data && orderRes.data.payParams) || {};
      if (pp && pp.prepayid && pp.partnerid) {
        const orderInfo = JSON.stringify({
          appid: pp.appid,
          partnerid: pp.partnerid,
          prepayid: pp.prepayid,
          package: pp.package || 'Sign=WXPay',
          noncestr: pp.noncestr,
          timestamp: pp.timestamp,
          sign: pp.sign
        });
        wx.requestPayment({
          provider: 'wxpay',
          orderInfo: orderInfo,
          success: () => {
            wx.showToast({ title: i18n.page('vip').toastBought, icon: 'success' });
            const planType = this.data.plan === 'yearly' ? 'yearly' : 'monthly';
            const remainDays = planType === 'yearly' ? 365 : 30;
            this.setData({ isVip: true, remainDays: remainDays, vipDecodeRemaining: 1 });
            if (app && app.globalData) {
              app.globalData.planType = planType;
              app.globalData.quota = 20;
              app.globalData.vipDecodeRemaining = 1;
              // 🔴 v3.5 修复：清除 profile 缓存，让"我的"页 onShow 时重新拉取后端最新 VIP 状态
              app.globalData.hasProfile = false;
              app.globalData.profile = null;
            }
            // 轮询确认订单状态
            if (orderRes.data.outTradeNo) {
              this._pollDelivery(orderRes.data.outTradeNo);
            } else {
              this._pollTimer = setTimeout(() => { this.loadVip(); }, 5000);
            }
          },
          fail: (err) => {
            console.error('[requestPayment] fail:', err.errMsg || String(err));
            const msg = err.errMsg || '';
            if (msg.indexOf('cancel') > -1) {
              wx.showToast({ title: i18n.page('vip').toastCancelled, icon: 'none' });
            } else {
              wx.showModal({ title: i18n.page('vip').mPayFail, content: msg, showCancel: false });
            }
          }
        });
      } else {
        // 兜底：如果没有支付参数，提示错误
        wx.showModal({ title: i18n.page('vip').mPayFail, content: i18n.page('vip').toastNoPayParams, showCancel: false });
      }
      } // end if (!isMpWeixin)
      /* #endif */
    } catch (e) {
      wx.hideLoading();
      console.error('buyVip error:', e);
      wx.showToast({ title: i18n.page('vip').toastNetError, icon: 'none' });
    }
  },

  // ========================================
  // v3.5 购买前检查：服务器支付未配置时提示“即将开通”，避免真实扣款后验签失败
  async _checkPayThenBuy(productId) {
    const vt = i18n.page('vip');
    wx.showLoading({ title: vt.toastPaying, mask: true });
    try {
      const res = await api.request('/api/payment/status', 'GET');
      wx.hideLoading();
      const cfg = (res && res.success && res.data) ? res.data : null;
      if (!cfg || !cfg.googlePlayConfigured) {
        wx.showModal({ title: vt.mPayComingSoon, content: vt.payComingSoonContent, showCancel: false });
        return;
      }
      this._googleBuyVip(productId);
    } catch (e) {
      wx.hideLoading();
      console.error('[buyVip] payment status check error:', e);
      // 状态接口失败时保守处理，不拉起实际支付，避免扣款风险
      wx.showModal({ title: vt.mPayFail, content: vt.toastNetError, showCancel: false });
    }
  },

  // v20.2 Google Play Billing（海外版）
  // ========================================
  _googleBuyVip(productId) {
    const vt = i18n.page('vip');
    const billing = (wx.miniapp && wx.miniapp.GooglePlayBilling) || null;
    if (!billing || typeof billing.startConnection !== 'function' || typeof billing.launchBillingFlow !== 'function') {
      wx.showModal({ title: vt.mPayFail, content: i18n.isEn() ? 'Google Play Billing unavailable' : 'Google Play Billing 不可用', showCancel: false });
      return;
    }
    wx.showLoading({ title: vt.toastPaying, mask: false });
    const doLaunch = () => {
      billing.launchBillingFlow({
        productId: productId,
        productType: 'INAPP', // 一次性商品（月/年权益由服务端按到期叠加计算）
        complete: (res) => {
          console.log('[GoogleBilling] launchBillingFlow complete:', JSON.stringify(res));
          wx.hideLoading();
          if (res && res.responseCode && res.responseCode !== 0) {
            const msg = res.debugMessage || ('code=' + res.responseCode);
            wx.showModal({ title: vt.mPayFail, content: msg, showCancel: false });
          }
        },
        fail: (err) => {
          wx.hideLoading();
          console.error('[GoogleBilling] launchBillingFlow fail:', JSON.stringify(err));
          const info = (typeof err === 'string') ? err : JSON.stringify(err || {});
          wx.showModal({ title: vt.mPayFail, content: info || vt.unknownError, showCancel: false });
        }
      });
    };
    if (this._billingReady) { doLaunch(); return; }
    billing.startConnection({
      success: () => {
        this._billingReady = true;
        doLaunch();
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('[GoogleBilling] startConnection fail:', JSON.stringify(err));
        // 调试：把 Google 真实错误码(responseCode/debugMessage)直接弹到屏幕，便于定位连接失败根因
        let info = '';
        try { info = (typeof err === 'string') ? err : JSON.stringify(err); } catch (e) { info = String(err); }
        if (info && info.length > 400) info = info.slice(0, 400);
        const tip = info ? ('code=' + info) : vt.toastNoPayParams;
        wx.showModal({ title: vt.mPayFail, content: tip, showCancel: false });
      }
    });
  },

  // 收到 Google 购买成功回调后：服务端验签 → 开通VIP → 消耗商品
  async _handleGooglePurchase(purchaseToken, productId) {
    const vt = i18n.page('vip');
    if (!purchaseToken) return;
    wx.showLoading({ title: vt.toastPaying, mask: true });
    try {
      const res = await api.request('/api/payment/google-verify', 'POST', {
        productId: productId,
        purchaseToken: purchaseToken,
        productType: 'INAPP'
      });
      wx.hideLoading();
      if (res.success && res.data && res.data.activated) {
        wx.showToast({ title: vt.toastBought, icon: 'success' });
        // 消耗商品（INAPP 一次性），并刷新VIP状态
        try {
          const billing = wx.miniapp && wx.miniapp.GooglePlayBilling;
          if (billing && typeof billing.consumeAsync === 'function') {
            billing.consumeAsync({ purchaseToken });
          }
        } catch (e) { console.error('[GoogleBilling] consumeAsync:', e); }
        this.loadVip();
      } else {
        wx.showModal({ title: vt.mPayFail, content: res.message || vt.unknownError, showCancel: false });
      }
    } catch (e) {
      wx.hideLoading();
      console.error('[GoogleBilling] 验签失败:', e);
      wx.showToast({ title: vt.toastNetError, icon: 'none' });
    }
  },

  // 发货轮询兜底：支付成功后轮询查单，防止微信推送回调延迟/丢失
  _pollDelivery(outTradeNo, pollCount) {
    pollCount = pollCount || 0;
    const MAX_POLLS = 10; // 最多轮询10次（3s×10=30s）
    const POLL_INTERVAL = 3000;
    // 第5次轮询后（约15s）仍未完成则主动调用sync-order查微信
    const SYNC_THRESHOLD = 5;

    const doPoll = () => {
      const checkUrl = '/api/payment/check-order/' + encodeURIComponent(outTradeNo);
      api.requestWithAuth(checkUrl, 'GET').then(res => {
        if (res.success && res.data && res.data.status === 'completed') {
          console.log('[pollDelivery] 订单已完成发货, pollCount=', pollCount);
          // 刷新VIP状态，同步服务端真实数据
          this.loadVip();
          return;
        }
        // 仍未完成：判断是否需要主动同步微信
        pollCount++;
        if (pollCount < MAX_POLLS) {
          if (pollCount === SYNC_THRESHOLD) {
            // 主动查微信支付状态并补发货
            console.log('[pollDelivery] 推送回调超时，主动查微信同步, pollCount=', pollCount);
            const syncUrl = '/api/payment/sync-order/' + encodeURIComponent(outTradeNo);
            api.requestWithAuth(syncUrl, 'POST').then(syncRes => {
              if (syncRes.success && syncRes.data && syncRes.data.status === 'completed') {
                console.log('[pollDelivery] 微信查单补发货成功');
                this.loadVip();
                return;
              }
              // sync也失败，继续轮询
              if (this._pollTimer) clearTimeout(this._pollTimer);
              this._pollTimer = setTimeout(doPoll, POLL_INTERVAL);
            }).catch(() => {
              if (this._pollTimer) clearTimeout(this._pollTimer);
              this._pollTimer = setTimeout(doPoll, POLL_INTERVAL);
            });
            return;
          }
          if (this._pollTimer) clearTimeout(this._pollTimer);
          this._pollTimer = setTimeout(doPoll, POLL_INTERVAL);
        } else {
          // 30s后仍未完成，最后尝试一次sync-order
          console.log('[pollDelivery] 超时，最后一次查微信同步');
          const syncUrl = '/api/payment/sync-order/' + encodeURIComponent(outTradeNo);
          api.requestWithAuth(syncUrl, 'POST').then(syncRes => {
            if (syncRes.success && syncRes.data && syncRes.data.status === 'completed') {
              console.log('[pollDelivery] 最终补发货成功');
            }
            this.loadVip();
          }).catch(() => { this.loadVip(); });
        }
      }).catch(() => {
        pollCount++;
        if (pollCount < MAX_POLLS) {
          if (this._pollTimer) clearTimeout(this._pollTimer);
          this._pollTimer = setTimeout(doPoll, POLL_INTERVAL);
        } else {
          this.loadVip();
        }
      });
    };

    doPoll();
  },

  // ========================================
  // v3.4.1 M13：恢复购买（Google Play 合规）
  // 1) 刷新服务端 VIP 状态；2) Google 渠道查询未消耗的已购商品并提交验证
  // ========================================
  async restorePurchase() {
    const vt = i18n.page('vip');
    wx.showLoading({ title: vt.restoring, mask: true });
    try {
      const app = getApp();
      if (app && app.globalData && app.globalData.openid) {
        await this.loadVip();
      }
      const billing = (wx.miniapp && wx.miniapp.GooglePlayBilling) || null;
      const isGoogleApp = env.CHANNEL === 'google' && app && app.globalData && app.globalData.isMpWeixin === false;
      if (isGoogleApp && billing && typeof billing.queryPurchasesAsync === 'function') {
        const res = await new Promise((resolve) => {
          billing.queryPurchasesAsync({ productType: 'INAPP', complete: resolve });
        });
        console.log('[GoogleBilling] queryPurchasesAsync:', JSON.stringify(res));
        const purchases = (res && (res.purchasesList || res.purchases)) || [];
        let restored = 0;
        for (let k = 0; k < purchases.length; k++) {
          const p = purchases[k];
          const token = p.token || p.purchaseToken;
          const pid = p.productId || (p.products && p.products[0]) || '';
          const state = p.purchaseState;
          if (token && (state === 0 || state === 'PURCHASED')) {
            await this._handleGooglePurchase(token, pid);
            restored++;
          }
        }
        wx.hideLoading();
        if (restored > 0) {
          wx.showToast({ title: vt.restoreOk, icon: 'success' });
        } else {
          wx.showToast({ title: vt.restoreNone, icon: 'none' });
        }
        return;
      }
      wx.hideLoading();
      wx.showToast({ title: vt.restoreNone, icon: 'none' });
    } catch (e) {
      wx.hideLoading();
      console.error('[restorePurchase] error:', e);
      wx.showToast({ title: vt.toastNetError, icon: 'none' });
    }
  },

  // ========================================
  // 手机号绑定流程
  // ========================================
  openBindDialog() {
    this.setData({ showBindDialog:true, bindPhone:'', bindCode:'', countdown:0 });
    if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
  },

  closeBindDialog() {
    this.setData({ showBindDialog:false, bindPhone:'', bindCode:'', countdown:0, binding:false });
    if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
  },

  noop() {},

  // v3.4 联系客服（华为审核：付费应用需提供客服联系方式；原在"我的"页，按方案B移至购买页）
  // v3.4.1 修复"无效"：改为点击即复制邮箱 + toast 反馈（不依赖 showModal，任何端都生效）
  contactService() {
    const vt = i18n.page('vip');
    const email = vt.contactServiceEmail || 'ccbaby2813@139.com';
    wx.setClipboardData({
      data: email,
      success: () => {
        wx.showToast({ title: (vt.contactEmailCopied || '客服邮箱已复制') + '\n' + email, icon: 'none', duration: 2500 });
      }
    });
  },

  onBindPhoneInput(e) {
    this.setData({ bindPhone: e.detail.value });
  },

  onBindCodeInput(e) {
    this.setData({ bindCode: e.detail.value });
  },

  async sendBindCode() {
    if (this.data.countdown > 0 || this.data.sendingCode) return;
    const vt = i18n.page('vip');
    const phone = (this.data.bindPhone || '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: vt.toastPhoneInvalid, icon: 'none' });
      return;
    }
    this.setData({ sendingCode: true });
    try {
      const res = await api.request('/api/auth/send-code', 'POST', { phone });
      if (res.success) {
        wx.showToast({ title: vt.toastCodeSent, icon: 'success' });
        this.startCountdown();
      } else {
        wx.showToast({ title: res.message || vt.toastSendFail, icon: 'none' });
      }
    } catch (e) {
      console.error('[sendBindCode] error:', e);
      wx.showToast({ title: vt.toastNetRetry, icon: 'none' });
    } finally {
      this.setData({ sendingCode: false });
    }
  },

  startCountdown() {
    let cnt = 60;
    this.setData({ countdown: cnt });
    if (this._countdownTimer) clearInterval(this._countdownTimer);
    this._countdownTimer = setInterval(() => {
      cnt--;
      if (cnt <= 0) {
        clearInterval(this._countdownTimer);
        this._countdownTimer = null;
        this.setData({ countdown: 0 });
      } else {
        this.setData({ countdown: cnt });
      }
    }, 1000);
  },

  async confirmBind() {
    if (this.data.binding) return;
    const vt = i18n.page('vip');
    const phone = (this.data.bindPhone || '').trim();
    const code = (this.data.bindCode || '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: vt.toastPhoneInvalid, icon: 'none' });
      return;
    }
    if (!/^\d{4,6}$/.test(code)) {
      wx.showToast({ title: vt.toastCodeRequired, icon: 'none' });
      return;
    }
    this.setData({ binding: true });
    try {
      const res = await api.requestWithAuth('/api/auth/bind-phone', 'POST', { phone, code });
      if (!res.success || !res.data) {
        wx.showToast({ title: res.message || vt.toastBindFail, icon: 'none' });
        return;
      }
      // 绑定成功：用返回的新 token/openid 更新本地存储与全局状态
      const { openid, token } = res.data;
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.token = token;
        app.globalData.openid = openid;
      }
      const storage = require('../../../utils/storage.js');
      storage.set('token', token);
      this.closeBindDialog();
      wx.showToast({ title: vt.toastBindOk, icon: 'success' });
      // 继续原有VIP购买流程
      this._doBuyVip();
    } catch (e) {
      console.error('[confirmBind] error:', e);
      wx.showToast({ title: vt.toastNetRetry, icon: 'none' });
    } finally {
      this.setData({ binding: false });
    }
  },

  onUnload() {
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
  }
});

