// src/services/cache.js - Redis 缓存服务（v10.3: 统一 Redis 客户端 + 定时恢复）
const { getClient } = require('./redis-client');

const PREFIX = 'tianji:cache:';
const DEFAULT_TTL = 300; // 5分钟

let _disabled = false;
let _disabledUntil = 0;       // 降级截止时间戳
const RECOVERY_DELAY = 60000;  // 60秒后尝试恢复

async function get(key) {
  try {
    if (_disabled && Date.now() < _disabledUntil) return null;
    if (_disabled) { _disabled = false; }  // 超过恢复时间，尝试恢复
    const c = await getClient();
    if (!c) return null;
    const val = await c.get(PREFIX + key);
    return val ? JSON.parse(val) : null;
  } catch (err) {
    console.error('[Cache] get error:', err.message);
    _disabled = true;
    _disabledUntil = Date.now() + RECOVERY_DELAY;
    return null;
  }
}

async function set(key, value, ttl = DEFAULT_TTL) {
  try {
    if (_disabled && Date.now() < _disabledUntil) return;
    if (_disabled) { _disabled = false; }
    const c = await getClient();
    if (!c) return;
    await c.set(PREFIX + key, JSON.stringify(value), { EX: ttl });
  } catch (err) {
    console.error('[Cache] set error:', err.message);
    _disabled = true;
    _disabledUntil = Date.now() + RECOVERY_DELAY;
  }
}

async function del(pattern) {
  try {
    if (_disabled && Date.now() < _disabledUntil) return;
    if (_disabled) { _disabled = false; }
    const c = await getClient();
    if (!c) return;
    if (pattern.includes('*')) {
      let cursor = 0;
      do {
        const result = await c.scan(cursor, { MATCH: PREFIX + pattern, COUNT: 100 });
        cursor = result.cursor;
        if (result.keys.length > 0) await c.del(result.keys);
      } while (cursor !== 0);
    } else {
      await c.del(PREFIX + pattern);
    }
  } catch (err) {
    console.error('[Cache] del error:', err.message);
    _disabled = true;
    _disabledUntil = Date.now() + RECOVERY_DELAY;
  }
}

async function wrap(key, fn, ttl = DEFAULT_TTL) {
  const cached = await get(key);
  if (cached !== null) return cached;
  const result = await fn();
  await set(key, result, ttl);
  return result;
}

async function clearStats() {
  await del('stats:*');
  await del('analytics:*');
}

module.exports = { get, set, del, wrap, clearStats, DEFAULT_TTL };
