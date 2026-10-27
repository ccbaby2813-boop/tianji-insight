// src/services/redis.js - Redis client for VIP decode rate limiting (v10.3: 统一 Redis 客户端)
const { getClient } = require('./redis-client');

const PREFIX = 'tianji:';

// Per-user daily quota overrides
const VIP_DECODE_OVERRIDES = (() => {
  try {
    return JSON.parse(process.env.VIP_DECODE_OVERRIDES || '{}');
  } catch (e) {
    console.error('[Redis] Failed to parse VIP_DECODE_OVERRIDES:', e.message);
    return {};
  }
})();
const VIP_DECODE_DEFAULT_LIMIT = parseInt(process.env.VIP_DECODE_DAILY_LIMIT || '1', 10);

function getUserDailyLimit(openid) {
  return VIP_DECODE_OVERRIDES[openid] || VIP_DECODE_DEFAULT_LIMIT;
}

function todayDate() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function checkVipDecodeLimit(openid) {
  const key = PREFIX + 'vip_decode:' + openid + ':' + todayDate();
  try {
    const c = await getClient();
    if (!c) return { allowed: false, remaining: 0, error: 'rate_limit_unavailable' };
    const val = await c.get(key);
    const count = val ? parseInt(val, 10) : 0;
    const limit = getUserDailyLimit(openid);
    const remaining = Math.max(0, limit - count);
    if (count < limit) return { allowed: true, remaining };
    return { allowed: false, remaining: 0 };
  } catch (err) {
    console.error('[Redis] checkVipDecodeLimit error:', err.message);
    return { allowed: false, remaining: 0, error: 'rate_limit_unavailable' };
  }
}

async function consumeVipDecodeLimit(openid) {
  const key = PREFIX + 'vip_decode:' + openid + ':' + todayDate();
  try {
    const c = await getClient();
    if (!c) return;
    const count = await c.incr(key);
    if (count === 1) await c.expire(key, 86400).catch(() => {});
    else await c.expire(key, 86400).catch(() => {});
  } catch (err) {
    console.error('[Redis] consumeVipDecodeLimit error:', err.message);
  }
}

// [SEC-FIX] P2-1: 原子"检查+扣减"VIP深度解读额度（Lua），防止并发请求同时通过只读检查导致超发
const TRY_CONSUME_VIP_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local count = redis.call('GET', key)
if not count then
  redis.call('SET', key, 1, 'PX', 86400000)
  return 1
end
count = tonumber(count)
if count < limit then
  redis.call('INCR', key)
  redis.call('PEXPIRE', key, 86400000)
  return count + 1
end
return 0
`;

/**
 * 原子消耗1次VIP深度解读额度
 * @returns {{allowed: boolean, remaining: number, error?: string}}
 */
async function tryConsumeVipDecodeLimit(openid) {
  const key = PREFIX + 'vip_decode:' + openid + ':' + todayDate();
  try {
    const c = await getClient();
    if (!c) return { allowed: false, remaining: 0, error: 'rate_limit_unavailable' };
    const limit = getUserDailyLimit(openid);
    const result = await c.eval(TRY_CONSUME_VIP_LUA, { keys: [key], arguments: [String(limit)] });
    if (result === 0) return { allowed: false, remaining: 0 };
    return { allowed: true, remaining: Math.max(0, limit - result) };
  } catch (err) {
    console.error('[Redis] tryConsumeVipDecodeLimit error:', err.message);
    return { allowed: false, remaining: 0, error: 'rate_limit_unavailable' };
  }
}

async function getVipDecodeRemaining(openid) {
  const key = PREFIX + 'vip_decode:' + openid + ':' + todayDate();
  try {
    const c = await getClient();
    if (!c) return getUserDailyLimit(openid);
    const val = await c.get(key);
    const count = val ? parseInt(val, 10) : 0;
    const limit = getUserDailyLimit(openid);
    return Math.max(0, limit - count);
  } catch (err) {
    console.error('[Redis] getVipDecodeRemaining error:', err.message);
    return getUserDailyLimit(openid);
  }
}

async function clearVipDecodeLimit(openid) {
  const key = PREFIX + 'vip_decode:' + openid + ':' + todayDate();
  try {
    const c = await getClient();
    if (!c) return;
    await c.del(key);
  } catch (err) {
    console.error('[Redis] clearVipDecodeLimit error:', err.message);
  }
}

async function decrVipDecodeLimit(openid) {
  const key = PREFIX + 'vip_decode:' + openid + ':' + todayDate();
  try {
    const c = await getClient();
    if (!c) return;
    const val = await c.get(key);
    const count = val ? parseInt(val, 10) : 0;
    if (count > 0) await c.decr(key);
  } catch (err) {
    console.error('[Redis] decrVipDecodeLimit error:', err.message);
  }
}

async function ping() {
  try {
    const c = await getClient();
    if (!c) return false;
    await c.ping();
    return true;
  } catch (err) {
    console.error('[Redis] ping error:', err.message);
    return false;
  }
}

// ========== v17.0 积分体系：签到奖励的额外超级推演次数 ==========
// 连续签到7天奖励1次超级推演，存 Redis；v18 起永久有效（不设过期）
const AD_REWARD_COOLDOWN = 30; // 广告奖励调用冷却（秒），防接口刷分

function extraVipDecodeKey(openid) {
  return PREFIX + 'extra_vip_decode:' + openid;
}

// 查询额外超级推演剩余次数
async function getExtraVipDecode(openid) {
  try {
    const c = await getClient();
    if (!c) return 0;
    const val = await c.get(extraVipDecodeKey(openid));
    return val ? Math.max(0, parseInt(val, 10)) : 0;
  } catch (err) {
    console.error('[Redis] getExtraVipDecode error:', err.message);
    return 0;
  }
}

// 增加1次额外超级推演（签到7天奖励；v18 起不设过期，永久有效，避免误删/重置丢失用户权益）
async function incrExtraVipDecode(openid) {
  try {
    const c = await getClient();
    if (!c) return;
    const count = await c.incr(extraVipDecodeKey(openid));
    return count;
  } catch (err) {
    console.error('[Redis] incrExtraVipDecode error:', err.message);
  }
}

// [SEC-FIX] P2-1: 原子消耗额外超级推演次数（Lua），消除"读-判-减"竞态
const DECR_EXTRA_LUA = `
local key = KEYS[1]
local count = redis.call('GET', key)
if not count then return 0 end
count = tonumber(count)
if count > 0 then
  redis.call('DECR', key)
  return 1
end
return 0
`;

// 原子消耗1次额外超级推演；成功返回true，无余量返回false
async function decrExtraVipDecode(openid) {
  try {
    const c = await getClient();
    if (!c) return false;
    const result = await c.eval(DECR_EXTRA_LUA, { keys: [extraVipDecodeKey(openid)] });
    return result === 1;
  } catch (err) {
    console.error('[Redis] decrExtraVipDecode error:', err.message);
    return false;
  }
}

// [SEC-FIX] P1-4: 广告奖励每日上限（默认20次/天，Lua 原子不超发）
const AD_DAILY_LIMIT = parseInt(process.env.AD_DAILY_LIMIT || '20', 10);
const AD_DAILY_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local count = redis.call('INCR', key)
if count == 1 then redis.call('EXPIRE', key, 86400) end
if count <= limit then return count end
redis.call('DECR', key)
return 0
`;

/**
 * 原子领取1次广告奖励名额（每日上限控制）
 * @returns {{allowed: boolean, count: number}}
 */
async function tryIncrAdDaily(openid) {
  try {
    const c = await getClient();
    if (!c) return { allowed: false, count: 0 }; // fail-closed：Redis 不可用不发放广告奖励
    const key = PREFIX + 'ad_daily:' + openid + ':' + todayDate();
    const result = await c.eval(AD_DAILY_LUA, { keys: [key], arguments: [String(AD_DAILY_LIMIT)] });
    return { allowed: result > 0, count: result };
  } catch (err) {
    console.error('[Redis] tryIncrAdDaily error:', err.message);
    return { allowed: false, count: 0 };
  }
}

// [SEC-FIX] P1-4: 广告奖励防刷：30秒内只允许领取1次；Redis 不可用时 fail-closed（不发放）
async function checkAdRewardCooldown(openid) {
  try {
    const c = await getClient();
    if (!c) return false; // Redis 不可用 → 拒绝（防止绕过计数刷积分）
    const key = PREFIX + 'ad_reward_cd:' + openid;
    const val = await c.set(key, '1', { NX: true, EX: AD_REWARD_COOLDOWN });
    return val === 'OK'; // NX 设置成功=不在冷却期
  } catch (err) {
    console.error('[Redis] checkAdRewardCooldown error:', err.message);
    return false;
  }
}

module.exports = { getClient, checkVipDecodeLimit, consumeVipDecodeLimit, tryConsumeVipDecodeLimit, getVipDecodeRemaining, clearVipDecodeLimit, decrVipDecodeLimit, ping, getExtraVipDecode, incrExtraVipDecode, decrExtraVipDecode, checkAdRewardCooldown, tryIncrAdDaily };
