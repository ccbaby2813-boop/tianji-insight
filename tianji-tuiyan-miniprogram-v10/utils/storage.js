/**
const i18n = require('./i18n.js');
 * utils/storage.js - 本地存储封装
 * 安全策略：容量检查，失败提示
 */

/**
 * 获取当前存储使用情况
 */
function getStorageInfo() {
  try {
    const info = wx.getStorageInfoSync();
    return {
      currentSize: info.currentSize,
      limitSize: info.limitSize,
      usagePercent: Math.round(info.currentSize / info.limitSize * 100),
      keys: info.keys
    };
  } catch (e) {
    console.error('storage getStorageInfo error', e);
    return null;
  }
}

/**
 * 检查存储容量是否足够
 */
function hasEnoughSpace(estimatedSizeKB = 100) {
  const info = getStorageInfo();
  if (!info) return true;
  const remaining = info.limitSize - info.currentSize;
  if (remaining < estimatedSizeKB) {
    console.warn('[storage] 存储空间不足: 剩余' + remaining + 'KB，需要' + estimatedSizeKB + 'KB');
    wx.showToast({ title: i18n.isEn() ? 'Storage space insufficient' : '存储空间不足', icon: 'none' });
    return false;
  }
  return true;
}

/**
 * 清理过期/无用数据
 */
function cleanup() {
  try {
    const info = wx.getStorageInfoSync();
    if (info.currentSize > info.limitSize * 0.8) {
      const cleanupKeys = ['temp_data', 'cache_', 'loading_'];
      for (const keyPrefix of cleanupKeys) {
        for (const key of info.keys) {
          if (key.startsWith(keyPrefix)) {
            wx.removeStorageSync(key);
          }
        }
      }
    }
  } catch (e) {
    console.error('storage cleanup error', e);
  }
}

function set(key, value) {
  try {
    // Bug #8修复：写入前检查容量
    if (!hasEnoughSpace(50)) {
      cleanup();
    }
    wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    console.error('storage set error:', key, e);
    if (e.errMsg && e.errMsg.indexOf('exceed') !== -1) {
      wx.showModal({ title: i18n.isEn() ? 'Notice' : '提示', content: i18n.isEn() ? 'Mini-program storage is full' : '小程序存储空间已满', showCancel: false });
    }
    return false;
  }
}

function get(key) {
  try {
    return wx.getStorageSync(key);
  } catch (e) {
    console.error('storage get error:', key, e);
    return null;
  }
}

function remove(key) {
  try {
    wx.removeStorageSync(key);
    return true;
  } catch (e) {
    console.error('storage remove error:', key, e);
    return false;
  }
}

module.exports = { set, get, remove, getStorageInfo, hasEnoughSpace, cleanup };
