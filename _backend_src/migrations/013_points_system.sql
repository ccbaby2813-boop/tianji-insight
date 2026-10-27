-- 013 积分体系上线（v17.0，2026-08-16）
-- 普通推演从「每日免费3次」改为「积分消耗制」：10积分/次
-- 积分来源：每日签到+10、连续签到7天+100、看激励视频广告+10、新用户注册+10、VIP每日赠送+200

ALTER TABLE users
  ADD COLUMN points INT NOT NULL DEFAULT 0 COMMENT '当前积分余额',
  ADD COLUMN total_points INT NOT NULL DEFAULT 0 COMMENT '累计获得积分',
  ADD COLUMN last_checkin_date DATE DEFAULT NULL COMMENT '上次签到日期',
  ADD COLUMN checkin_streak INT NOT NULL DEFAULT 0 COMMENT '连续签到天数',
  ADD COLUMN checkin_total INT NOT NULL DEFAULT 0 COMMENT '累计签到天数',
  ADD COLUMN last_points_grant_date DATE DEFAULT NULL COMMENT 'VIP每日积分最后发放日';

CREATE TABLE IF NOT EXISTS points_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(64) NOT NULL COMMENT '用户openid',
  type VARCHAR(32) NOT NULL COMMENT '类型：checkin/checkin_streak/ad_reward/new_user/vip_daily/consume_tuiyan/refund_tuiyan/admin_adjust',
  amount INT NOT NULL COMMENT '变动积分，正=获得，负=消耗',
  balance_after INT NOT NULL COMMENT '交易后积分余额',
  remark VARCHAR(255) DEFAULT '' COMMENT '备注',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pt_openid (openid),
  INDEX idx_pt_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分流水表';

-- 存量用户补偿：每个老用户初始 10 积分（改版后可立即推演1次）
UPDATE users SET points = 10, total_points = 10 WHERE points = 0;

-- 为补偿用户补记流水（幂等：已有 new_user 记录的跳过）
INSERT INTO points_transactions (openid, type, amount, balance_after, remark)
SELECT u.openid, 'new_user', 10, 10, '积分体系上线补偿'
FROM users u
WHERE u.points = 10
  AND NOT EXISTS (SELECT 1 FROM points_transactions t WHERE t.openid = u.openid AND t.type = 'new_user');
