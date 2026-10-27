# API 字段对照文档（双端）

> 小程序与 App 通过 Donut 多端框架共用一套代码，字段天然一致；网页端已降级为官网（展示 + APK 下载入口），不参与字段对齐。
> 本文档梳理后端 API 字段命名规范，供双端开发参考。
> **最后更新**：2026-09-03（v3.6 分享接口 match_result 类型）
> 生成时间：2026-08-02
> **最后更新：2026-08-18 — v19.2 匹配链路双语：letter/match、letter/match-pool（三分支统一 mapCandidate）、letter/friends、user/profile 系列接口支持 `lang` 参数**

---

## 一、后端接口命名风格现状

### ✅ 已修复：VIP深度解读剩余次数字段统一

之前存在同一数据、两个接口、两种命名的问题，现已修复：

| 接口 | 返回字段 | 状态 |
|------|---------|------|
| `/api/user/profile/:openid` | `vipDecodeRemaining`（主）+ `vip_decode_remaining`（兼容过渡） | ✅ 已统一 |
| `/api/payment/vip-info/:openid` | `vipDecodeRemaining` | ✅ 一致 |

两个接口现在都返回 `vipDecodeRemaining`（驼峰），`/api/user/profile` 同时保留 `vip_decode_remaining` 做兼容过渡。

### 后端整体命名规律

| 模块 | 命名风格 | 说明 |
|------|---------|------|
| 用户档案类 | 下划线 | `has_profile`, `quota_remaining`, `plan_type`, `ming_ben_gua`, `gua_ge_name`, `birth_year` 等 |
| 推演结果类 | 下划线 | `result_data`, `vip_decode_text`, `gua_name`, `created_at`, `sharer_nickname`, `zi_chao_biao_qian` |
| 卦数据类 | 下划线 | `guan_jian_ci`, `full_name`, `gua_ge` |
| 匹配历史类 | 下划线 | `user_a_openid`, `relationship_key`, `match_level` |
| 分享短码 | 下划线 | `share_id` |
| 好友/信件类 | 驼峰 | `friendNickname`, `unreadCount`, `matchId`, `lastLetterTime` |
| 匹配池类 | 驼峰 | `guaId`, `guaName`, `isGuest`, `introAgreed` |
| 支付类 | 驼峰 | `outTradeNo`, `payParams`, `h5Url` |
| 分享解析类 | 驼峰 | `sharerGuaId`, `sharerOpenid`, `sharerNickname` |
| 成就类 | 驼峰 | `achievementUnlocked`, `completionOrder` |
| 养生建议类 | 驼峰 | `recommendFood`, `recommendActivity` |
| 积分体系类 | 驼峰 | `points`, `totalPoints`, `todayCheckedIn`, `streak`, `checkinTotal`, `extraVipDecode`（v17.0 新增） |
| VIP信息 | 驼峰 | `vipDecodeRemaining`（已统一） |

---

## 二、API 字段对比（历史：网页端已降级为官网）

> 以下对比表为 2026-08-02 生成的历史记录。当前小程序与 App 通过 Donut 共用一套代码、字段天然一致；网页端已降级为官网（展示 + 下载入口），不再参与字段对齐。保留此表仅作后端字段命名参考。

### 2.1 认证类接口

#### POST /api/auth/login（小程序微信登录）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `openid`, `token`, `quota_remaining`, `plan_type` | 基准 |
| APP | `openid`, `token`, `quota_remaining`, `plan_type` | ✅ |
| 网页 | N/A（网页无微信登录） | - |

#### POST /api/auth/miniapp-login（App 端微信登录，核心接口）
> App 端（Donut 多端应用）微信登录：前端 `wx.weixinAppLogin()` 获取 code，后端调用 code2Verifyinfo 换取多端应用 user_id（跨端唯一标识）+ 各平台 openid。调用方：`app.js` login()、`pages/my/index.js`、`sub/profile/edit-profile/index.js`。
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | N/A（小程序走 `/api/auth/login`） | - |
| APP | `code` → `openid`, `token`, `quota_remaining`, `plan_type`, `user_id` | ✅ |

#### POST /api/auth/wx-login（`/login` 别名）
> 后端 `/wx-login` 为 `/login` 的别名，复用 code2Session 逻辑（小程序登录）。
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | 同 `/login` | ✅ |
| APP | N/A | - |
| 网页 | N/A | - |

#### POST /api/auth/device-login（设备登录）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | N/A（小程序无此接口） | - |
| APP | `openid`, `token`, `quota_remaining`, `plan_type` | - |
| 网页 | `openid`, `token`, `quota_remaining`, `plan_type` | ✅ |

#### POST /api/auth/phone-login（手机号登录）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `openid`, `token`, `quota_remaining`, `plan_type` | 基准 |
| APP | `openid`, `token`, `quota_remaining`, `plan_type` | ✅ |
| 网页 | `openid`, `token`, `quota_remaining`, `plan_type` | ✅ |

#### POST /api/auth/send-code（发送验证码）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | 仅 `success`/`message` | 基准 |
| APP | 仅 `success`/`message` | ✅ |
| 网页 | 仅 `success`/`message` | ✅ |

#### v19.1 邮箱登录三接口（海外用户，App 端使用）— ✅ 已部署实测通过（2026-08-18）
- `POST /api/auth/email-send-code` `{email, purpose}`：发6位验证码到邮箱（5分钟有效，60s冷却，每日≤10次）；需 .env `SMTP_*` 配置，未配置返回 500 `SMTP_NOT_CONFIGURED`；`purpose` 可选值 `register`（默认）/ `reset`（找回密码）/ `bind`（v19.4 绑定邮箱，绑定流程专用，与注册/重置分开计数）
- `POST /api/auth/email-register` `{email, code, password}`：首次注册（密码≥6位，bcrypt 存储），建号 openid=`email_`+sha256前20位，赠10积分；已注册返回 409 `ACCOUNT_EXISTS`；**v19.4** 若邮箱已被微信/手机账号绑定（该行无密码）且未带 `confirmMerge`，返回 409 `MERGE_CONFIRM` + `data.boundNickname`，前端弹窗确认后带 `confirmMerge: true` 重新提交，两账号合一（主账号补设密码+邮箱）
- `POST /api/auth/email-login` `{email, password}`：登录；未注册 404 `ACCOUNT_NOT_FOUND`，密码错 401 `PASSWORD_WRONG`
- `POST /api/auth/email-code-login` `{email, code}`：**v20.0（2026-08-20）**邮箱+验证码登录/注册合一（官网购会员/注销页用，无密码）。校验 `tianji:emailcode:register:*` 验证码；账号不存在自动注册（openid=`email_`+sha256前20位，赠10积分，与注册一致），已存在直接登录（不要求设过密码）；验证码错 400 `CODE_INVALID`，已注销 403 `USER_CANCELLED`；成功返回 `{success, data:{openid, token, isNewUser, quota_remaining, points, plan_type}}`
- `POST /api/auth/email-reset-password` `{email, code, newPassword}`：找回密码；验证 `reset` 用途的验证码后更新密码（bcrypt），成功后自动发送密码重置通知邮件
- `POST /api/auth/email-bind` `{email, code, password, confirmMerge}`（v19.4，需 Authorization）：「我的」页绑定邮箱入口。验证 `bind` 用途验证码后：邮箱未占用 → 直接绑定当前账号并设密码（`bound:true, merged:false`）；邮箱已被**独立邮箱账号**（openid=`email_*`）占用 → 未带 `confirmMerge` 时返回 `bound:false, mergeable:true, mergeSummary:{nickname, planType}`，前端弹窗确认后带 `confirmMerge:true` 重新提交，执行合并（事务迁移 tuiyan_records/vip_orders/信件/匹配/举报/拉黑/卦收集/成就/积分余额等子表数据到主账号，邮箱账号行删除，积分余额+累计+连签天数累加，写入 user_bindings 记录，事务后迁移 Redis extra_vip_decode 并清理旧账号缓存），返回 `bound:true, merged:true`；邮箱被**其他微信/手机账号**占用 → 409 `EMAIL_TAKEN`（不可合并）

三接口返回体与 phone-login 一致：`openid`, `token`, `isNewUser`, `quota_remaining`, `points`, `plan_type`。users 表 `email`(UNIQUE)/`password_hash` 列由 auth.js 启动时幂等迁移自动补齐。

#### GET /api/gua/:id 与 GET /api/relationship/:a/:b（v20 静态英文直读）
- 新增可选 query 参数 `lang`：`en` 时返回英文版数据
- gua：name/full_name/gua_ge/social_tag/wuxing 查静态表 `config/hexagrams-en.js`；renGe/emotionMode/judgment/image 等长文直接读静态文件 `config/hexagrams-en-long.js`（64 卦全量，由 `scripts/gen-en-files.js` 预生成）
- relationship：relationship_name/one_liner/analysis/resonance/conflict/advice/match_level 直接读静态文件 `config/relationship-en.js`（2080 条全量，按 `{min}-{max}` key 与中文版一一对应）；guaA/guaB 卦名查 `hexagrams-en.js` 短字段表
- 不传 lang 走原中文逻辑，零影响
- **v20（2026-08-20）方案B取代 v19.4 懒加载 AI 翻译**：英文数据 100% 预生成静态文件直读，Redis/AI 零依赖、毫秒级响应、永无 502；`src/utils/translator.js` 与预热脚本 `warm-rel-cache.js` 已删除，Redis `tianji:i18n:*` 缓存已清空
- 静态英文文件缺失某 key 时降级返回中文（不报错）
- **部署实测（2026-08-20）**：relationship/gua 中英双语全量比对通过（键一致、字段非空、无 CJK 残留），英文响应毫秒级

#### GET /api/auth/binding-status（绑定状态）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `isBound` | 基准 |
| APP | `isBound` | ✅ |
| 网页 | `isBound` | ✅ |

#### POST /api/auth/bind-phone（绑定手机）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `openid`, `token` | 基准 |
| APP | `openid`, `token` | ✅ |
| 网页 | `openid`, `token` | ✅ |

---

### 2.2 用户档案类接口

#### GET /api/user/profile/:openid（获取用户档案）⭐ 高频接口
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `has_profile`, `quota_remaining`, `plan_type`, `gua_ge`, `vip_decode_remaining`, `gua_ge_name`, `ming_ben_gua`, `wuxing`, `rarity`, `nickname`, `birth_year/month/day/shichen`, `gender`, `symbol` | 基准 |
| 网页 | `has_profile`, `quota_remaining`, `plan_type`, `nickname`, `ming_ben_gua`, `gua_ge_name`, `gua_ge`, `plan_type` | ✅ |
| APP | `has_profile`, `quota_remaining`, `plan_type`, `vip_decode_remaining`, `gua_ge_name`, `gua_ge`, `ming_ben_gua`, `rarity`, `nickname`, `birth_year/month/day/shichen`, `gender`, `symbol` | ✅ |

> 网页端读取字段较少（不读 `vip_decode_remaining`、`birth_*` 等），因为它从 `/api/payment/vip-info` 单独获取 VIP 信息，从 `/api/user/me` 获取详细档案。

#### POST /api/user/profile（创建/更新档案）
| 端 | 请求字段 | 读取返回 | 与小程序一致 |
|----|---------|---------|:-----------:|
| 小程序 | `nickname`, `birth_year/month/day/shichen`, `gender` | `ming_ben_gua` | 基准 |
| 网页 | `nickname`, `birth_year/month/day/shichen`, `gender` | `success`/`message` | ✅ |
| APP | `nickname`, `birth_year/month/day/shichen`, `gender` | `ming_ben_gua` | ✅ |

#### GET /api/user/me（获取当前用户详情）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | N/A（小程序不用此接口） | - |
| 网页 | `nickname`, `birth_year/month/day/shichen`, `gender` | - |
| APP | N/A | - |

> **v19.2 双语**：`/api/user/profile/:openid`、`/api/user/me`、`POST|PATCH /api/user/profile` 支持 `lang` 参数（GET 用 query、POST/PATCH 用 body）——`gua_ge_name`/`full_name`/`gua_ge`/`social_tag`/`wuxing` 英文态查 `hexagrams-en.js`，`rarity` 为百分比数值无需翻译。

#### POST /api/user/profile/:openid/request-delete（注销）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | 仅 `success`/`message` | 基准 |
| 网页 | 仅 `success`/`message` | ✅ |
| APP | 仅 `success`/`message` | ✅ |

---

### 2.3 推演类接口

#### POST /api/tuiyan（普通推演）

**v19.0 双语支持**：请求 body 新增可选字段 `lang`（`'zh'`（默认）| `'en'`）。`lang='en'` 时提示词追加英文输出指令块，返回 JSON 的**字段名不变、字段值全部为英文**（易经术语用 Wilhelm 英译，如 Qian (The Creative)）；中文用户不传或传 `zh` 完全不受影响。
> **v19.4.1（2026-08-19）**：英文输出指令中宜忌词条长度由 ≤8 words 收紧为 **≤5 words**（短动词短语，如 "Sign key contracts"），配合前端宜忌栏版式重构（纵向堆叠+可换行 pill），解决英文词条过长被截断问题。历史长词条记录由前端新样式完整换行显示。

| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `quota_remaining`, `id` | 基准 |
| 网页 | `quota_remaining`, `id` | ✅ |
| APP | `quota_remaining`, `id` | ✅ |

#### GET /api/tuiyan/:recordId（获取推演结果）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `result_data`, `vip_decode_text`, `symbol`, `gua_name`, `gua_ge`, `judgment`, `image`, `question`, `created_at`, `id`, `wuxing`, `sharer_nickname` | 基准 |
| 网页 | `result_data`, `vip_decode_text`, `wuxing`, `zi_chao_biao_qian`, `qimenSnapshot`, `sharer_nickname`, `nickname` | ⚠️ 部分差异 |
| APP | `result_data`, `vip_decode_text`, `symbol`, `gua_name`, `gua_ge`, `judgment`, `image`, `question`, `created_at`, `id`, `wuxing`, `sharer_nickname` | ✅ |

> **网页端差异说明**：网页端不读 `gua_name`/`gua_ge`/`judgment`/`symbol`/`image`/`question`/`created_at`，因为这些信息在网页端通过其他方式获取（如从历史记录列表获取）。`zi_chao_biao_qian` 和 `qimenSnapshot` 是网页端额外读取的字段，用于网页端特有展示。

#### GET /api/tuiyan/shared/:recordId（分享结果页）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | 同 `/api/tuiyan/:recordId` | 基准 |
| 网页 | 同 `/api/tuiyan/:recordId` 网页端 | ✅ |
| APP | 同 `/api/tuiyan/:recordId` | ✅ |

#### POST /api/tuiyan/vip（VIP超级推演）

**v19.0 双语支持**：同普通推演，请求 body 新增可选 `lang` 字段。`lang='en'` 时全文英文输出，7 个段落标题同步英文（Destiny Blueprint / Celestial Timing / Eight Spirits Insight / Star & Gate Synthesis / Situation Analysis / Action Guide / I Ching Wisdom）。

| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `vip_decode_text`, `quota_remaining`, `id`, `gua_name`, `gua_ge`, `symbol`, `question`, `created_at` | 基准 |
| 网页 | `vip_decode_text`, `content`(fallback), `quota` | ✅（有兼容） |
| APP | `vip_decode_text`, `quota_remaining`, `id`, `gua_name`, `gua_ge`, `symbol`, `question`, `created_at` | ✅ |

---

### 2.4 VIP/支付类接口

#### GET /api/payment/vip-info/:openid（VIP信息）⭐ 关键接口
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `plan_type`, `expire_at`, `vipDecodeRemaining`, `quota_remaining` | 基准 |
| 网页 | `plan_type`, `expire_at`, `quota_remaining`, `vipDecodeRemaining` | ✅ |
| APP | `plan_type`, `expire_at`, `vipDecodeRemaining`, `quota_remaining` | ✅ |

> **已统一**：后端两个接口（`/api/user/profile` 和 `/api/payment/vip-info`）都返回 `vipDecodeRemaining`（驼峰）字段。

#### POST /api/payment/create-order（小程序虚拟支付）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `signData`, `paySig`, `signature`, `mode` | 基准 |
| 网页/APP | N/A（不用虚拟支付） | - |

#### POST /api/payment/create-h5-order（H5支付）
> 🔴 App 端**不调用**此接口（原生 App 内不能用 H5 支付）。H5 支付由**官网手机浏览器**（`web/index.html` 易学会员区块）调用。
| 端 | 读取字段 | 说明 |
|----|---------|:-----------:|
| 官网(手机浏览器) | `outTradeNo`, `h5Url`, `testMode` | 手机号登录后选套餐 → 下单 → 跳转 h5Url 调起微信 |
| 网页 | `outTradeNo`, `h5Url`, `testMode` | H5 场景 |
| 小程序 | N/A | 走虚拟支付 |
| APP | N/A | 与小程序支付流程不同，走 APP 支付 |

#### POST /api/payment/create-app-order（APP支付）⭐ App 端唯一支付下单接口
| 端 | 读取字段 | 与后端一致 |
|----|---------|:-----------:|
| 小程序 | N/A | - |
| APP | `outTradeNo`, `payParams{appid,partnerid,prepayid,package,noncestr,timestamp,sign}` | ✅ |
| 网页 | N/A | - |

#### GET /api/payment/check-order/:outTradeNo（查单）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `status` | 基准 |
| 网页 | `status`, `plan_type` | ✅ |
| APP | `status` | ✅ |

#### POST /api/payment/sync-order/:outTradeNo（同步订单）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `status` | 基准 |
| 网页 | `status`, `activated`, `plan_type` | ✅ |
| APP | `status` | ✅ |

---

### 2.5 分享类接口

#### GET /api/share/resolve/:shareId（解析分享码）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `sharerGuaId`, `sharerOpenid`, `sharerNickname` | 基准 |
| 网页 | `type`, `sharerGuaId`, `recordId`, `scene`, `sharerOpenid`, `sharerNickname`, `sharerIsVip` | ✅（扩展） |
| APP | `sharerGuaId`, `sharerOpenid`, `sharerNickname` | ✅ |

> **v3.6 新增 `type='match_result'` 返回字段**（匹配结果分享）：
> `type`, `sharerGuaId`, `sharerGuaSymbol`, `sharerGuaName`, `sharerGuaGe`, `partnerGuaId`, `partnerGuaSymbol`, `partnerGuaName`, `partnerGuaGe`, `sharerNickname`, `relation{relationship_name, one_liner, analysis, resonance[], conflict[], advice, match_level}`
> — 由 `scene` 中的 `guaA:guaB` 解析后从 `config/relationship.js` 静态数据返回，落地页 `match.html` 完整展示匹配结果。

#### POST /api/share/code（生成分享码）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `share_id` | 基准 |
| 网页 | `share_id` / `shareId`(fallback) | ✅ |
| APP | `share_id` | ✅ |

> **v3.6 type 枚举**：`result`（推演结果，scene=记录ID）/ `match_result`（匹配结果，scene=`guaA:guaB`）/ `match`（个人人格，scene 空）/ `gua_match`（历史别名）。

---

### 2.6 卦/易学类接口

#### GET /api/gua/:id（卦详情）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `wuxing`, `guan_jian_ci`, `full_name`, `name`, `gua_ge`, `zi_chao_biao_qian`, `id` | 基准 |
| 网页 | `keywords`, `viewer_gender`, `full_name`, `name`, `gua_ge` | ✅ |
| APP | `guan_jian_ci`, `full_name`, `name`, `gua_ge`, `id` | ✅ |

#### GET /api/gua/list（卦列表）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `wuxing`, `id` | 基准 |
| 网页 | `wuxing` | ✅ |
| APP | 整体使用 | ✅ |

#### GET /api/user/gua-collection/:openid（卦收集）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `collected`(含 `gua_id`), `total` | 基准 |
| 网页 | `collected`(含 `gua_id`), `total` | ✅ |
| APP | `collected`(含 `gua_id`), `total` | ✅ |

#### GET /api/user/gua-collection/count/:openid（收集统计）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `total`, `achievementUnlocked`, `completionOrder` | 基准 |
| 网页 | `total`, `count`, `achievementUnlocked`, `completionOrder` | ✅ |
| APP | `total`, `achievementUnlocked`, `completionOrder` | ✅ |

---

### 2.7 匹配/关系类接口

#### GET /api/relationship/:a/:b（关系详情）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `guaA.symbol/full_name/name/gua_ge`, `guaB.*`, `relationship_name`, `match_level`, `one_liner`, `analysis`, `resonance`, `conflict`, `advice` | 基准 |
| 网页 | 同上 | ✅ |
| APP | 同上 | ✅ |

#### POST /api/match/record（记录匹配）
| 端 | 请求字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `user_a_openid`, `user_b_openid`, `user_a_gua`, `user_b_gua`, `relationship_key`, `relationship_name`, `match_level` | 基准 |
| 网页 | 同上 | ✅ |
| APP | 同上 | ✅ |

#### GET /api/match/history/:openid（匹配历史）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `user_a_openid`, `user_b_openid`, `user_a_gua`, `user_b_gua`, `relationship_key` | 基准 |
| 网页 | 整体使用 | ✅ |
| APP | 同上 | ✅ |

---

### 2.8 信件/社交类接口

#### GET /api/letter/unread-count（未读信件数）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `unreadCount` | 基准 |
| 网页 | `unreadCount` | ✅ |
| APP | `unreadCount` | ✅ |

#### GET /api/letter/match-pool（匹配池）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `candidates`(含 `guaId/guaName/guaGe/personalityDesc/isVip/birthDisplay/birthSolarDisplay`), `remaining`, `isGuest` | 基准 |
| 网页 | 同上 | ✅ |
| APP | 同上 + `introAgreed` | ✅ |

> **v19.2 双语**：`?lang=en` 时三分支（游客/未建档/正式）统一走 `mapCandidate`——卦名/卦格查 `hexagrams-en.js` 静态表，personalityDesc 用 social_tag，五行转英文（Metal/Wood/Water/Fire/Earth），出生显示拼音化干支+英月日+英时辰（如 "Ji-Wei Year, February 6 · Yin Hour (3-5am)"）。

#### POST /api/letter/match（发起匹配）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `id`, `relationshipName`, `matchLevel`, `skipped`, `myIsVip` | 基准 |
| 网页 | `id`, `relationshipName`, `matchLevel`, `skipped` | ✅ |
| APP | `id`, `relationshipName`, `matchLevel`, `skipped`, `myIsVip` | ✅ |

> **v19.2 双语**：body 传 `lang:'en'` 时 `relationshipName`/`matchLevel` 按短语 AI 翻译（Redis 缓存 `tianji:i18n:phrase:*`，失败降级中文）；数据库仍存中文原文。

#### GET /api/letter/friends（好友列表）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `matchId`, `friendOpenid`, `friendNickname`, `friendGua`, `friendGuaName`, `friendGuaGe`, `friendIsVip`, `lastLetter`, `lastLetterTime`, `unreadCount` | 基准 |
| 网页 | 同上 | ✅ |
| APP | 同上 | ✅ |

> **v20 双语**：`?lang=en` 时 `friendGuaName`/`friendGuaGe` 查英文表，`relationshipName` 静态映射查表（同 letter/match，无 AI 调用）。

#### GET /api/letter/thread/:friendOpenid（信件线程）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `friend.nickname/guaName/guaGe/isVip`, `letters`(含 `isMine/content/isRead/id/createdAt`) | 基准 |
| 网页 | 同上 + `lunarDate`, `senderIsVip` | ✅ |
| APP | 同上 + `senderIsVip` | ✅ |

#### POST /api/letter/send（发信）
| 端 | 请求字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `receiverOpenid`, `content` | 基准 |
| 网页 | 同上 | ✅ |
| APP | 同上 | ✅ |

#### POST /api/letter/report（举报）
| 端 | 请求字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `targetOpenid`, `reason`, `letterId?` | 基准 |
| 网页 | 同上 | ✅ |
| APP | 同上 | ✅ |

#### POST /api/letter/block（拉黑）
| 端 | 请求字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `targetOpenid` | 基准 |
| 网页 | 同上 | ✅ |
| APP | 同上 | ✅ |

#### POST /api/letter/mark-read（标记已读）
| 端 | 请求字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `letterId` | 基准 |
| 网页 | 同上 | ✅ |
| APP | 同上 | ✅ |

---

### 2.9 节气类接口

> **v20 双语（2026-08-20）**：三个接口（`/current`、`/advice`、`/all`）均支持 `?lang=en`——L1 通用养生直读 `config/jieqi-health-en.js`，L2 五行规则直读 `config/wuxing-relation-en.js`，L3 卦格×节气建议（1536 条）直读 `config/solar-advice-en.js`，节气五行归属直读 `config/jieqi-wuxing-en.js`；术语映射（五行/脏腑/五味/方位/五色/季节）程序化补齐；英文文件缺失时降级中文。

#### GET /api/solar-term/current（当前节气）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `name`, `generalYi`(含 `food/recipes/activity/emotion`，v17.0 起 `food` 为 8 样食材、`recipes` 为 3 道菜谱) | 基准 |
| 网页 | `name`, `generalYi`(含 `food/recipes/activity/emotion`) | ✅ |
| APP | 整体透传 | ✅ |

#### GET /api/solar-term/advice（养生建议）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `detail.recommendFood/Activity/Emotion`, `relation.correspondingOrgan` | 基准 |
| 网页 | `yi.food/activity/emotion` | ✅ |
| APP | `detail.recommendFood/Activity/Emotion`, `relation.correspondingOrgan` | ✅ |

---

### 2.10 历史记录

#### GET /api/user/history/:openid（推演历史）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `result_data`, `vip_decode_text`, `symbol`, `gua_name`, `gua_ge`, `judgment`, `image`, `question`, `created_at`, `id`, `wuxing`, `sharer_nickname` | 基准 |
| 网页 | 整体使用 | ✅ |
| APP | 同上 | ✅ |

---

### 2.11 积分体系类接口（v17.0 新增）

> 双端通过 Donut 共用一套代码，字段天然一致；以下字段为接口响应层命名（驼峰），DB 层使用下划线（`points`/`total_points`/`checkin_streak` 等）。

#### GET /api/points/balance（积分余额与签到状态）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `points`, `totalPoints`, `todayCheckedIn`, `streak`, `checkinTotal`, `extraVipDecode` | 基准 |
| APP | 同上 | ✅ |

#### POST /api/points/checkin（每日签到）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `points`, `gained`, `streak`, `isStreakBonus`, `bonusPoints`, `bonusVipDecode`, `extraVipDecode` | 基准 |
| APP | 同上 | ✅ |

#### POST /api/points/ad-reward（看视频奖励）
| 端 | 读取字段 | 与小程序一致 |
|----|---------|:-----------:|
| 小程序 | `points`, `gained` | 基准 |
| APP | 同上 | ✅ |

---

### 2.12 App 下载版本接口（v19.14 新增，官网下载链接动态管理）

> 背景：官网首页「下载」板块的 Android APK 链接不再写死，可在管理后台动态替换版本，便于换版本。后端用通用 key-value 表 `app_configs`（`config_key='app_download'`，`config_value` 为 JSON `{url,version,enabled}`）存储；建表见 `migrations/014_app_download_config.sql`。

#### GET /api/app-download（公开，官网首页读取，无需登录）
- 返回：`{ success, data: { url, version, enabled, updated_at } }`
- 表/数据缺失时回退默认：`url=/com.clawbook.tianji-3.1.0.apk, version=3.1.0, enabled=true`

| 端 | 读取字段 | 说明 |
|----|---------|------|
| 官网 `web/index.html` | `url`（下载按钮 href）、`version`（标题旁 vX.Y.Z）、`enabled`（false 时按钮置灰失效） | 公网经 nginx `/tianji/api/app-download` |

#### GET /api/app-download/file（公开，APK 流式下发，无需登录）
- 说明：由管理后台「内容资产 → App下载版本 → 上传 APK」上传的文件落地于服务器 `public/apk-current/tianji.apk`，本接口 `fs.createReadStream` 流式返回该文件；文件名按当前版本号命名 `com.clawbook.tianji-{version}.apk`（`Content-Disposition`）。
- 返回：`200` + `Content-Type: application/vnd.android.package-archive`（`Content-Length`/`Accept-Ranges`）；文件未上传时 `404 {code:'APK_NOT_FOUND'}`。
- 作用：用户在后台上传 APK 时，会把 `app_configs` 的 `url` 自动改为 `/tianji/api/app-download/file`，换版本无需改 nginx。

#### GET /api/admin/app-download（管理后台读取，需 admin token）
- 返回同上；由 `admin.js` 提供，`router.use(verifyAdminToken)` 之后自动鉴权。

#### PUT /api/admin/app-download（管理后台更新，需 admin token）
- Body：`{ url(必填), version, enabled }`
- 用 `INSERT ... ON DUPLICATE KEY UPDATE` 写入 `app_configs`；写审计日志 `logAdminAction(app_download_update)`。
- 前端：管理后台「内容资产 → App下载版本」页（`public/admin/index.html`）。

#### POST /api/admin/app-download/upload（管理后台上传 APK，需 admin token）
- `multipart/form-data`：`file`（`.apk`，上限 500MB）+ `version`（版本号）字段。
- 用 `multer.diskStorage` 流式落盘到 `public/apk-current/tianji.apk`（目录不存在自动创建）；写库（`app_configs`）时把 `url` 改为 `/tianji/api/app-download/file`，`version` 用表单值，`enabled=true`，即刻生效。
- 依赖：服务器 `node_modules` 需安装 `multer`（admin.js 内 try/catch 兜底，未装返回 `MULTER_MISSING`）。nginx `client_max_body_size` 须放至能容纳 APK。
- 客观事实：换版本后**无需登录服务器、无需改 nginx**，仅需在管理后台点「上传并生效」。

| DB 字段 | 说明 |
|---------|------|
| `app_configs.config_key` | `app_download` |
| `app_configs.config_value` | JSON：`{"url":"/com.clawbook.tianji-3.1.0.apk","version":"3.1.0","enabled":true}` |
| `app_configs.updated_at` | 自动更新 |

---

## 三、差异汇总与修复状态

### 已修复的差异

| # | 位置 | 问题 | 修复状态 |
|---|------|------|:-------:|
| 1 | 后端 `user.js` `/api/user/profile` | 返回 `vip_decode_remaining`（下划线），与 `/api/payment/vip-info` 的 `vipDecodeRemaining` 不一致 | ✅ 已统一 |
| 2 | 小程序 `pages/index/index.js:316` | 读 `d.vip_decode_remaining` | ✅ 已改为 `d.vipDecodeRemaining` |
| 3 | 网页端 `loadVipInfo` (L11891) | 读 `vip_decode_remaining`，接口返回 `vipDecodeRemaining` | ✅ 已修复 |
| 4 | 网页端 `loadVip` (L13434) | 有 `vip_decode_remaining` fallback | ✅ 已清理 |
| 5 | 网页端 `toggleCollapse` (L12271) | `this.$set` Vue2 API 在 Vue3 不存在 | ✅ 已修复 |
| 6 | 网页端 `toggleSecretSection` (L13664) | 同上 `this.$set` | ✅ 已修复 |
| 7 | 网页端 `pickShichen` (L12282) | `this.$el.querySelector` 在 Vue3 根组件不是函数 | ✅ 已修复 |
| 8 | 后端 `tuiyan.js` `tryParseJson` | AI返回内容JSON解析失败导致500 | ✅ 已修复 |
| 9 | Nginx `claw-book.conf` | `/favicon.ico` 返回404 | ✅ 已修复 |

### 字段读取差异（历史：网页端已降级为官网）

| # | 接口 | 小程序 | 网页端 | APP端 | 风险 |
|---|------|--------|--------|-------|------|
| 1 | `/api/tuiyan/:id` | 读 `gua_name/gua_ge/judgment/symbol/image/question/created_at` | 不读这些字段 | 读全部（同小程序） | **无** — 网页端通过其他途径获取这些信息 |
| 2 | `/api/share/code` | 读 `share_id` | 读 `share_id`/`shareId`(fallback) | 读 `share_id` | **无** — fallback 不造成问题 |

### 后端命名规范

| 模块 | 命名风格 | 说明 |
|------|---------|------|
| 用户档案类 | 下划线 | `has_profile`, `quota_remaining`, `plan_type` 等 |
| 推演结果类 | 下划线 | `result_data`, `vip_decode_text`, `gua_name` 等 |
| 好友/信件/匹配池/支付/分享/成就/养生类 | 驼峰 | `friendNickname`, `guaId`, `outTradeNo` 等 |
| 积分体系类 | 驼峰（响应层）/ 下划线（DB 层） | `points`/`totalPoints`、`todayCheckedIn`、`streak`、`extraVipDecode` 等 |
| VIP信息 | **已统一为驼峰** | `vipDecodeRemaining` |

---

## 四、结论

**双端 API 字段已对齐（Donut 共用代码，天然一致）。** `vipDecodeRemaining` 字段已在后端统一：

- ✅ 后端 `/api/user/profile` 和 `/api/payment/vip-info` 都返回 `vipDecodeRemaining`
- ✅ 小程序/App 双端共用一套代码，字段读取天然一致
- ✅ 线上验证通过：两个接口返回值完全一致

网页端已降级为官网，不再参与字段对齐；历史对比表中"网页端读取字段较少"的记录已无实际影响。

### 后续建议

1. **命名规范**：新接口统一使用驼峰命名（JS 生态原生风格）
2. **兼容过渡**：`/api/user/profile` 保留的 `vip_decode_remaining` 字段可在确认无外部调用后移除
3. **Code Review**：新增接口时检查是否与已有接口字段命名一致
