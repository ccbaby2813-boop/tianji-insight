-- Migration 011: share_codes 表添加 scene 和 use_limit 字段
-- 日期：2026-08-01
-- 说明：share.js 代码中使用了 scene 和 use_limit 字段，但 schema.sql 中未定义
-- 影响：若不执行此 migration，所有分享码生成和解析将失败

ALTER TABLE share_codes
  ADD COLUMN scene VARCHAR(128) DEFAULT '' COMMENT '分享场景数据（推演记录ID或匹配短码）',
  ADD COLUMN use_limit INT DEFAULT 100 COMMENT '分享码最大使用次数，0=无限';

-- 为现有数据设置默认值
UPDATE share_codes SET scene = '' WHERE scene IS NULL;
UPDATE share_codes SET use_limit = 100 WHERE use_limit IS NULL;
