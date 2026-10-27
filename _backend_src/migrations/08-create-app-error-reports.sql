-- v15.15 APP 错误上报表
CREATE TABLE IF NOT EXISTS app_error_reports (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  error_type VARCHAR(64) NOT NULL COMMENT '错误类型',
  error_message TEXT NOT NULL COMMENT '错误信息',
  stack_trace TEXT COMMENT '堆栈信息',
  page VARCHAR(128) COMMENT '发生错误的页面',
  user_openid VARCHAR(64) COMMENT '用户 openid',
  app_version VARCHAR(32) COMMENT 'APP 版本号',
  device_info JSON COMMENT '设备信息',
  reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '上报时间',
  INDEX idx_error_type (error_type),
  INDEX idx_reported_at (reported_at),
  INDEX idx_user_openid (user_openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='APP 错误上报表';
