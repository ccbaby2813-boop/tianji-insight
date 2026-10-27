const router = require('../../../utils/router.js');
const i18n = require('../../../utils/i18n.js');

Page({
  onShow() {
    i18n.applyNavTitle('sub/legal/privacy/index');
    this.setData({ lang: i18n.getLang() });
    // v20 语言可能已切换：重建字典与条款
    const t = i18n.page('legal');
    this.setData({ t, sections: this.buildPrivacySections(t) });
  },
  data: {
    t: {},
    sections: []
  },

  onLoad() {
    const t = i18n.page('legal');
    const sections = this.buildPrivacySections(t);
    this.setData({ t, sections });
  },

  buildPrivacySections(t) {
    return [
      {
        title: t.privacyIntro,
        items: [t.privacyIntroP1, t.privacyIntroP2]
      },
      {
        title: t.privacyCollect,
        items: [t.privacyCollectP1, t.privacyCollectP2, t.privacyCollectP3, t.privacyCollectP4]
      },
      {
        title: t.privacyUse,
        items: [t.privacyUseP1, t.privacyUseItem1, t.privacyUseItem2, t.privacyUseItem3, t.privacyUseItem4, t.privacyUseItem5, t.privacyUseP2]
      },
      {
        title: t.privacyStore,
        items: [t.privacyStoreP1, t.privacyStoreP2, t.privacyStoreP3]
      },
      {
        title: t.privacyShare,
        items: [t.privacyShareP1, t.privacyShareItem1, t.privacyShareItem2, t.privacyShareItem3, t.privacyShareItem4, t.privacyShareP2]
      },
      {
        title: t.privacyRight,
        items: [t.privacyRightP1, t.privacyRightP2, t.privacyRightP3, t.privacyRightP4]
      },
      {
        title: t.privacyMinor,
        items: [t.privacyMinorP1, t.privacyMinorP2, t.privacyMinorP3]
      },
      {
        title: t.privacyCookie,
        items: [t.privacyCookieP1, t.privacyCookieP2]
      },
      {
        title: t.privacySdk,
        items: [t.privacySdkP1, t.privacySdkP2, t.privacySdkP3]
      },
      {
        title: t.privacyUpdate,
        items: [t.privacyUpdateP1, t.privacyUpdateP2]
      },
      {
        title: t.privacyContact,
        items: [t.privacyContactOp, t.privacyContactEmail, t.privacyContactIcp, t.privacyContactP]
      }
    ];
  },

  goBack() {
    router.safeNavigateBack(1, '/pages/my/index');
  }
});
