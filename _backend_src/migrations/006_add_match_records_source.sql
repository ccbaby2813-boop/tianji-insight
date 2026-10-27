-- Migration 006: match_records 表添加 source 字段，区分一元匹配(letter)和分享匹配(share)
-- 执行：mysql -u root -p tianji_tuiyan < migrations/006_add_match_records_source.sql
-- 背景：getTodayMatchCount 之前统计所有 match_records 记录，导致分享匹配(无限制)消耗了一元匹配(每天10次)的额度

-- ===== match_records 表新增 source 字段 =====
DROP PROCEDURE IF EXISTS `add_match_records_source_if_missing`;
DELIMITER $$
CREATE PROCEDURE `add_match_records_source_if_missing`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'match_records'
      AND COLUMN_NAME = 'source'
  ) THEN
    ALTER TABLE `match_records`
      ADD COLUMN `source` VARCHAR(16) NOT NULL DEFAULT 'letter' COMMENT '匹配来源：letter=一元匹配, share=分享匹配' AFTER match_level;
    CREATE INDEX `idx_source` ON `match_records`(`source`);
  END IF;
END$$
DELIMITER ;
CALL `add_match_records_source_if_missing`();
DROP PROCEDURE IF EXISTS `add_match_records_source_if_missing`;

SELECT 'match_records.source 字段已添加（区分一元匹配/分享匹配）' AS result;
