-- 013 补充修复：points_transactions 与 users 排序规则对齐 + 补偿流水
-- （首次执行时 ALTER/CREATE/UPDATE 已成功，仅流水 INSERT 因 collation 冲突失败）

-- 1) 对齐流水表排序规则（与 users 表一致 utf8mb4_unicode_ci）
ALTER TABLE points_transactions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2) 为补偿用户补记流水（幂等）
INSERT INTO points_transactions (openid, type, amount, balance_after, remark)
SELECT u.openid, 'new_user', 10, 10, '积分体系上线补偿'
FROM users u
WHERE u.points = 10
  AND NOT EXISTS (
    SELECT 1 FROM points_transactions t
    WHERE t.openid COLLATE utf8mb4_unicode_ci = u.openid COLLATE utf8mb4_unicode_ci
      AND t.type = 'new_user'
  );

-- 3) 核对
SELECT COUNT(*) AS txn_total FROM points_transactions;
SELECT COUNT(*) AS users_with_points FROM users WHERE points >= 10;
