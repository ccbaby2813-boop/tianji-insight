-- 天机推演数据库迁移 v19.3 - 修复匹配功能缺失表和字段
-- 执行: mysql -u root -p tianji_tuiyan < db/migrations/004-fix-match-schema.sql
-- 问题: match_records 表缺少 gua_a, gua_b, source 列；letter_blocks 表不存在

-- 1. 为 match_records 添加缺失的列（如果不存在）
-- 注意: 使用存储过程避免重复添加列时报错
DROP PROCEDURE IF EXISTS _add_column_if_missing;
DELIMITER //
CREATE PROCEDURE _add_column_if_missing(
    IN p_table VARCHAR(64),
    IN p_column VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    DECLARE col_count INT;
    SELECT COUNT(*) INTO col_count
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column;
    IF col_count = 0 THEN
        SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_column, ' ', p_definition);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Added column ', p_column, ' to ', p_table) AS result;
    ELSE
        SELECT CONCAT('Column ', p_column, ' already exists in ', p_table) AS result;
    END IF;
END //
DELIMITER ;

-- 2. 添加缺失的列到 match_records
CALL _add_column_if_missing('match_records', 'gua_a', 'INT NULL COMMENT "A方卦ID(冗余)" AFTER user_b_gua');
CALL _add_column_if_missing('match_records', 'gua_b', 'INT NULL COMMENT "B方卦ID(冗余)" AFTER gua_a');
CALL _add_column_if_missing('match_records', 'source', "VARCHAR(32) DEFAULT 'letter' COMMENT '来源:letter/share' AFTER match_level");

-- 3. 创建 letter_blocks 表（如果不存在）
CREATE TABLE IF NOT EXISTS letter_blocks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  blocker_openid VARCHAR(64) NOT NULL COMMENT '发起拉黑的用户',
  blocked_openid VARCHAR(64) NOT NULL COMMENT '被拉黑的用户',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_blocker_blocked (blocker_openid, blocked_openid),
  INDEX idx_blocker (blocker_openid),
  INDEX idx_blocked (blocked_openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. 清理存储过程
DROP PROCEDURE IF EXISTS _add_column_if_missing;

-- 5. 验证结果
-- 查看 match_records 结构
DESCRIBE match_records;

-- 查看 letter_blocks 结构
DESCRIBE letter_blocks;
