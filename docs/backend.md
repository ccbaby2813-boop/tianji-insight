# 后端开发文档

> **适用版本**：v3.6 | **最后更新**：2026-09-03

---

## 目录

- [1. 架构概述](#1-架构概述)
- [2. 技术栈](#2-技术栈)
- [3. 目录结构](#3-目录结构)
- [4. 数据库设计](#4-数据库设计)
- [5. API 接口规范](#5-api-接口规范)
- [6. 认证与授权](#6-认证与授权)
- [7. 核心业务流程](#7-核心业务流程)
- [8. 支付系统](#8-支付系统)
- [9. 易缘传书系统](#9-易缘传书系统)
- [10. 缓存与限流](#10-缓存与限流)
- [11. 错误处理](#11-错误处理)
- [12. 性能优化](#12-性能优化)

---

## 1. 架构概述

### 1.1 系统架构

```
┌─────────────────────────────────────────────────────────┐
│              Express.js 后端服务 (:3003)                  │
│  ┌─────────────┐  ┌────────────────────────────────┐    │
│  │ middleware  │  │            routes                │    │
│  │ auth(JWT)   │  │ auth | user | tuiyan | payment  │    │
│  │ admin       │  │ collection | event | gua | share│    │
│  │ db(MySQL池) │  │ letter | match | relationship   │    │
│  │ error       │  │ solar-term | admin              │    │
│  │ request-id  │  │                                  │    │
│  └─────────────┘  ──────────────────┬─────────────┘    │
└────────────────────────────────────────────────────────┘
              ┌────────────┬───────────┼───────────┐
              ▼            ▼           ▼           ▼
       ┌──────────┐ ┌────────── ┌──────────┐ ┌──────────
       │  MySQL   │ │  Redis   │ │   PM2    │ │ DeepSeek │
       │  8.0     │ │ 限流/缓存 │ │ 进程管理 │ │   API    │
       └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

### 1.2 部署环境

| 项目 | 配置 |
|------|------|
| 服务器 | 阿里云 VPS |
| IP | YOUR_SERVER_HOST |
| 操作系统 | Linux |
| 进程管理 | PM2 cluster 模式（4 实例） |
| 监听端口 | 3003 |
| 反向代理 | Nginx（443 → 3003） |
| 域名 | `https://claw-book.cn/tianji` |

---

## 2. 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | nvm 管理 | 运行环境 |
| Express.js | 4.21.0 | Web 框架 |
| MySQL | 8.0 | 主数据库（utf8mb4_unicode_ci） |
| Redis | 7-alpine | VIP 限流 / session_key / 缓存 |
| mysql2 | 3.22.5 | MySQL 驱动（连接池 connectionLimit=15） |
| redis（node） | 6.0.0 | Redis 客户端 |
| jsonwebtoken | 9.0.2 | JWT 认证（HS256，24h 过期） |
| bcrypt | 6.0.0 | 密码哈希 |
| axios | 1.16.1 | HTTP 客户端（调用 DeepSeek API） |
| lunar-javascript | 1.7.7 | 农历计算 |
| express-rate-limit | 8.5.2 | 限流中间件 |

---

## 3. 目录结构

```
_backend_src/
├── server.js                           # 入口文件（Express 启动）
├── package.json                        # 后端依赖
├── ecosystem.config.js                 # PM2 配置
├── config/
│   ├── hexagrams.js                    # 64 卦数据
│   ├── jieqi-health.js                 # 节气养生数据
│   ├── jieqi-wuxing.js                 # 节气五行数据
│   ├── qimen-config.js                 # 奇门配置
│   ├── relationship.js                 # 卦象关系
│   └── wuxing-relation.js              # 五行关系
├── src/
│   ├── middleware/
│   │   ├── admin.js                    # 管理员认证中间件
│   │   ├── auth.js                     # JWT 认证中间件
│   │   ├── db.js                       # MySQL 连接池
│   │   ├── error.js                    # 全局错误/404 处理
│   │   └── request-id.js               # 请求追踪 ID
│   ├── routes/
│   │   ├── admin.js                    # 管理后台
│   │   ├── auth.js                     # 登录/注册/绑定
│   │   ├── collection.js               # 卦卡收集
│   │   ├── event.js                    # 事件埋点
│   │   ├── gua.js                      # 卦象查询
│   │   ├── letter.js                   # 易缘传书
│   │   ├── match.js                    # 匹配功能
│   │   ├── payment.js                  # 支付接口
│   │   ├── relationship.js             # 卦象关系
│   │   ├── share.js                    # 分享功能
│   │   ├── solar-term.js               # 节气养生
│   │   ├── tuiyan.js                   # 推演接口
│   │   └── user.js                     # 用户管理
│   ├── services/
│   │   ├── algorithms.js               # 算法服务
│   │   ├── cache.js                    # 缓存服务
│   │   ├── event-logger.js             # 事件日志服务
│   │   ├── qimen.js                    # 奇门遁甲服务
│   │   ├── redis-client.js             # Redis 客户端
│   │   ├── redis.js                    # Redis 服务
│   │   ├── tuiyan.js                   # 推演服务（DeepSeek API 封装）
│   │   └── wuxing.js                   # 五行服务
│   ├── utils/
│   │   ├── openid-resolver.js          # OpenID 解析
│   │   ├── sms.js                      # 短信发送
│   │   ├── vip.js                      # VIP 降级逻辑
│   │   ├── wechat-crypto.js            # 微信加解密
│   │   ├── wechat.js                   # 微信工具
│   │   └── wxpay.js                    # 微信支付工具
│   └── store.js                        # Redis 存储（session_key 等）
├── utils/
│   └── ganzhi.js                       # 天干地支计算
├── db/
│   ├── schema.sql                      # 数据库结构
│   ├── init.js                         # 数据库初始化
│   └── migrations/                     # 迁移脚本
├── migrations/                         # 数据库迁移脚本
├── public/                             # 管理后台前端静态文件
│   ├── admin/
│   │   ├── index.html                  # 管理后台页面
│   │   └── lib/                        # 前端库文件
│   └── lib/                            # 公共库文件
└── scripts/                            # 运维脚本
```

---

## 4. 数据库设计

### 4.1 核心表结构

#### users - 用户表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 自增主键 |
| openid | VARCHAR(64) | 唯一索引（小程序 openid 或统一 openid） |
| nickname | VARCHAR(128) | 昵称 |
| birth_year | INT | 出生年 |
| birth_month | INT | 出生月 |
| birth_day | INT | 出生日 |
| birth_shichen | INT | 出生时辰 |
| gender | TINYINT | 性别 |
| ming_ben_gua | INT | 易经人格 ID（1-64） |
| gua_ge_name | VARCHAR(64) | 卦格名称 |
| plan_type | VARCHAR(32) | free/monthly/yearly |
| quota_remaining | INT | 剩余推演次数（VIP 普通推演按次数扣费，每日北京时间 0 点重置为 20，用不完作废；免费用户不再作为扣费依据） |
| expire_time | TIMESTAMP | VIP 过期时间 |
| last_quota_reset_date | DATE | 配额重置日期（VIP 每日 0 点重置为 20 的判定依据） |
| points | INT | 当前积分余额（v17.0 添加，普通推演 10 积分/次） |
| total_points | INT | 累计获得积分（v17.0 添加） |
| last_checkin_date | DATE | 上次签到日期（v17.0 添加） |
| checkin_streak | INT | 连续签到天数（v17.0 添加，每满 7 天触发奖励） |
| checkin_total | INT | 累计签到天数（v17.0 添加） |
| last_points_grant_date | DATE | 遗留字段：v17.0 VIP 每日赠分的幂等判重字段，v17.1 移除VIP赠分后不再使用 |
| has_profile | TINYINT(1) | 是否已建档（0=未建档 1=已建档） |
| delete_request_time | TIMESTAMP | 注销申请时间 |
| phone | VARCHAR(20) | 手机号（绑定后） |
| unionid | VARCHAR(64) | 微信开放平台 UnionID（迁移添加） |
| wx_web_openid | VARCHAR(64) | 网页微信 OAuth openid（迁移添加） |
| letter_intro_agreed | TINYINT(1) | 易缘传书引言是否已同意（0=未同意 1=已同意，迁移添加） |
| last_login_ip | VARCHAR(45) | 最后登录 IP（迁移添加） |
| last_active_at | DATETIME | 最后活跃时间（迁移添加） |
| city | VARCHAR(50) | 城市（IP 归属地，迁移添加） |
| status | TINYINT | 1=正常 0=封禁（迁移添加） |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

#### tuiyan_records - 推演记录表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| openid | VARCHAR(64) | 用户 openid |
| question | TEXT | 用户问题 |
| result_data | JSON | AI 推演结果数据 |
| is_vip_decode | TINYINT(1) | 是否 VIP 超级推演 |
| vip_decode_text | TEXT | VIP 超级推演全文 |
| created_at | TIMESTAMP | 创建时间 |

#### points_transactions - 积分流水表（v17.0 添加）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT UNSIGNED | 自增主键 |
| openid | VARCHAR(64) | 用户 openid |
| type | VARCHAR(32) | checkin / checkin_streak / ad_reward / new_user / consume_tuiyan / refund_tuiyan / admin_adjust |
| amount | INT | 变动积分（正=获得，负=消耗） |
| balance_after | INT | 交易后积分余额 |
| remark | VARCHAR(255) | 备注 |
| created_at | DATETIME | 创建时间 |

#### user_gua_collection - 卦卡收集表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| openid | VARCHAR(64) | 用户 openid |
| gua_id | INT | 卦 ID |
| source | VARCHAR(32) | 来源（默认 profile） |
| collected_at | TIMESTAMP | 收集时间 |

#### user_achievements - 成就表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| openid | VARCHAR(64) | 用户 openid |
| achievement_id | VARCHAR(64) | 成就 ID |
| achieved_at | TIMESTAMP | 解锁时间 |
| extra_data | JSON | 额外数据 |

#### subscriptions - 订阅表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| openid | VARCHAR(64) | 用户 openid |
| plan_type | VARCHAR(32) | 订阅类型 |
| start_at | TIMESTAMP | 开始时间 |
| expire_at | TIMESTAMP | 结束时间 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

#### vip_orders - VIP 订单表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| openid | VARCHAR(64) | 用户 openid |
| out_trade_no | VARCHAR(64) | 订单号（唯一） |
| product_id | VARCHAR(32) | 产品 ID |
| goods_price | INT | 价格（分） |
| env | TINYINT | 环境（0=生产） |
| status | VARCHAR(32) | 订单状态（pending/paid 等） |
| mch_order_no | VARCHAR(128) | 商户订单号 |
| transaction_id | VARCHAR(128) | 交易 ID |
| paid_time | TIMESTAMP | 支付时间 |
| callback_time | TIMESTAMP | 回调时间 |
| created_at | TIMESTAMP | 创建时间 |

#### user_bindings - 账号绑定表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| unified_openid | VARCHAR(64) | 统一 openid |
| platform | VARCHAR(20) | wechat/phone/wx_web/mobile_app |
| platform_openid | VARCHAR(64) | 平台 openid |
| unionid | VARCHAR(64) | UnionID |
| bound_at | TIMESTAMP | 绑定时间 |

#### match_records - 匹配记录表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| user_a_openid | VARCHAR(64) | 用户 A |
| user_b_openid | VARCHAR(64) | 用户 B |
| user_a_gua | INT | 用户 A 卦 ID |
| user_b_gua | INT | 用户 B 卦 ID |
| gua_a | INT | A方卦ID（冗余，与user_a_gua相同） |
| gua_b | INT | B方卦ID（冗余，与user_b_gua相同） |
| relationship_key | VARCHAR(128) | 关系键（`min(A,B)-max(A,B)`） |
| relationship_name | VARCHAR(128) | 关系名称 |
| match_level | VARCHAR(32) | 匹配等级 |
| match_detail | JSON | 匹配详情 JSON（完整关系数据，含 analysis/resonance/conflict/advice） |
| match_score | DECIMAL(5,2) | 匹配分数 |
| source | VARCHAR(32) | 匹配来源（letter=易缘匹配/share=分享匹配） |
| created_at | TIMESTAMP | 创建时间 |

> **注**：`match_records` 表存的是匹配结果摘要（关系名/等级等）；**完整匹配内容**（analysis/resonance/conflict/advice）由 `config/relationship.js` 静态关系数据提供，`/api/relationship/:guaA/:guaB` 实时返回，落地页分享链路通过 `match_result` 分享码 + scene 里的 `guaA:guaB` 直接读取静态数据完整展示。

#### letters - 信件表（迁移添加）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | 主键 |
| sender_openid | VARCHAR(64) | 发送者 |
| receiver_openid | VARCHAR(64) | 接收者 |
| match_id | BIGINT | 关联的匹配记录 ID |
| content | TEXT | 信件内容 |
| is_read | TINYINT(1) | 0=未读 1=已读 |
| created_at | TIMESTAMP | 创建时间 |

#### events - 事件日志表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| openid | VARCHAR(64) | 用户 openid |
| event_type | VARCHAR(64) | 事件类型 |
| page | VARCHAR(128) | 页面 |
| extra_data | JSON | 额外数据 |
| session_id | VARCHAR(128) | 会话 ID |
| created_at | TIMESTAMP | 创建时间 |

#### hexagrams - 64 卦数据表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键（1-64） |
| name | VARCHAR(32) | 卦名 |
| full_name | VARCHAR(64) | 全名 |
| symbol | VARCHAR(16) | 符号 |
| upper | VARCHAR(32) | 上卦 |
| lower | VARCHAR(32) | 下卦 |
| wuxing | VARCHAR(16) | 五行 |
| judgment | TEXT | 卦辞 |
| image | TEXT | 象辞 |
| description | TEXT | 描述 |

#### share_codes - 分享短码表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| share_id | VARCHAR(64) | 分享短码（唯一，12 位随机数） |
| openid | VARCHAR(64) | 用户 openid |
| type | VARCHAR(32) | 类型：`result`（推演结果分享）/ `match_result`（匹配结果分享，scene 存 `guaA:guaB`）/ `match`（个人人格分享）/ `gua_match`（历史遗留别名） |
| scene | VARCHAR(64) | 场景参数：`result` 存推演记录 ID；`match_result` 存 `guaA:guaB`；`match` 可空 |
| created_at | TIMESTAMP | 创建时间 |
| expires_at | TIMESTAMP | 过期时间（默认 30 天） |
| use_count | INT | 使用次数 |
| use_limit | INT | 使用次数限制（默认 100） |

> **v3.6 分享类型语义**（2026-09-03）：
> - `result`：推演结果分享，落地页 `result.html` 完整展示分享者推演记录（只读，无"和 TA 易缘匹配"按钮）；
> - `match_result`：匹配结果分享，落地页 `match.html` 完整展示双方匹配结果（关系名/等级/分析/共鸣/冲突/建议，静态关系数据不依赖双方在线）；
> - `match`：个人人格分享，落地页 `match.html` 展示分享者人格并引导接收者进入双方匹配。

#### notifications - 用户通知表（v3.5 添加）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| user_openid | VARCHAR(64) | 接收用户 openid |
| type | VARCHAR(32) | 通知类型：`match_reply`（匹配回应）/ `letter_received`（信件到达）/ `jieqi_reminder`（节气提醒）/ `system`（系统） |
| title | VARCHAR(200) | 标题 |
| content | TEXT | 内容 |
| related_id | VARCHAR(64) | 关联 ID |
| is_read | TINYINT | 是否已读（0/1） |
| created_at | DATETIME | 创建时间 |
| read_at | DATETIME | 已读时间 |

> 通知写入方：`src/routes/match.js`（匹配回应）、`src/routes/letter.js`（信件到达）、`scripts/jieqi-notification.js`（节气提醒，cron `0 9 * * *` 每日 9 点触发，脚本内部判断"仅节气变更当天"才推送）。
> 前端 App 内"消息中心"页面代码已保留但不设入口；匹配回应/信件未读提醒走"我的 → 易缘匹配区"角标。

#### admins - 管理员账号表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| username | VARCHAR(64) | 用户名（唯一） |
| password_hash | VARCHAR(255) | 密码哈希 |
| ip_whitelist | TEXT | IP 白名单 |
| last_login_at | TIMESTAMP | 最后登录时间 |
| last_login_ip | VARCHAR(45) | 最后登录 IP |
| created_at | TIMESTAMP | 创建时间 |

#### admin_logs - 操作审计日志表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| admin_id | INT | 管理员 ID |
| action | VARCHAR(128) | 操作 |
| target | VARCHAR(128) | 目标 |
| detail | JSON | 详情 |
| ip | VARCHAR(45) | IP 地址 |
| created_at | TIMESTAMP | 创建时间 |

#### pending_deletions - 待删除数据表（15 天宽限期）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| openid | VARCHAR(64) | 用户 openid |
| users_backup | JSON | 用户数据备份 |
| tuiyan_backup | JSON | 推演记录备份 |
| subscriptions_backup | JSON | 订阅数据备份 |
| events_backup | JSON | 事件数据备份 |
| match_backup | JSON | 匹配数据备份 |
| share_backup | JSON | 分享数据备份 |
| requested_at | TIMESTAMP | 申请时间 |
| execute_at | TIMESTAMP | 执行时间 |
| status | VARCHAR(32) | 状态（默认 pending） |

#### letter_reports - 举报记录表（迁移添加）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | 主键 |
| reporter_openid | VARCHAR(64) | 举报人 |
| target_openid | VARCHAR(64) | 被举报人 |
| letter_id | BIGINT | 关联信件 ID（可选） |
| reason | VARCHAR(64) | 举报原因 |
| status | VARCHAR(20) | 状态（pending/reviewed/resolved） |
| created_at | TIMESTAMP | 创建时间 |

#### letter_blocks - 拉黑记录表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| blocker_openid | VARCHAR(64) | 发起拉黑的用户 |
| blocked_openid | VARCHAR(64) | 被拉黑的用户 |
| created_at | TIMESTAMP | 创建时间 |

**索引**：
- UNIQUE KEY uk_blocker_blocked (blocker_openid, blocked_openid)
- INDEX idx_blocker (blocker_openid)
- INDEX idx_blocked (blocked_openid)

#### letter_reply_config - 虚拟用户回信配置表（迁移添加）

| 字段 | 类型 | 说明 |
|------|------|------|
| config_key | VARCHAR(64) | 配置键（主键） |
| config_value | VARCHAR(255) | 配置值 |
| updated_at | TIMESTAMP | 更新时间 |

#### solar_term_basic - 节气养生基础表（迁移添加）

| 字段 | 类型 | 说明 |
|------|------|------|
| solar_term_index | TINYINT | 节气索引 0-23（主键） |
| name | VARCHAR(16) | 节气名 |
| wuxing | VARCHAR(8) | 五行属性 |
| organ | VARCHAR(8) | 对应脏腑 |
| season | VARCHAR(8) | 季节 |
| season_desc | VARCHAR(64) | 节气简述 |
| date_range | VARCHAR(32) | 日期范围 |
| wu_hou | JSON | 物候三候 |
| keywords | JSON | 养生关键词 |
| plain_summary | VARCHAR(255) | 一句话重点（v2.0，替代生涩关键词，让用户3秒抓住核心） |
| neijing_quote | TEXT | 黄帝内经原文 |
| neijing_source | VARCHAR(64) | 原文出处 |
| neijing_interpretation | TEXT | 白话解读 |
| neijing_plain | TEXT | 内经说人话（v2.0，古文翻译成现代人一听就懂的话） |
| neijing_action | JSON | 今天照做（v2.0，3条可执行动作） |
| general_yi_food | JSON | 通用宜-食物 |
| general_yi_recipes | JSON | 本节气推荐菜（v2.0，菜名+主料+做法+功效） |
| general_yi_activity | JSON | 通用宜-活动 |
| general_yi_emotion | JSON | 通用宜-情志 |
| general_ji | JSON | 通用忌 |
| updated_at | TIMESTAMP | 更新时间 |

#### solar_term_health_advice - 卦格专属养生建议表（迁移添加）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| solar_term_index | TINYINT | 节气索引 0-23 |
| gua_index | INT | 卦格 ID 1-64 |
| gua_ge | VARCHAR(32) | 卦格名 |
| gua_wuxing | VARCHAR(8) | 卦格五行 |
| term_wuxing | VARCHAR(8) | 节气五行 |
| element_interaction | VARCHAR(32) | 五行关系标题 |
| relation_type | VARCHAR(8) | 关系类型（同气/我生/生我/克我/我克） |
| corresponding_organ | VARCHAR(16) | 对应脏腑 |
| warning | TEXT | 脏腑警示文案 |
| recommend_food | JSON | 推荐食物 |
| recommend_activity | JSON | 推荐活动 |
| recommend_emotion | JSON | 情志调节 |
| recommend_avoid | JSON | 禁忌 |
| classic_quote | TEXT | 经典原文引用 |
| classic_source | VARCHAR(64) | 经典出处 |
| classic_interpretation | TEXT | 经典白话解读 |
| status | TINYINT | 状态（0待审核 1已审核 2需修正） |
| updated_at | TIMESTAMP | 更新时间 |

#### app_error_reports - 应用错误报告表（迁移添加）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| error_message | TEXT | 错误信息 |
| error_stack | TEXT | 错误堆栈 |
| platform | VARCHAR(20) | 平台（ios/android/web） |
| version | VARCHAR(20) | 应用版本 |
| user_agent | VARCHAR(255) | 用户代理 |
| created_at | TIMESTAMP | 创建时间 |

### 4.2 索引设计

```sql
-- 用户表索引
CREATE INDEX idx_openid ON users(openid);
CREATE INDEX idx_phone ON users(phone);
CREATE INDEX idx_unionid ON users(unionid);

-- 推演记录索引
CREATE INDEX idx_openid ON tuiyan_records(openid);
CREATE INDEX idx_openid_created ON tuiyan_records(openid, created_at);

-- 卦卡收集索引
CREATE UNIQUE INDEX uk_openid_gua ON user_gua_collection(openid, gua_id);
CREATE INDEX idx_openid ON user_gua_collection(openid);

-- 成就索引
CREATE UNIQUE INDEX uk_openid_achievement ON user_achievements(openid, achievement_id);
CREATE INDEX idx_openid ON user_achievements(openid);

-- 订阅索引
CREATE INDEX idx_openid ON subscriptions(openid);
CREATE INDEX idx_openid_expire ON subscriptions(openid, expire_at);

-- 订单索引
CREATE INDEX idx_openid ON vip_orders(openid);
CREATE INDEX idx_out_trade_no ON vip_orders(out_trade_no);
CREATE INDEX idx_status ON vip_orders(status);

-- 匹配记录索引
CREATE INDEX idx_user_a ON match_records(user_a_openid);
CREATE INDEX idx_user_b ON match_records(user_b_openid);
CREATE INDEX idx_created_at ON match_records(created_at);

-- 事件索引
CREATE INDEX idx_openid ON events(openid);
CREATE INDEX idx_event_type ON events(event_type);
CREATE INDEX idx_created_type ON events(created_at, event_type);

-- 分享短码索引
CREATE INDEX idx_openid ON share_codes(openid);
CREATE INDEX idx_expires_at ON share_codes(expires_at);
CREATE INDEX idx_share_codes_lookup ON share_codes(share_id, expires_at);

-- 待删除索引
CREATE INDEX idx_openid ON pending_deletions(openid);
CREATE INDEX idx_status_execute ON pending_deletions(status, execute_at);

-- 信件索引（迁移添加）
CREATE INDEX idx_letters_thread ON letters(sender_openid, receiver_openid, created_at);
CREATE INDEX idx_letters_unread ON letters(receiver_openid, is_read);
CREATE INDEX idx_sender_created ON letters(sender_openid, created_at);
CREATE INDEX idx_receiver_created ON letters(receiver_openid, created_at);
CREATE INDEX idx_pair ON letters(sender_openid, receiver_openid);

-- 举报索引
CREATE INDEX idx_reporter ON letter_reports(reporter_openid);
CREATE INDEX idx_target ON letter_reports(target_openid);
CREATE INDEX idx_status ON letter_reports(status);

-- 拉黑索引
CREATE UNIQUE INDEX uk_blocker_blocked ON letter_blocks(blocker_openid, blocked_openid);
CREATE INDEX idx_blocker ON letter_blocks(blocker_openid);
CREATE INDEX idx_blocked ON letter_blocks(blocked_openid);

-- 节气养生索引
CREATE UNIQUE INDEX uk_term_gua ON solar_term_health_advice(solar_term_index, gua_index);
CREATE INDEX idx_status ON solar_term_health_advice(status);
CREATE INDEX idx_term ON solar_term_health_advice(solar_term_index);

-- 账号绑定索引
CREATE UNIQUE INDEX uk_platform_openid ON user_bindings(platform, platform_openid);
CREATE UNIQUE INDEX uk_unionid ON user_bindings(unionid);
CREATE INDEX idx_unified ON user_bindings(unified_openid);
```

---

## 5. API 接口规范

### 5.1 接口路径规范

所有接口统一前缀：`/tianji/api/`

### 5.2 请求格式

```json
{
  "Authorization": "Bearer <token>",
  "Content-Type": "application/json"
}
```

### 5.3 响应格式

```json
{
  "success": true,
  "data": {
    "openid": "xxx",
    "token": "xxx",
    "quota_remaining": 3,
    "points": 10,
    "plan_type": "free"
  },
  "code": null,
  "message": null
}
```

### 5.4 错误码规范

| 错误码 | 说明 | 触发场景 |
|--------|------|---------|
| AUTH_TOKEN_MISSING | Token 缺失 | 未携带 Authorization 头 |
| AUTH_TOKEN_INVALID | Token 无效 | JWT 解析失败 / 签名错误 |
| AUTH_TOKEN_EXPIRED | Token 过期 | JWT exp 已过（24h） |
| ADMIN_AUTH_REQUIRED | 需要管理员权限 | 非 admin role 访问 admin 路由 |
| ADMIN_AUTH_FAILED | 管理员认证失败 | 用户名/密码错误 |
| ADMIN_RATE_LIMITED | 管理员登录限流 | 5 次/分钟超限 |
| FORBIDDEN | 无权访问 | openid 不匹配（越权访问他人数据）/ 非 VIP 用户调用 `/api/tuiyan/vip` |
| USER_NOT_FOUND | 用户不存在 | openid 查询无结果 |
| USER_BANNED | 用户已封禁 | `users.status = 0` 时 `verifyToken` 拦截（403 状态码） |
| PROFILE_INCOMPLETE | 未建档 | `ming_ben_gua` 为空（未填写档案） |
| QUOTA_EXCEEDED | 配额耗尽 | VIP 超级推演 Redis 计数已达上限（v17.0 起普通推演不再触发此码） |
| POINTS_INSUFFICIENT | 积分不足 | 普通推演原子扣 10 积分失败（`points < 10`），返回 **402**，引导签到/看视频 |
| ALREADY_CHECKED_IN | 今日已签到 | `POST /api/points/checkin` 重复签到，返回 400 |
| AD_TOO_FREQUENT | 广告奖励领取过快 | `POST /api/points/ad-reward` 30 秒冷却期内，返回 429 |
| SESSION_KEY_MISSING | session_key 缺失 | 虚拟支付签名时无对应 key |
| INVALID_PARAM | 参数无效 | 字段缺失/格式错误 |
| GUA_NOT_FOUND | 卦象不存在 | id 不在 1-64 范围 |
| RECORD_NOT_FOUND | 记录不存在 | 推演/匹配记录查询无果 |
| INVALID_SHARE_ID | 分享 ID 无效 | 短码不存在或已过期 |
| SHARE_LIMIT_EXCEEDED | 分享解析超限 | `use_count >= use_limit`（100） |
| AI_ERROR | AI 推演错误 | DeepSeek 返回错误 / JSON 解析失败 |
| RATE_LIMITED | 全局限流 | 60 req/min/IP 超限 |
| TIMEOUT | 请求超时 | 动态超时触发（30s/90s/300s） |
| TOO_MANY_REQUESTS | 服务繁忙 | 推演信号量排队超时（普通 60s / VIP 180s）返回 503 |
| DB_ERROR | 数据库错误 | SQL 执行失败 |
| INTERNAL_ERROR | 服务器内部错误 | 未捕获异常 |
| NOT_FOUND | 接口不存在 | 404 兜底 |
| ORDER_NOT_FOUND | 订单不存在 | 订单查询无果 |
| HEXAGRAM_NOT_FOUND | 卦象不存在（后台） | 后台卦象管理查询无果 |
| ADMIN_NOT_FOUND | 管理员不存在（后台） | 后台管理员查询无果 |
| NETWORK_ERROR | 网络异常（前端） | 网络请求失败 |
| SAME_GENDER | 同性别不可匹配 | `/api/letter/match` 同性别触发 |
| NOT_MATCHED | 未匹配不可传书 | `/api/letter/send`、`/api/letter/thread` 双方未匹配 |
| MATCH_LIMIT_EXCEEDED | 当日匹配次数已达上限 | `/api/letter/match` 超出限制 |
| BLOCKED | 双方已拉黑 | `/api/letter/send`、`/api/letter/thread`、`/api/letter/match` 存在拉黑关系 |
| DAILY_LETTER_LIMIT_EXCEEDED | 每日给同一人发信超 3 封 | `/api/letter/send` 当日给同一 receiverOpenid 发信数 ≥ 3 |
| REPLY_DISABLED | 虚拟用户单用户回信开关已关闭 | 代回信时 `letter_reply_enabled = 0` |
| GLOBAL_REPLY_DISABLED | 全局回信开关已关闭 | 代回信时 `letter_reply_config.global_reply_enabled !== '1'` |

### 5.5 开放接口（不需认证）

| 接口 | 用途 |
|------|------|
| `GET /api/health` | 健康检查 |
| `POST /api/auth/login` | 微信小程序登录 |
| `POST /api/auth/wx-login` | 微信登录（备用） |
| `POST /api/auth/miniapp-login` | 多端应用登录 |
| `POST /api/auth/device-login` | 设备登录 |
| `POST /api/auth/send-code` | 发送验证码 |
| `POST /api/auth/phone-login` | 手机登录 |
| `POST /api/auth/web-wx-login` | 网页微信扫码登录 |
| `GET /api/gua/list` | 卦象列表 |
| `GET /api/gua/:id` | 卦象详情 |
| `GET /api/relationship/lazy` | 卦象分页 |
| `GET /api/relationship/:guaA/:guaB` | 卦象关系 |
| `GET /api/solar-term/current` | 当前节气 |
| `GET /api/solar-term/all` | 全部节气列表 |
| `GET /api/payment/virtual-notify` | 微信回调验证 |
| `POST /api/payment/virtual-notify` | 虚拟支付回调 |
| `POST /api/payment/h5-notify` | H5 支付回调 |
| `GET /api/payment/test-pay` | 测试支付（生产禁用） |
| `GET /api/share/resolve/:shareId` | 分享解析 |
| `GET /api/tuiyan/shared/:id` | 分享查看 |

**分享接口详解（v3.6）**：
- `POST /api/share/code`（需认证，路由 `src/routes/share.js`）：生成分享短码。请求体 `{ type, scene }`；返回 `{ share_id, expires_at }`。`type` 见 share_codes 表说明。
- `GET /api/share/resolve/:shareId`（公开）：解析分享码。按 `type` 分派：
  - `result`：查 `tuiyan_records` 返回完整推演记录（question/result_data/vip_decode_text）+ 动态附加卦象（symbol 取 `hexagrams.symbol`、gua_name 取 `full_name`、gua_ge 从 `config/hexagrams.js` 按卦 ID 匹配）；
  - `match_result`：从 `scene` 解析 `guaA:guaB`，查 `config/relationship.js` 静态关系数据，返回完整匹配结果（relationship_name/one_liner/analysis/resonance/conflict/advice/match_level）+ 双方卦象信息（sharerGua/partnerGua 的 symbol/name/gua_ge）；
  - `match`/`gua_match`：返回分享者卦象/昵称/openid，引导接收者进入双方匹配。
  - 解析时自动用 `resolveOpenid()` 反查分享者最新主账号 openid（兼容绑定手机号场景），并递增 `use_count`。

### 5.6 积分体系接口（v17.0，需认证）

路由文件：`src/routes/points.js`，挂载于 server.js。

| 接口 | 方法 | 用途 |
|------|------|------|
| `/api/points/balance` | GET | 积分余额与签到状态（`points`/`totalPoints`/`todayCheckedIn`/`streak`/`checkinTotal`/`extraVipDecode`） |
| `/api/points/checkin` | POST | 每日签到 +10；连续签到每满 7 天 +100 并赠 1 次深度解读（Redis `extra_vip_decode:*`，v18 起永久有效，不设过期）；重复签到返回 400 |
| `/api/points/ad-reward` | POST | 看激励视频奖励 +10；Redis `ad_reward_cd:*` 30 秒冷却防刷，冷却期内返回 429 |

配套逻辑：
- 普通推演扣分/失败回补见 7.3；新用户注册赠 10 分在 `auth.js` 全部 6 处注册入口写入
- 管理后台：`GET /api/admin/users/:openid/points` 分页查询积分流水（含 users 表积分/签到字段汇总）

---

## 6. 认证与授权

### 6.1 JWT 认证

```javascript
// middleware/auth.js
const jwt = require('jsonwebtoken');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({
      success: false,
      code: 'AUTH_TOKEN_MISSING',
      message: '缺少认证信息'
    });
  }
  
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    // 反查 openid 为最新主账号 openid（绑定手机号后旧 JWT 仍携带旧 openid）
    const resolvedOpenid = await resolveOpenidWithCache(decoded.openid);
    req.openid = resolvedOpenid;
    req.originalOpenid = decoded.openid;
    // 封禁用户检查（60秒缓存）
    // ... 省略封禁检查逻辑
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        code: 'AUTH_TOKEN_EXPIRED',
        message: 'Token已过期，请重新登录'
      });
    }
    return res.status(401).json({
      success: false,
      code: 'AUTH_TOKEN_INVALID',
      message: 'Token无效'
    });
  }
};
```

### 6.2 双端登录流程

**小程序端**：
1. 前端调用 `wx.login` 获取 code
2. 后端调用 `jscode2session` 换取 openid
3. 生成 JWT token 返回

**App 端**：
1. 前端调用 `wx.weixinMiniProgramLogin` 获取 code
2. 后端调用 `code2Verifyinfo`（使用多端应用凭证）换取 openid
3. 生成 JWT token 返回

**设备登录（H5/APP 非微信环境）**：
1. 前端通过设备指纹生成唯一 device_id
2. 后端生成匿名 openid
3. 生成 JWT token 返回

**手机号登录（跨端统一身份）**：
1. 前端发送手机号 + 验证码
2. 后端验证短信验证码
3. 查找或创建 phone_ 开头的统一 openid
4. 合并旧账号数据，生成 JWT token 返回

### 6.3 账号绑定

```javascript
// POST /api/auth/bind-phone
// 将微信账号与手机号绑定，统一身份
```

---

## 7. 核心业务流程

### 7.1 推演流程

```
用户输入问题
    ↓
检查登录状态 → 未登录 → 引导登录
    ↓
检查建档状态 → 未建档 → 引导建档
    ↓
原子扣减 10 积分 → 积分不足（402 POINTS_INSUFFICIENT）→ 引导签到/看视频
    ↓
计算易经人格（lunar-javascript）
    ↓
调用 DeepSeek API 生成报告
    ↓
保存推演记录
    ↓
更新卦卡收集
    ↓
返回结果
```

### 7.2 VIP 超级推演

- 每日限量 1 次（Redis 限流 `vip_decode:{openid}:{date}`，TTL 24 小时，每日重置）
- 支持按用户单独配置次数（`VIP_DECODE_OVERRIDES`）
- 68 时空变量注入
- 动效增强

**深度解读消耗顺序（v18）**：AI 生成成功后按下列顺序扣次——
- **VIP（monthly/yearly）**：优先扣 **VIP 每日 1 次**（Redis）→ 每日用完后再扣**签到连签赠次**（`extra_vip_decode:*`）
- **免费用户**：仅扣**签到连签赠次**（无份额时 403 `VIP_DECODE_NO_QUOTA`）
- 签到连签赠次 `extra_vip_decode:*` **永久有效**（v18 不再设 90 天过期）
- 权限判定（阶段1 只读检查）与消耗（AI 成功后）逻辑已同步，保证"权限过 + 当日只扣一次"

### 7.3 配额重置与计费逻辑（v17.1）

```javascript
// 每日北京时间 0 点重置（utils/vip.js resetDailyQuota）
const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
const today = beijingTime.toISOString().split('T')[0];

if (lastResetDate !== today) {
  if (plan_type === 'monthly' || plan_type === 'yearly') {
    quota_remaining = 20; // VIP 普通推演次数制：每日 20 次，0 点重置，用不完作废
  } else {
    quota_remaining = 3; // 免费用户遗留兼容重置，普通推演实际按积分扣费
  }
}
// v17.1 起不再在此执行任何 VIP 积分赠送（v17.0 的 grantDailyPointsIfNeeded 已移除）
```

**普通推演计费（`tuiyan.js`）**：按用户类型分流——
- VIP（monthly/yearly）：扣次数 `UPDATE users SET quota_remaining = quota_remaining - 1`，剩余 0 返回 402 VIP_QUOTA_EXCEEDED
- 免费用户：扣积分 `UPDATE users SET points = points - 10 WHERE openid = ? AND points >= 10`，不足返回 402 POINTS_INSUFFICIENT
- AI 生成失败时回补对应资源（免费用户 +10 积分记 type='refund_tuiyan'；VIP quota_remaining +1）

---

## 8. 支付系统

### 8.1 小程序虚拟支付

```javascript
// POST /api/payment/create-order
// 创建虚拟支付订单

// POST /api/payment/virtual-notify
// 微信支付回调
```

### 8.2 App 原生支付（APP支付）

> 🔴 关键结论：原生 App 内**不能使用 H5 支付**（微信官方 H5 支付仅限手机浏览器场景，禁止在 App 客户端内调起）。Donut/uni-app 的 App 端购买 VIP 必须走**微信 APP 支付**，需在微信开放平台注册「移动应用」获得 `移动应用 AppID`（即 `WXPAY_APP_APPID`）。

```javascript
// POST /api/payment/create-app-order        App 支付下单，返回 { outTradeNo, payParams }
//   payParams = { appid, partnerid, prepayid, package, noncestr, timestamp, sign }
// POST /api/payment/h5-notify               APP 支付回调（与 H5 共用同一收款回调接口）
// GET  /api/payment/check-order/:outTradeNo  查询订单状态（前端轮询）
// POST /api/payment/sync-order/:outTradeNo   微信查单补发货（前端兜底）
```

后端 `createAppOrder`（utils/wxpay.js）调用微信 V3 `/v3/pay/transactions/app` 下单，返回 `prepay_id`，
并用商户私钥对 `appid\n+timestamp\n+noncestr\n+prepayid\n` 做 RSA-SHA256 签名，拼装 `payParams` 给客户端。

前端 App 端（`sub/vip/vip/index.js`）调用 `/api/payment/create-app-order`，将返回的 `payParams`
序列化为 `orderInfo` JSON 传入 `wx.requestPayment({ provider: 'wxpay', orderInfo })` 调起微信。

> 备注：`create-h5-order` 接口仍保留（供未来手机浏览器 H5 场景使用），但 App 端不再调用它。

### 8.3 VIP 降级逻辑

```javascript
// utils/vip.js
const downgradeExpiredVip = async (conn, openid, user, today) => {
  let target = user;
  if (!target) {
    const [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [openid]);
    if (rows.length === 0) return false;
    target = rows[0];
  }
  if (target.plan_type !== 'free' && target.expire_time && new Date(target.expire_time) < new Date()) {
    await conn.query('UPDATE users SET plan_type="free", quota_remaining=3, expire_time=NULL WHERE openid=?', [openid]);
    await conn.query('UPDATE subscriptions SET plan_type="free", expire_at=NULL, updated_at=NOW() WHERE openid=?', [openid]);
    target.plan_type = 'free';
    target.quota_remaining = 3;
    target.expire_time = null;
    if (today) target.last_quota_reset_date = today;
    return true;
  }
  return false;
};
```

> 注（v17.1）：降级时 `quota_remaining=3`；VIP 到期后停止按次数特权（普通推演回退为免费用户的积分扣费），不再发放任何每日赠送积分。

---

## 9. 易缘传书系统

### 9.1 匹配池

```javascript
// GET /api/letter/match-pool
// 返回匹配候选人列表（optionalAuth，游客可浏览）
```

### 9.2 写信/收信

```javascript
// POST /api/letter/send
// 发送信件

// GET /api/letter/friends
// 获取好友列表

// GET /api/letter/thread/:friendOpenid
// 获取与某好友的信件线程

// GET /api/letter/unread-count
// 获取未读信件数
```

### 9.3 举报拉黑

```javascript
// POST /api/letter/report
// 举报用户

// POST /api/letter/block
// 拉黑用户
```

---

## 10. 缓存与限流

### 10.1 Redis Key 设计

| Key | 用途 | TTL |
|-----|------|-----|
| `tianji:session_key:{openid}` | session_key 缓存 | 2h |
| `tianji:vip_decode:{openid}:{date}` | VIP 推演计数 | 24h |
| `tianji:sms:{phone}` | 短信验证码 | 5min |
| `tianji:sms:cooldown:{phone}` | 短信冷却 | 60s |
| `tianji:cache:ban:{openid}` | 封禁缓存 | 60s |
| `tianji:i18n:gua:v2:{id}` | 64 卦长文本英文翻译缓存 | 永久 |
| `tianji:i18n:gua:list:v2` | gua/list 接口批量翻译缓存 | 永久 |
| `tianji:i18n:user:{openid}` | 用户档案英文翻译缓存 | 永久 |

### 10.2 AI 翻译缓存（双语系统）

双语系统采用「AI 翻译 + Redis 永久缓存」的懒加载策略：

- **短字段**（卦名、卦格等 < 16 字）：使用静态配置表 `config/hexagrams-en.js`，不经 AI
- **长字段**（description、renGe、emotionMode 等）：首次请求时调 AI 翻译，结果存入 Redis，后续直接命中缓存
- **翻译可靠性保障**（`utils/translator.js`）：
  - 字段完整性校验：检测 AI 返回的缺失字段和空字符串
  - 未翻译检测：`findProblemFields()` 识别仍含中文的字段
  - 3 轮重试 + 字段级补翻：对问题字段单独重翻
  - 字段重命名规避 AI 忽略：`description` → `core_meaning`
  - 分片翻译：大量字段拆为小批次并行处理，避免超时
- **缓存 Key 版本号**：格式 `v2`，升级时递增以避免旧缓存污染

### 10.3 限流策略

```javascript
// VIP 推演限流
const key = `tianji:vip_decode:${openid}:${today}`;
const count = await redis.incr(key);
if (count === 1) {
  await redis.expire(key, 86400);
}
if (count > limit) {
  return res.status(429).json({ message: '今日次数已用完' });
}
```

---

## 11. 错误处理

### 11.1 全局错误处理

```javascript
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: '服务器内部错误'
  });
});
```

### 11.2 数据库错误

```javascript
try {
  const [rows] = await conn.query('SELECT * FROM users WHERE openid = ?', [openid]);
} catch (e) {
  console.error('[db] query error:', e);
  throw e;
} finally {
  conn.release();
}
```

---

## 12. 性能优化

### 12.1 连接池配置

```javascript
// middleware/db.js
const CONNECTION_LIMIT = parseInt(process.env.DB_CONNECTION_LIMIT || '15', 10);
const QUEUE_LIMIT = parseInt(process.env.DB_QUEUE_LIMIT || '100', 10);

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'tianji_tuiyan',
  connectionLimit: CONNECTION_LIMIT,  // 默认 15（PM2 4 进程 × 15 = 60 总连接）
  queueLimit: QUEUE_LIMIT,            // 默认 100
  idleTimeout: 60000,                 // 60 秒回收空闲连接
  charset: 'utf8mb4',
  dateStrings: true,                  // 时间字段返回原始字符串
  connectTimeout: 10000,              // 连接超时 10 秒
  enableKeepAlive: true,
  multipleStatements: false,          // 防止 SQL 注入
});
```

### 12.2 PM2 Cluster 模式

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'tianji-tuiyan-api',
    script: 'server.js',
    cwd: '/home/admin/.openclaw/workspace/projects/tianji-tuiyan',
    instances: 4,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
    },
    max_memory_restart: '800M',
    error_file: '/home/admin/logs/tianji-error.log',
    out_file: '/home/admin/logs/tianji-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    autorestart: true,
    watch: false,
    min_uptime: '30s',
    restart_delay: 5000,
    kill_timeout: 10000,
    listen_timeout: 30000,
    source_map_support: true,
  }]
};
```

### 12.3 Nginx 超时配置

```nginx
location /tianji/ {
  proxy_read_timeout 300s;  // 适配 VIP 推演 5 分钟超时
}
```

---

## 附录：环境变量配置

```bash
# 服务器配置
PORT=3003

# 数据库
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=***
DB_NAME=tianji_tuiyan

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=***
JWT_EXPIRES_IN=24h

# 微信（小程序）
WX_APPID=***
WX_APPSECRET=***

# 微信（多端应用）
MINIAPP_APPID=***
MINIAPP_APPSECRET=***

# DeepSeek
DEEPSEEK_API_KEY=***
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_VIP_MODEL=deepseek-v4-flash

# 虚拟支付
XPAY_OFFER_ID=***
XPAY_APP_KEY=***
XPAY_ENV=0

# 微信支付 V3（APP支付 / H5支付）
WXPAY_MCHID=***            # 收单商户号
WXPAY_APPID=***            # 与商户号关联的公众号 AppID（H5支付下单用，非小程序）
WXPAY_APP_APPID=***        # 移动应用 AppID（APP支付必填，微信开放平台）
WXPAY_API_V3_KEY=***       # APIv3 密钥（32 位）
WXPAY_SERIAL_NO=***        # API 证书序列号
WXPAY_PRIVATE_KEY=***      # 商户 API 私钥内容（apiclient_key.pem）
WXPAY_NOTIFY_URL=https://claw-book.cn/tianji/api/payment/h5-notify

# 管理员
ADMIN_USERNAME=***
ADMIN_PASSWORD_HASH=***
```
