/**
 * app.js - 天机推演小程序入口
 * 负责：微信登录、全局状态管理、scene参数处理
 * 安全策略：前端只存token，openid由后端管理
 */
const api = require('./utils/api.js');
const storage = require('./utils/storage.js');
const soundManager = require('./utils/audio.js');
const fontManager = require('./utils/fonts.js');

// v15.3.2 登录冷却锁：防止 onLaunch + api.js 401 重试导致 wx.login 重复调用（触发微信45011限流）
let _lastLoginTime = 0;
const LOGIN_COOLDOWN_MS = 5000; // 5秒冷却

App({
  globalData: {
    version: '3.4.6',
    openid: '',
    token: '',
    hasProfile: false,
    profile: null,
    quota: 3,
    points: 0, // v17.0 积分余额（普通推演10积分/次）
    planType: 'free',
    pendingShareType: '',
    pendingShareId: '',
    pendingMatchGuaId: 0,
    pendingMatchOpenid: '',  // [修复] native-gua 分享时保存 A 的 openid
    pendingMatchNickname: '', // [修复] 保存 A 的昵称，匹配页展示分享者名字
    lastRecordId: 0,
    vipDecodeRemaining: 0,
    loginPromise: null,
    isMpWeixin: true,   // 默认小程序模式，仅明确检测到App才切换
    unreadNotificationCount: 0  // 全局未读通知数
  },

  // [MONITOR] 全局错误上报：上线后崩溃监控（后端 admin 后台可见 /app-error-reports）
  onError(err) {
    try {
      const api = require('./utils/api.js');
      const errMsg = String((err && (err.message || err.errMsg)) || err || '').slice(0, 500);
      const stack = String((err && err.stack) || '').slice(0, 2000);
      if (!errMsg) return;
      api.request('/api/admin/app-error-report', 'POST', {
        error_type: 'app_global',
        error_message: errMsg,
        stack_trace: stack,
        page: '',
        user_openid: (this.globalData && this.globalData.openid) || '',
        app_version: (this.globalData && this.globalData.version) || '',
        device_info: {}
      }).catch(function () {});
    } catch (e) { /* 上报失败静默 */ }
  },

  onLaunch(options) {
    // 环境检测：小程序端 vs App端（Donut多端框架）
    // v15.4 重构：优先检测 Donut App 特征，避免 host==='weixin' 误判
    var isMp = true;
    try {
      let host = '', SDKVersion = '', platform = '', appField = '';
      try {
        const baseInfo = wx.getAppBaseInfo();
        host = baseInfo.host || '';
        SDKVersion = baseInfo.SDKVersion || '';
      } catch (e2) {}
      try {
        const devInfo = wx.getDeviceInfo();
        platform = devInfo.platform || '';
      } catch (e3) {}
      if (!host && !SDKVersion && !platform) {
        try {
          const sys = wx.getSystemInfoSync();
          host = sys.host || '';
          SDKVersion = sys.SDKVersion || '';
          platform = sys.platform || '';
          appField = sys.app || '';
        } catch (e4) {
          console.warn('[env] getSystemInfoSync 失败，跳过环境检测细节');
        }
      }
      console.log('[env] host=' + host + ', app=' + appField + ', SDKVersion=' + SDKVersion + ', platform=' + platform);

      // 🔴 v15.4 优先检测 Donut App 特征（必须在 host==='weixin' 判断之前）
      // 特征1：wx.miniapp 命名空间存在（Donut 专属 API）
      var hasMiniappAPI = !!(wx.miniapp && typeof wx.miniapp === 'object');
      // 特征2：platform 为 android/ios（小程序里 platform 通常是 devtools/wechat）
      var isNativePlatform = (platform === 'android' || platform === 'ios');
      // 特征3：host 以 wxext 开头（旧版 Donut 特征）— host 可能是对象，先转字符串
      var hostStr = typeof host === 'string' ? host : JSON.stringify(host || '');
      var isWxextHost = !!(hostStr && hostStr.indexOf('wxext') === 0);

      if (hasMiniappAPI || isNativePlatform || isWxextHost) {
        isMp = false;
        console.log('[env] 检测到Donut App模式: miniappAPI=' + hasMiniappAPI + ', platform=' + platform + ', host=' + host);
      }
      // 标准小程序：host === 'weixin' 且无 App 特征
      else if (host === 'weixin') {
        console.log('[env] host检测为微信小程序');
      }
      // 兜底：用 accountInfo 确认
      else {
        try {
          var accountInfo = wx.getAccountInfoSync();
          if (accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.appId) {
            isMp = true;
            console.log('[env] accountInfo确认为小程序');
          } else {
            isMp = false;
            console.log('[env] 非小程序环境，按App处理');
          }
        } catch(e) {
          console.log('[env] accountInfo获取失败，默认小程序模式');
        }
      }
    } catch (e) {
      console.warn('[env] 环境检测异常，默认按小程序模式启动:', (e && e.message) || e);
    }

    this.globalData.isMpWeixin = isMp;
    console.log('[env] 最终判定: isMpWeixin=' + isMp);

    // v2.4 TIMPush 系统推送：App 启动时注册（小程序环境自动跳过）
    try {
      require('./utils/push.js').initPush();
    } catch (e) {
      console.warn('[push] initPush 调用失败:', (e && e.message) || e);
    }

    soundManager.init();
    this.handleScene(options);

    // v16.2 OpenSDK 日志监听（官方 API）：辅助排查 App 端微信分享/登录失败
    // ⚠️ 官方文档：onOpensdkLog 仅 iOS 支持，Android 端不输出日志。
    //    Android 分享失败请查看 vConsole 中 share.js 打印的 '[share] 分享失败 detail:' 日志
    try {
      if (wx.miniapp && typeof wx.miniapp.onOpensdkLog === 'function') {
        wx.miniapp.onOpensdkLog(function(log) {
          console.log('[opensdk]', typeof log === 'string' ? log : JSON.stringify(log));
        });
      }
    } catch (e) {
      console.warn('[opensdk] 日志监听注册失败:', e);
    }

    // 初始化字体分层系统（v2.1：篆书 + L1灵魂字 + L2标题字 统一加载）
    fontManager.initFonts();

    // v19.5 Android 深链监听：匹配分享 H5 链接经 Scheme(tianji://) 唤起 App 时，续接匹配关系
    this._registerDeepLink();

    // v19.3 tabBar 国际化
    try {
      const i18n = require('./utils/i18n.js');
      i18n.updateTabBar();
    } catch (e) {}

    // 只恢复token，不恢复openid（openid由登录接口返回）
    const savedToken = storage.get('token');
    if (savedToken) this.globalData.token = savedToken;

    // v16.15 登录策略：小程序端静默登录，App端不强制登录（游客浏览，需要时再登录）
    if (isMp) {
      // 小程序端：wx.login 是静默的，用户无感知，启动时自动登录
      this.globalData.loginPromise = this.tryLogin(savedToken);
    } else {
      // App端：wx.weixinAppLogin 会唤起微信，有感知，不放在启动时
      // 游客可浏览所有页面，推演/匹配/建档时再引导登录
      console.log('[app] App端启动，游客模式浏览，需要时再登录');
      this.globalData.loginPromise = Promise.resolve();
    }
  },

  onShow(options) {
    if (options) this.handleScene(options);
    // 处理待处理的分享（热启动直接处理；冷启动留给login()回调处理，避免hasProfile未加载）
    var shareType = this.globalData.pendingShareType;
    if (shareType && this.globalData.pendingShareId) {
      if (!this.globalData.openid) return; // 登录尚未完成，留给login()回调处理
      this.globalData.pendingShareType = '';
      this.handlePendingShare();
    }
    // 全局未读通知数检查（登录后异步获取，不阻塞页面）
    this.checkUnreadNotifications();
  },

  // 全局未读通知数检查
  async checkUnreadNotifications() {
    try {
      // 等登录完成
      if (!this.globalData.openid || !this.globalData.token) {
        if (this.globalData.loginPromise) {
          await this.globalData.loginPromise;
        }
        if (!this.globalData.openid || !this.globalData.token) return;
      }
      const api = require('./utils/api.js');
      const res = await api.request('/api/notifications/unread-count', 'GET');
      if (res && res.success && res.data) {
        const count = res.data.count || 0;
        const prevCount = this.globalData.unreadNotificationCount || 0;
        this.globalData.unreadNotificationCount = count;
        // 有新消息时轻提示（仅在 App 前台且非消息中心页）
        if (count > prevCount && count > 0) {
          const pages = getCurrentPages();
          const currentPage = pages.length > 0 ? pages[pages.length - 1].route : '';
          if (currentPage !== 'sub/profile/notifications/index') {
            wx.showToast({
              title: count > 1 ? `你有 ${count} 条新消息` : '你有一条新消息',
              icon: 'none',
              duration: 2000
            });
          }
        }
      }
    } catch (e) {
      // 静默失败，不影响 App
    }
  },

  waitForLogin() {
    if (this.globalData.openid && this.globalData.token) {
      return Promise.resolve();
    }
    return this.globalData.loginPromise || this.tryLogin(this.globalData.token || '');
  },

  handleScene(options) {
    // 只检查 options.query.scene（我们设置的 scene 参数）
    // 不检查 options.scene（微信的分享场景值，如 1007=个人分享、1008=群聊分享）
    const rawScene = options && options.query && options.query.scene;
    if (rawScene) {
      try {
        const scene = decodeURIComponent(rawScene);
        if (scene.startsWith('match:')) {
          const shareId = scene.replace('match:', '');
          this.globalData.pendingShareType = 'match';
          this.globalData.pendingShareId = shareId;
        } else if (/^\d+$/.test(scene)) {
          const recordId = parseInt(scene);
          this.globalData.pendingShareType = 'result';
          this.globalData.pendingShareId = recordId;
        }
      } catch (e) {
        console.error('handleScene error', e);
      }
    }
    // v19.5 Android 深链兜底：Donut App 冷/热启动经 scheme 唤起时，query 可能直接带 sid
    // （registOpenURL 回调是主动式解析，此处覆盖纯冷启动未回调的路径差异）
    const sid = options && options.query && options.query.sid;
    if (sid) {
      const shareId = ('' + sid).replace(/\D/g, '');
      if (shareId) {
        this.globalData.pendingShareType = 'match';
        this.globalData.pendingShareId = shareId;
      }
    }
    // [深链健壮性] 部分 Donut 版本冷启动经 scheme/Universal Link 唤起时，
    // onLaunch options 直接携带 url/link 字符串（内含 sid），一并兜底提取
    if (!sid && options) {
      var optUrl = options.url || options.link || options.path || '';
      if (typeof optUrl !== 'string') optUrl = '';
      var sm = String(optUrl).match(/sid=([0-9]+)/);
      if (sm) {
        this.globalData.pendingShareType = 'match';
        this.globalData.pendingShareId = sm[1];
      }
    }
  },

  /**
   * v19.5 Android 深链监听（Donut 多端框架）
   * 官方 API：wx.miniapp.registOpenURL，Android>=1.0.8
   * 匹配分享 H5 链接 → scheme(tianji://match?sid=xxx) 或 iOS Universal Link(https://claw-book.cn/...?sid=xxx) → 唤起 App → 续接匹配
   * 已建档+已登录 → resolveMatchShare 计算并展示匹配；未建档 → 先引导建档，建档后 navigateToMatchIfNeeded 展示
   * v3.3：放开仅识别 action==='scheme' 的限制。iOS 经 Universal Link 唤起时 param.data.url 同样携带 sid，
   *       统一从 url/query 提取 sid，scheme 与 Universal Link 一体兼容。
   */
  _registerDeepLink() {
    try {
      if (wx.miniapp && typeof wx.miniapp.registOpenURL === 'function') {
        const app = this;
        wx.miniapp.registOpenURL(function(param) {
          try {
            // 唤起来源可能是 scheme(tianji://...) 或 iOS Universal Link(https://...)，两者 data 均含 url/query，统一提取 sid
            if (!param || !param.data) return;
            // [深链健壮性] Donut 不同版本/不同唤起方式的回调结构不一：
            // param.data 可能是字符串，或含 url/query/path/params 的对象，统一拼接后提取 sid
            var d = param.data;
            var rawStr = '';
            if (typeof d === 'string') {
              rawStr = d;
            } else if (d && typeof d === 'object') {
              var keys = ['url', 'query', 'path', 'params', 'uri', 'link'];
              for (var i = 0; i < keys.length; i++) {
                var v = d[keys[i]];
                if (typeof v === 'string') rawStr += ' ' + v;
                else if (v && typeof v === 'object') { try { rawStr += ' ' + JSON.stringify(v); } catch (e) {} }
              }
            }
            var m = String(rawStr).match(/sid=([0-9]+)/);
            if (!m) return;
            const shareId = m[1];
            // 提取 rid（推演记录 ID，用于 type='result' 推演结果分享）
            var ridMatch = String(rawStr).match(/rid=([0-9]+)/);
            const recordId = ridMatch ? ridMatch[1] : '';
            // 判断分享类型：URL 包含 result.html 或有 rid 则为推演结果分享，否则为匹配分享
            const isResultShare = /result\.html/.test(rawStr) || !!recordId;
            if (isResultShare && recordId) {
              app.globalData.pendingShareType = 'result';
              app.globalData.pendingShareId = recordId;
              console.log('[deeplink] 推演结果唤起，rid=' + recordId);
            } else {
              app.globalData.pendingShareType = 'match';
              app.globalData.pendingShareId = shareId;
              console.log('[deeplink] 匹配唤起，sid=' + shareId);
            }
            app.handlePendingShare();
          } catch (e) {
            console.error('[deeplink] 解析异常:', e);
          }
        });
        console.log('[deeplink] registOpenURL 已注册');
      }
    } catch (e) {
      console.warn('[deeplink] 注册失败:', e);
    }
  },

  async tryLogin(savedToken) {
    // v15.3.2 冷却锁：5秒内不重复调用 wx.login，避免 onLaunch + api.js 401 重试触发微信45011限流
    const now = Date.now();
    if (now - _lastLoginTime < LOGIN_COOLDOWN_MS) {
      console.log('[tryLogin] 冷却中(' + (LOGIN_COOLDOWN_MS - (now - _lastLoginTime)) + 'ms)，跳过重复登录');
      // 已有 token 则直接返回，否则返回进行中的 loginPromise
      if (this.globalData.token && this.globalData.openid) return;
      // [FIX] App 端冷启动（有 token 但 openid 未恢复）不受冷却限制，继续走 token 恢复
      // 冷却锁仅用于防止小程序 wx.login 重复调用触发微信 45011 限流
      if (this.globalData.isMpWeixin || !savedToken) {
        return this.globalData.loginPromise || Promise.reject(new Error('login cooldown'));
      }
    }
    _lastLoginTime = now;

    // 小程序环境：静默wx.login
    if (this.globalData.isMpWeixin) {
      console.log('[tryLogin] 小程序环境，调用wx.login静默登录');
      // 清理可能存在的旧token（避免旧token导致后续接口401连锁）
      if (savedToken && !this.globalData.openid) {
        console.log('[tryLogin] 清理旧token，重新wx.login');
        storage.remove('token');
        this.globalData.token = '';
      }
      try {
        return await this.login();
      } catch (e) {
        console.error('[tryLogin] wx.login失败:', e.message);
        throw e;
      }
    }

    // App 环境：仅尝试用token恢复会话，不主动唤起微信登录
    // 微信登录是用户主动操作（唤起微信App），不能放在tryLogin中自动触发
    if (savedToken) {
      console.log('[tryLogin] App端有token，尝试恢复会话');
      try {
        await this.restoreSession();
        if (this.globalData.openid) return;
      } catch (e) {
        console.log('[tryLogin] restoreSession失败:', e.message);
        storage.remove('token');
        this.globalData.token = '';
      }
    }

    // App端无有效token：不自动登录，游客模式浏览
    // 用户需要登录时（如推演、匹配），由具体页面调用 app.login() 引导登录
    console.log('[tryLogin] App端无有效token，游客模式浏览');
    return Promise.resolve();
  },

  async login() {
    if (this.globalData.token && this.globalData.openid) {
      return;
    }

    // 🔴 v18.6 并发锁：进行中的登录直接复用同一 Promise，防止多页面/多生命周期
    // 同时触发 wx.weixinAppLogin 导致微信授权界面被反复唤起（VIP页 onLoad+onShow 双调即典型场景）
    if (this._loginInflight) {
      console.log('[login] 已有登录进行中，复用同一登录流程');
      return this._loginInflight;
    }

    this._loginInflight = this._doLogin();
    try {
      await this._loginInflight;
    } finally {
      this._loginInflight = null;
    }
  },

  async _doLogin() {
    try {
      wx.showLoading({ title: i18n.isEn() ? 'Signing in...' : '登录中...', mask: true });

      let code;
      
      if (this.globalData.isMpWeixin) {
        // 小程序环境：使用 wx.login
        const res = await new Promise((resolve, reject) => {
          wx.login({
            timeout: 10000,
            success: resolve,
            fail: reject
          });
        });
        code = res.code;
      } else {
        // App 环境：使用 wx.weixinAppLogin 直接唤起微信 App 登录
        // 官方文档：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/api/auth/wx.weixinAppLogin.html
        // 注意：该接口不支持在「移动应用助手」中调试，需构建 apk/ipa 安装到手机后调试
        console.log('[login] App端环境，调用wx.weixinAppLogin直接唤起微信登录');
        const res = await new Promise((resolve, reject) => {
          wx.weixinAppLogin({
            success: resolve,
            fail: reject
          });
        });
        code = res.code;
      }

      if (!code) {
        console.error('[login] 获取code失败');
        wx.hideLoading();
        wx.showToast({ title: i18n.isEn() ? 'Login failed, please retry' : '登录失败，请重试', icon: 'none' });
        return;
      }

      // v16.15 双端登录：小程序用 /login，App端用 /miniapp-login（多端应用凭证）
      const loginPath = this.globalData.isMpWeixin ? '/api/auth/login' : '/api/auth/miniapp-login';
      const result = await api.request(loginPath, 'POST', { code: code });

      wx.hideLoading();

      if (result.success && result.data && result.data.openid) {
        const { openid, token, quota_remaining, plan_type, points } = result.data;

        this.globalData.openid = openid;
        this.globalData.token = token;

        // Bug #4修复：只存token，不单独存openid
        storage.set('token', token);
        // openid存在内存中，不持久化到storage

        // v2.4 推送：登录成功后上报 RegistrationID（若 App 已注册推送）
        try {
          require('./utils/push.js').reportRegistrationId();
        } catch (e) {}

        if (quota_remaining !== undefined) this.globalData.quota = quota_remaining;
        if (plan_type) this.globalData.planType = plan_type;
        // v17.0 积分体系：同步积分余额
        if (points !== undefined) this.globalData.points = points;

        await this.checkProfile(openid);
        this.handlePendingShare();

        // 微信登录成功后，未绑定邮箱则引导绑定（每7天最多弹一次，邮箱登录用户不触发）
        this.promptBindEmailIfNeeded();
      } else {
        console.error('[login] Login failed:', result);
        wx.showToast({ title: result.message || (i18n.isEn() ? 'Login failed' : '登录失败'), icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      // App端错误：直接抛出，让 tryLogin 处理
      if (e.errMsg && e.errMsg.indexOf('多端App无法使用') > -1) {
        throw e;
      }
      console.error('[login] Login error', e);
      wx.showToast({ title: i18n.isEn() ? 'Network error, please retry' : '网络异常，请重试', icon: 'none' });
      throw e;
    }
  },

  // App端：有token时恢复会话（用token获取用户信息）
  async restoreSession() {
    try {
      // 用token调一个需要认证的接口，验证token是否有效
      // 同时拿到openid（使用 /me 路由，避免与 /profile/:openid 冲突）
      const result = await api.request('/api/user/me', 'GET');
      if (result.success && result.data) {
        // 从profile接口获取openid（后端从token中解析）
        // 实际上profile接口返回的是当前token用户的信息
        const openid = result.data.openid || '';
        if (openid) {
          this.globalData.openid = openid;
          if (result.data.quota_remaining !== undefined) this.globalData.quota = result.data.quota_remaining;
          if (result.data.plan_type) this.globalData.planType = result.data.plan_type;
          // v17.0 积分体系：同步积分余额
          if (result.data.points !== undefined) this.globalData.points = result.data.points;
          this.globalData.hasProfile = !!result.data.has_profile;
          this.globalData.profile = result.data;
          // v2.4.1 推送：恢复会话成功后补报 RegistrationID（App 端每天打开最常见的登录恢复路径）
          try {
            require('./utils/push.js').ensureReport();
          } catch (e) {}
          this.handlePendingShare();
          return;
        }
      }
      // token无效，清除（游客模式下不自动跳转登录页）
      console.log('[restoreSession] token无效，已清除');
      storage.remove('token');
      this.globalData.token = '';
    } catch (e) {
      console.error('[restoreSession] error', e);
      storage.remove('token');
      this.globalData.token = '';
    }
  },

  // App端：跳转到登录页（带防循环守卫）
  _redirectingToLogin: false,
  redirectToLogin() {
    if (this._redirectingToLogin) {
      console.log('[redirectToLogin] 已在跳转中，跳过');
      return Promise.resolve();
    }
    this._redirectingToLogin = true;
    console.log('[redirectToLogin] 跳转到登录页');
    setTimeout(() => {
      this._redirectingToLogin = false;
      wx.reLaunch({ url: '/pages/login/login' });
    }, 100);
    return Promise.resolve();
  },

  async checkProfile(openid) {
    try {
      const result = await api.request('/api/user/profile/' + encodeURIComponent(openid), 'GET');
      if (result.success && result.data && result.data.has_profile) {
        this.globalData.hasProfile = true;
        this.globalData.profile = result.data;
        if (result.data.quota_remaining !== undefined) this.globalData.quota = result.data.quota_remaining;
        if (result.data.plan_type) this.globalData.planType = result.data.plan_type;
        // v17.0 积分体系：同步积分余额
        if (result.data.points !== undefined) this.globalData.points = result.data.points;
        // 初始化vipDecodeRemaining（VIP用户直接从超推入口进入时需要）
        if (result.data.plan_type !== 'free') {
          try {
            const vipRes = await api.request('/api/payment/vip-info/' + encodeURIComponent(openid), 'GET');
            if (vipRes.success && vipRes.data) {
              this.globalData.vipDecodeRemaining = vipRes.data.vipDecodeRemaining || 0;
            }
          } catch(e) { /* 静默失败 */ }
        }
      } else {
        this.globalData.hasProfile = false;
        this.globalData.profile = null;
      }
    } catch (e) {
      console.error('checkProfile error', e);
      this.globalData.hasProfile = false;
    }
  },

  // 微信登录后引导绑定邮箱（未绑定邮箱时，每7天最多弹一次）
  promptBindEmailIfNeeded() {
    try {
      const profile = this.globalData.profile;
      // 已绑定邮箱或未建档，不提示
      if (!profile || profile.email) return;

      // 频率限制：每7天最多弹一次
      const lastPrompt = storage.get('bind_email_last_prompt') || 0;
      const now = Date.now();
      if (now - lastPrompt < 7 * 24 * 60 * 60 * 1000) return;

      storage.set('bind_email_last_prompt', now);

      const isEn = i18n.isEn();
      wx.showModal({
        title: isEn ? 'Bind Email' : '绑定邮箱',
        content: isEn
          ? 'Bind your email so you can sign in with email next time, and recover your account if needed.'
          : '绑定邮箱后，下次换手机可用邮箱登录，也能找回账号。',
        confirmText: isEn ? 'Bind Now' : '去绑定',
        cancelText: isEn ? 'Later' : '稍后',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/sub/profile/bind-email/index' });
          }
        }
      });
    } catch (e) {
      // 静默失败，不影响登录
    }
  },

  handlePendingShare() {
    const shareType = this.globalData.pendingShareType;
    const shareId = this.globalData.pendingShareId;
    if (!shareType || !shareId) return;

    if (shareType === 'result') {
      wx.redirectTo({ url: '/pages/result/index?id=' + shareId + '&shared=1' });
    } else if (shareType === 'match') {
      this.resolveMatchShare(shareId);
    }
  },

  async resolveMatchShare(shareId) {
    try {
      const result = await api.request('/api/share/resolve/' + shareId, 'GET');
      if (result.success && result.data) {
        // v3.6 匹配结果分享（type='match_result'）：展示分享者当时的匹配结果（双方卦象来自分享链接）
        if (result.data.type === 'match_result') {
          var mUrl = '/sub/match/match/index?sharerGuaId=' + (result.data.sharerGuaId || '') + '&myGuaId=' + (result.data.partnerGuaId || '') + '&fromHistory=1';
          if (result.data.sharerNickname) mUrl += '&sharerNickname=' + encodeURIComponent(result.data.sharerNickname);
          wx.redirectTo({ url: mUrl });
          return;
        }
        if (this.globalData.hasProfile) {
          const myGuaId = this.globalData.profile.ming_ben_gua;
          var url = '/sub/match/match/index?sharerGuaId=' + (result.data.sharerGuaId || '') + '&myGuaId=' + myGuaId;
          if (result.data.sharerOpenid) url += '&sharerOpenid=' + encodeURIComponent(result.data.sharerOpenid);
          if (result.data.sharerNickname) url += '&sharerNickname=' + encodeURIComponent(result.data.sharerNickname);
          wx.redirectTo({ url: url });
        } else {
          this.globalData.pendingMatchGuaId = result.data.sharerGuaId;
          this.globalData.pendingMatchOpenid = result.data.sharerOpenid || '';
          this.globalData.pendingMatchNickname = result.data.sharerNickname || '';
          wx.redirectTo({ url: '/pages/profile/index?fromMatch=1' });
        }
      } else {
        wx.showModal({ title: i18n.isEn() ? 'Notice' : '提示', content: i18n.isEn() ? 'Share link expired' : '分享短码已失效', showCancel: false, confirmText: i18n.isEn() ? 'Back to Home' : '返回首页' });
      }
    } catch (e) {
      console.error('resolveMatchShare error', e);
      wx.showModal({ title: i18n.isEn() ? 'Notice' : '提示', content: i18n.isEn() ? 'Share link expired' : '分享短码已失效', showCancel: false, confirmText: i18n.isEn() ? 'Back to Home' : '返回首页' });
    }
  },

  navigateToMatchIfNeeded() {
    const pendingGuaId = this.globalData.pendingMatchGuaId;
    if (pendingGuaId && this.globalData.hasProfile) {
      const myGuaId = this.globalData.profile.ming_ben_gua;
      const pendingOpenid = this.globalData.pendingMatchOpenid || '';
      const pendingNickname = this.globalData.pendingMatchNickname || '';
      this.globalData.pendingMatchGuaId = 0;
      this.globalData.pendingMatchOpenid = '';
      this.globalData.pendingMatchNickname = '';
      var url = '/sub/match/match/index?sharerGuaId=' + pendingGuaId + '&myGuaId=' + myGuaId;
      if (pendingOpenid) url += '&sharerOpenid=' + encodeURIComponent(pendingOpenid);
      if (pendingNickname) url += '&sharerNickname=' + encodeURIComponent(pendingNickname);
      wx.redirectTo({ url: url });
      return true;
    }
    return false;
  },

  playSound(name) { soundManager.play(name); }
});
