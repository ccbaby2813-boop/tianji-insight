const soundManager = require('../../../utils/audio.js');
const router = require('../../../utils/router.js');
const shareUtil = require('../../../utils/share.js');
const i18n = require('../../../utils/i18n.js');

Page({
  data: {
    completionOrder: '',
    achOrderText: '',
    animPhase: 0,
    t: {}
  },

  onLoad(opt) {
    soundManager.init();
    const completionOrder = opt.order || '';
    this.setData({ completionOrder: completionOrder });
    this.applyI18n();
    // 动画分阶段依次触发：星冠&星座环(1) → 标题(2) → 描述(3) → 徽章(4) → 按钮(5)
    const phases = [1, 2, 3, 4, 5];
    phases.forEach((p, i) => {
      setTimeout(() => this.setData({ animPhase: p }), 100 + i * 180);
    });
  },

  onShow() {

    i18n.applyNavTitle('sub/learn/achievement/index');
    this.setData({ lang: i18n.getLang() });
    this.applyI18n();
  },

  applyI18n() {
    const dict = i18n.page('learn');
    const completionOrder = this.data.completionOrder || '';
    const achOrderText = completionOrder
      ? i18n.fill(dict.achOrder || '你是第 {n} 位达成此成就的人', { n: completionOrder })
      : '';
    this.setData({ t: dict, achOrderText: achOrderText });
  },

  onShareAppMessage() {
    const isEn = i18n.isEn();
    return {
      title: isEn
        ? "I collected all 64 I Ching archetypes and unlocked the 'Network King' title! How many can you collect?"
        : '我集齐了64型易经人格，解锁「人脉王」称号！你能集齐几个？',
      path: '/pages/index/index',
      imageUrl: ''
    };
  },

  // 🔴 v3.5 新增：分享到朋友圈
  onShareTimeline() {
    const isEn = i18n.isEn();
    return {
      title: isEn
        ? "I collected all 64 I Ching archetypes and unlocked the 'Network King' title!"
        : '我集齐了64型易经人格，解锁「人脉王」称号！',
      query: '',
      imageUrl: ''
    };
  },

  // App端分享按钮点击：分享 H5 官网链接（替代小程序卡片）
  onShareTap() {
    const shareInfo = this.onShareAppMessage();
    shareUtil.shareWebPageMessage({
      webpageUrl: shareUtil.H5_WEB_BASE,
      title: shareInfo.title,
      description: shareInfo.description || ''
    });
  },

  goBack() {
    soundManager.play('click');
    router.safeNavigateBack(1, '/pages/my/index');
  }
});
