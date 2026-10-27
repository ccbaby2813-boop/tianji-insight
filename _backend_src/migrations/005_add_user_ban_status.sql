-- Migration 005: 用户封禁功能 - users 表新增 status 字段
-- 执行：mysql -u root -p tianji_tuiyan < migrations/005_add_user_ban_status.sql

-- ===== users 表新增 status 字段（用户状态：1=正常，0=已封禁） =====
DROP PROCEDURE IF EXISTS `add_user_status_if_missing`;
DELIMITER $$
CREATE PROCEDURE `add_user_status_if_missing`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'status'
  ) THEN
    ALTER TABLE `users`
      ADD COLUMN `status` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '用户状态：1=正常，0=已封禁';
  END IF;
END$$
DELIMITER ;
CALL `add_user_status_if_missing`();
DROP PROCEDURE IF EXISTS `add_user_status_if_missing`;

SELECT 'users.status 字段已添加（封禁功能）' AS result;
