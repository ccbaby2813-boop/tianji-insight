/**
 * sub/match/match/index.js - 易缘匹配结果页
 * v3.0 redesign：新增折叠区交互（toggleCollapse / collapseKeys），其余逻辑保持不变
 * 
 * 完整链路：
 * 1. A分享 → 生成短码 (share_codes 表存 A的openid)
 * 2. B点击 → 解析短码 (返回 A的openid + A的卦ID)
 * 3. B进入匹配页 → 加载匹配结果
 * 4. 写记录: user_a_openid=A的openid, user_b_openid=B的openid
 * 5. "我的易缘" → 查 user_a_openid=? OR user_b_openid=?
 */
const api = require('../../../utils/api.js');
const soundManager = require('../../../utils/audio.js');
const shareUtil = require('../../../utils/share.js');
const i18n = require('../../../utils/i18n.js'); // v19.2

Page({
  onShow() {
    i18n.applyNavTitle('sub/match/match/index');
    this.setData({ lang: i18n.getLang() });
    this.applyI18n();
  },
  data: {
    pageState: 'loading',
    guaA: {},   // 分享者（A）的卦
    guaB: {},   // 当前用户（B）的卦
    relation: {},
    levelClass: '',  // 匹配等级 CSS 类名（tianzuo/moqi/hubu）
    shareId: '',  // 预生成的分享短码（用于 onShareAppMessage）
    nicknameA: '',  // 分享者昵称
    nicknameB: '',  // 当前用户昵称
    isVipA: false,  // v1.3.3 分享者 VIP 状态
    isVipB: false,  // v1.3.3 当前用户 VIP 状态
    sharerOpenid: '',  // 分享者 openid（用于"给ta写信"跳转）
    sharePosterImagePath: '',  // v3.5 新增：预生成的双卦关系分享海报图路径
    isMpWeixin: true,
    // v3.0 redesign：折叠区默认收起
    collapseKeys: { analysis: false, resonance: false, conflict: false, advice: false },
    // v19.2 双语字典
    t: {}
  },

  // v19.2 加载 match 模块双语字典
  applyI18n() {
    this.setData({ t: i18n.page('match') });
  },

  // v3.0 redesign：折叠区切换
  toggleCollapse: function(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const current = this.data.collapseKeys[key] || false;
    const patch = {};
    patch['collapseKeys.' + key] = !current;
    this.setData(patch);
    soundManager.play('click');
  },

  onLoad(opt) {
    soundManager.init();
    this.setData({ isMpWeixin: getApp().globalData.isMpWeixin });
    // v19.2 加载 match 模块双语字典
    this.applyI18n();

    // v16.15 支持从匹配池（match-pool）跳转：fromPool=1
    // 参数：targetGuaId, targetOpenid, targetNickname, targetIsVip, matchId
    const fromPool = opt.fromPool === '1';
    if (fromPool) {
      const targetGuaId = parseInt(opt.targetGuaId);
      const targetOpenid = decodeURIComponent(opt.targetOpenid || '');
      const targetNickname = decodeURIComponent(opt.targetNickname || '');
      const targetIsVip = opt.targetIsVip === '1' || opt.targetIsVip === 1;
      this._fromPool = true;
      this._targetOpenid = targetOpenid;
      this._targetNickname = targetNickname;
      this._targetIsVip = targetIsVip;

      if (targetGuaId) {
        // 等待当前用户 profile 加载
        const app = getApp();
        const dict = i18n.page('match');
        if (app.globalData.hasProfile && app.globalData.profile && app.globalData.profile.ming_ben_gua) {
          this.loadMatch(targetGuaId, app.globalData.profile.ming_ben_gua, targetOpenid);
        } else {
          this.setData({ pageState: 'loading', loadingText: dict.loadingTextProfile });
          var tries = 0;
          if (this._profileTimer) clearInterval(this._profileTimer);
          this._profileTimer = setInterval(() => {
            tries++;
            if (app.globalData.hasProfile && app.globalData.profile && app.globalData.profile.ming_ben_gua) {
              clearInterval(this._profileTimer);
              this._profileTimer = null;
              this.loadMatch(targetGuaId, app.globalData.profile.ming_ben_gua, targetOpenid);
            } else if (tries >= 20) {
              clearInterval(this._profileTimer);
              this._profileTimer = null;
              this.setData({ pageState: 'error', errorMsg: dict.errorNoProfile });
            }
          }, 500);
        }
      } else {
        const dict = i18n.page('match');
        this.setData({ pageState: 'error', errorMsg: dict.errorIncomplete });
      }
      this._preGenerateShareCode();
      return;
    }

    // 原有逻辑：从分享链接进入
    // 关键：从 URL 参数中取 sharerOpenid（A的openid）
    const sharerGuaId = parseInt(opt.sharerGuaId);
    const myGuaId = parseInt(opt.myGuaId) || parseInt(opt.guaB);
    const sharerOpenid = decodeURIComponent(opt.sharerOpenid || '');
    const sharerNickname = decodeURIComponent(opt.sharerNickname || '');
    const sharerIsVip = opt.sharerIsVip === '1' || opt.sharerIsVip === 1 || opt.sharerIsVip === true; // v1.3.3 分享者VIP状态
    const fromHistory = opt.fromHistory === '1'; // 从历史记录查看，不写入新记录
    this._sharerNickname = sharerNickname; // 暂存，loadMatch 中使用
    this._sharerIsVip = sharerIsVip; // v1.3.3 暂存分享者VIP状态
    this._fromHistory = fromHistory;

    if (sharerGuaId) {
      if (myGuaId) {
        this.loadMatch(sharerGuaId, myGuaId, sharerOpenid);
      } else {
        // 等待 profile 加载
        const app = getApp();
        const dict = i18n.page('match');
        if (app.globalData.hasProfile && app.globalData.profile && app.globalData.profile.ming_ben_gua) {
          this.loadMatch(sharerGuaId, app.globalData.profile.ming_ben_gua, sharerOpenid);
        } else {
          this.setData({ pageState: 'loading', loadingText: dict.loadingTextProfile });
          // 轮询等待profile加载，最多等10秒（每500ms检查一次）
          var tries = 0;
          if (this._profileTimer) clearInterval(this._profileTimer);
          this._profileTimer = setInterval(() => {
            tries++;
            if (app.globalData.hasProfile && app.globalData.profile && app.globalData.profile.ming_ben_gua) {
              clearInterval(this._profileTimer);
              this._profileTimer = null;
              this.loadMatch(sharerGuaId, app.globalData.profile.ming_ben_gua, sharerOpenid);
            } else if (tries >= 20) {
              clearInterval(this._profileTimer);
              this._profileTimer = null;
              this.setData({ pageState: 'error', errorMsg: dict.errorNoProfile });
            }
          }, 500);
        }
      }
    } else {
      // 直接传了 guaA 和 guaB（非分享场景）
      const guaA = parseInt(opt.guaA);
      const guaB = parseInt(opt.guaB);
      if (guaA && guaB) {
        this.loadMatch(guaA, guaB, '');
      } else {
        const dict = i18n.page('match');
        this.setData({ pageState: 'error', errorMsg: dict.errorIncomplete });
      }
    }

    // 预生成分享短码（onShareAppMessage是同步函数不能用await，必须提前生成）
    this._preGenerateShareCode();
  },

  async loadMatch(sharerGuaId, myGuaId, sharerOpenid) {
    const app = getApp();
    try {
      // 调用匹配 API（v19.2 英文态带 lang 触发后端双语输出）
      const res = await api.request('/api/relationship/' + sharerGuaId + '/' + myGuaId + (i18n.isEn() ? '?lang=en' : ''), 'GET');
      if (res.success && res.data) {
        // === 记录匹配结果（仅分享场景，从历史查看不重复写入） ===
        // v16.15 fromPool 场景：匹配记录已在 match-pool 中创建，不再重复写入
        if (sharerOpenid && !this._fromHistory && !this._fromPool) {
          try {
            try { await app.waitForLogin(); } catch(e) { /* ignored */ }
            const myOpenid = app.globalData.openid;

            if (myOpenid) {
              await api.request('/api/match/record', 'POST', {
                user_a_openid: sharerOpenid,
                user_b_openid: myOpenid,
                user_a_gua: sharerGuaId,
                user_b_gua: myGuaId,
                relationship_key: Math.min(sharerGuaId, myGuaId) + '-' + Math.max(sharerGuaId, myGuaId),
                relationship_name: res.data.relationship_name,
                match_level: res.data.match_level
              });
            }
          } catch (e) { console.error('[match/record] error:', e); }
        }

        const guaAData = res.data.guaA;
        const guaBData = res.data.guaB;

        // v16.15 fromPool 场景：使用传入的 target 信息
        const nicknameA = this._fromPool ? (this._targetNickname || '') : (app.globalData._matchSharerNickname || this._sharerNickname || '');
        const isVipA = this._fromPool ? !!this._targetIsVip : !!this._sharerIsVip;
        const finalSharerOpenid = this._fromPool ? (this._targetOpenid || '') : (sharerOpenid || '');

        this.setData({
          pageState: 'loaded',
          relation: res.data,
          levelClass: this._getLevelClass(res.data.match_level || ''),
          guaA: {
            id: sharerGuaId,
            symbol: (guaAData && guaAData.symbol) || this.sym(sharerGuaId),
            name: (guaAData && guaAData.full_name) || (guaAData && guaAData.name) || '',
            gua_ge: (guaAData && guaAData.gua_ge) || ''
          },
          guaB: {
            id: myGuaId,
            symbol: (guaBData && guaBData.symbol) || this.sym(myGuaId),
            name: (guaBData && guaBData.full_name) || (guaBData && guaBData.name) || '',
            gua_ge: (guaBData && guaBData.gua_ge) || ''
          },
          nicknameB: (app.globalData.profile && app.globalData.profile.nickname) || '',
          nicknameA: nicknameA,
          // v1.3.3 VIP 状态：B方从当前用户 plan_type 判断，A方从分享链接传入
          isVipB: !!(app.globalData.profile && app.globalData.profile.plan_type && app.globalData.profile.plan_type !== 'free'),
          isVipA: isVipA,
          sharerOpenid: finalSharerOpenid
        });
        // 清理 globalData 中的临时昵称，避免残留
        if (app.globalData._matchSharerNickname) {
          app.globalData._matchSharerNickname = '';
        }
        // v3.6 双方卦象已确定：重新生成 match_result 分享码（scene 存 guaA:guaB）
        this._preGenerateShareCode(sharerGuaId, myGuaId);
        soundManager.play('success');

        // 防御：如果分享者昵称缺失但openid存在，尝试从后端获取
        if (!this.data.nicknameA && finalSharerOpenid) {
          try {
            const profileRes = await api.request('/api/user/profile/' + encodeURIComponent(finalSharerOpenid) + (i18n.isEn() ? '?lang=en' : ''), 'GET');
            if (profileRes.success && profileRes.data && profileRes.data.nickname) {
              this.setData({ nicknameA: profileRes.data.nickname });
            }
          } catch(e) { /* 静默失败 */ }
        }

        // v3.5 新增：预生成双卦关系分享海报图（onShareAppMessage是同步函数，需提前生成）
        this._preGenerateSharePoster();
      } else {
        // v19.4.2 英文首次翻译慢于 Nginx 30s 网关超时会 502（NETWORK_ERROR）：
        // 后台翻译完成后 Redis 缓存即命中，延迟自动重试即可成功；预热完成后缓存全量命中不再触发
        const retryable = res.code === 'NETWORK_ERROR' || res.code === 'INTERNAL_ERROR';
        if (retryable && (this._relRetryCount || 0) < 2) {
          this._relRetryCount = (this._relRetryCount || 0) + 1;
          const dict = i18n.page('match');
          this.setData({ pageState: 'loading', loadingText: dict.loadingTextTranslating });
          setTimeout(() => {
            this.loadMatch(sharerGuaId, myGuaId, sharerOpenid);
          }, 8000);
          return;
        }
        const dict = i18n.page('match');
        // 404=关系数据真不存在；其余（含超时重试后仍失败）=加载失败提示
        const msg = res.code === 'RECORD_NOT_FOUND' ? dict.errorNoRelation : (dict.errorLoadFail || dict.errorNoRelation);
        this.setData({ pageState: 'error', errorMsg: msg });
      }
    } catch (e) {
      console.error('[match] loadMatch error:', e);
      const dict = i18n.page('match');
      this.setData({ pageState: 'error', errorMsg: dict.errorLoadFail });
    }
  },

  sym(id) { return id >= 1 && id <= 64 ? String.fromCodePoint(0x4DC0 + id - 1) : '䷀'; },

  /**
   * 匹配等级 → CSS 类名映射（天作绿 / 默契蓝 / 互补橙）
   * v19.2 兼容英文态：翻译提示词约定 天作→Heaven-Made / 默契→Kindred / 互补→Complementary
   */
  _getLevelClass(matchLevel) {
    if (!matchLevel) return '';
    const level = matchLevel.trim();
    if (level.indexOf('天作') !== -1 || level.indexOf('Heaven-Made') !== -1) return 'level-tianzuo';
    if (level.indexOf('默契') !== -1 || level.indexOf('Kindred') !== -1) return 'level-moqi';
    if (level.indexOf('互补') !== -1 || level.indexOf('Complementary') !== -1) return 'level-hubu';
    return '';
  },

  /**
   * 预生成分享短码（onShareAppMessage是同步函数，不能用await）
   */
  async _preGenerateShareCode(guaA, guaB) {
    try {
      const app = getApp();
      if (app.globalData.loginPromise) {
        await app.globalData.loginPromise;
      }
      if (!app.globalData.openid) return;
      // v3.6 匹配结果分享：scene 存 "guaA:guaB"，落地页可完整展示匹配结果
      // 需双方卦象都已确定（loadMatch 成功后再调用）
      if (!guaA || !guaB) {
        // 双方卦象未就绪：先兜底生成（type='match'），loadMatch 成功后会用 match_result 覆盖
        const codeRes = await api.requestWithAuth('/api/share/code', 'POST', { type: 'match' });
        if (codeRes.success && codeRes.data && codeRes.data.share_id) {
          this.setData({ shareId: codeRes.data.share_id });
        }
        return;
      }
      const scene = guaA + ':' + guaB;
      const codeRes = await api.requestWithAuth('/api/share/code', 'POST', { type: 'match_result', scene: scene });
      if (codeRes.success && codeRes.data && codeRes.data.share_id) {
        this.setData({ shareId: codeRes.data.share_id });
      }
    } catch (e) {
      console.error('_preGenerateShareCode error:', e);
    }
  },

  /**
   * v3.5 新增：预生成双卦关系分享海报图
   * 调用 share-poster 组件的 generatePoster 方法，生成临时图片路径
   * 失败时静默降级为无图分享（微信自动截屏）
   */
  _preGenerateSharePoster() {
    try {
      const poster = this.selectComponent('#sharePoster');
      if (!poster || typeof poster.generatePoster !== 'function') return;
      // 延迟100ms确保组件数据绑定完成
      setTimeout(() => {
        const p = this.selectComponent('#sharePoster');
        if (!p) return;
        p.generatePoster().then((tempPath) => {
          if (tempPath) {
            this.setData({ sharePosterImagePath: tempPath });
          }
        }).catch((e) => {
          console.warn('[match] 生成分享海报失败，降级为无图分享:', e);
        });
      }, 100);
    } catch (e) {
      console.warn('[match] _preGenerateSharePoster error:', e);
    }
  },

  onShareAppMessage() {
    const { relation, guaA, guaB, shareId, sharePosterImagePath } = this.data;
    const matchName = relation.relationship_name || (this.data.t && this.data.t.matchDefaultName) || '天生一对';
    const app = getApp();
    const myGuaId = guaB.id || (app.globalData.profile && app.globalData.profile.ming_ben_gua);
    const sharerGua = guaA.id || myGuaId || 1;

    // v7.1: 增强互动钩子——制造好奇心驱动接收者点击
    var dict = i18n.page('match');
    var shareTitle = i18n.fill(dict.shareMatchTemplate, { name: matchName });
    // v3.5: 优先使用预生成的双卦关系海报图，提升分享点击率
    var imageUrl = sharePosterImagePath || '';

    if (shareId) {
      return {
        title: shareTitle,
        path: '/pages/index/index?scene=match:' + shareId,
        imageUrl: imageUrl
      };
    }

    // 短码生成失败时回退到直接分享（补充sharerOpenid以保证匹配记录完整）
    var fallbackPath = '/pages/index/index?fromMatch=1&shareGua=' + sharerGua;
    var sharerOpenid = app.globalData.openid || '';
    if (sharerOpenid) fallbackPath += '&sharerOpenid=' + encodeURIComponent(sharerOpenid);
    var sharerNickname = (app.globalData.profile && app.globalData.profile.nickname) || '';
    if (sharerNickname) fallbackPath += '&sharerNickname=' + encodeURIComponent(sharerNickname);
    // v1.3.3 传递分享者VIP状态
    var sharerIsVip = !!(app.globalData.profile && app.globalData.profile.plan_type && app.globalData.profile.plan_type !== 'free');
    fallbackPath += '&sharerIsVip=' + (sharerIsVip ? 1 : 0);
    return {
      title: shareTitle,
      path: fallbackPath,
      imageUrl: imageUrl
    };
  },

  // App端分享按钮点击（复用onShareAppMessage的分享内容）
  onShareTap() {
    const shareInfo = this.onShareAppMessage();
    const shareId = this.data.shareId;

    // v19.5 匹配分享改为分享 H5 链接（web/match.html），替代旧的小程序卡片分享：
    // 接收方点开链接 →
    //   已装App+已建档 → "打开App"以 scheme(tianji://match?sid=xxx) 唤起 App，展示双方匹配关系
    //   未装App/未建档  → 落地页引导下载 App / 建档
    if (shareId) {
      const matchName = this.data.relation.relationship_name || (this.data.t && this.data.t.matchDefaultName) || '天生一对';
      var shareTitle = shareInfo.title || matchName;
      const h5Url = 'https://claw-book.cn/tianji/web/match.html?sid=' + shareId + (i18n.isEn() ? '&lang=en' : '');
      var shareDesc = i18n.fill(i18n.page('match').shareMatchDesc || '点开查看「{name}」的契合关系', { name: matchName });
      shareUtil.shareWebPageMessage({
        webpageUrl: h5Url,
        title: shareTitle,
        description: shareDesc
      });
      return;
    }

    // 无短码时回退分享 H5 官网链接（不再分享小程序卡片）
    shareUtil.shareWebPageMessage({
      webpageUrl: shareUtil.H5_WEB_BASE,
      title: shareInfo.title,
      description: shareInfo.description || ''
    });
  },

  onUnload() {
    if (this._profileTimer) { clearInterval(this._profileTimer); this._profileTimer = null; }
  },

  goHome() { soundManager.play('click'); wx.switchTab({ url: '/pages/index/index' }); },
  goBack() { soundManager.play('click'); wx.navigateBack({ delta: 1 }); },

  goToNativeGua() {
    soundManager.play('click');
    const app = getApp();
    const guaId = app.globalData.profile && app.globalData.profile.ming_ben_gua;
    if (guaId) {
      wx.navigateTo({ url: '/sub/learn/native-gua/index?guaId=' + guaId });
    } else {
      wx.showToast({ title: i18n.page('match').toastNoProfile, icon: 'none' });
    }
  },

  goWriteLetter() {
    soundManager.play('click');
    const sharerOpenid = this.data.sharerOpenid;
    const sharerNickname = this.data.nicknameA;
    if (!sharerOpenid) {
      wx.showToast({ title: i18n.page('match').toastNoTarget, icon: 'none' });
      return;
    }
    // v1.3.3 传递收信人VIP状态（对方即分享者A，receiverIsVip=isVipA）
    const url = '/sub/match/letter-write/index?receiverOpenid=' + sharerOpenid
      + '&receiverNickname=' + encodeURIComponent(sharerNickname || '')
      + '&receiverIsVip=' + (this.data.isVipA ? 1 : 0);
    wx.navigateTo({ url });
  }
});
