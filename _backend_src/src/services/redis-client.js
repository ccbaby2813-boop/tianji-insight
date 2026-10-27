// src/services/redis-client.js - 统一 Redis 客户端单例（v19.3）
// 所有服务共享同一个 Redis 连接，避免 PM2 cluster 模式下连接数爆炸
// v19.3: 增强重连逻辑，PM2 cluster worker 重启后自动重建连接
const redis = require('redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';

let client = null;
let _connected = false;
let _connectPromise = null;
let _initStarted = false;

/**
 * 构建 Redis 连接选项（含密码注入、超时、重连策略）
 */
function buildOptions() {
  const opts = {
    url: REDIS_URL,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
    },
    disableOfflineQueue: true,
  };

  if (REDIS_PASSWORD && !opts.url.includes('@')) {
    try {
      const u = new URL(opts.url);
      opts.url = `redis://:${encodeURIComponent(REDIS_PASSWORD)}@${u.hostname}:${u.port || 6379}`;
    } catch (e) {
      console.error('[RedisClient] Failed to parse REDIS_URL:', e.message);
    }
  }

  return opts;
}

/**
 * 获取 Redis 客户端（单例，Promise-based 防止并发连接）
 * v19.3: 如果现有连接已断开，自动重建；支持 PM2 cluster worker 重启后恢复
 */
async function getClient() {
  // 快速路径：已有且连接中
  if (client && _connected) return client;

  // 如果有正在进行的连接尝试，等待它
  if (_connectPromise) return _connectPromise;

  // 如果 client 存在但已断开（PM2 重启或 Redis 闪断），销毁旧连接重建
  if (client && !_connected) {
    try {
      client.removeAllListeners();
      client.quit().catch(() => {});
    } catch (_) {}
    client = null;
  }

  _connectPromise = (async () => {
    try {
      if (!client) {
        const opts = buildOptions();
        client = redis.createClient(opts);

        client.on('error', (err) => {
          // 只打印非连接错误
          if (!err.message.includes('ECONNREFUSED') && !err.message.includes('ETIMEDOUT')) {
            console.error('[RedisClient] Error:', err.message);
          }
          _connected = false;
        });
        client.on('ready', () => {
          _connected = true;
          _initStarted = true;
          console.log('[RedisClient] Ready');
        });
        client.on('end', () => {
          _connected = false;
          console.log('[RedisClient] Disconnected');
        });
        client.on('reconnecting', () => {
          _connected = false;
          console.log('[RedisClient] Reconnecting...');
        });
      }

      if (!_connected) {
        await client.connect();
        _connected = true;
      }
      return client;
    } catch (err) {
      console.error('[RedisClient] Connect failed:', err.message);
      _connected = false;
      _connectPromise = null;
      return null;
    }
  })();

  return _connectPromise;
}

/**
 * 检查 Redis 是否可用
 */
async function ping() {
  try {
    const c = await getClient();
    if (!c) return false;
    await c.ping();
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 获取当前连接状态
 */
function isReady() {
  return _connected;
}

module.exports = { getClient, ping, isReady };
