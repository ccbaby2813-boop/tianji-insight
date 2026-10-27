/**
 * components/protocol-viewer/protocol-viewer.js
 * 协议查看器弹窗组件
 * 使用场景：我的页点击协议、建档页勾选协议后点击查看
 */
const i18n = require('../../utils/i18n.js');
Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    content: { type: String, value: '' }
  },
  data: {
    t: { known: '我知道了' }
  },
  lifetimes: {
    attached() {
      this.applyI18n();
    }
  },
  methods: {
    applyI18n() {
      const dict = i18n.page('learn') || {};
      this.setData({
        t: { known: dict.known || '我知道了' }
      });
    },
    onClose() {
      this.setData({ visible: false });
      this.triggerEvent('close');
    },
    onMaskTap() {
      this.onClose();
    },
    stop() {}
  }
});
