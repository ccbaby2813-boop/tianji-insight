-- Migration 008: letters 表添加联合索引，优化对话列表和详情查询性能
-- 执行：mysql -u root -p tianji_tuiyan < migrations/008_add_letters_indexes.sql
-- 背景：对话列表查询 WHERE sender_openid = ? OR receiver_openid = ? 以及
--       对话详情查询 WHERE (sender_openid = ? AND receiver_openid = ?) OR ...
--       原有单字段索引无法高效覆盖联合条件与排序，添加联合索引提升性能

-- 添加 (sender_openid, created_at) 联合索引
-- 覆盖按发件人查询+时间排序场景，最左前缀可替代原 idx_sender
DROP PROCEDURE IF EXISTS `add_letters_idx_sender_created`;
DELIMITER $$
CREATE PROCEDURE `add_letters_idx_sender_created`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'letters'
      AND INDEX_NAME = 'idx_sender_created'
  ) THEN
    ALTER TABLE `letters` ADD INDEX `idx_sender_created` (`sender_openid`, `created_at`);
  END IF;
END$$
DELIMITER ;
CALL `add_letters_idx_sender_created`();
DROP PROCEDURE IF EXISTS `add_letters_idx_sender_created`;

-- 添加 (receiver_openid, created_at) 联合索引
-- 覆盖按收件人查询+时间排序场景，最左前缀可替代原 idx_receiver
DROP PROCEDURE IF EXISTS `add_letters_idx_receiver_created`;
DELIMITER $$
CREATE PROCEDURE `add_letters_idx_receiver_created`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'letters'
      AND INDEX_NAME = 'idx_receiver_created'
  ) THEN
    ALTER TABLE `letters` ADD INDEX `idx_receiver_created` (`receiver_openid`, `created_at`);
  END IF;
END$$
DELIMITER ;
CALL `add_letters_idx_receiver_created`();
DROP PROCEDURE IF EXISTS `add_letters_idx_receiver_created`;

-- 添加 (sender_openid, receiver_openid) 联合索引
-- 优化对话详情查询 WHERE sender_openid = ? AND receiver_openid = ?
DROP PROCEDURE IF EXISTS `add_letters_idx_pair`;
DELIMITER $$
CREATE PROCEDURE `add_letters_idx_pair`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'letters'
      AND INDEX_NAME = 'idx_pair'
  ) THEN
    ALTER TABLE `letters` ADD INDEX `idx_pair` (`sender_openid`, `receiver_openid`);
  END IF;
END$$
DELIMITER ;
CALL `add_letters_idx_pair`();
DROP PROCEDURE IF EXISTS `add_letters_idx_pair`;

-- 删除被联合索引覆盖的冗余单字段索引
DROP PROCEDURE IF EXISTS `drop_letters_idx_sender`;
DELIMITER $$
CREATE PROCEDURE `drop_letters_idx_sender`()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'letters'
      AND INDEX_NAME = 'idx_sender'
  ) THEN
    ALTER TABLE `letters` DROP INDEX `idx_sender`;
  END IF;
END$$
DELIMITER ;
CALL `drop_letters_idx_sender`();
DROP PROCEDURE IF EXISTS `drop_letters_idx_sender`;

DROP PROCEDURE IF EXISTS `drop_letters_idx_receiver`;
DELIMITER $$
CREATE PROCEDURE `drop_letters_idx_receiver`()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'letters'
      AND INDEX_NAME = 'idx_receiver'
  ) THEN
    ALTER TABLE `letters` DROP INDEX `idx_receiver`;
  END IF;
END$$
DELIMITER ;
CALL `drop_letters_idx_receiver`();
DROP PROCEDURE IF EXISTS `drop_letters_idx_receiver`;

SELECT 'letters 表联合索引已添加，冗余单字段索引已清理' AS result;
