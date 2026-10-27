// components/bottom-declaration/bottom-declaration.js — 底部合规声明组件（中/英双语）
const i18n = require('../../utils/i18n.js');
Component({
  data: { t: '' },
  lifetimes: {
    attached() { this._applyLang(); }
  },
  pageLifetimes: {
    show() { this._applyLang(); }
  },
  methods: {
    _applyLang() {
      const en = i18n.getLang() === 'en';
      this.setData({
        t: en
          ? 'AI interpretations inspired by the I Ching and Chinese classics - for cultural and entertainment purposes only, not for fortune-telling, divination, or life decisions.'
          : '本产品是基于国学经典的AI解读，请勿用于算运势、算命、取名等用途'
      });
    }
  }
});
