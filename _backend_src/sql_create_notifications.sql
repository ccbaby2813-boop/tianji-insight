CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_openid VARCHAR(64) NOT NULL,
  type VARCHAR(32) NOT NULL COMMENT "match_reply/letter_received/jieqi_reminder/system",
  title VARCHAR(200) NOT NULL,
  content TEXT,
  related_id VARCHAR(64) DEFAULT NULL COMMENT "关联ID(匹配ID/信件ID)",
  is_read TINYINT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME DEFAULT NULL,
  INDEX idx_user_openid (user_openid),
  INDEX idx_unread (user_openid, is_read),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT="用户通知表";
