/**
 * utils/router.js - 路由工具函数
 * 解决微信小程序 navigateBack 不能返回 tabBar 页面的问题
 */

/**
 * 安全的 navigateBack
 * 当页面栈只有 1 个页面时（即当前页面），自动切换到首页
 * @param {number} delta - 返回的页面数，默认 1
 * @param {string} fallbackUrl - 页面栈不足时的 fallback 路径，默认首页
 */
function safeNavigateBack(delta = 1, fallbackUrl = '/pages/index/index') {
  const pages = getCurrentPages();
  if (pages.length > delta) {
    // 页面栈足够，正常返回
    wx.navigateBack({ delta: delta });
  } else {
    // 页面栈不足，切换到 tabBar 页面
    wx.switchTab({ url: fallbackUrl });
  }
}

module.exports = {
  safeNavigateBack
};
