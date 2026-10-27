-- v15.14 新增用户IP归属地和最后活跃时间字段
-- 用途：管理后台用户列表显示IP和城市、用户画像城市分布统计、留存分析改用last_active_at

ALTER TABLE users
  ADD COLUMN last_login_ip VARCHAR(45) DEFAULT NULL COMMENT '最后登录IP地址' AFTER updated_at,
  ADD COLUMN city VARCHAR(64) DEFAULT NULL COMMENT 'IP归属城市' AFTER last_login_ip,
  ADD COLUMN last_active_at TIMESTAMP NULL DEFAULT NULL COMMENT '最后活跃时间' AFTER city;

-- 为 last_active_at 添加索引（留存分析查询需要）
CREATE INDEX idx_last_active_at ON users(last_active_at);

-- 为 city 添加索引（城市分布统计需要）
CREATE INDEX idx_city ON users(city);
