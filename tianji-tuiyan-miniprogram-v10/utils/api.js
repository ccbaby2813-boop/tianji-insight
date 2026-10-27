/**
 * utils/api.js - API请求封装
 * 超时策略：普通接口10s，推演接口60s，支付接口30s
 * 自动处理：401自动重新登录，token过期处理
 * 错误码映射：后端错误码 -> 前端中文提示
 */
const env = require('../config/env.js');

// 错误码映射表
const ERROR_MAP = {
  INVALID_PARAM: '参数有误',
  USER_NOT_FOUND: '用户不存在',
  USER_ALREADY_EXISTS: '用户已存在',
  RECORD_NOT_FOUND: '记录不存在',
  QUOTA_EXCEEDED: '今日超级推演次数已用完，明天再来',
  // v17.0 积分体系错误码
  POINTS_INSUFFICIENT: '积分不足：每日签到+10，看视频+10',
  ALREADY_CHECKED_IN: '今日已签到，明天再来',
  AD_TOO_FREQUENT: '操作太快了，稍后再试',
  VIP_DECODE_NO_QUOTA: '连续签到7天可获1次深度解读，或开通易学会员每日1次',
  AI_TIMEOUT: '天机信号不稳定，请稍后再试',
  AI_ERROR: '天机信号不稳定，请稍后再试',
  RATE_LIMITED: '操作太频繁，请稍后再试',
  INTERNAL_ERROR: '系统异常，请稍后再试',
  GUA_NOT_FOUND: '易经人格不存在',
  WX_LOGIN_FAILED: '微信登录失败',
  DB_ERROR: '数据库异常',
  INVALID_SHARE_ID: '分享短码不存在',
  SHARE_EXPIRED: '分享短码已过期',
  SHARE_LIMIT_EXCEEDED: '分享短码使用次数已用完',
  ALREADY_PENDING: '已有待删除申请',
  NO_PENDING: '无待删除申请',
  FORBIDDEN: '禁止访问',
  PAYMENT_NOT_AVAILABLE: '支付暂未开放',
  PAYMENT_UNAVAILABLE: '支付暂未开放',
  ADMIN_AUTH_FAILED: '管理认证失败',
  TIMEOUT: '天机信号不稳定，请稍后再试',
  NETWORK_ERROR: '网络异常，请检查网络连接',
  AUTH_TOKEN_MISSING: '请先登录',
  AUTH_TOKEN_INVALID: '登录状态无效',
  AUTH_TOKEN_EXPIRED: '登录已过期，请重新登录',
  // v1.4 补全后端实际抛出但前端未映射的错误码
  PROFILE_INCOMPLETE: '请先完善档案',
  USER_BANNED: '该账号已被封禁，如有疑问请联系客服',
  TOO_MANY_REQUESTS: '当前推演请求较多，请稍候再试',
  SERVER_ERROR: '服务异常，请稍后再试',
  QIMEN_ERROR: '奇门计算错误，请稍后再试',
  AUTH_CHECK_FAILED: '认证检查失败，请稍后重试',
  NOT_FOUND: '接口不存在',
  SESSION_KEY_MISSING: '登录凭证已过期，请重新进入小程序',
  DUPLICATE_ORDER: '请勿重复提交，请稍后再试',
  ORDER_FAILED: '创建订单失败',
  ORDER_CREATE_FAILED: '订单创建失败，请稍后再试',
  ORDER_NOT_FOUND: '订单不存在',
  SYNC_FAILED: '补发货失败',
  SAME_GENDER: '只能匹配异性',
  BLOCKED: '双方已拉黑，无法匹配或通信',
  MATCH_LIMIT_EXCEEDED: '今日匹配次数已用完，明日再来',
  NOT_MATCHED: '只能给已匹配的有缘人写信或拉黑',
  DAILY_LETTER_LIMIT_EXCEEDED: '今日写信次数已用完',
  DUPLICATE_REPORT: '您已举报过该用户，请勿重复举报',
  CONFIG_ERROR: '服务器配置错误，请联系管理员',
  SMS_FAILED: '短信发送失败，请稍后重试',
  AUTH_FAILED: '未认证',
  JIE_QI_NOT_FOUND: '节气计算异常',
  JIE_QI_DATA_MISSING: '节气数据未配置',
  PARAM_MISSING: '缺少必要参数',
  JIE_QI_WUXING_MISSING: '节气五行配置缺失',
  RELATION_MISSING: '五行关系配置缺失'
};

// 英文错误映射（海外版 CHANNEL=google 英文态使用）
const EN_ERROR_MAP = {
  INVALID_PARAM: 'Invalid parameters', USER_NOT_FOUND: 'User not found', USER_ALREADY_EXISTS: 'User already exists',
  RECORD_NOT_FOUND: 'Record not found', QUOTA_EXCEEDED: "Today's deep insight limit is reached. Come back tomorrow",
  POINTS_INSUFFICIENT: 'Not enough points. Daily check-in +10, watch a video +10', ALREADY_CHECKED_IN: 'Already checked in today. Come back tomorrow',
  AD_TOO_FREQUENT: 'Too frequent, please retry later', VIP_DECODE_NO_QUOTA: 'Check in 7 days in a row for 1 Deep Insight, or subscribe for 1 daily',
  AI_TIMEOUT: 'Unstable cosmic signal, please retry', AI_ERROR: 'Unstable cosmic signal, please retry',
  RATE_LIMITED: 'Too many requests, please retry later', INTERNAL_ERROR: 'System error, please retry',
  GUA_NOT_FOUND: 'Hexagram not found', WX_LOGIN_FAILED: 'WeChat login failed', DB_ERROR: 'Database error',
  INVALID_SHARE_ID: 'Invalid share link', SHARE_EXPIRED: 'Share link expired', SHARE_LIMIT_EXCEEDED: 'Share link usage limit reached',
  ALREADY_PENDING: 'A delete request is already pending', NO_PENDING: 'No pending delete request', FORBIDDEN: 'Access denied',
  PAYMENT_NOT_AVAILABLE: 'Payments coming soon', PAYMENT_UNAVAILABLE: 'Payments coming soon', ADMIN_AUTH_FAILED: 'Admin authentication failed',
  TIMEOUT: 'Unstable cosmic signal, please retry', NETWORK_ERROR: 'Network error, please check your connection',
  AUTH_TOKEN_MISSING: 'Please sign in first', AUTH_TOKEN_INVALID: 'Invalid login state', AUTH_TOKEN_EXPIRED: 'Login expired, please sign in again',
  PROFILE_INCOMPLETE: 'Please complete your profile first', USER_BANNED: 'This account has been banned. Contact support if you have questions',
  TOO_MANY_REQUESTS: 'Too many requests, please wait', SERVER_ERROR: 'Service error, please retry',
  QIMEN_ERROR: 'Qimen calculation error, please retry', AUTH_CHECK_FAILED: 'Authentication check failed, please retry', NOT_FOUND: 'Not found',
  SESSION_KEY_MISSING: 'Login session expired, please reopen the app', DUPLICATE_ORDER: "Please don't submit twice, retry later",
  ORDER_FAILED: 'Order creation failed', ORDER_CREATE_FAILED: 'Order creation failed, please retry', ORDER_NOT_FOUND: 'Order not found',
  SYNC_FAILED: 'Delivery sync failed', SAME_GENDER: 'You can only match with the opposite gender',
  BLOCKED: 'You two have blocked each other. No matching or messaging', MATCH_LIMIT_EXCEEDED: "Today's match limit is reached. Come back tomorrow",
  NOT_MATCHED: 'You can only write to your matched connections', DAILY_LETTER_LIMIT_EXCEEDED: "Today's letter limit is reached",
  DUPLICATE_REPORT: "You already reported this user. Please don't repeat", CONFIG_ERROR: 'Server configuration error, please contact support',
  SMS_FAILED: 'SMS sending failed, please retry', AUTH_FAILED: 'Not authenticated',
  JIE_QI_NOT_FOUND: 'Solar term calculation error', JIE_QI_DATA_MISSING: 'Solar term data not configured',
  PARAM_MISSING: 'Missing required parameters', JIE_QI_WUXING_MISSING: 'Solar term wuxing config missing', RELATION_MISSING: 'Wuxing relation config missing'
};

/**
 * 获取超时配置
 */
function getTimeout(url, method) {
  // 超级推演接口：400秒（服务端最多3次重试×120s+退避≈380s，留余量）
  if (url.indexOf('/api/tuiyan/vip') !== -1 && method === 'POST') {
    return 400000;
  }
  // 普通推演接口：60秒
  if (url.indexOf('/api/tuiyan') !== -1 && method === 'POST') {
    return 60000;
  }
  // 支付接口：30秒
  if (url.indexOf('/payment/') !== -1) {
    return 30000;
  }
  // 普通接口：10秒
  return 10000;
}

/**
 * 通用请求方法
 */
// 🔴 修复：401重试锁，避免并发请求触发多次wx.login
let _reLoginPromise = null;

async function request(path, method, data) {
  let isEn = false;
  try { isEn = require('./i18n.js').isEn(); } catch (e) {}
  const MAP = isEn ? EN_ERROR_MAP : ERROR_MAP;
  return new Promise((resolve, reject) => {
    const app = getApp();
    const token = (app && app.globalData) ? app.globalData.token : '';

    const timeout = getTimeout(path, method);
    const url = env.API_BASE + (path.startsWith('/') ? path : '/' + path);

    const header = { 'Content-Type': 'application/json', 'x-api-version': '2', 'X-Lang': isEn ? 'en' : 'zh' };
    if (token) {
      header['Authorization'] = 'Bearer ' + token;
    }

    wx.request({
      url: url,
      method: method,
      data: data || {},
      header: header,
      timeout: timeout,
      success: async (res) => {
        // 401: token过期/无效，等待登录完成后自动重试
        if (res.statusCode === 401) {
          const storage = require('./storage.js');
          storage.remove('token');
          if (app && app.globalData) {
            app.globalData.token = '';
          }
          // 🔴 修复：App端（非微信小程序）401直接跳登录页，不重试
          if (app && app.globalData && app.globalData.isMpWeixin === false) {
            if (typeof app.redirectToLogin === 'function') {
              app.redirectToLogin();
            }
            resolve({ success: false, code: 'AUTH_TOKEN_EXPIRED', message: isEn ? 'Login expired, please sign in again' : '登录已过期，请重新登录' });
            return;
          }
          // 401 时重新登录
          try {
            if (!_reLoginPromise) {
              if (app && typeof app.login === 'function') {
                // App端和小程序端都使用 app.login()
                // 小程序端：wx.login 静默登录
                // App端：wx.weixinAppLogin 唤起微信
                _reLoginPromise = app.login();
              } else {
                _reLoginPromise = Promise.reject(new Error('no login method'));
              }
            }
            await _reLoginPromise;
            _reLoginPromise = null;
            // 登录成功后自动重试原请求
            const retryToken = (app && app.globalData) ? app.globalData.token : '';
            const retryHeader = { 'Content-Type': 'application/json', 'x-api-version': '2', 'X-Lang': isEn ? 'en' : 'zh' };
            if (retryToken) {
              retryHeader['Authorization'] = 'Bearer ' + retryToken;
            }
            wx.request({
              url: url,
              method: method,
              data: data || {},
              header: retryHeader,
              timeout: timeout,
              success: (retryRes) => {
                if (retryRes.statusCode >= 200 && retryRes.statusCode < 300 && retryRes.data) {
                  resolve(retryRes.data);
                } else if (retryRes.statusCode === 401) {
                  resolve({ success: false, code: 'AUTH_TOKEN_EXPIRED', message: isEn ? 'Login expired, please sign in again' : '登录已过期，请重新登录' });
                } else if (retryRes.data && retryRes.data.code) {
                  const msg = isEn ? (MAP[retryRes.data.code] || 'Request failed') : (MAP[retryRes.data.code] || retryRes.data.message || '请求失败');
                  resolve({ success: false, code: retryRes.data.code, message: msg });
                } else {
                  resolve({ success: false, code: 'NETWORK_ERROR', message: isEn ? 'Network error, please check your connection' : '网络异常，请检查网络连接' });
                }
              },
              fail: (err) => {
                resolve({ success: false, code: 'NETWORK_ERROR', message: '网络异常，请检查网络连接', detail: err ? err.errMsg : 'unknown' });
              }
            });
          } catch (e) {
            _reLoginPromise = null;
            resolve({ success: false, code: 'AUTH_TOKEN_EXPIRED', message: isEn ? 'Login expired, please sign in again' : '登录已过期，请重新登录' });
          }
          return;
        }

        // 🔴 修复：403专门处理（openid不一致、无权访问）
        if (res.statusCode === 403) {
          const code = (res.data && res.data.code) || 'FORBIDDEN';
          const msg = isEn ? (MAP[code] || 'Access denied') : ((res.data && res.data.message) || MAP[code] || '无权访问该内容');
          resolve({ success: false, code: code, message: msg });
          return;
        }
        // 🔴 修复：404专门处理（记录不存在）
        if (res.statusCode === 404) {
          const code = (res.data && res.data.code) || 'RECORD_NOT_FOUND';
          const msg = isEn ? (MAP[code] || 'Record not found') : ((res.data && res.data.message) || MAP[code] || '记录不存在');
          resolve({ success: false, code: code, message: msg });
          return;
        }

        if (res.statusCode >= 200 && res.statusCode < 300 && res.data) {
          resolve(res.data);
        } else if (res.data && res.data.code) {
          const msg = isEn ? (MAP[res.data.code] || 'Request failed') : (res.data.message || MAP[res.data.code] || '请求失败');
          // v19.4 保留响应 data 字段（如 409 MERGE_CONFIRM 返回 boundNickname 供前端弹窗展示）
          resolve({ success: false, code: res.data.code, message: msg, data: res.data.data });
        } else {
          resolve({ success: false, code: 'NETWORK_ERROR', message: isEn ? 'Network error, please check your connection' : '网络异常，请检查网络连接' });
        }
      },
      fail: (err) => {
        resolve({
          success: false,
          code: 'NETWORK_ERROR',
          message: isEn ? 'Network error, please check your connection' : '网络异常，请检查网络连接',
          detail: err ? err.errMsg : 'unknown'
        });
      }
    });
  });
}

/**
 * 带认证的请求（openid由JWT token携带，不在body中冗余发送）
 */
function requestWithAuth(path, method, data) {
  return request(path, method, data);
}

/**
 * 额度不足时跳转VIP
 */
function goToVip() {
  let isEn = false;
  try { isEn = require('./i18n.js').isEn(); } catch (e) {}
  wx.showModal({
    title: isEn ? 'Insufficient quota' : '额度不足',
    content: isEn ? "Today's insight limit is reached. Subscribe for 20 daily insights" : '今日推演次数已用完，开通易学会员每日20次推演',
    confirmText: isEn ? 'Subscribe' : '开通易学会员',
    cancelText: isEn ? 'Later' : '再看看',
    success: (res) => {
      if (res.confirm) {
        wx.navigateTo({ url: '/sub/vip/vip/index' });
      }
    }
  });
}

module.exports = { request, requestWithAuth, goToVip, ERROR_MAP };
