-- 010: 用户绑定表 + UnionID 支持（三端用户体系打通）
-- 执行：mysql -u root -p tianji_tuiyan < migrations/010_user_bindings_and_unionid.sql

-- 1. users 表新增字段
ALTER TABLE users ADD COLUMN unionid VARCHAR(64) DEFAULT NULL COMMENT '微信开放平台UnionID（跨端识别同一用户）' AFTER phone;
ALTER TABLE users ADD COLUMN wx_web_openid VARCHAR(64) DEFAULT NULL COMMENT '网页微信OAuth openid' AFTER unionid;
ALTER TABLE users ADD INDEX idx_phone (phone);
ALTER TABLE users ADD INDEX idx_unionid (unionid);

-- 2. 用户绑定记录表（记录各平台 openid → 主账号 phone_openid 的映射）
CREATE TABLE IF NOT EXISTS user_bindings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unified_openid VARCHAR(64) NOT NULL COMMENT '主账号openid（phone_xxxx）',
  platform VARCHAR(20) NOT NULL COMMENT 'wx_miniprogram / wx_web / app_device',
  platform_openid VARCHAR(64) NOT NULL COMMENT '平台原始openid',
  unionid VARCHAR(64) DEFAULT NULL COMMENT '微信开放平台UnionID（wx_miniprogram/wx_web共享）',
  bound_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_platform_openid (platform, platform_openid),
  UNIQUE KEY uk_unionid (unionid),
  INDEX idx_unified (unified_openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='跨端账号绑定记录';

-- 3. 更新 .env.example 提示（需手动在 .env 中配置）
-- WX_OPEN_PLATFORM_APPID=  （微信开放平台AppID，用于UnionID）
-- 网页微信扫码登录使用微信开放平台的网站应用，AppID/AppSecret 与小程序不同
-- WX_WEB_APPID=
-- WX_WEB_APPSECRET=
