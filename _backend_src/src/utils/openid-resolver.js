// src/utils/openid-resolver.js - openid 反查工具
// 解决场景：用户绑定手机号后，主账号 openid 变为 phone_xxx，
// 但前端缓存的对方 openid 可能仍是绑定前的旧值（微信 oXXX / 设备 device_id / 旧手机号 phone_yyy），
// 导致写入数据时落到已不存在的旧账号。
// 解决方案：通过 user_bindings 表把可能过期的 openid 反查为当前主账号 unified_openid。
//
// 调用约定：
//   const { resolveOpenid, resolveOpenids } = require('../utils/openid-resolver');
//   const realTargetOpenid = await resolveOpenid(conn, targetOpenid);
// 若 conn 不传则内部自行获取并释放。

const db = require('../middleware/db');

/**
 * 把可能过期的单个 openid 反查为当前主账号 openid
 * @param {object} conn - 数据库连接（必传，避免重复获取）
 * @param {string} maybeStaleOpenid - 前端传入的可能是旧值的 openid
 * @returns {Promise<string>} 当前主账号 openid
 */
async function resolveOpenid(conn, maybeStaleOpenid) {
  if (!maybeStaleOpenid) return maybeStaleOpenid;
  // 查 user_bindings：platform_openid = 输入 或 unified_openid = 输入
  // 命中即返回 unified_openid（最新主账号）
  try {
    const [rows] = await conn.query(
      'SELECT unified_openid FROM user_bindings WHERE platform_openid = ? OR unified_openid = ? LIMIT 1',
      [maybeStaleOpenid, maybeStaleOpenid]
    );
    if (rows.length > 0) {
      return rows[0].unified_openid;
    }
  } catch (e) {
    console.error('[resolveOpenid] query failed:', e.message, 'openid=', maybeStaleOpenid);
  }
  // 查不到绑定记录，说明该 openid 未绑定过手机号，原样返回
  return maybeStaleOpenid;
}

/**
 * 批量反查多个 openid（用于同时校验 A/B 双方场景）
 * @param {object} conn - 数据库连接
 * @param  {...string} openids - 多个 openid
 * @returns {Promise<string[]>} 反查后的 openid 数组，顺序与入参一致
 */
async function resolveOpenids(conn, ...openids) {
  return Promise.all(openids.map(o => resolveOpenid(conn, o)));
}

/**
 * 不需要外部 conn 的便捷版本（内部获取并释放）
 * 仅供一次性查询场景使用；事务/多次查询场景应使用 resolveOpenid(conn, ...)
 */
async function resolveOpenidStandalone(maybeStaleOpenid) {
  if (!maybeStaleOpenid) return maybeStaleOpenid;
  const conn = await db.get();
  try {
    return await resolveOpenid(conn, maybeStaleOpenid);
  } finally {
    conn.release();
  }
}

module.exports = { resolveOpenid, resolveOpenids, resolveOpenidStandalone };
