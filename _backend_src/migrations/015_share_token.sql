-- 015_share_token.sql
-- [SEC-FIX] P1-2: 分享链接改用不可枚举的随机 share_token，替代自增 id，防止批量枚举抓取用户推演内容。
-- 执行方式（服务器上，后端库）：
--   mysql -u<user> -p<pass> <db> < migrations/015_share_token.sql
-- 已存在的旧记录 share_token 为空，分享接口对 32 位 hex 之外的参数仍按自增 id 兼容，无需回填。

ALTER TABLE tuiyan_records
  ADD COLUMN share_token VARCHAR(32) NULL DEFAULT NULL AFTER id,
  ADD UNIQUE KEY uk_tuiyan_records_share_token (share_token);

-- 回滚：
-- ALTER TABLE tuiyan_records DROP KEY uk_tuiyan_records_share_token, DROP COLUMN share_token;
