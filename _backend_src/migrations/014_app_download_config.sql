-- Migration 014: App 下载版本配置 - 数据库表结构
-- 执行：mysql -u root -p tianji_tuiyan < migrations/014_app_download_config.sql
-- 背景：官网下载板块的 APK 链接可在管理后台「内容资产 → App下载版本」动态替换，
--       不再写死 HTML；官网 index.html 通过 GET /api/app-download 读取最新配置。
-- 结构：通用 key-value 表 app_configs，本功能用 config_key='app_download'，
--       config_value 存储 JSON：{"url":"...","version":"...","enabled":bool}

USE tianji_tuiyan;

CREATE TABLE IF NOT EXISTS app_configs (
  config_key   VARCHAR(64) PRIMARY KEY COMMENT '配置键',
  config_value TEXT COMMENT '配置值（JSON 文本）',
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='应用级配置（key-value）';

-- 插入默认「App 下载版本」配置（与当前写死的官网链接一致）；已存在则跳过
INSERT INTO app_configs (config_key, config_value)
VALUES ('app_download', '{"url": "/com.clawbook.tianji-3.1.0.apk", "version": "3.1.0", "enabled": true}')
ON DUPLICATE KEY UPDATE config_key = config_key;