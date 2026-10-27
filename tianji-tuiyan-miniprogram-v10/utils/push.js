/**
 * utils/push.js - Donut App 系统推送（TIMPush）注册与上报
 *
 * 职责：
 *   1. App 启动时注册推送服务（@tencentcloud/donut-push），拿到设备 RegistrationID
 *   2. 登录成功后把 RegistrationID 上报后端，绑定到用户（users.push_registration_id）
 *   3. 监听通知点击，跳转到对应页面（节气→首页；信件/匹配→易缘匹配列表）
 *
 * 注意：
 *   - 仅 Donut App 环境生效（小程序环境 require 失败自动跳过）
 *   - PUSH_SDK_APP_ID / PUSH_APP_KEY 为占位，需在腾讯云 IM 控制台开通推送后填入
 *   - 卸载重装 App 后 RegistrationID 会变化，需重新上报（本模块每次启动都会更新）
 */

const storage = require('./storage.js');
const api = require('./api.js');

// 腾讯云 IM 推送服务（TIMPush）配置
// 获取位置：腾讯云控制台 > 即时通信 IM > 你的应用 > 推送服务 Push > 概览
const PUSH_SDK_APP_ID = 1600161254; // SDKAppID
const PUSH_APP_KEY = 'q7a5zWtoGNDBhpLU0fZoZxlqWjaHfuSOuiG7AjSFgeGjPdjKhD6u8GA7uKbacbIO'; // 客户端密钥（Push Key）

let _push = null;
let _registered = false;

// 注册/上报失败重试（GBox 等容器环境首次注册常失败，需延迟重试）
const REGISTER_MAX_RETRIES = 3;
const REGISTER_RETRY_DELAYS = [5000, 30000, 60000]; // 5s / 30s / 60s
const REPORT_MAX_RETRIES = 3;
const REPORT_RETRY_DELAYS = [5000, 30000, 60000];
let _registerRetries = 0;

/** 获取 donut-push 模块（小程序环境 require 失败返回 null） */
function getPush() {
  if (_push !== null) return _push;
  try {
    _push = require('@tencentcloud/donut-push');
  } catch (e) {
    _push = null;
  }
  return _push;
}

function isAppEnv() {
  try {
    const app = getApp();
    if (app && app.globalData) {
      // 小程序环境不注册推送（Donut App 才有系统推送能力）
      if (app.globalData.isMpWeixin === true) return false;
    }
  } catch (e) {}
  return true;
}

/** 从 getRegistrationID 各种返回结构中稳健提取 RegistrationID 字符串 */
function extractRegistrationId(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  if (typeof res !== 'object') return '';
  // 直接字段
  const direct = res.registrationId || res.registrationID || res.token || res.registration_id;
  if (typeof direct === 'string' && direct) return direct;
  // 常见嵌套容器：{data:{...}} / {result:{...}} / {response:{...}} 等
  const containers = [res.data, res.result, res.response, res.payload];
  for (let i = 0; i < containers.length; i++) {
    const c = containers[i];
    if (!c) continue;
    if (typeof c === 'string') return c;
    if (typeof c === 'object') {
      const inner = extractRegistrationId(c);
      if (inner) return inner;
    }
  }
  return '';
}

/**
 * 初始化推送（App onLaunch 调用）：
 * 注册推送 → 获取 RegistrationID → 存本地 → 若已登录则上报
 * 注册失败自动延迟重试（最多3次），GBox 容器等环境可恢复
 */
function initPush() {
  try {
    if (!isAppEnv()) return;
    const Push = getPush();
    if (!Push || typeof Push.registerPush !== 'function') {
      console.warn('[push] donut-push 未安装或当前环境不支持，跳过推送注册');
      return;
    }
    if (_registered) return;
    _registered = true;
    _registerRetries = 0;

    doRegister();
  } catch (e) {
    console.warn('[push] initPush 异常:', e && e.message);
  }
}

/** 实际执行注册（可被重试调度重复调用） */
function doRegister() {
  try {
    // 注册通知点击监听（每次注册都注册，幂等）
    try {
      const Push = getPush();
      if (Push && typeof Push.addPushListener === 'function') {
        Push.addPushListener(Push.EventName.NOTIFICATION_CLICKED, (param) => {
          handleNotificationClick(param);
        });
      }
    } catch (e) {
      console.warn('[push] addPushListener 失败:', e && e.message);
    }
    const Push = getPush();
    if (!Push || typeof Push.registerPush !== 'function') return;

    Push.registerPush(PUSH_SDK_APP_ID, PUSH_APP_KEY)
      .then(() => Push.getRegistrationID())
      .then((res) => {
        const registrationId = extractRegistrationId(res);
        if (!registrationId) {
          console.error('[push] 获取 RegistrationID 为空:', JSON.stringify(res));
          scheduleRegisterRetry();
          return;
        }
        _registerRetries = 0;
        storage.set('push_registration_id', registrationId);
        console.log('[push] RegistrationID:', registrationId);
        // 无论是否已登录都尝试上报；未登录时 reportRegistrationId 内部会保留本地并标记待上报
        reportRegistrationId(registrationId);
      })
      .catch((err) => {
        console.error('[push] registerPush failed:', JSON.stringify(err));
        _registered = false;
        scheduleRegisterRetry();
      });
  } catch (e) {
    console.warn('[push] doRegister 异常:', e && e.message);
    _registered = false;
    scheduleRegisterRetry();
  }
}

/** 注册失败延迟重试 */
function scheduleRegisterRetry() {
  if (_registerRetries >= REGISTER_MAX_RETRIES) {
    console.warn('[push] registerPush 重试达上限，等待下次启动再试');
    return;
  }
  const delay = REGISTER_RETRY_DELAYS[Math.min(_registerRetries, REGISTER_RETRY_DELAYS.length - 1)];
  _registerRetries++;
  console.log('[push] ' + (delay / 1000) + 's 后重试推送注册（第' + _registerRetries + '次）');
  setTimeout(() => {
    if (_registered) return;
    _registered = true;
    doRegister();
  }, delay);
}

/** 上报失败延迟重试 */
let _reportRetries = 0;
function scheduleReportRetry(rid) {
  if (_reportRetries >= REPORT_MAX_RETRIES) {
    console.warn('[push] 上报重试达上限，保留本地待下次上报');
    storage.set('push_pending_report', '1');
    return;
  }
  const delay = REPORT_RETRY_DELAYS[Math.min(_reportRetries, REPORT_RETRY_DELAYS.length - 1)];
  _reportRetries++;
  console.log('[push] ' + (delay / 1000) + 's 后重试上报 RegistrationID（第' + _reportRetries + '次）');
  setTimeout(() => {
    reportRegistrationId(rid);
  }, delay);
}


/**
 * 上报 RegistrationID 到后端（登录成功后由 app.js 调用，也可在注册完成后自动调用）
 * @param {string} registrationId - 缺省时读取本地存储
 * 逻辑：
 *   - 未登录：保留本地 + 标记 push_pending_report=1，登录/恢复会话后由 app.js 补报
 *   - 已登录：立即上报；失败自动延迟重试（最多3次）
 *   - 上报成功：清除待上报标记
 */
function reportRegistrationId(registrationId) {
  try {
    const rid = registrationId || storage.get('push_registration_id') || '';
    if (!rid) return;
    const app = getApp();
    const token = (app && app.globalData && app.globalData.token) || storage.get('token') || '';
    if (!token) {
      // 未登录：等待登录成功后再次上报（app.js login/restoreSession 成功后会调用）
      storage.set('push_pending_report', '1');
      console.log('[push] 未登录，RegistrationID 已本地暂存，等待登录后上报');
      return;
    }
    // 语言偏好随上报传给后端，系统推送按用户语言出英文/中文模板
    let lang = 'zh';
    try { lang = require('./i18n.js').isEn() ? 'en' : 'zh'; } catch (e) {}
    api.request('/api/push/register', 'POST', { registrationId: rid, lang: lang })
      .then((res) => {
        if (res && res.success) {
          console.log('[push] RegistrationID 上报成功');
          storage.remove('push_pending_report');
          _reportRetries = 0;
        } else {
          console.warn('[push] RegistrationID 上报失败:', JSON.stringify(res));
          scheduleReportRetry(rid);
        }
      })
      .catch((err) => {
        console.warn('[push] RegistrationID 上报异常:', err);
        scheduleReportRetry(rid);
      });
  } catch (e) {}
}

/** 通知点击跳转：解析后端透传的 ext（JSON），按类型跳转 */
function handleNotificationClick(param) {
  try {
    let raw = '';
    if (param && typeof param === 'object') {
      raw = param.ext || param.data || param.content || '';
    } else if (typeof param === 'string') {
      raw = param;
    }
    let obj = {};
    if (typeof raw === 'string' && raw) {
      try { obj = JSON.parse(raw); } catch (e) { obj = { type: raw }; }
    } else if (raw && typeof raw === 'object') {
      obj = raw;
    }
    const type = obj.type || '';
    console.log('[push] 通知点击:', type, obj);
    if (type === 'jieqi_reminder') {
      wx.switchTab({ url: '/pages/index/index' });
    } else if (type === 'letter_received' || type === 'match_reply') {
      wx.navigateTo({ url: '/sub/match/my-matches/index' });
    }
  } catch (e) {
    console.warn('[push] 通知点击处理异常:', e && e.message);
  }
}

/**
 * 补报入口：登录/恢复会话成功后调用。
 * 从本地读取 RegistrationID 重新上报（无论是否标记待上报，幂等安全）。
 */
function ensureReport() {
  reportRegistrationId();
}

module.exports = {
  initPush,
  reportRegistrationId,
  ensureReport,
  handleNotificationClick
};
