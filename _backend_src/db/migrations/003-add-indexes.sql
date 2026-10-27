-- 天机推演数据库迁移 v9.3 - 补充复合索引
-- 执行: mysql -u root -p tianji_tuiyan < db/migrations/003-add-indexes.sql

-- 1. tuiyan_records: 按openid+时间查询推演历史
ALTER TABLE tuiyan_records ADD INDEX idx_openid_created (openid, created_at);

-- 2. subscriptions: 查询未过期订阅
ALTER TABLE subscriptions ADD INDEX idx_openid_expire (openid, expire_at);

-- 3. share_codes: 按过期时间清理过期短码
ALTER TABLE share_codes ADD INDEX idx_expires_at (expires_at);

-- 4. match_records: 按创建时间查匹配记录
ALTER TABLE match_records ADD INDEX idx_created_at (created_at);

-- 5. events: 按时间范围查询统计数据
ALTER TABLE events ADD INDEX idx_created_type (created_at, event_type);

-- 6. pending_deletions: 按状态+执行时间查询待处理删除
ALTER TABLE pending_deletions ADD INDEX idx_status_execute (status, execute_at);
