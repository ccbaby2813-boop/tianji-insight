/**
 * VIP 相关公共函数
 * v2.3.5 抽取：VIP过期自动降级逻辑原在 auth/user/payment 多处重复，统一收敛到此
 */

/**
 * 获取今日日期（北京时间 YYYY-MM-DD）
 */
function getTodayBeijing() {
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return beijingTime.toISOString().split('T')[0];
}

/**
 * 每日免费配额重置 + VIP过期检查
 * 原逻辑在 auth.js（5个登录接口）和 user.js（2个查询接口）中重复，统一收敛到此
 * @param {object} conn 数据库连接
 * @param {string} openid 用户 openid
 * @param {object} user 已查询出的 user 对象（会原地修改 quota_remaining 和 last_quota_reset_date）
 * @param {string} [today] 今日日期 YYYY-MM-DD（可选，不传则自动计算）
 */
async function resetDailyQuota(conn, openid, user, today) {
  if (!today) today = getTodayBeijing();

  const lastReset = user.last_quota_reset_date;
  // 将数据库日期转为北京时间再比较
  const lastResetDate = lastReset
    ? new Date(new Date(lastReset).getTime() + 8 * 60 * 60 * 1000).toISOString().split('T')[0]
    : null;

  if (!lastResetDate || lastResetDate !== today) {
    if (user.plan_type !== 'free' && user.expire_time && new Date(user.expire_time) > new Date()) {
      await conn.query('UPDATE users SET quota_remaining=20, last_quota_reset_date=? WHERE openid=?', [today, openid]);
      user.quota_remaining = 20;
    } else if (user.plan_type === 'free') {
      await conn.query('UPDATE users SET quota_remaining=3, last_quota_reset_date=? WHERE openid=?', [today, openid]);
      user.quota_remaining = 3;
    }
    user.last_quota_reset_date = today;
  }
}

/**
 * VIP过期自动降级为 free（同时更新 subscriptions 表保持一致）
 * @param {object} conn 数据库连接
 * @param {string} openid 用户 openid
 * @param {object} [user] 已查询出的 user 对象（可选，避免重复查询；降级时会原地修改该对象字段）
 * @param {string} [today] 今日日期 YYYY-MM-DD（可选，传入时同步 user.last_quota_reset_date）
 * @returns {Promise<boolean>} 是否发生了降级
 */
async function downgradeExpiredVip(conn, openid, user, today) {
  let target = user;
  if (!target) {
    const [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [openid]);
    if (rows.length === 0) return false;
    target = rows[0];
  }
  if (target.plan_type !== 'free' && target.expire_time && new Date(target.expire_time) < new Date()) {
    await conn.query('UPDATE users SET plan_type="free", quota_remaining=3, expire_time=NULL WHERE openid=?', [openid]);
    await conn.query('UPDATE subscriptions SET plan_type="free", expire_at=NULL, updated_at=NOW() WHERE openid=?', [openid]);
    target.plan_type = 'free';
    target.quota_remaining = 3;
    target.expire_time = null;
    if (today) target.last_quota_reset_date = today;
    return true;
  }
  return false;
}

module.exports = { downgradeExpiredVip, resetDailyQuota, getTodayBeijing };
