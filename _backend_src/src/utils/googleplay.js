// src/utils/googleplay.js - Google Play Developer API 服务端验签（Google Play Billing）
// 用途：App 端 wx.miniapp.GooglePlayBilling 支付成功后，前端把 purchaseToken 回传，
//       后端调用 Google Play Developer API（purchases.products.get / purchases.subscriptions.get）
//       服务端验签，确认购买真实有效后再开通 VIP（类比微信虚拟支付 virtual-notify 的"前端拉起 + 后端验签发货"链路）。
//
// 配置（.env）：
//   GOOGLE_PLAY_PACKAGE=com.clawbook.tianji
//   GOOGLE_PLAY_CREDENTIALS_JSON=<服务账号 JSON 原文 或 Base64>
//   GOOGLE_PLAY_CREDENTIALS_PATH=<服务账号 JSON 文件路径>（二选一）
//
// 服务账号来源：Google Cloud 控制台创建服务账号并生成 JSON 密钥 → 在 Play Console「用户和权限」关联该服务账号并授予
// 「查看财务数据 / 管理订单」等权限。
const axios = require('axios');
const jwt = require('jsonwebtoken');
const fs = require('fs');

let cachedToken = null;
let cachedTokenExpire = 0;

// 读取服务账号配置：优先 JSON 内容/Base64，其次文件路径
function getCredentials() {
  const raw = process.env.GOOGLE_PLAY_CREDENTIALS_JSON;
  if (raw) {
    try { return JSON.parse(raw); } catch (e) {
      try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch (e2) { /* fallthrough */ }
    }
  }
  const p = process.env.GOOGLE_PLAY_CREDENTIALS_PATH;
  if (p && fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { /* fallthrough */ }
  }
  return null;
}

/** 是否已配置可用的服务账号凭据 */
function isConfigured() {
  return !!(process.env.GOOGLE_PLAY_PACKAGE && getCredentials());
}

// 获取 OAuth access token（服务账号 JWT → token_uri 换取）
async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpire - 60000) return cachedToken;
  const cred = getCredentials();
  if (!cred) throw new Error('GOOGLE_PLAY_CREDENTIALS 未配置');
  const tokenUri = cred.token_uri || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: cred.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: tokenUri,
    iat: now,
    exp: now + 3600
  };
  const assertion = jwt.sign(claims, cred.private_key, { algorithm: 'RS256' });
  const body = new URLSearchParams();
  body.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  body.append('assertion', assertion);
  const resp = await axios.post(tokenUri, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000
  });
  if (!resp.data.access_token) {
    throw new Error('Google token 获取失败: ' + JSON.stringify(resp.data).slice(0, 300));
  }
  cachedToken = resp.data.access_token;
  cachedTokenExpire = Date.now() + (resp.data.expires_in || 3600) * 1000;
  return cachedToken;
}

// 验证一次性商品（INAPP）购买：purchases.products.get
// 返回 { purchaseState, purchaseTimeMillis, consumptionState, orderId, ... }
// purchaseState: 0=已购买(purchased) 1=已取消(cancelled) 2=已退款(refunded)
async function verifyProductPurchase(productId, purchaseToken) {
  const pkg = process.env.GOOGLE_PLAY_PACKAGE;
  const token = await getAccessToken();
  const url = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'
    + encodeURIComponent(pkg)
    + '/purchases/products/' + encodeURIComponent(productId)
    + '/tokens/' + encodeURIComponent(purchaseToken);
  const resp = await axios.get(url, { headers: { Authorization: 'Bearer ' + token }, timeout: 15000 });
  return resp.data;
}

// 验证订阅（SUBS）：purchases.subscriptions.get
async function verifySubscriptionPurchase(productId, purchaseToken) {
  const pkg = process.env.GOOGLE_PLAY_PACKAGE;
  const token = await getAccessToken();
  const url = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'
    + encodeURIComponent(pkg)
    + '/purchases/subscriptions/' + encodeURIComponent(productId)
    + '/tokens/' + encodeURIComponent(purchaseToken);
  const resp = await axios.get(url, { headers: { Authorization: 'Bearer ' + token }, timeout: 15000 });
  return resp.data;
}

module.exports = { isConfigured, getAccessToken, verifyProductPurchase, verifySubscriptionPurchase };
