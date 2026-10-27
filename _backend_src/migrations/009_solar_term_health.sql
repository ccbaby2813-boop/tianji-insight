-- Migration 009: 节气养生功能 - 数据库表结构
-- 执行：mysql -u root -p tianji_tuiyan < migrations/009_solar_term_health.sql
-- 背景：新增"节气养生"功能，支持卦格×节气的个性化养生建议
-- 数据层级：
--   L1 = solar_term_basic（24节气通用养生，后台可编辑）
--   L3 = solar_term_health_advice（1536条卦格专属建议，需审核）
--   L2 = 25条五行关系规则矩阵，存配置文件 config/wuxing-relation.js，不入库

USE tianji_tuiyan;

-- ============================================================
-- 表 1: solar_term_basic - 24 节气通用养生配置（L1 层）
-- ============================================================
CREATE TABLE IF NOT EXISTS solar_term_basic (
  solar_term_index TINYINT PRIMARY KEY COMMENT '节气索引 0-23（立春=0）',
  name VARCHAR(16) NOT NULL COMMENT '节气名',
  wuxing VARCHAR(8) NOT NULL COMMENT '五行属性 金/木/水/火/土',
  organ VARCHAR(8) NOT NULL COMMENT '对应脏腑',
  season VARCHAR(8) NOT NULL COMMENT '季节 春/夏/秋/冬/春末/夏末/秋末/冬末',
  season_desc VARCHAR(64) DEFAULT '' COMMENT '节气简述',
  date_range VARCHAR(32) DEFAULT '' COMMENT '日期范围',
  wu_hou JSON COMMENT '物候三候 JSON数组',
  keywords JSON COMMENT '养生关键词 JSON数组',
  neijing_quote TEXT COMMENT '黄帝内经原文',
  neijing_source VARCHAR(64) DEFAULT '' COMMENT '原文出处',
  neijing_interpretation TEXT COMMENT '白话解读',
  general_yi_food JSON COMMENT '通用宜-食物 JSON数组',
  general_yi_activity JSON COMMENT '通用宜-活动 JSON数组',
  general_yi_emotion JSON COMMENT '通用宜-情志 JSON数组',
  general_ji JSON COMMENT '通用忌 JSON数组',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='24节气通用养生配置';

-- ============================================================
-- 表 2: solar_term_health_advice - 卦格专属养生建议（L3 层，1536条）
-- ============================================================
CREATE TABLE IF NOT EXISTS solar_term_health_advice (
  id INT AUTO_INCREMENT PRIMARY KEY,
  solar_term_index TINYINT NOT NULL COMMENT '节气索引 0-23',
  gua_index INT NOT NULL COMMENT '卦格ID 1-64',
  gua_ge VARCHAR(32) NOT NULL COMMENT '卦格名',
  gua_wuxing VARCHAR(8) NOT NULL COMMENT '卦格五行',
  term_wuxing VARCHAR(8) NOT NULL COMMENT '节气五行',
  element_interaction VARCHAR(32) DEFAULT '' COMMENT '五行关系标题 如"火金相克"',
  relation_type VARCHAR(8) DEFAULT '' COMMENT '关系类型 同气/我生/生我/克我/我克',
  corresponding_organ VARCHAR(16) DEFAULT '' COMMENT '对应脏腑',
  warning TEXT COMMENT '脏腑警示文案',
  recommend_food JSON COMMENT '推荐食物 JSON数组',
  recommend_activity JSON COMMENT '推荐活动 JSON数组',
  recommend_emotion JSON COMMENT '情志调节 JSON数组',
  recommend_avoid JSON COMMENT '禁忌 JSON数组',
  classic_quote TEXT COMMENT '经典原文引用',
  classic_source VARCHAR(64) DEFAULT '' COMMENT '经典出处',
  classic_interpretation TEXT COMMENT '经典白话解读',
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0待审核 1已审核 2需修正',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_term_gua (solar_term_index, gua_index),
  INDEX idx_status (status),
  INDEX idx_term (solar_term_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='卦格专属养生建议';

-- 验证
SELECT '009 迁移完成：solar_term_basic + solar_term_health_advice 表已创建' AS result;
SELECT
  TABLE_NAME, TABLE_COMMENT
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'tianji_tuiyan'
  AND TABLE_NAME IN ('solar_term_basic', 'solar_term_health_advice');
