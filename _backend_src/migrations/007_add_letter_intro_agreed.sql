-- Migration 007: users 表添加 letter_intro_agreed 字段，记录用户是否已同意易缘传书引言
-- 执行：mysql -u root -p tianji_tuiyan < migrations/007_add_letter_intro_agreed.sql
-- 背景：之前引言同意状态仅存于小程序 storage，清缓存后丢失导致每次都弹。改为后端持久化记录。

DROP PROCEDURE IF EXISTS `add_letter_intro_agreed_if_missing`;
DELIMITER $$
CREATE PROCEDURE `add_letter_intro_agreed_if_missing`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'letter_intro_agreed'
  ) THEN
    ALTER TABLE `users`
      ADD COLUMN `letter_intro_agreed` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '易缘传书引言是否已同意：0=未同意，1=已同意';
  END IF;
END$$
DELIMITER ;
CALL `add_letter_intro_agreed_if_missing`();
DROP PROCEDURE IF EXISTS `add_letter_intro_agreed`;

SELECT 'users.letter_intro_agreed 字段已添加' AS result;
