const api = require('../../../utils/api.js');
const soundManager = require('../../../utils/audio.js');
const router = require('../../../utils/router.js');
const shareUtil = require('../../../utils/share.js');
const i18n = require('../../../utils/i18n.js'); // v19.2

Page({
  data: {
    showIntro: false,
    pageState: 'loading',
    errorMsg: '',
    emptyMsg: '',
    candidates: [],
    remaining: -1,
    isGuest: false,
    matching: false,
    isMpWeixin: true,
    // v19.2 双语字典（match 模块）
    t: {}
  },

  // v2.0 根据五行返回头像渐变 css 类名（金/土=gold, 火=warm, 木/水=cool）
  // v19.2 兼容英文五行值（Metal/Earth=gold, Fire=warm, Wood/Water=cool）
  getAvatarClass(wuxing) {
    const gold = wuxing === '金' || wuxing === '土' || wuxing === 'Metal' || wuxing === 'Earth';
    const warm = wuxing === '火' || wuxing === 'Fire';
    return 'avatar-gradient-' + (gold ? 'gold' : warm ? 'warm' : 'cool');
  },

  onShow() {

    i18n.applyNavTitle('sub/match/match-pool/index');
    soundManager.init();
    // v16.4 分享按钮需区分环境：小程序 open-type=share / App bindtap 调用 shareMiniProgramMessage
    const app = getApp();
    this.setData({ isMpWeixin: app.globalData.isMpWeixin });
    // v19.2 加载双语字典
    this.applyI18n();
    // 🔴 v3.4 修复：不再无条件弹出引导浮层
    // 首次进入由 loadPool 根据 introAgreed 决定是否显示，已同意则直接加载列表
    this.loadPool();
  },

  // v19.2 根据当前语言刷新 match 模块字典和剩余次数字符串
  applyI18n() {
    const dict = i18n.page('match');
    const common = i18n.common();
    const remaining = this.data.remaining;
    let remainStr = '';
    if (remaining === -1) {
      remainStr = dict.vipInfinite || '';
    } else if (remaining >= 0) {
      remainStr = i18n.fill(dict.remainCount || '', { n: remaining });
    }
    this.setData({
      t: dict,
      c: common,
      remainStr: remainStr,
      errLoad: dict.loadFail || '',
      errRetry: dict.retry || '',
      emptyMsg: dict.emptyMsg || ''
    });
  },

  onIntroAgree() {
    soundManager.play('click');
    // 仅关闭浮层，不重新 loadPool()：
    // onShow 已调用 loadPool() 加载好候选列表，再次请求会因后端不返回 introAgreed
    // 导致 showIntro 被重置为 true，浮层再次弹出
    this.setData({ showIntro: false });
  },

  onIntroCancel() {
    soundManager.play('click');
    router.safeNavigateBack(1, '/pages/my/index');
  },

  async loadPool() {
    this.setData({ pageState: 'loading' });
    try {
      const res = await api.request('/api/letter/match-pool' + (i18n.isEn() ? '?lang=en' : ''), 'GET');
      // v4.1 修复：处理后端返回错误码（如 PROFILE_INCOMPLETE）
      if (res && res.success === false) {
        const msg = res.message || (i18n.isEn() ? 'Failed to load, please retry' : '加载失败，请稍后再试');
        this.setData({ pageState: 'error', errorMsg: msg, showIntro: false });
        return;
      }
      // 后端响应：{ success, data: { remaining, candidates: [...], isGuest } }
      // v1.3.3 修复：默认值从 1 改为 -1，与初始 data.remaining 一致，避免后端异常时误显示"剩余1次"
      let list = [];
      let remaining = -1;
      let isGuest = false;
      // v3.5 硬约束：后端已移除 introAgreed 字段，引言每次进入都显示
      if (res && res.data) {
        if (Array.isArray(res.data)) {
          list = res.data;
        } else if (Array.isArray(res.data.candidates)) {
          list = res.data.candidates;
          remaining = typeof res.data.remaining === 'number' ? res.data.remaining : -1;
        }
        // 游客模式：后端返回 isGuest: true 时，不显示次数徽章
        isGuest = !!res.data.isGuest;
        if (isGuest) remaining = null;
      } else if (Array.isArray(res)) {
        list = res;
      }
      // 引言每次进入都显示（硬约束：用户每次进入板块时提示并要求同意才能进入）
      this.setData({ remaining: remaining, showIntro: true, isGuest: isGuest });
      // v19.2 刷新剩余次数字符串
      this.applyI18n();

      if (list.length) {
        const candidates = list.slice(0, 10).map(item => {
          // v1.5 性别字段：1=男，2=女
          const genderNum = Number(item.gender);
          const genderLabel = genderNum === 1 ? (i18n.isEn() ? 'Male' : '男') : genderNum === 2 ? (i18n.isEn() ? 'Female' : '女') : '';
          const genderSymbol = genderNum === 1 ? '♂' : genderNum === 2 ? '♀' : '';
          return {
            openid: item.openid || '',
            nickname: item.nickname || (i18n.isEn() ? 'Kindred' : '有缘人'),
            guaId: item.guaId || 0,
            guaName: item.guaName || '',
            guaGe: item.guaGe || '',
            personalityDesc: item.personalityDesc || '',
            isVip: !!item.isVip,
            avatarChar: (item.nickname || (i18n.isEn() ? 'Y' : '缘')).charAt(0),
            // v1.3.1 头像改用本命卦 Unicode 卦符（64卦 U+4DC0~U+4DFF）
            guaSymbol: item.guaId ? String.fromCharCode(0x4DC0 + (item.guaId - 1)) : '',
            // v1.3.2 出生年月日时（农历中文，后端格式化）
            birthDisplay: item.birthDisplay || '',
            // v1.5 出生阳历显示
            birthSolarDisplay: item.birthSolarDisplay || '',
            // v1.5 性别
            gender: genderNum,
            genderLabel: genderLabel,
            genderSymbol: genderSymbol,
            // v2.0 五行字段（用于头像渐变配色）
            wuxing: item.wuxing || '',
            // v4.1 五行拼音类名（WXSS 不支持中文选择器）
            wuxingClass: { '金':'jin','木':'mu','水':'shui','火':'huo','土':'tu' }[item.wuxing] || '',
            avatarClass: this.getAvatarClass(item.wuxing)
          };
        });
        this.setData({ pageState: 'loaded', candidates: candidates });
        // 绘制艺术曲线
        this.drawArtCurves(candidates.length);
      } else {
        const msg = this.data.t.emptyMsg || '暂无可传书的有缘人，请稍后再试';
        this.setData({ pageState: 'empty', candidates: [], emptyMsg: msg });
      }
    } catch (e) {
      this.setData({ pageState: 'error', errorMsg: this.data.t.loadFail || '加载失败，请检查网络' });
    }
  },

  // 绘制艺术曲线（女性S曲线 + 男性肌肉线）
  drawArtCurves(count) {
    const that = this;
    // 延迟确保 DOM 渲染完成
    setTimeout(() => {
      for (let i = 0; i < count; i++) {
        // 绘制女性S曲线
        const femaleCtx = wx.createCanvasContext('artFemale' + i, that);
        femaleCtx.setStrokeStyle('rgba(232, 180, 190, 0.7)');
        femaleCtx.setLineWidth(1.2);
        femaleCtx.setLineCap('round');
        femaleCtx.beginPath();
        // S形波浪：起点(5,30) -> 控制点1(20,10) -> 控制点2(35,10) -> 中点(50,30) -> 控制点3(65,50) -> 控制点4(80,50) -> 终点(95,30)
        femaleCtx.moveTo(5, 30);
        femaleCtx.bezierCurveTo(20, 10, 35, 10, 50, 30);
        femaleCtx.bezierCurveTo(65, 50, 80, 50, 95, 30);
        femaleCtx.stroke();
        femaleCtx.draw();

        // 绘制男性肌肉线
        const maleCtx = wx.createCanvasContext('artMale' + i, that);
        maleCtx.setStrokeStyle('rgba(200, 165, 91, 0.5)');
        maleCtx.setLineWidth(1.2);
        maleCtx.setLineCap('round');
        // 第一条线：左下到右上
        maleCtx.beginPath();
        maleCtx.moveTo(20, 50);
        maleCtx.lineTo(45, 25);
        maleCtx.stroke();
        // 第二条线：水平
        maleCtx.beginPath();
        maleCtx.moveTo(30, 35);
        maleCtx.lineTo(65, 35);
        maleCtx.stroke();
        // 第三条线：左上到右下
        maleCtx.beginPath();
        maleCtx.moveTo(25, 20);
        maleCtx.lineTo(50, 45);
        maleCtx.stroke();
        maleCtx.draw();
      }
    }, 100);
  },

  async onMatchTap(e) {
    soundManager.play('click');
    if (this.data.matching) return;
    // 游客模式拦截：未登录用户不能匹配
    const app = getApp();
    const t = this.data.t || {};
    if (!app.globalData.openid || !app.globalData.token) {
      wx.showModal({
        title: t.modalLoginTitle || (i18n.isEn() ? 'Hint' : '提示'),
        content: t.modalLoginContent || t.loginFirst || '请先登录并建立档案',
        showCancel: true,
        confirmText: t.modalLoginConfirm || t.goProfile || '去建档',
        cancelText: t.modalLoginCancel || t.cancel || '取消',
        success(res) {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/profile/index' });
          }
        }
      });
      return;
    }
    // 前端拦截：免费用户今日匹配次数已用完，跳转VIP页（remaining=-1 为会员无限）
    if (this.data.remaining === 0) {
      wx.navigateTo({ url: '/sub/vip/vip/index' });
      return;
    }
    const item = e.currentTarget.dataset.item;
    if (!item || !item.openid) return;
    this.setData({ matching: true });
    wx.showLoading({ title: t.loading || '缘起中...', mask: true });
    try {
      const res = await api.request('/api/letter/match', 'POST', { targetOpenid: item.openid, lang: i18n.getLang() });
      wx.hideLoading();
      // 次数用完
      if (res && res.code === 'MATCH_LIMIT_EXCEEDED') {
        wx.navigateTo({ url: '/sub/vip/vip/index' });
        return;
      }
      if (res && res.success) {
        let result = (res.data) ? res.data : res;
        // 已匹配过的直接跳转写信
        if (result && result.skipped) {
          const url = '/sub/match/letter-write/index?receiverOpenid=' + item.openid
            + '&receiverNickname=' + encodeURIComponent(item.nickname || '')
            + '&receiverIsVip=' + (item.isVip ? 1 : 0);
          wx.navigateTo({ url });
          return;
        }
        // v16.15 跳转到统一匹配结果页（match/index），不再使用内嵌浮层
        // 传递 targetGuaId + targetOpenid + targetNickname，match/index 自行加载关系数据
        const targetGuaId = item.guaId || 0;
        const targetOpenid = item.openid || '';
        const targetNickname = item.nickname || (i18n.isEn() ? 'Kindred' : '有缘人');
        const targetIsVip = !!item.isVip;
        wx.navigateTo({
          url: '/sub/match/match/index?fromPool=1'
            + '&targetGuaId=' + targetGuaId
            + '&targetOpenid=' + encodeURIComponent(targetOpenid)
            + '&targetNickname=' + encodeURIComponent(targetNickname)
            + '&targetIsVip=' + (targetIsVip ? 1 : 0)
            + '&matchId=' + (result ? result.id || '' : '')
        });
      } else {
        const msg = (res && res.message) ? res.message : '匹配失败，请稍后再试';
        wx.showToast({ title: msg, icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: this.data.c?.networkError || i18n.page('match').loadFail, icon: 'none' });
    } finally {
      this.setData({ matching: false });
    }
  },

  retry() {
    soundManager.play('click');
    this.loadPool();
  },

  goBack() {
    soundManager.play('click');
    router.safeNavigateBack(1, '/pages/my/index');
  }
});
