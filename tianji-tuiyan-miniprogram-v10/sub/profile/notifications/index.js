// sub/profile/notifications/index.js - 消息中心
const api = require('../../../utils/api.js');
const i18n = require('../../../utils/i18n.js');

Page({
  data: {
    t: {},
    lang: 'zh',
    statusBarHeight: 20,
    list: [],
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    refreshing: false,
    unreadCount: 0
  },

  onLoad() {
    const lang = i18n.getLang();
    let statusBarHeight = 20;
    try { statusBarHeight = wx.getWindowInfo().statusBarHeight || 20; } catch (e) {}
    this.setData({ t: i18n.page('notifications'), lang, statusBarHeight });
    this.loadList(true);
  },

  // 返回上一页
  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: '/pages/my/index' });
    }
  },

  onShow() {
    this.loadUnreadCount();
  },

  // 下拉刷新（页面级事件：固定高度 scroll-view 不触发，保留兼容）
  async onPullDownRefresh() {
    this.setData({ refreshing: true });
    await this.loadList(true);
    wx.stopPullDownRefresh();
    this.setData({ refreshing: false });
  },

  // 加载更多（页面级事件：固定高度 scroll-view 不触发，保留兼容）
  async onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      await this.loadList(false);
    }
  },

  // scroll-view 下拉刷新（v3.4.1 修复：列表在固定高度 scroll-view 内滚动，页面级事件不生效）
  onScrollRefresh() {
    if (this.data.loading) { this.setData({ refreshing: false }); return; }
    this.setData({ refreshing: true });
    this.loadList(true).finally(() => this.setData({ refreshing: false }));
  },

  // scroll-view 触底加载
  onScrollLoadMore() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadList(false);
    }
  },

  // 加载通知列表
  async loadList(reset = false) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const page = reset ? 1 : this.data.page;
      const res = await api.request('/api/notifications', 'GET', {
        page,
        pageSize: this.data.pageSize
      });
      if (res && res.success && res.data) {
        const newList = res.data.list || [];
        const merged = reset ? newList : [...this.data.list, ...newList];
        const list = this._localize(merged);
        this.setData({
          list,
          page: page + 1,
          hasMore: res.data.hasMore,
          unreadCount: list.filter(n => !n.is_read).length
        });
      }
    } catch (e) {
      console.error('[notifications] load error:', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  // 加载未读数
  async loadUnreadCount() {
    try {
      const res = await api.request('/api/notifications/unread-count', 'GET');
      if (res && res.success && res.data) {
        this.setData({ unreadCount: res.data.count || 0 });
      }
    } catch (e) { /* silent */ }
  },

  // 点击通知
  async onNotificationTap(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find(n => n.id === id);
    if (!item) return;

    // 标记已读
    if (!item.is_read) {
      try {
        await api.request(`/api/notifications/${id}/read`, 'POST');
        const list = this.data.list.map(n => n.id === id ? { ...n, is_read: 1 } : n);
        this.setData({ list, unreadCount: Math.max(0, this.data.unreadCount - 1) });
      } catch (e) { /* silent */ }
    }

    // 按类型跳转
    if (item.type === 'match_reply' || item.type === 'letter_received') {
      // 匹配回应和信件到达都跳转到我的匹配列表（统一入口，用户可在列表中查看详情/写信）
      wx.navigateTo({ url: '/sub/match/my-matches/index' });
    } else if (item.type === 'jieqi_reminder') {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  // 全部已读
  async onMarkAllRead() {
    if (this.data.unreadCount === 0) return;
    try {
      await api.request('/api/notifications/read-all', 'POST');
      const list = this.data.list.map(n => ({ ...n, is_read: 1 }));
      this.setData({ list, unreadCount: 0 });
      wx.showToast({ title: this.data.t.allReadDone || '已全部已读', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: this.data.t.operationFailed || '操作失败', icon: 'none' });
    }
  },

  // 通知类型图标和颜色
  getTypeMeta(type) {
    const map = {
      match_reply: { icon: 'peach-heart', color: '#C8A55B' },
      letter_received: { icon: 'mail', color: '#6B8E9F' },
      jieqi_reminder: { icon: 'leaf', color: '#7BA05B' },
      system: { icon: 'info', color: '#999' }
    };
    return map[type] || map.system;
  },

  /**
   * 英文态通知本地化：后端通知标题/内容按写入时语言存储（中文），
   * 英文用户按 type 重新翻译显示；中文态返回原值（保持后端文案原样）。
   * 昵称/关系名从原内容提取，节气名经 jieqi.termMap 英译。
   */
  _localize(list) {
    if (!list || !list.length) return list;
    const t = this.data.t || {};
    if (!i18n.isEn()) return list;
    const termMap = (i18n.page('jieqi').termMap) || {};
    return list.map(item => {
      if (!item || !item.type) return item;
      const title = item.title || '';
      const content = item.content || '';
      if (item.type === 'letter_received') {
        const sender = ((content.match(/^(.*?)给你写了一封信$/) || [])[1] || '').trim();
        return Object.assign({}, item, {
          title: t.titleLetterReceived || 'You received a new letter',
          content: (t.contentLetterReceived || '{sender} wrote you a letter').replace('{sender}', sender)
        });
      }
      if (item.type === 'match_reply') {
        const m = content.match(/和你匹配了[:：]?(.*)$/) || [];
        const name = content.replace(/和你匹配了[:：]?.*$/, '').trim();
        const rel = (m[1] || '').trim();
        return Object.assign({}, item, {
          title: t.titleMatchReply || 'Someone matched with you',
          content: (t.contentMatchReply || '{name} matched with you: {rel}')
            .replace('{name}', name).replace('{rel}', rel)
        });
      }
      if (item.type === 'jieqi_reminder') {
        const tm = (title.match(/[:：](.+)$/) || [])[1] || '';
        const termEn = (tm && termMap[tm]) || tm;
        return Object.assign({}, item, {
          title: (t.titleJieqiReminder || 'Solar Term Today: {term}').replace('{term}', termEn),
          content: (t.contentJieqiReminder || 'It is {term} in the 24 solar terms. Follow the seasons for wellbeing. Tap to view today\'s wellness guide.').replace('{term}', termEn)
        });
      }
      return item;
    });
  }
});
