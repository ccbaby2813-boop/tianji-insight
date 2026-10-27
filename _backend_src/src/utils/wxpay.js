// src/utils/wxpay.js - 微信支付 V3 API 封装 (H5支付 + APP支付)
const crypto = require('crypto');
const axios = require('axios');

const WXPAY_MCHID = process.env.WXPAY_MCHID || '';
const WXPAY_APPID = process.env.WXPAY_APPID || '';
const WXPAY_APP_APPID = process.env.WXPAY_APP_APPID || '';
const WXPAY_API_V3_KEY = process.env.WXPAY_API_V3_KEY || '';
const WXPAY_SERIAL_NO = process.env.WXPAY_SERIAL_NO || '';
const WXPAY_PRIVATE_KEY = (process.env.WXPAY_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const WXPAY_NOTIFY_URL = process.env.WXPAY_NOTIFY_URL || 'https://claw-book.cn/tianji/api/payment/h5-notify';

function isConfigured() {
  return !!(WXPAY_MCHID && WXPAY_API_V3_KEY && WXPAY_SERIAL_NO && WXPAY_PRIVATE_KEY);
}

function sign(method, url, timestamp, nonceStr, body) {
  const signStr = method + '\n' + url + '\n' + timestamp + '\n' + nonceStr + '\n' + (body || '') + '\n';
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signStr);
  sign.end();
  return sign.sign(WXPAY_PRIVATE_KEY, 'base64');
}

function getAuthorization(method, url, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const signature = sign(method, url, timestamp, nonceStr, body);
  return {
    'Authorization': 'WECHATPAY2-SHA256-RSA2048 mchid="' + WXPAY_MCHID + '",nonce_str="' + nonceStr + '",signature="' + signature + '",timestamp="' + timestamp + '",serial_no="' + WXPAY_SERIAL_NO + '"',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Tianji-Tuiyan/1.0'
  };
}

async function createH5Order({ outTradeNo, totalAmount, description, clientIp }) {
  if (!isConfigured()) {
    throw new Error('WXPAY_NOT_CONFIGURED');
  }
  const url = '/v3/pay/transactions/h5';
  const body = JSON.stringify({
    appid: WXPAY_APPID,
    mchid: WXPAY_MCHID,
    description: description || 'VIP',
    out_trade_no: outTradeNo,
    notify_url: WXPAY_NOTIFY_URL,
    amount: { total: totalAmount, currency: 'CNY' },
    scene_info: { payer_client_ip: clientIp || '127.0.0.1', h5_info: { type: 'Wap' } }
  });
  const headers = getAuthorization('POST', url, body);
  try {
    const resp = await axios.post('https://api.mch.weixin.qq.com' + url, body, { headers, timeout: 30000 });
    return { success: true, h5_url: resp.data.h5_url };
  } catch (err) {
    console.error('[wxpay] createH5Order:', err.response && err.response.data || err.message);
    return { success: false, error: (err.response && err.response.data && err.response.data.message) || err.message };
  }
}

async function queryOrder(outTradeNo) {
  if (!isConfigured()) throw new Error('WXPAY_NOT_CONFIGURED');
  const url = '/v3/pay/transactions/out-trade-no/' + outTradeNo + '?mchid=' + WXPAY_MCHID;
  const headers = getAuthorization('GET', url, '');
  try {
    const resp = await axios.get('https://api.mch.weixin.qq.com' + url, { headers, timeout: 10000 });
    return { success: true, data: resp.data };
  } catch (err) {
    console.error('[wxpay] queryOrder:', err.response && err.response.data || err.message);
    return { success: false, error: (err.response && err.response.data && err.response.data.message) || err.message };
  }
}

function decryptNotify(ciphertext, associatedData, nonce) {
  const buff = Buffer.from(ciphertext, 'base64');
  const authTag = buff.subarray(buff.length - 16);
  const data = buff.subarray(0, buff.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(WXPAY_API_V3_KEY), Buffer.from(nonce));
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(associatedData));
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

async function createAppOrder({ outTradeNo, totalAmount, description }) {
  if (!isConfigured()) {
    throw new Error('WXPAY_NOT_CONFIGURED');
  }
  if (!WXPAY_APP_APPID) {
    throw new Error('WXPAY_APP_APPID not configured');
  }
  const url = '/v3/pay/transactions/app';
  const body = JSON.stringify({
    appid: WXPAY_APP_APPID,
    mchid: WXPAY_MCHID,
    description: description || 'VIP',
    out_trade_no: outTradeNo,
    notify_url: WXPAY_NOTIFY_URL,
    amount: { total: totalAmount, currency: 'CNY' }
  });
  const headers = getAuthorization('POST', url, body);
  try {
    const resp = await axios.post('https://api.mch.weixin.qq.com' + url, body, { headers, timeout: 30000 });
    const prepayId = resp.data.prepay_id;
    if (!prepayId) {
      return { success: false, error: 'No prepay_id in response' };
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = crypto.randomBytes(16).toString('hex');
    const message = WXPAY_APP_APPID + '\n' + timestamp + '\n' + nonceStr + '\n' + prepayId + '\n';
    const paySign = crypto.createSign('RSA-SHA256').update(message).end().sign(WXPAY_PRIVATE_KEY, 'base64');

    return {
      success: true,
      payParams: {
        appid: WXPAY_APP_APPID,
        partnerid: WXPAY_MCHID,
        prepayid: prepayId,
        package: 'Sign=WXPay',
        noncestr: nonceStr,
        timestamp: timestamp,
        sign: paySign
      }
    };
  } catch (err) {
    console.error('[wxpay] createAppOrder:', err.response && err.response.data || err.message);
    return { success: false, error: (err.response && err.response.data && err.response.data.message) || err.message };
  }
}

module.exports = { isConfigured, createH5Order, createAppOrder, queryOrder, decryptNotify, getMchid: () => WXPAY_MCHID };
