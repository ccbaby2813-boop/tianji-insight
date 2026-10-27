/**
 * sub/match/letter-thread/index.js - 信件往来
 * 展示与某位好友的全部书信往返记录
 */
const api = require('../../../utils/api.js');
const soundManager = require('../../../utils/audio.js');
const router = require('../../../utils/router.js');
const i18n = require('../../../utils/i18n.js'); // v19.2

Page({
  data: {
    statusBarHeight: 20,
    friendOpenid: '',
    friendNickname: '',
    friendGuaName: '',
    friendGuaGe: '',
    friendIsVip: false,
    letters: [],
    total: 0,
    pageState: 'loading',
    errorMsg: '',
    showFullLetter: false,
    fullLetter: null,
    // v19.2 双语字典
    t: {}
  },

  // v19.2 加载 letter 模块双语字典
  applyI18n() {
    this.setData({ t: i18n.page('letter') });
  },

  onLoad(options) {
    soundManager.init();
    // v19.2 加载双语字典
    this.applyI18n();
    // 获取状态栏高度（自定义导航栏需要）
    let statusBarHeight = 20;
    try {
      statusBarHeight = wx.getWindowInfo().statusBarHeight || 20;
    } catch (e) {
      statusBarHeight = (wx.getSystemInfoSync() || {}).statusBarHeight || 20;
    }
    this.setData({ statusBarHeight: statusBarHeight });

    const friendOpenid = options.friendOpenid || '';
    const friendNickname = decodeURIComponent(options.friendNickname || '');
    const friendGuaName = decodeURIComponent(options.friendGuaName || '');
    const friendGuaGe = decodeURIComponent(options.friendGuaGe || '');
    this.setData({
      friendOpenid: friendOpenid,
      friendNickname: friendNickname,
      friendGuaName: friendGuaName,
      friendGuaGe: friendGuaGe
    });
    this._loaded = false;
    this.loadThread();
  },

  onShow() {

    i18n.applyNavTitle('sub/match/letter-thread/index');
    this.setData({ lang: i18n.getLang() });
    this.applyI18n();
    // 首次进入由 onLoad 触发加载，跳过首次 onShow；返回本页时刷新
    if (this._loaded && this.data.friendOpenid) {
      this.loadThread();
    }
    this._loaded = true;
  },

  async loadThread() {
    const friendOpenid = this.data.friendOpenid;
    if (!friendOpenid) {
      const t = this.data.t || {};
      this.setData({ pageState: 'error', errorMsg: t.paramMissing || '参数缺失' });
      return;
    }
    this.setData({ pageState: 'loading' });
    try {
      const res = await api.request(
        '/api/letter/thread/' + encodeURIComponent(friendOpenid) + (i18n.isEn() ? '?lang=en' : ''),
        'GET'
      );
      if (res && res.success && res.data) {
        const data = res.data;
        const friend = data.friend || {};
        const friendNickname = friend.nickname || this.data.friendNickname;
        const friendGuaName = friend.guaName || this.data.friendGuaName;
        const friendGuaGe = friend.guaGe || this.data.friendGuaGe;
        const friendIsVip = !!friend.isVip;
        const letters = (data.letters || []).map((l) => {
          const isMine = !!l.isMine;
          const senderNickname = isMine ? (this.data.t.myself || '我') : friendNickname;
          // 缩略预览：取第一行（前30字，超出省略号）v2.0 修复：/s 标志改为 [\s\S] 提升兼容性
          const firstLine = (l.content || '').replace(/\n[\s\S]*/, '');
          const previewMax = i18n.isEn() ? 60 : 30;
  const previewText = firstLine.slice(0, previewMax) + (firstLine.length > previewMax ? '...' : '');
          // v2.0 已读回执：优先使用后端 isRead 字段（后端 thread 接口已自动标记收到的信为已读）
          // - 收到的信：isRead=true 表示我已读
          // - 发出的信：isRead=true 表示对方已读
          let unread = false;
          if (typeof l.isRead === 'boolean') {
            unread = !l.isRead;
          } else if (!isMine) {
            // 降级：本地 storage 判断（仅对收到的信）
            unread = !this._isLetterRead(l.id);
          }
          return Object.assign({}, l, {
            timeText: this.formatTime(l.createdAt),
            senderNickname: senderNickname,
            senderIsVip: isMine ? false : friendIsVip, // v1.3.3 收到的信显示对方VIP标识
            avatarChar: senderNickname ? senderNickname.charAt(0) : (this.data.t.avatarChar || ''),
            previewText: previewText,
            unread: unread
          });
        });
        this.setData({
          letters: letters,
          total: data.total != null ? data.total : letters.length,
          friendNickname: friendNickname,
          friendGuaName: friendGuaName,
          friendGuaGe: friendGuaGe,
          friendIsVip: friendIsVip,
          pageState: letters.length ? 'loaded' : 'empty',
          errorMsg: ''
        });
      } else {
        const msg = (res && res.message) || this.data.t.loadFail || '加载失败，请稍后再试';
        this.setData({ pageState: 'error', errorMsg: msg });
      }
    } catch (e) {
      this.setData({ pageState: 'error', errorMsg: this.data.t.threadLoadFail || '网络异常，请检查网络' });
    }
  },

  formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr.replace(/-/g, '/'));
    const now = new Date();
    const diff = now - d;
    const t = this.data.t || {};
    if (diff < 60000) return t.timeJustNow || '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + (t.timeMinAgo || '分钟前');
    if (diff < 86400000) return Math.floor(diff / 3600000) + (t.timeHourAgo || '小时前');
    if (diff < 172800000) return t.timeYesterday || '昨天';
    if (diff < 604800000) return Math.floor(diff / 86400000) + (t.timeDayAgo || '天前');
    return (d.getMonth() + 1) + (t.timeMonth || '月') + d.getDate() + (t.timeDay || '日');
  },

  onWriteReply() {
    soundManager.play('click');
    this.goWrite();
  },

  goWrite() {
    soundManager.play('click');
    const friendOpenid = this.data.friendOpenid;
    const friendNickname = this.data.friendNickname;
    if (!friendOpenid) {
      wx.showToast({ title: this.data.t.paramMissing || '参数缺失', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/sub/match/letter-write/index?receiverOpenid=' + friendOpenid +
           '&receiverNickname=' + encodeURIComponent(friendNickname) +
           '&receiverIsVip=' + (this.data.friendIsVip ? 1 : 0)
    });
  },

  onBack() {
    soundManager.play('click');
    router.safeNavigateBack(1, '/pages/my/index');
  },

  // 底部举报按钮（与写信页一致）
  onReport() {
    soundManager.play('click');
    var t = this.data.t || {};
    wx.showActionSheet({
      itemList: t.reportItems || ['骚扰内容', '不当言论', '诈骗信息', '其他'],
      success: (res) => {
        var reasons = t.reportItems || ['骚扰内容', '不当言论', '诈骗信息', '其他'];
        var reason = reasons[res.tapIndex] || t.reportOther || '其他';
        this.confirmReportLetter(reason);
      },
      fail: function () {}
    });
  },

  onMore() {
    soundManager.play('click');
    var t = this.data.t || {};
    wx.showActionSheet({
      itemList: [t.blockFriend || '拉黑此好友'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.confirmBlock();
        }
      },
      fail: () => {}
    });
  },

  // 拉黑好友（从信件浮层中触发）
  onBlockFromLetter() {
    soundManager.play('click');
    this.confirmBlock();
  },

  // 从收信浮层直接写回信
  onReplyFromLetter() {
    soundManager.play('click');
    this.onCloseFullLetter();
    this.goWrite();
  },

  // 举报信件（在收信浮层中触发）
  onReportLetter() {
    soundManager.play('click');
    var letter = this.data.fullLetter;
    if (!letter || letter.isMine) return;
    var t = this.data.t || {};
    var items = (t.reportItems || ['骚扰内容', '不当言论', '诈骗信息', '其他']).slice();
    items.push(t.blockThisPerson || '拉黑此人');
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (res.tapIndex === items.length - 1) {
          this.confirmBlock();
        } else {
          var reasons = t.reportItems || ['骚扰内容', '不当言论', '诈骗信息', '其他'];
          var reason = reasons[res.tapIndex];
          this.confirmReportLetter(reason);
        }
      },
      fail: function () {}
    });
  },

  confirmReportLetter(reason) {
    var letter = this.data.fullLetter;
    var senderName = letter ? (letter.senderNickname || (this.data.t.appName || '易缘')) : this.data.friendNickname;
    var t = this.data.t || {};
    wx.showModal({
      title: t.reportConfirmTitle || '举报确认',
      content: i18n.fill(t.reportConfirmContent || '确定举报「{name}」吗？\n举报原因：{reason}', { name: senderName, reason: reason }),
      confirmText: t.reportConfirmBtn || '举报',
      cancelText: i18n.common().cancel,
      confirmColor: '#C8A55B',
      success: (res) => {
        if (res.confirm) {
          this.doReportLetter(reason);
        }
      }
    });
  },

  async doReportLetter(reason) {
    var letter = this.data.fullLetter;
    var postData = {
      targetOpenid: this.data.friendOpenid,
      reason: reason
    };
    if (letter && letter.id) {
      postData.letterId = letter.id;
    }
    try {
      const res = await api.request('/api/letter/report', 'POST', postData);
      if (res && res.success) {
        soundManager.play('success');
        wx.showToast({ title: this.data.t.toastReportSubmitted || '举报已提交', icon: 'success' });
      } else {
        wx.showToast({ title: (res && res.message) || this.data.t.toastReportFail || '举报失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: (e && e.message) || this.data.t.toastNetworkFail || '网络异常', icon: 'none' });
    }
  },

  confirmBlock() {
    var t = this.data.t || {};
    wx.showModal({
      title: t.blockConfirmTitle || '拉黑好友',
      content: i18n.fill(t.blockConfirmContent || '拉黑后双方将不再可见，也无法再匹配或写信。确定拉黑「{name}」吗？', { name: this.data.friendNickname }),
      confirmText: t.blockConfirmBtn || '拉黑',
      cancelText: i18n.common().cancel,
      confirmColor: '#C8A55B',
      success: (res) => {
        if (res.confirm) {
          this.doBlock();
        }
      }
    });
  },

  async doBlock() {
    try {
      const res = await api.request('/api/letter/block', 'POST', {
        targetOpenid: this.data.friendOpenid
      });
      if (res && res.success) {
        soundManager.play('success');
        wx.showToast({ title: this.data.t.blockOk || '已拉黑', icon: 'success' });
        setTimeout(function () { router.safeNavigateBack(1, '/pages/my/index'); }, 1200);
      } else {
        wx.showToast({ title: (res && res.message) || this.data.t.blockFail || '拉黑失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: (e && e.message) || this.data.t.toastNetworkFail || '网络异常', icon: 'none' });
    }
  },

  onLetterTap(e) {
    soundManager.play('click');
    const index = e.currentTarget.dataset.index;
    const letter = this.data.letters[index];
    if (!letter) return;
    // 打开信件时自动取消未读状态：本地 storage + 显式 mark-read API 双通道
    if (letter.unread && !letter.isMine) {
      this._markLetterRead(letter.id, index);
      this._markReadViaApi(letter.id);
    }
    this.setData({
      showFullLetter: true,
      fullLetter: letter
    });
  },

  /**
   * 🔴 v3.5 新增：显式调用后端 mark-read API
   * 幂等操作，失败不影响本地已读状态（thread 接口已兜底）
   */
  async _markReadViaApi(letterId) {
    if (!letterId) return;
    try {
      await api.request('/api/letter/mark-read', 'POST', { letterId: letterId });
    } catch (e) {
      console.warn('[letter-thread] mark-read API 调用失败:', e && e.message);
    }
  },

  /**
   * 本地已读记录 storage key
   */
  _readStorageKey() {
    return 'tj_read_letters_' + this.data.friendOpenid;
  },

  /**
   * 判断某封信是否已读（本地 storage）
   */
  _isLetterRead(letterId) {
    if (!letterId) return false;
    try {
      const stored = wx.getStorageSync(this._readStorageKey());
      if (stored) {
        const readIds = JSON.parse(stored);
        return readIds.indexOf(letterId) !== -1;
      }
    } catch (e) {}
    return false;
  },

  /**
   * 标记信件为已读（更新 storage + 当前列表）
   */
  _markLetterRead(letterId, index) {
    if (!letterId) return;
    const key = this._readStorageKey();
    let readIds = [];
    try {
      const stored = wx.getStorageSync(key);
      if (stored) readIds = JSON.parse(stored);
    } catch (e) {}
    if (readIds.indexOf(letterId) === -1) {
      readIds.push(letterId);
      wx.setStorageSync(key, JSON.stringify(readIds));
    }
    // 🔴 v3.4 修复：使用路径表达式精确更新，避免直接修改 data 对象和整体 setData 大数组
    if (this.data.letters[index]) {
      const patch = {};
      patch['letters[' + index + '].unread'] = false;
      this.setData(patch);
    }
  },

  onCloseFullLetter() {
    soundManager.play('click');
    this.setData({ showFullLetter: false });
  },

  onRetry() {
    soundManager.play('click');
    this.loadThread();
  }
});
