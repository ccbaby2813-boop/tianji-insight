/**
 * sub/learn/native-gua/index.js - 易经人格详情页
 * "测测你和 ta 的易缘"按钮 → 直接调起微信分享 → 对方点击 → 进入匹配页
 */
const api = require('../../../utils/api.js');
const soundManager = require('../../../utils/audio.js');
const router = require('../../../utils/router.js');
const shareUtil = require('../../../utils/share.js');
const i18n = require('../../../utils/i18n.js');

Page({
  data: { gua: {}, keywords: [], viewerGender: '', nickname: '', ownerLabel: '', collapseKeys: { classic: false, renge: false, emotion: false, growth: false }, isMpWeixin: true, t: {}, shareId: '' },

  // v2.0 折叠区切换（参考 pages/result/index.js 实现）
  toggleCollapse: function(e) {
    var key = e.currentTarget.dataset.key;
    if (!key) return;
    var current = this.data.collapseKeys[key] || false;
    var patch = {};
    patch['collapseKeys.' + key] = !current;
    this.setData(patch);
    soundManager.play('click');
  },

  onLoad(opt) {
    soundManager.init();
    const app = getApp();
    this.setData({ isMpWeixin: app.globalData.isMpWeixin });
    this.applyI18n();
    const p = app.globalData.profile;
    this._guaId = opt.guaId || (p && p.ming_ben_gua);
    if (this._guaId) {
      this._loadFromProfile();
    } else {
      // profile未就绪（冷启动直接进子包页面），等待后重试
      this.setData({ gua: {}, keywords: [] });
      this._waitForProfile();
    }
    // 预生成分享短码：App端分享深链 match.html?sid=，接收者点开可唤起App进入匹配
    this._preGenerateShareCode();
  },

  onShow() {

    i18n.applyNavTitle('sub/learn/native-gua/index');
    this.setData({ lang: i18n.getLang() });
    // 跳过首次（onLoad已加载），仅从编辑档案返回时刷新
    if (!this._firstShow) { this._firstShow = true; return; }
    this.applyI18n();
    this._loadFromProfile();
  },

  applyI18n() {
    const dict = i18n.page('learn');
    const nickname = this.data.nickname || '';
    const ownerLabel = nickname
      ? i18n.fill(dict.guaOwner || '{name}的专属人格', { name: nickname })
      : '';
    this.setData({ t: dict, ownerLabel: ownerLabel });
  },

  _waitForProfile() {
    var tries = 0;
    var that = this;
    // clear old timer if any (defensive)
    if (this._profileTimer) clearInterval(this._profileTimer);
    this._profileTimer = setInterval(function() {
      tries++;
      var p = getApp().globalData.profile;
      if (p && p.ming_ben_gua) {
        clearInterval(that._profileTimer);
        that._profileTimer = null;
        that._guaId = p.ming_ben_gua;
        that._loadFromProfile();
      } else if (tries >= 20) {
        clearInterval(that._profileTimer);
        that._profileTimer = null;
        // 超时：仍然尝试加载（参数guaId可能有效）
        if (that._guaId) that._loadFromProfile();
      }
    }, 500);
  },

  onUnload() {
    if (this._profileTimer) {
      clearInterval(this._profileTimer);
      this._profileTimer = null;
    }
  },

  _loadFromProfile() {
    const app = getApp();
    const p = app.globalData.profile;
    const rawGender = p && p.gender ? p.gender : '';
    const gender = (rawGender === 'male' || rawGender === 'female') ? rawGender : '';
    const nickname = p && p.nickname ? p.nickname : '';
    this.setData({ viewerGender: gender, nickname: nickname });
    this.applyI18n();
    const guaId = this._guaId || (p && p.ming_ben_gua);
    if (guaId) this.loadGua(guaId);
  },

  async loadGua(id) {
    try {
      const lang = i18n.isEn() ? 'en' : 'zh';
      const res = await api.request('/api/gua/' + id + '?lang=' + encodeURIComponent(lang), 'GET');
      if (res.success && res.data) {
        const g = res.data;
        // WXSS 不支持中文类名，将五行（金木水火土）转为拼音作为 CSS 类名
        g.wuxingClass = this.wuxingToPinyin(g.wuxing);
        const keywords = g.guan_jian_ci ? g.guan_jian_ci.split('·') : [];
        this.setData({ gua: g, keywords });
      }
    } catch (e) { console.error('loadGua:', e); }
  },

  // 五行中文 → 拼音映射（用于 WXSS 类名，规避中文类名编译错误）
  wuxingToPinyin(wuxing) {
    const map = { '金': 'jin', '木': 'mu', '水': 'shui', '火': 'huo', '土': 'tu' };
    return map[wuxing] || 'jin';
  },

  /**
   * 微信分享 - 测测易缘
   * 用户点击"测测你和ta的易缘"按钮后触发
   * 对方点击分享卡片 → 进入首页 → 引导建档 → 自动匹配
   * 注意：分享路径必须指向主包首页，不能指向子包页面
   */
  onShareAppMessage() {
    const { gua } = this.data;
    const guaName = gua.full_name || gua.name || (i18n.isEn() ? 'I Ching Archetype' : '易经人格');
    const guaGe = gua.gua_ge || '';
    const sharerGua = gua.id || (getApp().globalData.profile && getApp().globalData.profile.ming_ben_gua) || 1;
    // 关键：分享时带上 A 的 openid，否则 B 建档后写记录时 user_a_openid 为空
    const app = getApp();
    const sharerOpenid = app.globalData.openid || '';

    const dict = i18n.page('learn');
    const isEn = i18n.isEn();
    // 分享标题：展示"我的专属人格XX"
    var title;
    if (isEn) {
      title = "My archetype is " + guaName + (guaGe ? '「' + guaGe + '」' : '') + ', come test our affinity!';
    } else {
      title = i18n.fill(dict.guaShareTitle || '我的专属人格是{name}，快来测测你和我的缘分！', { name: guaName });
      if (guaGe) title = guaName + '「' + guaGe + '」，快来测测你和我的缘分！';
    }

    return {
      title: title,
      path: '/pages/index/index?fromMatch=1&shareGua=' + sharerGua + '&sharerOpenid=' + encodeURIComponent(sharerOpenid),
      imageUrl: ''
    };
  },

  // 🔴 v3.5 新增：分享到朋友圈（接收者通过 guaId=X 直接查看同一卦象详情）
  onShareTimeline() {
    const { gua } = this.data;
    const guaName = gua.full_name || gua.name || (i18n.isEn() ? 'I Ching Archetype' : '易经人格');
    const guaGe = gua.gua_ge || '';
    const guaId = gua.id || 1;
    var ziChao = gua.zi_chao_biao_qian || '';
    var title;
    if (i18n.isEn()) {
      if (ziChao) {
        title = '「' + ziChao + '」— ' + guaName + ' archetype reading';
      } else {
        title = guaName + (guaGe ? '·' + guaGe : '') + ' - I Ching 64 Archetypes';
      }
    } else {
      if (ziChao) {
        title = '「' + ziChao + '」——' + guaName + '的人格解读';
      } else {
        title = guaName + (guaGe ? '·' + guaGe : '') + ' - 易经64卦人格解读';
      }
    }
    return {
      title: title,
      query: 'guaId=' + guaId,
      imageUrl: ''
    };
  },

  // 预生成分享短码（onShareAppMessage是同步函数，不能用await；type='match' 与 app.js handlePendingShare 对应）
  async _preGenerateShareCode() {
    try {
      const app = getApp();
      if (app.globalData.loginPromise) await app.globalData.loginPromise;
      if (!app.globalData.openid) return;
      const codeRes = await api.requestWithAuth('/api/share/code', 'POST', { type: 'match' });
      if (codeRes.success && codeRes.data && codeRes.data.share_id) {
        this.setData({ shareId: codeRes.data.share_id });
      }
    } catch (e) {
      console.error('_preGenerateShareCode error:', e);
    }
  },

  // APP端分享按钮点击：优先分享 H5 深链（match.html?sid=），
  // 接收者点开 → 网页内引导/浏览器唤起 App → 自动进入双方匹配结果页；短码未就绪时回退官网
  onShareTap() {
    const shareInfo = this.onShareAppMessage();
    const shareId = this.data.shareId;
    const h5Url = shareId ? (shareUtil.H5_WEB_BASE + 'match.html?sid=' + shareId + (i18n.isEn() ? '&lang=en' : '')) : shareUtil.H5_WEB_BASE;
    shareUtil.shareWebPageMessage({
      webpageUrl: h5Url,
      title: shareInfo.title,
      description: shareInfo.description || ''
    });
  },

  goBack() {
    soundManager.play('click');
    router.safeNavigateBack(1, '/pages/my/index');
  }
});
