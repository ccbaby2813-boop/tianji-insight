/**
 * utils/share.js - 多端分享工具
 * 小程序：open-type="share" + onShareAppMessage
 * APP：wx.miniapp.shareWebPageMessage（分享 H5 链接，v19.8 起全量替代 shareMiniProgramMessage）
 */

const env = require('../config/env.js');
const i18n = require('./i18n.js');

// 小程序原始 ID（gh_xxx 开头），微信分享 API 要求使用原始 ID
const MINIAPP_USERNAME = 'gh_3d91a850c688';
const WEBPAGE_URL = 'https://claw-book.cn';
// App 端 H5 分享落地页基础地址（官网/首页，nginx `/tianji/web/` 反代到 web/）
// 参考 match H5 分享 `${H5_WEB_BASE}match.html?sid=xxx`
const H5_WEB_BASE = 'https://claw-book.cn/tianji/web/';
const SHARE_IMAGE_PATH = '/assets/images/share-thumb.png'; // 本地分享缩略图

/**
 * APP 端分享小程序卡片到微信
 * @param {Object} options - 分享配置
 * @param {string} options.path - 小程序页面路径
 * @param {string} options.title - 分享标题
 * @param {number} options.scene - 0=分享到会话，1=分享到朋友圈
 */
function shareMiniProgramMessage(options) {
  const { path, title, scene = 0 } = options;
  
  // v16.8 安全检查：wx.miniapp 可能不存在
  if (!wx.miniapp || !wx.miniapp.shareMiniProgramMessage) {
    console.error('[share] wx.miniapp 或 shareMiniProgramMessage 不存在');
    wx.showToast({ title: i18n.isEn() ? 'Sharing not supported in this environment' : '当前环境不支持分享', icon: 'none' });
    return;
  }
  
  wx.miniapp.shareMiniProgramMessage({
    userName: MINIAPP_USERNAME,
    path: path,
    title: title,
    imagePath: SHARE_IMAGE_PATH,
    webpageUrl: WEBPAGE_URL,
    withShareTicket: true,
    miniprogramType: 0, // 0=正式版，1=开发版，2=体验版
    scene: scene,
    success(res) {
      console.log('[share] 分享成功:', res);
    },
    fail(err) {
      // v16.2 完整打印错误信息（含 OpenSDK 错误码），便于按官方文档定位：
      // 常见错误「应用包签名信息校验不通过」= 开放平台移动应用签名/包名与打包不一致
      // ⚠️ Android 端 [opensdk] 日志不输出，必须看这里打印的 detail
      console.error('[share] 分享失败 detail:', {
        errMsg: err && err.errMsg,
        errCode: err && err.errCode,
        errno: err && err.errno,
        raw: err
      });
      const msg = (err && (err.errMsg || err.message)) || '';
      const isEn = i18n.isEn();
      let tip = isEn ? 'Share failed, please retry later' : '分享失败，请稍后再试';
      if (/sign|签名|signature/i.test(msg)) {
        tip = isEn ? 'Share failed: app signature check failed. Check the Open Platform config' : '分享失败：应用签名校验不通过，请检查开放平台配置';
      } else if (/uninstall|install|微信版本|WXNotInstall/i.test(msg)) {
        tip = isEn ? 'Share failed: WeChat is not installed or its version is too old' : '分享失败：未安装微信或版本过低';
      } else if (/cancel|取消/i.test(msg)) {
        return; // 用户主动取消，不提示
      }
      wx.showToast({ title: tip, icon: 'none' });
    }
  });
}

/**
 * APP 端分享网页链接到微信（H5 落地页）
 * @param {Object} options
 * @param {string} options.webpageUrl - 网页链接（必填）
 * @param {string} options.title - 分享标题
 * @param {string} options.description - 分享描述
 * @param {string} options.thumbPath - 分享缩略图（本地路径）
 * @param {number} options.scene - 0=会话，1=朋友圈，2=收藏
 */
// v3.4 无微信环境降级：复制 H5 链接（可粘贴到 WhatsApp/邮件/短信/浏览器等）
function copyShareLinkFallback(url) {
  const target = url || WEBPAGE_URL;
  wx.setClipboardData({
    data: target,
    success() {
      wx.showToast({ title: i18n.getLang() === 'en' ? 'Link copied - paste to share' : '未检测到微信，已复制链接可分享', icon: 'none' });
    },
    fail() {
      wx.showToast({ title: i18n.getLang() === 'en' ? 'Copy failed' : '复制失败', icon: 'none' });
    }
  });
}

// v3.5 海外版（Google Play）：用 wx.miniapp.openUrl 唤起第三方 App（WhatsApp/X），
// 需提前在多端应用控制台「第三方App」配置对应 URL Scheme
function openThirdPartyUrl(schemeUrl, fallbackUrl) {
  if (wx.miniapp && wx.miniapp.openUrl) {
    wx.miniapp.openUrl({
      url: schemeUrl,
      fail: function () {
        // 未安装对应 App 或唤起失败：降级为复制链接
        copyShareLinkFallback(fallbackUrl);
      }
    });
  } else {
    copyShareLinkFallback(fallbackUrl);
  }
}

// v3.5 海外版分享面板：带图标的自定义分享选择页（WhatsApp / X / Facebook / Messenger / Telegram / 微信 / 复制链接 / 更多）
function showSharePanel(options) {
  const { webpageUrl, title, description = '', thumbPath = SHARE_IMAGE_PATH, scene = 0 } = options;
  const shareUrl = webpageUrl || WEBPAGE_URL;
  // 跳转到带图标的分享选择页
  wx.navigateTo({
    url: '/sub/profile/share/index?url=' + encodeURIComponent(shareUrl)
      + '&title=' + encodeURIComponent(title || '')
      + '&desc=' + encodeURIComponent(description || '')
  });
}

// 分享网页链接到微信（H5 落地页）——原逻辑，含无微信降级复制链接
function shareToWeChat(options) {
  const { webpageUrl, title, description = '', thumbPath = SHARE_IMAGE_PATH, scene = 0 } = options;

  if (!wx.miniapp || !wx.miniapp.shareWebPageMessage) {
    console.error('[share] wx.miniapp 或 shareWebPageMessage 不存在');
    copyShareLinkFallback(webpageUrl);
    return;
  }

  wx.miniapp.shareWebPageMessage({
    title: title,
    description: description,
    thumbPath: thumbPath,
    webpageUrl: webpageUrl,
    scene: scene,
    success(res) {
      console.log('[share] 网页分享成功:', res);
    },
    fail(err) {
      console.error('[share] 网页分享失败 detail:', {
        errMsg: err && err.errMsg,
        errCode: err && err.errCode,
        errno: err && err.errno,
        raw: err
      });
      const msg = (err && (err.errMsg || err.message)) || '';
      let tip = '分享失败，请稍后再试';
      if (/sign|签名|signature/i.test(msg)) {
        tip = '分享失败：应用签名校验不通过，请检查开放平台配置';
      } else if (/uninstall|install|微信版本|WXNotInstall/i.test(msg)) {
        // 未安装微信或微信不可用：降级为复制链接（海外无微信用户）
        copyShareLinkFallback(webpageUrl);
        return;
      } else if (/cancel|取消/i.test(msg)) {
        return; // 用户主动取消，不提示
      }
      wx.showToast({ title: tip, icon: 'none' });
    }
  });
}

/**
 * APP 端分享网页链接到微信（H5 落地页）
 * 海外版（Google Play）：弹分享面板（WhatsApp / X / 微信 / 复制链接）
 * @param {Object} options
 */
function shareWebPageMessage(options) {
  const { webpageUrl, title, description = '', thumbPath = SHARE_IMAGE_PATH, scene = 0 } = options;
  // 海外版（Google Play）且具备唤起第三方 App 能力：弹分享面板
  if (env.CHANNEL === 'google' && wx.miniapp && wx.miniapp.openUrl) {
    showSharePanel({ webpageUrl, title, description, thumbPath, scene });
    return;
  }
  // 国内版 / 海外无 openUrl 能力：走微信分享（无微信自动降级复制链接）
  shareToWeChat({ webpageUrl, title, description, thumbPath, scene });
}

module.exports = {
  shareMiniProgramMessage,
  shareWebPageMessage,
  MINIAPP_USERNAME,
  WEBPAGE_URL,
  H5_WEB_BASE,
  SHARE_IMAGE_PATH
};
