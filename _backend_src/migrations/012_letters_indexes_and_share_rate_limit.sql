-- Migration 012: letters 表复合索引 + share_codes 索引优化
-- 日期：2026-08-01
-- 说明：优化信件查询性能，支持 thread/unread-count/friends 等接口

-- 1. 信件线程查询索引（thread 接口）
CREATE INDEX IF NOT EXISTS idx_letters_thread ON letters (sender_openid, receiver_openid, created_at);

-- 2. 未读信件查询索引（unread-count 接口）
CREATE INDEX IF NOT EXISTS idx_letters_unread ON letters (receiver_openid, is_read);

-- 3. 分享码查询索引优化（resolve 接口）
CREATE INDEX IF NOT EXISTS idx_share_codes_lookup ON share_codes (share_id, expires_at);
