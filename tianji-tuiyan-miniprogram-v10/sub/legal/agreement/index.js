const router = require('../../../utils/router.js');
const i18n = require('../../../utils/i18n.js');

Page({
  onShow() {
    i18n.applyNavTitle('sub/legal/agreement/index');
    this.setData({ lang: i18n.getLang() });
    // v20 语言可能已切换：重建字典与条款
    const t = i18n.page('legal');
    this.setData({ t, sections: this.buildAgreementSections(t) });
  },
  data: {
    t: {},
    sections: []
  },

  onLoad() {
    const t = i18n.page('legal');
    const sections = this.buildAgreementSections(t);
    this.setData({ t, sections });
  },

  buildAgreementSections(t) {
    return [
      {
        title: t.agreeUpdate,
        items: [t.agreeUpdateP1, t.agreeUpdateP2, t.agreeUpdateP3]
      },
      {
        title: t.serviceContent,
        items: [t.serviceP1, t.serviceItem1, t.serviceItem2, t.serviceItem3, t.serviceItem4, t.serviceP2, t.serviceP3, t.serviceP4]
      },
      {
        title: t.userAccount,
        items: [t.accountP1, t.accountP2, t.accountP3]
      },
      {
        title: t.conduct,
        items: [t.conductP1, t.conductItem1, t.conductItem2, t.conductItem3, t.conductItem4, t.conductP2]
      },
      {
        title: t.vipRights,
        items: [t.vipRightsP]
      },
      {
        title: t.ipRight,
        items: [t.ipP1, t.ipP2]
      },
      {
        title: t.privacy,
        items: [t.privacyP1, t.privacyP2]
      },
      {
        title: t.disclaimer,
        items: [t.disclaimerP1, t.disclaimerP2, t.disclaimerP3]
      },
      {
        title: t.paidService,
        items: [t.paidP1, t.paidP2, t.paidP3]
      },
      {
        title: t.dataDelete,
        items: [t.dataDeleteP]
      },
      {
        title: t.termination,
        items: [t.terminationP1, t.terminationP2, t.terminationP3]
      },
      {
        title: t.lawApply,
        items: [t.lawApplyP1, t.lawApplyP2]
      },
      {
        title: t.contact,
        items: [t.contactOp, t.contactEmail, t.contactIcp]
      }
    ];
  },

  goBack() {
    router.safeNavigateBack(1, '/pages/my/index');
  }
});
