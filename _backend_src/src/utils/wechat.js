// src/utils/wechat.js - 微信API工具（access_token管理，v10.3: 统一 Redis 客户端）
const axios = require('axios');
const { getClient } = require('../services/redis-client');

const APPID = process.env.WX_APPID;
const APPSECRET = process.env.WX_APPSECRET;

// Redis key for cluster-shared access_token cache
const TOKEN_KEY = 'tianji:wechat:access_token';
const TOKEN_LOCK_KEY = 'tianji:wechat:access_token:lock';

/**
 * 获取微信 access_token（带Redis缓存，提前5分钟刷新，集群共享）
 */
async function getAccessToken() {
  const client = await getClient();
  if (!client) throw new Error('Redis不可用，无法获取access_token');

  try {
    // Try to get cached token from Redis
    const cached = await client.get(TOKEN_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      if (Date.now() < data.expireAt) {
        return data.token;
      }
    }
  } catch (e) {
    console.error('[wechat] Redis get failed:', e.message);
  }

  // Use distributed lock to prevent multiple processes from refreshing simultaneously
  let lockAcquired = false;
  try {
    const lock = await client.set(TOKEN_LOCK_KEY, '1', { NX: true, EX: 30 });
    lockAcquired = !!lock;
  } catch (e) {
    console.error('[wechat] Redis lock failed:', e.message);
    lockAcquired = true; // fallback: proceed without lock
  }

  if (!lockAcquired) {
    // Another process is refreshing, wait and retry
    await new Promise(r => setTimeout(r, 2000));
    return getAccessToken();
  }

  try {
    if (!APPID || !APPSECRET) {
      throw new Error('WX_APPID或WX_APPSECRET未配置');
    }

    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APPID}&secret=${encodeURIComponent(APPSECRET)}`;
    const resp = await axios.get(url, { timeout: 10000 });

    if (resp.data.errcode) {
      throw new Error(`获取access_token失败: ${resp.data.errmsg} (${resp.data.errcode})`);
    }

    const token = resp.data.access_token;
    // 提前5分钟过期，确保不会在请求过程中失效
    const expireAt = Date.now() + (resp.data.expires_in - 300) * 1000;
    const ttlSeconds = resp.data.expires_in - 300;

    // Store in Redis with TTL
    try {
      await client.setEx(TOKEN_KEY, Math.max(ttlSeconds, 60), JSON.stringify({ token, expireAt }));
    } catch (e) {
      console.error('[wechat] Redis set failed:', e.message);
    }

    console.log('[wechat] access_token已刷新, 过期时间:', new Date(expireAt).toISOString());
    return token;
  } finally {
    // Release lock
    try {
      await client.del(TOKEN_LOCK_KEY);
    } catch (e) {}
  }
}

/**
 * 查询虚拟支付订单状态
 */
async function queryVirtualOrder(openid, outTradeNo, env) {
  const token = await getAccessToken();
  const envVal = env !== undefined ? env : parseInt(process.env.XPAY_ENV || '0');

  const url = `https://api.weixin.qq.com/xpay/query_order?access_token=${token}`;
  const body = { openid, out_trade_no: outTradeNo, env: envVal };

  console.log(`[wechat] 查询订单: openid=${openid}, outTradeNo=${outTradeNo}, env=${envVal}`);
  const resp = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000
  });

  if (resp.data.errcode && resp.data.errcode !== 0) {
    throw new Error(`查询订单失败: ${resp.data.errmsg} (${resp.data.errcode})`);
  }

  return resp.data;
}

module.exports = { getAccessToken, queryVirtualOrder };
