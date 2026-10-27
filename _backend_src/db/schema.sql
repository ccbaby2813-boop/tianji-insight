-- 天机推演数据库 schema (v10 - 与生产数据库对齐)
-- MySQL 8.0 / InnoDB / utf8mb4_unicode_ci
CREATE DATABASE IF NOT EXISTS tianji_tuiyan DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tianji_tuiyan;

-- 1. users 表（用户档案）
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(64) NOT NULL UNIQUE,
  nickname VARCHAR(128) DEFAULT '',
  birth_year INT DEFAULT 0,
  birth_month INT DEFAULT 0,
  birth_day INT DEFAULT 0,
  birth_shichen INT DEFAULT 0,
  gender TINYINT DEFAULT 0,
  ming_ben_gua INT DEFAULT 0 COMMENT '易经人格ID（1-64）',
  gua_ge_name VARCHAR(64) DEFAULT '',
  plan_type VARCHAR(32) DEFAULT 'free',
  quota_remaining INT DEFAULT 3 COMMENT '剩余普通推演次数',
  expire_time TIMESTAMP NULL COMMENT 'VIP过期时间',
  last_quota_reset_date DATE NULL COMMENT '上次配额重置日期',
  has_profile TINYINT(1) DEFAULT 0 COMMENT '是否已建档',
  delete_request_time TIMESTAMP NULL COMMENT '注销申请时间',
  phone VARCHAR(20) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_openid (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. tuiyan_records 表（推演记录）
CREATE TABLE IF NOT EXISTS tuiyan_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(64) NOT NULL,
  question TEXT,
  result_data JSON,
  is_vip_decode TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否VIP超级推演',
  vip_decode_text TEXT COMMENT 'VIP超级推演全文',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_openid (openid),
  INDEX idx_openid_created (openid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. hexagrams 表（64种人格基础数据）
CREATE TABLE IF NOT EXISTS hexagrams (
  id INT PRIMARY KEY,
  name VARCHAR(32) NOT NULL,
  full_name VARCHAR(64),
  symbol VARCHAR(16),
  upper VARCHAR(32),
  lower VARCHAR(32),
  wuxing VARCHAR(16),
  judgment TEXT,
  image TEXT,
  description TEXT,
  UNIQUE KEY uk_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. subscriptions 表（会员订阅）
CREATE TABLE IF NOT EXISTS subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(64) NOT NULL,
  plan_type VARCHAR(32) NOT NULL,
  start_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expire_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_openid (openid),
  INDEX idx_openid_expire (openid, expire_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. events 表（埋点事件）
CREATE TABLE IF NOT EXISTS events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(64),
  event_type VARCHAR(64),
  page VARCHAR(128),
  extra_data JSON,
  session_id VARCHAR(128),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_openid (openid),
  INDEX idx_event_type (event_type),
  INDEX idx_created_type (created_at, event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. admins 表（后台管理账号）
CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  ip_whitelist TEXT,
  last_login_at TIMESTAMP NULL,
  last_login_ip VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. admin_logs 表（操作审计日志）
CREATE TABLE IF NOT EXISTS admin_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT,
  action VARCHAR(128),
  target VARCHAR(128),
  detail JSON,
  ip VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_id (admin_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. match_records 表（易缘匹配记录）
CREATE TABLE IF NOT EXISTS match_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_a_openid VARCHAR(64) NOT NULL,
  user_b_openid VARCHAR(64) NOT NULL,
  user_a_gua INT,
  user_b_gua INT,
  gua_a INT NULL COMMENT 'A方卦ID(冗余)',
  gua_b INT NULL COMMENT 'B方卦ID(冗余)',
  relationship_key VARCHAR(128),
  relationship_name VARCHAR(128),
  match_level VARCHAR(32),
  source VARCHAR(32) DEFAULT 'letter' COMMENT '来源:letter/share',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_a (user_a_openid),
  INDEX idx_user_b (user_b_openid),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. share_codes 表（分享短码）
CREATE TABLE IF NOT EXISTS share_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  share_id VARCHAR(64) NOT NULL UNIQUE,
  openid VARCHAR(64) NOT NULL,
  type VARCHAR(32) DEFAULT 'match',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  use_count INT DEFAULT 0,
  INDEX idx_openid (openid),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. pending_deletions 表（待删除数据 - 15天宽限期）
CREATE TABLE IF NOT EXISTS pending_deletions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(64) NOT NULL,
  users_backup JSON,
  tuiyan_backup JSON,
  subscriptions_backup JSON,
  events_backup JSON,
  match_backup JSON,
  share_backup JSON,
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  execute_at TIMESTAMP NULL,
  status VARCHAR(32) DEFAULT 'pending',
  INDEX idx_openid (openid),
  INDEX idx_status_execute (status, execute_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. vip_orders 表（VIP支付订单）
CREATE TABLE IF NOT EXISTS vip_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(64) NOT NULL,
  out_trade_no VARCHAR(64) NOT NULL UNIQUE,
  product_id VARCHAR(32) NOT NULL,
  goods_price INT NOT NULL COMMENT '价格（分）',
  env TINYINT DEFAULT 0,
  status VARCHAR(32) DEFAULT 'pending',
  mch_order_no VARCHAR(128),
  transaction_id VARCHAR(128),
  paid_time TIMESTAMP NULL,
  callback_time TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_openid (openid),
  INDEX idx_out_trade_no (out_trade_no),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. user_gua_collection 表（卦卡收集）
CREATE TABLE IF NOT EXISTS user_gua_collection (
  id INT AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(64) NOT NULL,
  gua_id INT NOT NULL,
  source VARCHAR(32) DEFAULT 'profile',
  collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_openid_gua (openid, gua_id),
  INDEX idx_openid (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. user_achievements 表（用户成就）
CREATE TABLE IF NOT EXISTS user_achievements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(64) NOT NULL,
  achievement_id VARCHAR(64) NOT NULL,
  achieved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  extra_data JSON,
  UNIQUE KEY uk_openid_achievement (openid, achievement_id),
  INDEX idx_openid (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. letter_blocks 表（传书拉黑）
CREATE TABLE IF NOT EXISTS letter_blocks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  blocker_openid VARCHAR(64) NOT NULL COMMENT '发起拉黑的用户',
  blocked_openid VARCHAR(64) NOT NULL COMMENT '被拉黑的用户',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_blocker_blocked (blocker_openid, blocked_openid),
  INDEX idx_blocker (blocker_openid),
  INDEX idx_blocked (blocked_openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
