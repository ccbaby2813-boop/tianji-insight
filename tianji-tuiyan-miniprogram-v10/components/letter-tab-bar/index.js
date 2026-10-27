const i18n = require('../../utils/i18n.js');

Component({
  options: {
    multipleSlots: true
  },
  properties: {
    active: {
      type: String,
      value: 'match'
    }
  },
  data: {
    t: {
      tabMatch: '易缘',
      tabFriends: '传书',
      tabBack: '返回'
    }
  },
  lifetimes: {
    attached() {
      this.applyI18n();
    }
  },
  methods: {
    applyI18n() {
      const dict = i18n.page('letter') || {};
      const tabMatch = dict.tabMatch || '易缘';
      const tabFriends = dict.tabFriends || '传书';
      const tabBack = dict.tabBack || '返回';
      this.setData({ t: { tabMatch, tabFriends, tabBack } });
    },
    onTapMatch() {
      if (this.data.active === 'match') return
      wx.redirectTo({ url: '/sub/match/match-pool/index' })
    },
    onTapFriends() {
      if (this.data.active === 'friends') return
      wx.redirectTo({ url: '/sub/match/my-matches/index' })
    },
    onTapBack() {
      wx.switchTab({ url: '/pages/index/index' })
    }
  }
})
