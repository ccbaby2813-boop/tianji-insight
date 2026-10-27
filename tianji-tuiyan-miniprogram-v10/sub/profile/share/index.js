// sub/profile/share/index.js - 分享选择页（带图标，替代 showActionSheet）
const env = require('../../../config/env.js');
const i18n = require('../../../utils/i18n.js');
const { CHANNEL_LOGOS } = require('../../../utils/share-logos.js');

Page({
  data: {
    shareUrl: '',
    shareTitle: '',
    shareDesc: '',
    isEn: false,
    channels: []
  },

  onLoad(options) {
    const isEn = i18n.getLang() === 'en';
    const shareUrl = decodeURIComponent(options.url || '');
    const shareTitle = decodeURIComponent(options.title || '');
    const shareDesc = decodeURIComponent(options.desc || '');

    // 构建渠道列表（带官方 logo base64）
    const channels = [
      { key: 'wechat', name: isEn ? 'WeChat' : '微信', logo: CHANNEL_LOGOS.wechat, color: '#07C160' },
      { key: 'whatsapp', name: 'WhatsApp', logo: CHANNEL_LOGOS.whatsapp, color: '#25D366' },
      { key: 'facebook', name: 'Facebook', logo: CHANNEL_LOGOS.facebook, color: '#1877F2' },
      { key: 'messenger', name: 'Messenger', logo: CHANNEL_LOGOS.messenger, color: '#0084FF' },
      { key: 'x', name: isEn ? 'X (Twitter)' : 'X（推特）', logo: CHANNEL_LOGOS.x, color: '#000000' },
      { key: 'telegram', name: 'Telegram', logo: CHANNEL_LOGOS.telegram, color: '#0088CC' },
      { key: 'copy', name: isEn ? 'Copy Link' : '复制链接', logo: CHANNEL_LOGOS.copy, color: '#8B7340' },
      { key: 'system', name: isEn ? 'More Apps' : '更多应用', logo: CHANNEL_LOGOS.system, color: '#999999' }
    ];

    // 微信渠道：只有装了微信才显示
    if (!wx.miniapp || !wx.miniapp.shareWebPageMessage) {
      const idx = channels.findIndex(c => c.key === 'wechat');
      if (idx > -1) channels.splice(idx, 1);
    }

    this.setData({ shareUrl, shareTitle, shareDesc, isEn, channels });
  },

  // 选择渠道
  onChannelTap(e) {
    const key = e.currentTarget.dataset.key;
    const { shareUrl, shareTitle, shareDesc } = this.data;
    // 分享文本：标题 + 链接（WhatsApp/X/Telegram 用）
    const shareText = (shareTitle || (this.data.isEn ? 'Tianji Tuiyan' : '天机推演')) + ' ' + shareUrl;

    if (key === 'wechat') {
      this.shareToWeChat(shareUrl, shareTitle, shareDesc);
    } else if (key === 'whatsapp') {
      // WhatsApp: Scheme 唤起（不降级）
      this.openUrl(
        'whatsapp://send?text=' + encodeURIComponent(shareText),
        'WhatsApp'
      );
    } else if (key === 'facebook') {
      // Facebook: Scheme 唤起（不降级）
      this.openUrl(
        'fb://share/?link=' + encodeURIComponent(shareUrl),
        'Facebook'
      );
    } else if (key === 'messenger') {
      // Messenger: Scheme 唤起（不降级）
      this.openUrl(
        'fb-messenger://share?link=' + encodeURIComponent(shareUrl),
        'Messenger'
      );
    } else if (key === 'x') {
      // X (Twitter): Scheme 唤起（不降级）
      this.openUrl(
        'twitter://post?message=' + encodeURIComponent(shareText),
        'X'
      );
    } else if (key === 'telegram') {
      // Telegram: Scheme 唤起（不降级）
      this.openUrl(
        'tg://msg_url?url=' + encodeURIComponent(shareUrl) + '&text=' + encodeURIComponent(shareTitle || ''),
        'Telegram'
      );
    } else if (key === 'copy') {
      this.copyLink(shareUrl);
    } else if (key === 'system') {
      this.systemShare(shareUrl, shareTitle);
    }
  },

  // 唤起第三方 App（不降级，直接看成功/失败，打印详细错误）
  openUrl(schemeUrl, channelName) {
    if (wx.miniapp && wx.miniapp.openUrl) {
      console.log('[share] 尝试唤起 ' + channelName + ':', schemeUrl);
      wx.miniapp.openUrl({
        url: schemeUrl,
        success: (res) => {
          console.log('[share] ' + channelName + ' 唤起成功:', JSON.stringify(res));
          wx.showToast({ title: this.data.isEn ? 'Opened ' + channelName : '已唤起' + channelName, icon: 'success' });
          setTimeout(() => wx.navigateBack(), 500);
        },
        fail: (err) => {
          console.error('[share] ' + channelName + ' 唤起失败 detail:', {
            errMsg: err && err.errMsg,
            errCode: err && err.errCode,
            errno: err && err.errno,
            raw: err
          });
          const msg = (err && (err.errMsg || err.message)) || '';
          wx.showModal({
            title: this.data.isEn ? 'Share failed' : '唤起失败',
            content: (this.data.isEn ? 'Failed to open ' + channelName + '. ' : '无法唤起' + channelName + '。') + (msg || '') + '\n\n' + (this.data.isEn ? 'Possible reasons: URL Scheme not whitelisted in WeChat Open Platform, or app not installed.' : '可能原因：微信开放平台未配置该 URL Scheme 白名单，或手机未安装该应用。'),
            showCancel: true,
            cancelText: this.data.isEn ? 'Copy Link' : '复制链接',
            confirmText: this.data.isEn ? 'OK' : '知道了',
            success: (r) => {
              if (r.cancel) {
                wx.setClipboardData({ data: this.data.shareUrl, success: () => wx.navigateBack() });
              } else {
                wx.navigateBack();
              }
            }
          });
        }
      });
    } else {
      console.error('[share] wx.miniapp.openUrl 不存在');
      wx.showToast({ title: this.data.isEn ? 'openUrl not available' : '当前环境不支持唤起', icon: 'none' });
    }
  },

  // 三级降级已移除：所有渠道直接用 URL Scheme 唤起，失败显示错误详情
  openUrlWithFallback(schemeUrl, webUrl, fallbackUrl) {
    this.openUrl(schemeUrl, 'channel');
  },

  // 分享到微信（Donut 多端应用官方 API）
  shareToWeChat(url, title, desc) {
    if (!wx.miniapp || !wx.miniapp.shareWebPageMessage) {
      wx.showToast({ title: this.data.isEn ? 'WeChat not available' : '微信不可用', icon: 'none' });
      setTimeout(() => this.copyLink(url), 1000);
      return;
    }

    // 缩略图：必须用本地路径 thumbPath，不能用网络 URL thumbUrl
    const thumbPath = '/assets/images/share-thumb.png';

    wx.miniapp.shareWebPageMessage({
      title: title || (this.data.isEn ? 'Tianji Tuiyan' : '天机推演'),
      description: desc || (this.data.isEn ? 'Discover your destiny through I Ching' : '易经推演，探寻天命'),
      webpageUrl: url,
      thumbPath: thumbPath,
      scene: 0, // 0=聊天，1=朋友圈
      success: () => {
        console.log('[share] wechat share success');
        setTimeout(() => wx.navigateBack(), 300);
      },
      fail: (err) => {
        const msg = (err && (err.errMsg || err.message)) || '';
        console.log('[share] wechat share fail:', msg, JSON.stringify(err));
        if (/cancel|取消/i.test(msg)) { wx.navigateBack(); return; }
        // 不直接降级复制，先提示用户，再复制
        wx.showToast({
          title: this.data.isEn ? 'Share failed, link copied' : '分享失败，已复制链接',
          icon: 'none',
          duration: 2000
        });
        setTimeout(() => {
          wx.setClipboardData({
            data: url,
            success: () => { setTimeout(() => wx.navigateBack(), 500); }
          });
        }, 300);
      }
    });
  },

  // 复制链接
  copyLink(url) {
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: this.data.isEn ? 'Link copied' : '链接已复制', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      },
      fail: () => {
        wx.showToast({ title: this.data.isEn ? 'Copy failed' : '复制失败', icon: 'none' });
      }
    });
  },

  // 系统分享（Android 原生分享面板）
  systemShare(url, title) {
    // Donut 可能支持 wx.miniapp.shareText 或类似系统分享
    if (wx.miniapp && wx.miniapp.shareText) {
      wx.miniapp.shareText({
        text: title + ' ' + url,
        success: () => { setTimeout(() => wx.navigateBack(), 300); },
        fail: () => { this.copyLink(url); }
      });
    } else {
      // 降级为复制链接
      this.copyLink(url);
    }
  },

  // 关闭
  onClose() {
    wx.navigateBack();
  },

  // 阻止内容区点击冒泡
  noop() {}
});
