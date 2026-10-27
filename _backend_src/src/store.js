// src/store.js - Redis存储 session_key（v10.3: 统一 Redis 客户端）
const { getClient } = require('./services/redis-client');

const SESSION_KEY_PREFIX = 'tianji:session_key:';
const SESSION_TTL = 7200; // 2小时过期（秒）

class SessionKeyStore {
  async set(openid, sessionKey) {
    try {
      const c = await getClient();
      if (!c) {
        console.error('[SessionStore] Redis不可用，session_key未存储');
        return;
      }
      const key = SESSION_KEY_PREFIX + openid;
      if (sessionKey === null || sessionKey === undefined) {
        await c.del(key);
      } else {
        await c.setEx(key, SESSION_TTL, sessionKey);
      }
    } catch (err) {
      console.error('[SessionStore] set error:', err.message);
    }
  }

  async get(openid) {
    try {
      const c = await getClient();
      if (!c) return null;
      const key = await c.get(SESSION_KEY_PREFIX + openid);
      return key ? { sessionKey: key, timestamp: Date.now() } : null;
    } catch (err) {
      console.error('[SessionStore] get error:', err.message);
      return null;
    }
  }
}

module.exports = new SessionKeyStore();
