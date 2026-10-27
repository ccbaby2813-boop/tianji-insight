// src/services/push-service.js - TIMPush 系统推送服务（Donut App 通知栏推送）
// 通道：腾讯云 IM 推送服务（TIMPush），接口 v4/timpush/batch（单发/批量，支持 RegistrationID）
// 覆盖：在线推送 + 离线厂商通道（华为/荣耀/OPPO/vivo/小米/魅族/FCM/APNs，需完成厂商配置）
//
// 配置（.env，均为占位，开通后填写）：
//   PUSH_SDKAPPID   IM 控制台 > 推送服务 Push > 概览 的 SDKAppID
//   PUSH_ADMIN_ID   App 管理员账号（默认 administrator）
//   PUSH_ADMIN_KEY  IM 控制台密钥 Key（用于生成 UserSig）
//   PUSH_DOMAIN     中国区默认 console.tim.qq.com
//
// 注意：未配置 PUSH_* 时所有方法静默跳过（返回 { skipped: true }），不影响现有业务。

const https = require('https');
const db = require('../middleware/db');
const { genUserSig } = require('./user-sig');

const BATCH_MAX = 500; // 单次最多 500 个 RegistrationID

// 24 节气中英文标准名（系统推送英文模板用）
const JIEQI_EN = {
  '立春': 'Start of Spring', '雨水': 'Rain Water', '惊蛰': 'Awakening of Insects',
  '春分': 'Spring Equinox', '清明': 'Pure Brightness', '谷雨': 'Grain Rain',
  '立夏': 'Start of Summer', '小满': 'Grain Buds', '芒种': 'Grain in Ear',
  '夏至': 'Summer Solstice', '小暑': 'Minor Heat', '大暑': 'Major Heat',
  '立秋': 'Start of Autumn', '处暑': 'End of Heat', '白露': 'White Dew',
  '秋分': 'Autumn Equinox', '寒露': 'Cold Dew', '霜降': "Frost's Descent",
  '立冬': 'Start of Winter', '小雪': 'Minor Snow', '大雪': 'Major Snow',
  '冬至': 'Winter Solstice', '小寒': 'Minor Cold', '大寒': 'Major Cold'
};
function jieqiEn(zh) { return JIEQI_EN[zh] || zh; }

function cfg() {
  return {
    sdkAppID: parseInt(process.env.PUSH_SDKAPPID || '0', 10),
    adminId: (process.env.PUSH_ADMIN_ID || 'administrator').trim(),
    adminKey: (process.env.PUSH_ADMIN_KEY || '').trim(),
    domain: (process.env.PUSH_DOMAIN || 'console.tim.qq.com').trim()
  };
}

function isConfigured() {
  const c = cfg();
  return c.sdkAppID > 0 && !!c.adminKey;
}

function _post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ ActionStatus: 'FAIL', ErrorCode: -1, ErrorInfo: data.slice(0, 300) });
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('TIMPush 请求超时'));
    });
    req.write(payload);
    req.end();
  });
}

/**
 * 调用 TIMPush REST API
 * @param {string} service - 接口名，如 'batch'
 * @param {object} body
 */
async function callTimpush(service, body) {
  const c = cfg();
  const random = Math.floor(Math.random() * 4294967295);
  const usersig = genUserSig(c.sdkAppID, c.adminKey, c.adminId);
  const url =
    `https://${c.domain}/v4/timpush/${service}` +
    `?usersig=${encodeURIComponent(usersig)}` +
    `&identifier=${encodeURIComponent(c.adminId)}` +
    `&sdkappid=${c.sdkAppID}` +
    `&random=${random}&contenttype=json`;
  return _post(url, body);
}

/**
 * 按 RegistrationID 列表定向推送（自动分批，每批 ≤500）
 * @param {string[]} registrationIds
 * @param {object} opts { title, desc, ext, classification }
 *   ext: 透传对象（如 { type: 'letter_received', letterId: '123' }），点击通知后前端可解析跳转
 *   classification: 0=系统消息（默认，厂商配额宽松）；1=运营消息
 */
async function pushToRegistrationIDs(registrationIds, { title, desc, ext, classification = 0, huaweiCategory = 'IM', xiaomiChannelID = '160531', oppoCategory = 'IM', vivoCategory = 'IM' } = {}) {
  if (!isConfigured()) return { skipped: true, reason: 'push not configured' };
  if (!registrationIds || !registrationIds.length) return { skipped: true, reason: 'empty target' };
  const results = [];
  for (let i = 0; i < registrationIds.length; i += BATCH_MAX) {
    const chunk = registrationIds.slice(i, i + BATCH_MAX);
    const body = {
      From_Account: cfg().adminId,
      To_Account: chunk,
      MsgRandom: Math.floor(Math.random() * 4294967295),
      OfflinePushInfo: {
        PushFlag: 0, // 在线走在线通道，离线走厂商通道
        Title: title || '',
        Desc: desc || '',
        Ext: ext ? JSON.stringify(ext) : '',
        // 厂商消息分类：HuaWeiCategory=IM 表示服务与通讯类（避免被厂商当作营销类限流）
        AndroidInfo: {
          HuaWeiCategory: huaweiCategory,
          XiaoMiChannelID: xiaomiChannelID,
          OPPOCategory: oppoCategory,
          VIVOCategory: vivoCategory
        },
        ApnsInfo: {
          Sound: 'default.mp3',
          BadgeMode: 1
        }
      },
      Classification: classification
    };
    try {
      const resp = await callTimpush('batch', body);
      results.push({ batch: Math.floor(i / BATCH_MAX), resp });
    } catch (err) {
      results.push({ batch: Math.floor(i / BATCH_MAX), error: err.message });
    }
  }
  return results;
}

/** 查询某 openid 的推送 RegistrationID（未注册返回 null） */
async function getRegistrationIdByOpenid(openid) {
  if (!openid) return null;
  const [rows] = await db.query(
    'SELECT push_registration_id FROM users WHERE openid = ? LIMIT 1',
    [openid]
  );
  return rows[0] && rows[0].push_registration_id ? rows[0].push_registration_id : null;
}

/**
 * 给单个用户推送（通过其绑定的 RegistrationID）
 * 失败/未配置/未注册 均静默跳过，不抛错
 */
async function getUserLang(openid) {
  try {
    const [rows] = await db.query('SELECT lang FROM users WHERE openid = ? LIMIT 1', [openid]);
    return rows[0] && rows[0].lang ? rows[0].lang : 'zh';
  } catch (e) { return 'zh'; }
}

async function sendToUser(openid, opts) {
  try {
    if (!isConfigured()) return { skipped: true, reason: 'push not configured' };
    const rid = await getRegistrationIdByOpenid(openid);
    if (!rid) return { skipped: true, reason: 'no registration id' };
    // 按接收者语言选择标题/内容（英文用户用 enTitle/enDesc）
    const lang = await getUserLang(openid);
    const title = (lang === 'en' && opts.enTitle) ? opts.enTitle : opts.title;
    const desc = (lang === 'en' && opts.enDesc) ? opts.enDesc : opts.desc;
    return await pushToRegistrationIDs([rid], { ...opts, title, desc });
  } catch (err) {
    console.error('[push] sendToUser error:', err.message);
    return { skipped: true, reason: err.message };
  }
}

/**
 * 给所有已注册推送的用户群发（节气提醒用）
 * 分批查询 users 表 push_registration_id 非空用户，再分批推送
 */
async function sendToAllRegistered({ title, desc, ext, classification = 0, enTitle, enDesc, huaweiCategory = 'IM', xiaomiChannelID = '160531', oppoCategory = 'IM', vivoCategory = 'IM' } = {}) {
  try {
    if (!isConfigured()) return { skipped: true, reason: 'push not configured' };
    const rids = [];
    const usersWithLang = [];
    let offset = 0;
    const bs = 1000;
    while (true) {
      const [rows] = await db.query(
        `SELECT push_registration_id, lang FROM users
         WHERE push_registration_id IS NOT NULL AND push_registration_id != ''
         ORDER BY id ASC LIMIT ? OFFSET ?`,
        [bs, offset]
      );
      if (!rows.length) break;
      rows.forEach((r) => {
        if (r.push_registration_id) { rids.push(r.push_registration_id); usersWithLang.push(r); }
      });
      if (rows.length < bs) break;
      offset += bs;
    }
    if (!rids.length) return { skipped: true, reason: 'no registered users' };
    // 按语言分组：英文用户用英文模板，其余用中文模板
    const zhRids = [], enRids = [];
    for (const u of usersWithLang) {
      if (u.lang === 'en') enRids.push(u.push_registration_id);
      else zhRids.push(u.push_registration_id);
    }
    const results = [];
    if (zhRids.length) {
      results.push(await pushToRegistrationIDs(zhRids, { title, desc, ext, classification, huaweiCategory, xiaomiChannelID, oppoCategory, vivoCategory }));
    }
    if (enRids.length && enTitle) {
      results.push(await pushToRegistrationIDs(enRids, { title: enTitle, desc: enDesc, ext, classification, huaweiCategory, xiaomiChannelID, oppoCategory, vivoCategory }));
    }
    return results;
  } catch (err) {
    console.error('[push] sendToAllRegistered error:', err.message);
    return { skipped: true, reason: err.message };
  }
}

module.exports = {
  isConfigured,
  jieqiEn,
  pushToRegistrationIDs,
  sendToUser,
  sendToAllRegistered,
  getRegistrationIdByOpenid
};
