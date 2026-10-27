# 天机推演架构文档

> 版本：v3.6 | 更新时间：2026-09-03 | 作者：AI辅助生成
> 本次更新：v3.6 分享系统完整修复（三种分享：推演结果/匹配结果/个人人格；落地页完整内容渲染；6 渠道唤起第三方 App；落地页部署目录勘正）；此前：v3.5 推送通知系统（notifications 表+节气变更 9 点推送+匹配回应/信件提醒）；v3.3 中英双语、iOS Universal Link、微信引导；v19.5 匹配分享改 H5 落地页 + Android 深链唤起

## 一、双端现状概览（小程序/App + 网页官网）

### 1.1 技术栈对比

| 维度 | 微信小程序 | App（Donut） | 网页版（官网） |
|------|-----------|---------------|--------|
| 定位 | 应用（主） | 应用（Donut 编译，与小程序共用一套代码） | 官网展示 + APK 下载入口 |
| 框架 | 微信原生 WXML/WXSS/JS | Donut 多端框架（小程序代码直接编译） | Vue 3 CDN 单文件 |
| 页面数 | 19页（7主包页面+12分包页面） | 19页（同小程序，Donut 编译） | 官网单页（非完整应用） |
| 组件 | 原生组件 + 自定义组件 | 同小程序（Donut 支持） | 内联 HTML 模板 |
| 样式单位 | rpx (750基准) | rpx (Donut 支持) | px (手动0.5倍换算) |
| 构建 | 微信开发者工具 | 微信开发者工具 → 多端应用模式 → 构建 | 无构建（直接部署） |
| 部署 | 微信平台 | APK / 应用商店 | Nginx 静态文件 |

### 1.2 登录方式对比

| 端 | 登录方式 | API 路径 | openid 格式 |
|----|---------|---------|-------------|
| 小程序 | wx.login → jscode2session | POST /api/auth/login | 微信原始 openid |
| App (微信环境) | wx.weixinAppLogin → code2Verifyinfo | POST /api/auth/miniapp-login | 多端应用 user_id（跨端唯一标识） |
| App (非微信环境) | 手机号+验证码 | POST /api/auth/send-code + /api/auth/phone-login | phone_sha256前20位 |
| App (海外/邮箱, v19.1) | 邮箱+密码（注册需邮箱验证码） | POST /api/auth/email-send-code + /email-register + /email-login | email_+sha256前20位 |
| 网页版 (PC) | 微信扫码 OAuth | POST /api/auth/web-wx-login | wx_web_sha256前20位 |
| 网页版 (移动端) | 设备ID | POST /api/auth/device-login | device_id 原值 |

### 1.3 API 复用现状

| 维度 | 小程序 | App | 网页版 |
|------|--------|-----|--------|
| baseURL | https://claw-book.cn/tianji | https://claw-book.cn/tianji | https://claw-book.cn/tianji |
| 认证头 | Authorization: Bearer <JWT> | Authorization: Bearer <JWT> | Authorization: Bearer <JWT> |
| 401处理 | 自动重新登录+重试 | 自动重新登录+重试 | 跳转登录页 |
| API数量 | 38个 | 39个（同小程序+miniapp-login） | 38个（已补齐缺失） |

### 1.4 数据库共享现状

跨端共享同一个 MySQL 数据库 `tianji_tuiyan`，共20张表。

**用户身份识别链路**：
```
小程序 openid ──┐
               ├──→ unionid（微信开放平台）──→ user_bindings ──→ phone_openid（主账号）
网页 wx_web_xxx ─┘                                              ↑
                                                                │
App phone_xxx ──────────────────────────────────────────────────┘
```

---

## 二、用户身份体系打通方案

### 2.1 当前问题

1. **wx_web_openid 死字段**：迁移010添加了字段，但 web-wx-login 未写入（已修复）
2. **device-login 不参与绑定**：设备登录不查 user_bindings 表（已修复）
3. **bind-phone platform 判断不完整**：只支持 wx_web/wx_miniprogram，缺 app_device（已修复）
4. **多端默认创建独立临时账号**：需用户主动绑定手机号才能合并

### 2.2 统一身份模型

```
┌─────────────────────────────────────────────────┐
│              users 表（主档案）                    │
│  openid (主键) │ phone │ unionid │ wx_web_openid │
│  nickname │ plan_type │ quota_remaining │ ...    │
└─────────────────────┬───────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
┌───────▼───────┐ ┌──▼──────────┐ ┌▼──────────────┐
│ user_bindings │ │ tuiyan_records│ │ letters 等    │
│ unified_openid│ │ openid       │ │ openid        │
│ platform      │ │ ...          │ │ ...           │
│ platform_openid│ └──────────────┘ └───────────────┘
│ unionid       │
└───────────────┘
```

### 2.3 跨端身份打通流程

#### 场景A：小程序用户 → 网页版
```
1. 用户在小程序已登录（openid = wx_xxx）
2. 用户在网页版扫码登录 → web-wx-login
3. 后端检查 unionid：
   - 若小程序已绑定开放平台且返回 unionid → 查 user_bindings → 自动关联
   - 若无 unionid → 创建 wx_web_xxx 临时账号（独立）
4. 用户在网页版绑定手机号 → bind-phone
5. 后端将 wx_web_xxx 合并到 phone_xxx 主账号
6. 小程序端下次登录时查 user_bindings → 返回 phone_xxx
7. 跨端数据自动合并
```

#### 场景B：App用户 → 网页版
```
1. 用户在App用手机号登录（openid = phone_xxx）
2. 用户在网页版扫码登录 → web-wx-login → wx_web_xxx 临时账号
3. 用户在网页版绑定手机号 → bind-phone
4. 后端检测 phone_xxx 已存在 → 合并数据 → 删除 wx_web_xxx 临时账号
5. 跨端共享同一 phone_xxx 账号
```

#### 场景C：设备登录用户 → 绑定手机号
```
1. 用户在网页版移动端设备登录（openid = device_id）
2. 用户绑定手机号 → bind-phone
3. 后端将 device_id 合并到 phone_xxx
4. 在 user_bindings 记录 (phone_xxx, app_device, device_id)
5. 下次设备登录时查 user_bindings → 返回 phone_xxx
```

#### 场景D：邮箱账号 ↔ 微信账号合并（v19.4，2026-08-19）
```
路径1（「我的」页绑定邮箱，主动合并）：
1. 用户以微信账号登录（openid = oXxx / 多端 user_id）
2. 「我的」页 → 绑定邮箱 → 输入邮箱+验证码(purpose=bind)+密码 → POST /api/auth/email-bind
3. 邮箱未占用 → 主账号直接获得 email + password_hash（bound:true, merged:false）
4. 邮箱已有独立邮箱账号（openid = email_xxx）→ 返回 mergeable:true + mergeSummary
   → 前端弹窗确认 → confirmMerge:true 重新提交 → 事务执行 mergeEmailAccountInto：
   - 子表数据迁移（tuiyan_records/vip_orders/卦收集/成就/匹配/信件/举报/拉黑/事件/积分流水）
   - 积分余额/累计/连签天数累加到主账号，邮箱账号行删除
   - 主账号获得 email + password_hash（沿用邮箱账号原密码）
   - user_bindings 记录 (主openid, email, email_xxx)（旧邮箱 token 解析到主账号）
   - 事务后 Redis 迁移 extra_vip_decode、清理旧账号 vip_decode/session_key/ban 缓存
5. 之后邮箱+密码登录与微信登录进入同一账号

路径2（注册时发现邮箱已被微信账号绑定）：
1. 用户在登录页用邮箱注册 → email-register
2. 该邮箱行已存在且无密码（微信账号曾绑定过）→ 409 MERGE_CONFIRM + boundNickname
3. 前端弹窗确认 → confirmMerge:true 重新提交 → 微信账号补设邮箱+密码，两号合一
```

### 2.4 待完成项

- [ ] 微信开放平台申请（获取 UnionID 能力，AppID: WX_WEB_APPID）
- [ ] App 端打包测试（验证 Donut 条件编译在真机上的表现）
- [ ] 跨端账号合并端到端测试

---

## 三、API 统一设计

### 3.1 API 分类

| 分类 | API 数量 | 说明 | 跨端共用 |
|------|---------|------|---------|
| 认证 | 9 | login/wx-login/miniapp-login/phone-login/web-wx-login/device-login/send-code/binding-status/bind-phone | 各端不同入口，共用后端 |
| 用户 | 7 | profile(GET/POST/PATCH)/me/history/request-delete/cancel-delete | ✅ 共用 |
| 推演 | 4 | tuiyan(普通)/tuiyan/vip(超级)/tuiyan/shared/:id/tuiyan/:id | ✅ 共用 |
| 卦象 | 2 | gua/list/gua/:id | ✅ 共用 |
| 收集 | 3 | gua-collection/list/count/gua-collection(POST记录) | ✅ 共用 |
| 支付 | 7 | vip-info/quota/create-order/create-h5-order/create-app-order/check-order/sync-order | 小程序/App用create-order，网页用create-h5-order |
| 匹配 | 3 | match/record/match/history/match/:id | ✅ 共用 |
| 信件 | 9 | letter/match-pool/letter/match/letter/send/letter/friends/letter/thread/letter/report/letter/block/letter/unread-count/letter/mark-read | ✅ 共用 |
| 分享 | 2 | share/code/share/resolve | ✅ 共用 |
| 节气 | 2 | solar-term/current/solar-term/advice | ✅ 共用 |
| 关系 | 1 | relationship/:a/:b（+relationship/lazy） | ✅ 共用 |

### 3.2 端独有 API

| API | 端 | 说明 |
|-----|---|------|
| POST /api/auth/login | 小程序/App(微信) | 微信 jscode2session |
| POST /api/auth/phone-login | App(非微信) | 手机号+验证码登录 |
| POST /api/auth/web-wx-login | 网页版(PC) | 微信扫码 OAuth |
| POST /api/auth/device-login | 网页版(移动端) | 设备ID登录 |
| POST /api/payment/create-order | 小程序/App | 微信小程序支付 |
| POST /api/payment/create-h5-order | 网页版 | 微信H5支付 |

### 3.3 统一请求头

```http
Content-Type: application/json
Authorization: Bearer <JWT token>
x-api-version: 2
```

### 3.4 统一响应格式

```json
{
  "success": true/false,
  "data": { ... },
  "code": "ERROR_CODE",
  "message": "用户可读的中文提示"
}
```

### 3.5 统一错误码

| 错误码 | 说明 | 跨端一致 |
|--------|------|---------|
| INVALID_PARAM | 参数有误 | ✅ |
| USER_NOT_FOUND | 用户不存在 | ✅ |
| QUOTA_EXCEEDED | 次数用完 | ✅ |
| AI_TIMEOUT | AI超时 | ✅ |
| RATE_LIMITED | 限流 | ✅ |
| WX_LOGIN_FAILED | 微信登录失败 | ✅ |
| AUTH_TOKEN_EXPIRED | Token过期 | ✅ |
| ... | ... | ✅ |

---

## 四、数据库共享策略

### 4.1 数据表分类

| 分类 | 表名 | 说明 |
|------|------|------|
| 用户 | users, user_bindings, subscriptions | 用户主档案、跨端绑定、会员订阅 |
| 推演 | tuiyan_records | 推演记录（含普通+超级） |
| 卦象 | hexagrams, user_gua_collection, user_achievements | 64卦基础数据、收集记录、成就 |
| 匹配 | match_records | 易缘匹配记录 |
| 信件 | letters, letter_reports, letter_blocks | 信件、举报、屏蔽 |
| 支付 | vip_orders | VIP订单 |
| 分享 | share_codes | 分享短码 |
| 节气 | solar_term_basic, solar_term_health_advice | 节气通用养生、卦格专属建议 |
| 管理 | admins, admin_logs | 管理员账号、操作日志 |
| 系统 | events, pending_deletions | 埋点事件、待删除数据 |

### 4.2 数据隔离策略

**不隔离**。跨端共享同一份数据，通过 openid 关联：
- 同一个 openid 在数据库中就是同一份数据
- 跨端对同一 openid 的读写完全共享
- 推演记录、卦卡收集、匹配记录、信件等全部共享

### 4.3 数据合并策略

用户绑定手机号时，后端事务执行：
1. 将临时账号 openid 改名为 phone_openid
2. 更新所有子表的 openid 字段
3. 如果 phone_openid 已存在，合并数据（保留主账号数据，删除临时账号）
4. 在 user_bindings 表记录绑定关系

涉及更新的子表：
- tuiyan_records
- subscriptions
- vip_orders
- user_gua_collection
- user_achievements
- match_records
- letters
- letter_reports
- letter_blocks
- events
- share_codes

---

## 五、页面 UI 对齐方案

### 5.1 页面清单（19页）

| # | 页面 | 小程序路径 | App路径 | 网页版 currentPage |
|---|------|-----------|---------|-------------------|
| 1 | 首页 | pages/index/index | pages/index/index | home |
| 2 | 我的 | pages/my/index | pages/my/index | my |
| 3 | 推演结果 | pages/result/index | pages/result/index | result |
| 4 | 建档 | pages/profile/index | pages/profile/index | profile |
| 5 | 关于 | pages/about/about | pages/about/about | about |
| 6 | 登录 | pages/login/login | pages/login/login | login |
| 7 | WebView | pages/webview/index | pages/webview/index | webview |
| 8 | 学习库 | sub/learn/learn/index | sub/learn/learn/index | learn |
| 9 | 卦详情 | sub/learn/native-gua/index | sub/learn/native-gua/index | native-gua |
| 10 | 成就 | sub/learn/achievement/index | sub/learn/achievement/index | achievement |
| 11 | 编辑档案 | sub/profile/edit-profile/index | sub/profile/edit-profile/index | edit-profile |
| 12 | VIP会员 | sub/vip/vip/index | sub/vip/vip/index | vip |
| 13 | 匹配引言 | sub/match/match/index | sub/match/match/index | match-intro |
| 14 | 匹配池 | sub/match/match-pool/index | sub/match/match-pool/index | match-pool |
| 15 | 我的好友 | sub/match/my-matches/index | sub/match/my-matches/index | my-matches |
| 16 | 写信 | sub/match/letter-write/index | sub/match/letter-write/index | letter-write |
| 17 | 信件列表 | sub/match/letter-thread/index | sub/match/letter-thread/index | letter-thread |
| 18 | 用户协议 | sub/legal/agreement/index | sub/legal/agreement/index | agreement |
| 19 | 隐私政策 | sub/legal/privacy/index | sub/legal/privacy/index | privacy |

> **注**：`sub/vip/vip/secret/index`（超级推演页）已于 v15.13 删除，功能合并至首页。

### 5.2 平台差异处理策略

| 差异类型 | 处理方式 |
|---------|---------|
| scroll-view vs div | 网页版用 overflow:auto + -webkit-overflow-scrolling:touch |
| rpx vs px | 网页版手动0.5倍换算（1rpx = 0.5px） |
| open-type="share" vs JS | 小程序用原生分享，网页版用 /api/share/code + clipboard |
| picker vs input[type=date] | 小程序用picker，网页版用原生HTML控件 |
| wx:if vs v-if | 语法等价，语义一致 |
| bindtap vs @click | 语法等价，语义一致 |
| catchtap vs @click.stop | 语法等价，语义一致 |

### 5.3 网页版 UI 差异修复记录（2026-08-01 完成）

#### ✅ 已完成修复（18个页面全部对齐）

**首页（home）**
- [x] `.index-content` bottom: 146px → 90px（对齐小程序 180rpx）
- [x] `.jade-device-wrap` bottom: 76px → 20px（对齐小程序 40rpx）
- [x] `.question-input:focus` box-shadow: 3px → 4px
- [x] `.jade-mark` box-shadow: 2px → 1.5px
- [x] `.panel-front` inset: 1px → 0.5px，颜色改用 var(--gold-pure)
- [x] `.panel-sub-text` letter-spacing: 1px → 0.5px
- [x] `.panel-back-available` inset: 1px → 0.5px
- [x] `.jade-ring-inner` inset: 1px 1px → 0.5px 0.5px
- [x] `.jade-ring-center` inset: -1px 1px → -0.5px 0.5px，背景改用 var(--gold-pure)
- [x] `.question-input` 添加 line-height: 44px
- [x] `.action-section` 添加 margin-top: 0

**推演结果页（result）**
- [x] `.result-content` padding: 16px 24px → 16px 16px
- [x] `.shared-notice` 背景改为渐变，移除边框圆角
- [x] `.poem-hero` padding-top: 32px → 40px，动画时长 0.8s → 1.2s，添加 overflow:hidden
- [x] `.zichao-sticker` 移除 border/background/transform:rotate(-2deg)
- [x] `.collapse-body-inner` padding: 0 8px 20px → 16px 0
- [x] `.yi-title/.ji-title` 移除 text-align:center，margin-bottom: 12px → 8px
- [x] `.yi-item` 颜色改为 var(--gold-pure)，border-radius: 4px → 0
- [x] `.result-title` 添加 text-align: center
- [x] 分享按钮/折叠箭头 Unicode → icon-guo 组件

**超级推演页（secret）**
- [x] `.secret-page-wrap` 背景改为 var(--bg-base) 纯色
- [x] `.secret-banner` 改为透明背景+上下金线，文字改为斜体次要色
- [x] `.secret-input-box` 改为透明背景+仅下边框
- [x] `.secret-submit-btn` 改为纯色 var(--gold-pure)，border-radius: 0
- [x] `.secret-flame-particles` 尺寸 0→100px×150px，颜色改为金色渐变
- [x] `@keyframes secretFlameRise` 时长 2s→3s，补 60% 关键帧
- [x] `.secret-var-item span::after` 补光晕拖尾效果
- [x] `.secret-furnace-char` 补 box-shadow
- [x] `.secret-user-nickname` 改为透明背景+上下双横线
- [x] `.secret-question-display` padding/align-items/gap 对齐小程序
- [x] `.secret-action-btn` border-radius: 0
- [x] `.secret-action-back` 改用 var(--bg-muted)/var(--border-subtle)
- [x] `.secret-retry-btn` 改为纯色+直角
- [x] `.secret-result` 添加 scroll-unroll 类

**VIP页（vip）**
- [x] `.vip-page-wrap` 添加 theme-ink 类
- [x] `.vip-page-header` 动态绑定 vip-page-header-active 类
- [x] `.vip-page-header-active::before` 移除 border-radius: 50%
- [x] `.vip-page-header-active::after` top: 0 → 12px
- [x] 新增 `.vip-page-manage-btn` 续费按钮样式
- [x] `.vip-page-buy-btn` color 改用 var(--bg-ink)
- [x] `.vip-page-scroll-rod` 端点位置 8% → 8px

**匹配结果页（match-share）**
- [x] `.ms-paper-card` 背景 #FFF8F3 → #F5EBD8，border-radius: 8px → 4px，阴影色改深褐
- [x] `.ms-content` padding: 32px 20px 24px → 28px 24px
- [x] 装饰图标尺寸/颜色差异化（千纸鹤/莲花/桃心/月亮各有不同）
- [x] 添加朱砂印章装饰（paper-seal）
- [x] 共鸣点/冲突点补前缀图标（check/conflict-dot）
- [x] 底部分享/写信按钮补 icon-guo 图标

**我的好友页（my-matches）**
- [x] `.mm-header` padding: 20px 20px 12px → 32px 24px 16px
- [x] `.mm-header-title-main` font-size: 22px → 28px，letter-spacing: 4px → 6px
- [x] `.mm-count-badge` border 颜色改淡，padding: 4px → 3px
- [x] `.mm-friend-list` 补固定高度+overflow-y:auto，padding: 8px 16px → 0 24px
- [x] `.mm-friend-card` border-bottom 颜色改淡，padding: 24px 8px → 24px 0，动画改 cardSlideIn
- [x] `.mm-friend-info` 补 margin-left: 14px，gap: 7px
- [x] `.mm-friend-name` font-size: 15px → 16px，补 max-width: 120px
- [x] `.mm-gua-badge` border 颜色改淡，font-size: 10px → 11px
- [x] `.mm-unread-dot` 尺寸 18px → 16px
- [x] `.mm-write-icon-text` letter-spacing: 6px → 4px
- [x] `.mm-write-icon-line` height: 1px → 0.5px

**写信页/收信页（letter-write/letter-thread）**
- [x] `.letter-send-btn-text` letter-spacing: 12px → 8px
- [x] `.letter-paper-body` 字体楷体→宋体，font-size: 16px → 15px，line-height: 40px → 2
- [x] `.letter-paper-signoff` 改为 flex-column 布局
- [x] `.letter-paper-sender-name` 字体改宋体

**知识库页（learn）**
- [x] `.learn-tab-item.active` 移除 font-weight: 700，border: 2px → 1.5px

**专属人格页（native-gua）**
- [x] `.native-gua-name` font-weight: 700 → 800，补 letter-spacing: 4px
- [x] `.native-gua-ge-tag` 补 letter-spacing: 2px

**成就页（achievement）**
- [x] `.ach-title-main` font-size: 28px → 26px，letter-spacing: 8px → 4px
- [x] `.ach-badge` 去卡片化（移除 background/border/box-shadow）
- [x] `.ach-badge-title` font-size: 12px → 11px，color 改 text-secondary
- [x] `.ach-badge-name` font-size: 28px → 26px，补 letter-spacing: 6px
- [x] `.ach-badge-order` font-size: 13px → 11px，color 改 accent-gold-hover
- [x] `.ach-btn-row` 改为 flex-direction: column，gap: 12px → 10px
- [x] `.ach-btn-row .btn` border-radius: 12px → 22px，font-size: 14px → 15px

**法律页（agreement/privacy）**
- [x] `.legal-title` font-size: 20px → 24px，补 font-weight/text-shadow/text-indent
- [x] `.legal-title::after` 补标题下金线
- [x] `.legal-update-date` margin-top: 4px → 8px，补 text-align/letter-spacing
- [x] `.legal-section` margin-bottom: 20px → 16px，border-left: 1px → 0.5px，padding 补全
- [x] `.legal-h` font-size: 15px → 16px，letter-spacing: 2px → 3px
- [x] `.legal-t` font-size: 14px → 13px，移除 text-align: justify

**登录页（login）**
- [x] `.login-logo` margin-bottom: 12px → 20px
- [x] `.login-title` 补 text-indent: 8px，text-shadow: 12px → 16px
- [x] `.login-subtitle` font-size: 13px → 12px，letter-spacing: 2px → 3px，移除 margin-bottom

**建档页（profile）**
- [x] `.form-section` padding-bottom: 0 → 80px

**修改档案页（edit-profile）**
- [x] `.edit-profile-submit-btn` font-size: 16px → 15px

**桌面端适配**
- [x] `.legal-page` 加入 @media(768px) 居中限宽列表
- [x] `.secret-page-wrap` 加入 @media(768px) 居中限宽列表
- [x] `.login-page` 加入 @media(768px) 居中限宽列表

#### 后端修复（2026-08-01）
- [x] `server.js` 添加 `Content-Type: text/html; charset=utf-8` 响应头（修复中文乱码）
- [x] `index.html` 修复 `createApp` 未赋值给 `app` 变量（修复 Vue 挂载失败）

#### 官网首页 Hero 重构（2026-08-05）
- [x] 移除聚光灯效果（`::before`/`::after` 伪元素）
- [x] 太极图尺寸放大（桌面 1200px/70vh，移动端 760px/80vh）
- [x] 太极图居中屏幕（`margin-top: calc(50vh - 图高/2)`）
- [x] 标题「天僟推演」显示在图下方
- [x] 页脚年份 2025 → 2026
- [x] 协议页/隐私页年份 2025年1月 → 2026年8月
- [x] nginx 缓存头改为 no-store（杜绝旧版缓存）
- [x] 新增 `taiji-logo-hero.png` 静态路由

#### 小程序路由工具函数（2026-08-05）
- [x] 新增 `utils/router.js` - `safeNavigateBack()` 函数
- [x] 修复 `navigateBack with an invalid tabbar page` 报错（8 个文件）
- [x] 修复 `Converting circular structure to JSON` 报错（1 个文件）

#### 匹配池随机逻辑修复（2026-08-05）
- [x] 修复 `letter.js` match-pool 接口随机逻辑（3 处）
- [x] 原问题：`LIMIT 10 OFFSET ${随机数}` 返回连续记录，导致名字风格聚集
- [x] 修复方案：应用层随机打散（`sort(() => Math.random() - 0.5)`）+ `WHERE openid IN (...)`
- [x] 涉及模式：游客模式、未建档模式、已建档模式

#### v10.3 基础设施优化（2026-08-05）
**P0 安全/稳定性：**
- [x] `admin.js` 移除 JWT_SECRET 和 token 日志泄露（第 19-20 行）
- [x] `db.js` connectionLimit 50→15，添加 idleTimeout 60s，修复 getStats 硬编码
- [x] nginx proxy_read_timeout 240s→310s（防止 VIP 推演被断开）
- [x] nginx 添加 gzip 压缩、keepalive、安全头（X-Content-Type-Options 等）
- [x] 移除 `_find_nginx.py`（含服务器密码）和 `mysql-backup.sh`（含 MySQL root 密码）
- [x] 添加 `.gitignore` 防止敏感文件提交

**P1 性能/可靠性：**
- [x] 新建 `redis-client.js` 统一 Redis 客户端单例（4 个独立 client → 1 个共享）
- [x] Redis 添加 connectTimeout 5s、reconnectStrategy、disableOfflineQueue
- [x] `cache.js` 永久降级改为 60 秒定时恢复
- [x] `store.js` 移除阻塞式等待循环，改用统一客户端
- [x] `wechat.js` 移除独立 Redis client，改用统一客户端
- [x] PM2 max_memory_restart 500M→800M，添加日志输出路径
- [x] 推演接口用户级限流（5 次/分钟），匹配/信件接口（10 次/分钟）

**P2 优化：**
- [x] 新建 `request-id.js` 请求追踪中间件，日志携带 Request ID
- [x] 创建 `add_composite_indexes.sql`（vip_orders/match_records/admin_logs 复合索引）
- [x] JWT 有效期 7d→3d
- [x] `.env.example` 补充 REDIS_URL/REDIS_PASSWORD/ADMIN_USERNAME/VIP_DECODE 等缺失配置

---

### 5.4 平台差异处理策略

---

## 六、支付体系打通

### 6.1 跨端支付方式

| 端 | 支付方式 | API | 回调方式 |
|----|---------|-----|---------|
| 小程序 | 微信小程序支付 | POST /api/payment/create-order | 微信支付回调 |
| App | 微信App支付 / 支付宝 | POST /api/payment/create-order | 微信支付回调 |
| 网页版 | 微信H5支付 | POST /api/payment/create-h5-order | URL带回out_trade_no |

### 6.2 订单状态同步

```
用户支付 → 微信支付回调 → 后端更新 vip_orders 状态 → 激活VIP
                                    ↓
                            若回调失败：
                            网页版 mounted 检查 URL 中的 out_trade_no
                            → POST /api/payment/sync-order/:outTradeNo
                            → 后端查微信侧状态 → 补发货
```

### 6.3 VIP权益共享

VIP状态存储在 `users.plan_type` 和 `subscriptions` 表，跨端共享：
- 任何一端开通VIP → 数据库更新 → 跨端均可见
- VIP过期自动降级 → 跨端同步

---

## 七、分享体系打通

### 7.1 分享流程（v3.6 三种分享）

| 分享类型 | 端 | 生成分享 | 打开分享 |
|---------|----|---------|---------|
| 推演结果（`result`） | App | `/api/share/code`（`type=result`，scene=记录ID）→ `result.html?sid=&rid=` | 落地页完整展示分享者推演记录；`tianji://result?sid=&rid=` 唤起 App 展示只读结果页 |
| 匹配结果（`match_result`） | App | `/api/share/code`（`type=match_result`，scene=`guaA:guaB`）→ `match.html?sid=` | 落地页完整展示双方匹配结果（静态关系数据）；`tianji://match?sid=` 唤起 App 展示该份匹配结果 |
| 个人人格（`match`） | App | `/api/share/code`（`type=match`，scene 空）→ `match.html?sid=` | 落地页展示分享者人格并引导匹配；唤起 App 用接收者自己卦进入双方匹配 |
| 小程序 | 小程序 | `open-type="share"` → 微信转发卡片 | 点击卡片 → `/api/share/resolve` → 推演结果页 |

### 7.1.1 小程序/App 环境区分（isMpWeixin）

小程序代码中通过 `getApp().globalData.isMpWeixin` 判断当前运行环境：
- **微信小程序环境**：`isMpWeixin = true`，使用 `open-type="share"` 原生分享按钮
- **App 环境**：`isMpWeixin = false`，使用 `bindtap="onShareTap"` + `shareUtil.shareWebPageMessage()` JS 调用

涉及页面：
- `pages/result/index.wxml/js` - 推演结果页
- `sub/match/match/index.wxml/js` - 匹配结果页
- `sub/learn/native-gua/index.wxml/js` - 个人人格页
- `components/jieqi-bar/jieqi-bar.wxml/js` - 节气分享按钮

实现方式：WXML 中使用 `wx:if="{{isMpWeixin}}"` 条件渲染，分别渲染 `open-type="share"` 和 `bindtap="onShareTap"` 两个按钮。

### 7.2 分享链接格式

```
推演结果：https://claw-book.cn/tianji/web/result.html?sid={shareId}&rid={recordId}
匹配结果：https://claw-book.cn/tianji/web/match.html?sid={shareId}   （scene 内嵌 guaA:guaB）
个人人格：https://claw-book.cn/tianji/web/match.html?sid={shareId}
唤起 scheme：tianji://result?sid=&rid=   /   tianji://match?sid=
```

> 🔴 **落地页部署目录（2026-09-03 勘正）**：必须部署到后端 Express 实际 webPath `/home/admin/.openclaw/workspace/projects/web/`（server.js `webPath = path.join(__dirname, '..', 'web')`）。误传 `projects/tianji-tuiyan/web/` 会导致 `/tianji/web/` 兜底返回官网首页。

### 7.3 分享码生命周期

- 生成：POST /api/share/code（需认证）→ 返回 `{ share_id, expires_at }`
- 解析：GET /api/share/resolve/:shareId（公开）→ 按 type 返回推演记录 / 完整匹配结果 / 分享者卦象
- 过期：expires_at 字段控制（默认 30 天）
- 限制：use_count / use_limit 控制使用次数（默认 100 次）
- 短码：12 位随机数（10^12 熵），防暴力枚举

### 7.4 App 分享 H5 落地页 + 深链唤起（v19.5 起，v3.6 补三种分享完整内容）

- **分享**：App 各分享入口用 Donut API `shareWebPageMessage` 分享 H5 落地页（`result.html?sid=` / `match.html?sid=`），替代小程序卡片。
- **H5 落地页**（`web/result.html` / `web/match.html`）：公开调用 `/api/share/resolve` 取数并按 `data.type` 完整渲染——`result` 展示完整推演记录（只读）、`match_result` 展示完整匹配结果（双卦+关系名+等级+分析/共鸣/冲突/建议，折叠区默认展开）、`match` 展示分享者人格+引导匹配。「打开 App」用 scheme `tianji://result|match?sid=` 唤起 App，「下载 App」跳官网 APK。
- **App 深链**：`app.js` `_registerDeepLink()` 注册 `wx.miniapp.registOpenURL` 监听 scheme/Universal Link，`handleScene()` 做 `sid` 冷启动兜底；`resolveMatchShare()` 按 resolve 返回的 `type` 分流——`match_result` 用 scene 里的双方卦象直接展示该份匹配结果，`match` 用接收者自己卦实时匹配，`result` 展示只读推演结果页。
- **Android 配置**：`project.miniapp.json` → `mini-android.schemes.scheme = "tianji"`，需重新构建 APK 生效。
- **6 渠道唤起第三方 App**：微信（`shareWebPageMessage` 预填文字+链接）、WhatsApp（`whatsapp://send?text=`）、Facebook（`fb://share/?link=`）、Messenger（`fb-messenger://share?link=`）、X（`twitter://post?message=`）、Telegram（`tg://msg_url?url=&text=`）；微信开放平台第三方 App 已配置各渠道 URL Scheme 白名单（构建时写入 AndroidManifest）。
- **链路依赖**：`share_codes`（短码）+ `config/relationship.js`（静态匹配关系数据，`/api/relationship/:guaA/:guaB` 实时返回）+ 落地页（静态渲染）。

---

## 八、部署架构

### 8.1 服务器架构

```
                    ┌─────────────────┐
                    │  claw-book.cn   │
                    │  (Nginx 443)    │
                    └───────┬─────────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
    ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
    │ /            │  │ /tianji/    │  │ /api/       │
    │ 网页版静态    │  │ 小程序H5    │  │ 后端API     │
    │ (3003/web)  │  │ (静态文件)  │  │ (3003)     │
    └─────────────┘  └─────────────┘  └─────────────┘
                                           │
                                    ┌──────▼──────┐
                                    │ MySQL       │
                                    │ tianji_tuiyan│
                                    └─────────────┘
```

### 8.2 Nginx 路由

| 路径 | 代理目标 | 说明 |
|------|---------|------|
| / | http://127.0.0.1:3003/web/ | 网页版首页 |
| /tianji/api/ | http://127.0.0.1:3003/api/ | 天机推演API |
| /tianji/web/ | http://127.0.0.1:3003/web/ | 网页版（兼容旧路径） |
| /tianji/admin/ | http://127.0.0.1:3003/admin/ | 管理后台 |
| /tianji-media/ | 静态文件 | 媒体资源 |
| /api/ | http://127.0.0.1:3002/api/ | 楚门陪伴API |

### 8.3 PM2 进程管理

```bash
pm2 start ecosystem.config.js --only tianji-tuiyan-api
# cluster模式，4实例
```

---

## 九、待解决问题清单

### 9.1 已完成 ✅

- [x] API路径对齐（超级推演/修改档案/删除用户）
- [x] x-api-version 头补齐
- [x] 9个缺失API调用补齐
- [x] wx_web_openid 死字段修复
- [x] device-login 参与绑定体系
- [x] bind-phone platform 判断完善
- [x] 屏幕适配768px断点覆盖所有页面
- [x] 80rpx残留修复
- [x] 罗盘响应式
- [x] PC端固定元素居中
- [x] tap-highlight-color 补齐
- [x] **18个页面UI差异全部修复**（2026-08-01）
- [x] **后端中文编码修复**（2026-08-01）
- [x] **Vue挂载失败修复**（2026-08-01）

### 9.2 待修复 🔲

#### UI缺失补齐（功能增强）
- [ ] letter-write/letter-thread 底部3-tab导航
- [ ] 信纸背景图（match结果/letter-write/letter-thread）
- [ ] letter-thread 农历日期显示
- [ ] letter-thread 导航副标题卦名+卦格
- [ ] letter-thread 信纸落款vip标识
- [ ] match-pool/my-matches 头像内联渐变色
- [ ] 首页等待视频+3态动画
- [ ] "我的"页易缘匹配入口+未读徽标
- [ ] "我的"页称号展示区
- [ ] learn页欢迎弹窗
- [ ] secret页24变量飞入动画

#### 文案对齐
- [ ] about页卦象结构+产品简介
- [ ] achievement描述文案
- [ ] agreement/privacy条文
- [ ] 各页面按钮文字

#### 长期
- [ ] 微信开放平台申请（UnionID能力）
- [ ] App端打包发布
- [ ] share_codes 表schema对齐

---

## 十、关键文件索引

### 10.1 后端
- 入口：`_backend_src/server.js`
- 路由：`_backend_src/src/routes/`（auth/user/tuiyan/payment/match/letter/share/collection/solar-term/relationship/gua/event/admin）
- 中间件：`_backend_src/src/middleware/`（db/auth）
- 迁移：`_backend_src/migrations/`（004-010）
- Schema：`_backend_src/db/schema.sql`

### 10.2 小程序
- 入口：`tianji-tuiyan-miniprogram-v10/app.js`
- 页面：`tianji-tuiyan-miniprogram-v10/pages/` + `sub/`
- 组件：`tianji-tuiyan-miniprogram-v10/components/`
- 工具：`tianji-tuiyan-miniprogram-v10/utils/api.js`

### 10.3 App（Donut 多端框架）
- 入口：`tianji-tuiyan-miniprogram-v10/app.js`（与小程序共用）
- 页面：`tianji-tuiyan-miniprogram-v10/pages/` + `sub/`（与小程序共用）
- 组件：`tianji-tuiyan-miniprogram-v10/components/`（与小程序共用）
- 工具：`tianji-tuiyan-miniprogram-v10/utils/api.js`（与小程序共用）
- 多端配置：`tianji-tuiyan-miniprogram-v10/project.miniapp.json`

> **注**：App 通过 Donut 多端框架从小程序代码直接编译，不维护独立代码库。旧的独立 App 项目 `app/tianji-tuiyan-app-ready/` 已废弃。

### 10.4 网页版
- 单文件：`web/index.html`（CSS + HTML + JS 全部内联）
- 部署脚本：`deploy_web_v2.py`（前端部署）
- 后端入口：`_backend_src/server.js`
- 后端部署：`deploy_server.py`

### 10.5 服务器
- 项目目录：`/home/admin/.openclaw/workspace/projects/tianji-tuiyan/`
- 网页版目录：`/home/admin/.openclaw/workspace/projects/web/`
- Nginx配置：`/etc/nginx/conf.d/claw-book.conf`
- PM2进程：`tianji-tuiyan-api`（cluster 4实例）

---

## 十一、2026-08-01 更新日志

> 说明：本章为 2026-08-01 的历史记录，其中"三端同步/三端对齐"的表述已于 2026-08-14 废弃（网页端降级为官网，小程序与 App 改为 Donut 双端同步）。历史内容保留原样，仅作追溯。

### 修复内容

本次更新完成了小程序与网页版18个页面的UI差异修复，实现视觉对齐。

#### 首页（home）
- 修复 `.index-content` 底部定位偏移（146px → 90px）
- 修复 `.jade-device-wrap` 底部定位偏移（76px → 20px）
- 修复输入框聚焦光晕扩散半径（3px → 4px）
- 修复玉璧四象刻度光晕（2px → 1.5px）
- 修复推演按钮 inset 阴影亚像素偏差（1px → 0.5px）
- 修复副标题字间距（1px → 0.5px）
- 修复玉璧内环/中心点 inset 阴影亚像素偏差
- 统一使用 CSS 变量替代硬编码颜色值

#### 推演结果页（result）
- 修复内容区 padding（24px → 16px）
- 修复共享通知背景为渐变，移除边框圆角
- 修复诗卷展开动画时长（0.8s → 1.2s）和 padding-top（32px → 40px）
- 修复自嘲标签贴纸样式（移除多余边框/背景/旋转）
- 修复折叠区内容 padding（0 8px 20px → 16px 0）
- 修复宜忌标题对齐和间距
- 修复宜项颜色为金色，移除圆角
- 修复结果标题居中
- 替换分享按钮/折叠箭头为 icon-guo 组件

#### 超级推演页（secret）
- 修复页面背景为纯色
- 修复合规提示为透明背景+上下金线，文字改为斜体
- 修复输入框为透明背景+仅下边框
- 修复提交按钮为纯色+直角
- 修复火焰粒子容器尺寸（0 → 100px×150px）和颜色（橙红→金色）
- 修复火焰上升动画时长（2s → 3s）和关键帧
- 补全变量文字光晕拖尾效果
- 补全炉心字符 box-shadow
- 修复用户昵称为透明背景+上下双横线
- 修复问题展示区 padding/对齐/间距
- 修复操作按钮为直角
- 修复返回按钮使用 CSS 变量
- 修复重试按钮为纯色+直角
- 补全结果容器 scroll-unroll 卷轴展开动效

#### VIP页（vip）
- 补全 theme-ink 纯黑画布类
- 修复头部动态绑定 vip-page-header-active 类
- 修复头部光晕呼吸效果（移除 border-radius，调整 top 位置）
- 新增 manage-btn 续费按钮独立样式
- 修复购买按钮颜色使用 CSS 变量
- 修复卷轴端点位置（8% → 8px）

#### 匹配结果页（match-share）
- 修复卡片背景色（#FFF8F3 → #F5EBD8）和圆角（8px → 4px）
- 修复内容区 padding（32px 20px 24px → 28px 24px）
- 修复装饰图标尺寸和颜色差异化
- 补全朱砂印章装饰（paper-seal）
- 补全共鸣点/冲突点前缀图标
- 补全底部分享/写信按钮 icon-guo 图标

#### 我的好友页（my-matches）
- 修复头部 padding（20px 20px 12px → 32px 24px 16px）
- 修复标题字号（22px → 28px）和字间距（4px → 6px）
- 修复计数徽章边框颜色和 padding
- 补全好友列表固定高度和滚动
- 修复好友卡片 padding、边框颜色、动画
- 修复好友信息 margin-left 和 gap
- 修复好友名字字号（15px → 16px）和 max-width
- 修复卦徽章边框颜色和字号
- 修复未读圆点尺寸（18px → 16px）
- 修复写信图标字间距（6px → 4px）和线条高度（1px → 0.5px）

#### 写信页/收信页（letter-write/letter-thread）
- 修复寄信按钮字间距（12px → 8px）
- 修复信纸正文字体（楷体→宋体）、字号（16px → 15px）、行高（40px → 2）
- 修复落款为 flex-column 布局
- 修复寄件人名字体为宋体

#### 知识库页（learn）
- 修复 tab 激活状态移除加粗，边框（2px → 1.5px）

#### 专属人格页（native-gua）
- 修复卦名字重（700 → 800），补全字间距（4px）
- 修复卦格标签补全字间距（2px）

#### 成就页（achievement）
- 修复标题字号（28px → 26px）和字间距（8px → 4px）
- 修复徽章去卡片化（移除背景/边框/阴影）
- 修复徽章标题字号（12px → 11px）和颜色
- 修复徽章名字号（28px → 26px）和字间距（6px）
- 修复徽章序号字号（13px → 11px）和颜色
- 修复按钮行改为纵向全宽堆叠，间距（12px → 10px）
- 修复按钮圆角（12px → 22px）和字号（14px → 15px）

#### 法律页（agreement/privacy）
- 修复标题字号（20px → 24px），补全字重/光晕/缩进
- 补全标题下金线
- 修复更新日期 margin-top（4px → 8px），补全对齐/字间距
- 修复区块 margin-bottom（20px → 16px）、边框（1px → 0.5px）、padding
- 修复标题字号（15px → 16px）和字间距（2px → 3px）
- 修复正文字号（14px → 13px），移除两端对齐

#### 登录页（login）
- 修复 logo margin-bottom（12px → 20px）
- 修复标题补全缩进（8px），光晕（12px → 16px）
- 修复副标题字号（13px → 12px）、字间距（2px → 3px），移除 margin-bottom

#### 建档页（profile）
- 修复表单组 padding-bottom（0 → 80px）

#### 修改档案页（edit-profile）
- 修复提交按钮字号（16px → 15px）

#### 桌面端适配
- 补全 `.legal-page`、`.secret-page-wrap`、`.login-page` 到 @media(768px) 居中限宽列表

### 后端修复
- 修复 `server.js` 添加 `Content-Type: text/html; charset=utf-8` 响应头（解决中文乱码）
- 修复 `index.html` 中 `createApp` 未赋值给 `app` 变量（解决 Vue 挂载失败）

### 影响范围
- 修改文件：`web/index.html`、`_backend_src/server.js`
- 部署状态：已部署到生产环境（https://claw-book.cn/）
- 测试状态：待用户验证

#### v2.1 建档页/修改档案页视觉统一重构（2026-08-01 补充）

**建档页（profile）**
- 结构重构：移除卷轴合规横幅（compliance-banner/scroll-frame）与居中大标题（title-block），改为与修改档案页完全一致的左对齐标题区（edit-profile-page-header：标题 + 细金线 + 合规副标题）
- 表单样式：从带边框输入框（52px 全边框）改为菜单式行（透明背景 + 仅下边框金线，复用 edit-profile-form-* 样式体系），对齐"我的页" menu-item 去卡片化风格
- 输入占位符与提示：昵称"请输入昵称"→"留一笔你的称谓"；出生日期提示"公历时间"→"填写公历生日"；时间段占位"请选择时间段（默认11:00-13:00）"→"请选择时间段"
- 提交按钮：金色渐变填充（btn-gold）→ 透明背景 + 金色描边极简按钮（edit-profile-submit-btn），移除盖章动画
- 协议勾选与提交区沿用原逻辑（agreement-group / submit-hint）

**修改档案页（edit-profile）**
- 生辰提示文案：公历 · 自动推算八字 → 填写公历生日
- 时辰提示文案：十二时辰 · 对应今之时段 → 出生时间段
- 背景：移除顶部 `rgba(200,165,91,0.04)` 径向渐变，改为 `var(--bg-ink)` 纯色（对齐我的页纯黑底）

**两页统一对齐**
- 内容区左右间距统一为 32px（`.profile-page .profile-content` 24px → 32px）
- 表单行分隔金线统一为 `rgba(200,165,91,0.25)`（与我的页 menu-item 边框一致）
- 建档页与修改档案页现共用同一套表单样式体系（edit-profile-*），视觉完全一致

**部署验证**
- 已执行 `deploy_web_v2.py` 部署，线上 `https://claw-book.cn/tianji/web/` 验证通过：
  - "填写公历生日" 2 处、"出生时间段" 5 处
  - "十二时辰"、"公历 · 自动推算八字" 0 处（旧文案已清除）
- 测试状态：待用户在浏览器验证两页视觉效果

#### v2.2 三端同步（2026-08-01 补充）

**背景**
- 用户确认 SOP：**从现在开始任何改动必须三端同步**（网页版 / 微信小程序 / App），不允许只改一端后遗漏

**本次三端同步内容（建档页 + 修改档案页）**

| 端 | 建档页 | 修改档案页 |
|----|--------|-----------|
| 网页版 | ✅ 上一轮已完成 | ✅ 上一轮已完成 |
| 微信小程序 | 重构 wxml/wxss：移除卷轴横幅+居中标题+带边框输入框+金色渐变按钮，改为左对齐标题区+菜单式表单行+下划线输入框+透明金边按钮；出生日期提示"公历时间"→"填写公历生日" | 生辰提示→"填写公历生日"、时辰提示→"出生时间段"；背景改纯色 var(--bg-ink)；form-item 金线 0.10→0.25 |
| App | 重构 vue：同上风格统一；出生日期提示"公历时间"→"填写公历生日" | 生辰由"出生年份/月份/日期"三个选择器改为**单一日期选择器**（同步小程序/网页版结构），提示→"填写公历生日"；时辰提示"十二时辰"→"出生时间段"；背景改纯色；form-item 金线 0.10→0.25 |

**三端统一规范（建档页/修改档案页）**
- 左对齐标题区：page-header（标题 + 细金线 + 合规副标题）
- 表单菜单式行：透明底 + 1rpx 金线分隔（rgba(200,165,91,0.25)）
- 输入框/选择器：诗集式下划线（透明背景 + 仅下边框）
- 提交按钮：透明背景 + 金色描边（0 圆角）
- 文案：生辰"填写公历生日"、时辰"出生时间段"（三端逐字一致）
- 结构：生辰统一为单一日期选择器

**验证状态**
- 小程序 / App：已修改代码，需在微信开发者工具（多端应用模式）中清除缓存重新编译验证
- 网页版：已部署并验证
- 该 SOP 规则已写入 Code-Wiki.md 1.3 节

#### v2.3 游客模式改造（2026-08-01）

**背景**
- 产品需求：游客可浏览内容（首页节气、候选人资料、关于我们等），仅涉及卦象调用的功能（推演、匹配启封、写信）需建档
- 登录方式：小程序静默登录保持不变，App/网页版移除强制登录跳转，改为游客模式
- 统一档案：建档页/修改档案页增加"已有账号？手机号登录"入口

**后端改动**
- `GET /api/letter/match-pool`：`verifyToken` → `optionalAuth`，游客可浏览候选人资料
- 游客模式返回 `isGuest: true`，不显示次数徽章
- 启封/匹配/推演接口保持 `verifyToken` 认证

**前端改动（三端同步）**

| 端 | App.vue / app.js | 建档页 | 修改档案页 | 匹配池页 |
|----|-----------------|--------|-----------|---------|
| 小程序 | `tryLogin()` App端不再 `redirectToLogin()` | 增加手机号登录入口 | 增加手机号登录入口 | 游客可浏览，启封引导登录 |
| App | `login()` 失败不再 `reLaunch` 到登录页 | 增加手机号登录入口 + `goLogin()` | 增加手机号登录入口 + `goLogin()` | 游客可浏览，启封引导登录 |
| 网页版 | 无强制登录检查 | 增加手机号登录入口 + `goPhoneLogin()` | 增加手机号登录入口 + `goPhoneLogin()` | 游客可浏览，启封引导登录 |

**游客模式权限矩阵**

| 功能 | 游客 | 已登录未建档 | 已建档 |
|------|------|-------------|--------|
| 首页节气 | ✅ | ✅ | ✅ |
| 候选人资料浏览 | ✅ | ✅ | ✅ |
| 关于我们/知识库 | ✅ | ✅ | ✅ |
| 推演 | ❌ 引导建档 | 引导建档 | ✅ |
| 匹配启封 | ❌ 引导建档 | 引导建档 | ✅ |
| 写信传情 | ❌ 引导建档 | 引导建档 | ✅ |
| VIP购买 | ❌ 需手机号 | 需手机号 | ✅ 需手机号 |

**开放平台状态**
- 小程序：已绑定开放平台，unionid 可用
- App：已绑定开放平台，unionid 可用
- 网页版：**待创建、待绑定**（2026-08-01 状态）

**修改文件清单**
- 后端：`_backend_src/src/routes/letter.js`
- 小程序：`app.js`、`pages/profile/index.{wxml,wxss,js}`、`pages/my/index.{wxml,js}`、`sub/profile/edit-profile/index.{wxml,wxss,js}`、`sub/match/match-pool/index.{wxml,wxss,js}`
- App：`App.vue`、`src/pages/profile/index.vue`、`src/pages/my/index.vue`、`src/sub/profile/edit-profile/index.vue`、`src/sub/match/match-pool/index.vue`
- 网页版：`web/index.html`

#### v2.3.1 "我的"页面游客模式修复（2026-08-01 补充）

**问题**
- 网页版"我的"页面：游客点击后被强制跳转登录页
- 小程序/App"我的"页面：游客显示"请先登录"错误提示

**修复**
- 三端统一：游客可进入"我的"页面，显示友好引导（"欢迎体验天机推演" + 建档/登录按钮）
- 网页版：`goMy()` 移除登录检查，`loadProfile()` 增加 `guest` 状态
- 小程序：`loadProfile()` 改为 `pageState: 'guest'`，新增 `goLogin()` 方法
- App：`loadProfile()` 改为 `pageState: 'guest'`，新增 `goLogin()` 方法

**游客引导界面**
- 标题："欢迎体验天机推演"
- 副标题："建立档案，解锁完整功能"
- 按钮1："去建档"（金色主按钮）
- 按钮2："手机号登录"（透明金边次要按钮）

#### v2.3.2 全量回归测试修复（2026-08-01 补充）

**严重问题修复**

| # | 问题 | 修复 | 涉及端 |
|---|------|------|--------|
| 1 | 网页版推演未保存 pendingQuestion | `onTapDivine` 增加 `this.pendingQuestion = this.question` | 网页版 |
| 2 | 网页版建档成功后不自动推演 | `submitProfile` 增加 pendingQuestion 处理逻辑（goHome + onTapDivine） | 网页版 |

**中等问题修复**

| # | 问题 | 修复 | 涉及端 |
|---|------|------|--------|
| 3 | App 匹配池候选数据缺少字段 | 补齐 wuxing/wuxingClass/genderLabel/genderSymbol/birthSolarDisplay/avatarClass + 新增 getAvatarClass 方法 | App |
| 4 | 游客启封跳转方式不一致 | 小程序改为 `navigateTo`（与 App/网页版统一） | 小程序 |
| 5 | App 匹配池 onShow 引言逻辑 | 改为调用 loadPool() 管理引言浮层（与小程序统一） | App |

**修改文件清单**
- 网页版：`web/index.html`（onTapDivine + submitProfile）
- 小程序：`sub/match/match-pool/index.js`（redirectTo → navigateTo）
- App：`src/sub/match/match-pool/index.vue`（数据字段补齐 + onShow 逻辑修复）

#### v2.3.3 深度回归测试修复（2026-08-01）

**严重问题修复（5 个）**

| # | 问题 | 修复 | 涉及端 |
|---|------|------|--------|
| 1 | `mark-read` 参数名不匹配（`letter_id` vs `letterId`） | 网页端改为 `{ letterId: letterId }` | 网页版 |
| 2 | `check-order` 不返回 `plan_type` | 后端改为 `SELECT status, product_id`，返回 `plan_type: product_id` | 后端 |
| 3 | `share_codes` 表缺 `scene`/`use_limit` 字段 | 创建 migration `011_share_codes_add_scene_and_use_limit.sql` | 后端 |
| 4 | `loadMatchShare` 重复调用 resolve 接口（use_count 翻倍） | 传递 `resolvedData` 参数，避免二次调用 | 网页版 |
| 5 | 网页版 401 不自动重试 | 对齐小程序，401 时自动重新登录并重试原请求 | 网页版 |

**中等问题修复（2 个）**

| # | 问题 | 修复 | 涉及端 |
|---|------|------|--------|
| 6 | `create-h5-order` 缺少 10 秒防重检查 | 增加 pending 订单查询，10 秒内重复请求直接返回 | 后端 |
| 7 | 网页版 `apiRequest` 统一 60 秒超时 | 按接口类型区分：推演 60s、VIP 推演 400s、支付 30s、普通 10s | 网页版 |

**分享功能优化**

| # | 优化项 | 说明 |
|---|--------|------|
| 8 | 游客分享匹配体验 | 缓存 `pendingMatchGuaId` 等数据，引导建档后直接展示匹配结果 |

**修改文件清单**
- 后端：`_backend_src/src/routes/payment.js`（check-order + create-h5-order 防重）
- 后端：`_backend_src/migrations/011_share_codes_add_scene_and_use_limit.sql`（新建）
- 网页版：`web/index.html`（mark-read + 401 重试 + 超时区分 + loadMatchShare 优化）

#### v2.3.4 五轮深度检查修复（2026-08-02）

**P0 严重问题修复（2 个）**

| # | 问题 | 修复 | 涉及文件 |
|---|------|------|----------|
| 1 | H5支付回调未验证业务数据 | 增加订单存在性+金额+商户号验证 | `payment.js` |
| 2 | 推演配额TOCTOU竞态 | 改为阶段1原子扣减，AI失败时回补 | `tuiyan.js` |

**P1 重要问题修复（3 个）**

| # | 问题 | 修复 | 涉及文件 |
|---|------|------|----------|
| 3 | paidTime 字符串乘1000得NaN | 先parseInt再乘1000 | `payment.js` |
| 4 | 匹配池ORDER BY RAND()全表扫描 | 改为应用层随机偏移（COUNT+OFFSET） | `letter.js` |
| 5 | share INSERT缺use_limit字段 | INSERT中增加use_limit=100 | `share.js` |

**P2 中等问题修复（4 个）**

| # | 问题 | 修复 | 涉及文件 |
|---|------|------|----------|
| 6 | auth/login返回openid与token不一致 | 返回生成token时的openid变量 | `auth.js` |
| 7 | thread接口total返回当前页数量 | 增加COUNT查询返回真实总数 | `letter.js` |
| 8 | unread-count含拉黑用户来信 | 增加NOT EXISTS排除拉黑用户 | `letter.js` |
| 9 | device_id无复杂度校验 | 要求至少32位（防枚举攻击） | `auth.js` |

**性能优化（1 个）**

| # | 优化 | 说明 |
|---|------|------|
| 10 | letters表复合索引 | 创建idx_letters_thread、idx_letters_unread、idx_share_codes_lookup |

**修改文件清单**
- 后端：`payment.js`（H5验证+paidTime）、`tuiyan.js`（配额竞态）、`letter.js`（RAND+thread+unread）、`share.js`（use_limit）、`auth.js`（openid+device_id）、`wxpay.js`（getMchid导出）
- Migration：`012_letters_indexes_and_share_rate_limit.sql`（新建索引）

#### v2.7 中英双语支持 + 邮箱登录（2026-08-18）

**中英双语模块（v19.0/v19.1，Google Play 海外上架）**
- 运行时切换，中文默认，不做双包；中文完整基线备份于 `backup/v18.21-cn-baseline-20260818.zip`
- 前端：`utils/i18n.js` + `i18n/zh-CN.js`/`i18n/en-US.js` 文案字典（`tianji_lang` 持久化）；已覆盖登录/首页/建档/推演结果/VIP/我的六页；英文态衬线字体（Georgia），规范详见 `docs/frontend.md` 5.6 节
- 推演接口：请求 body 携带可选 `lang`，`en` 时 AI 全英文输出，JSON 字段名不变
- 静态数据英文化：64卦短字段查 `config/hexagrams-en.js` 静态表；长文本（人格描述/2080条关系解读）AI 按需翻译 + Redis 永久缓存（`utils/translator.js`），失败降级中文；`GET /api/gua/:id?lang=en`、`GET /api/relationship/:a/:b?lang=en`
- 术语标准：天机推演→I Ching Insight，推演→Insight，深度解读→Deep Insight（全表见 `docs/frontend.md` 5.6 节）

**邮箱+密码登录（海外用户，与手机号登录并存）**
- 三接口：`POST /api/auth/email-send-code`（发验证码，5分钟有效/60s冷却/每日≤10次）/ `email-register`（验证码+密码注册，密码≥6位 bcrypt 存储）/ `email-login`（密码登录）
- openid=`email_`+sha256 前20位，返回体与 phone-login 一致；users 表由 auth.js 启动幂等迁移补 `email`(UNIQUE)/`password_hash` 列
- 依赖 nodemailer + .env `SMTP_*`；未配置 SMTP 时邮箱通道返回 500 `SMTP_NOT_CONFIGURED`，不影响手机号/微信登录

**修改文件清单**
- 前端：`i18n/zh-CN.js`、`i18n/en-US.js`、`utils/i18n.js`、`app.wxss`（.lang-en 衬线字体）、`pages/login/index.*`（双 tab）、`pages/index/index.*`、`pages/profile/index.*`、`pages/result/index.*`、`pages/my/index.*`、`sub/vip/vip/index.*`
- 后端：`src/routes/auth.js`（邮箱三接口+列迁移）、`src/routes/tuiyan.js` + `src/services/tuiyan.js`（lang 英文输出）、`src/routes/gua.js`/`src/routes/relationship.js`（lang 双语）、`config/hexagrams-en.js`（新建）、`src/utils/translator.js`（新建，v2.9 已删除）、`package.json`（+nodemailer）

#### v2.8 匹配链路双语（2026-08-18，v19.2）

**后端**（存储统一中文原文，仅响应输出英文）：
- `src/routes/letter.js`：`POST /api/letter/match`（一元匹配）body `lang` → relationshipName/matchLevel 短语 AI 翻译（`phrase:relname:*`/`phrase:rellevel:*` 内容寻址缓存）；`GET match-pool`（三分支统一 `mapCandidate`：卦名/卦格/标签查英文表、五行转英文、干支拼音化+英月日+英时辰）；`GET friends`（卦名/卦格英文 + 关系名去重并行翻译）
- `src/routes/user.js`：`getGuaExtra(guaId, conn, lang)` 英文态覆盖 gua_ge_name/full_name/gua_ge/social_tag/wuxing，4 个调用点（POST/GET me/GET profile/:openid/PATCH）传 lang
- `src/utils/translator.js`：系统提示词新增规则 7——match_level 三类关键词固定译法（天作→Heaven-Made / 默契→Kindred / 互补→Complementary），供前端配色判断

**前端**（英文态接口补传 lang）：
- `sub/match/match/index.js`：`/api/relationship` 带 `?lang=en`；`_getLevelClass` 兼容英文等级词
- `sub/match/match-pool/index.js`：match-pool/match 两调用带 lang；`getAvatarClass` 兼容英文五行（Metal/Earth/Fire）
- `sub/match/letter-write/index.js`：gua/relationship/profile 三类调用带 lang
- `sub/match/my-matches/index.js`：friends 调用带 lang
- `pages/my/index.js`、`pages/profile/index.js`、`sub/profile/edit-profile/index.js`：profile 调用/请求体带 lang

#### v2.8.1 学习/协议模块双语（2026-08-18，P3 补全）

**前端**（静态文案全量 i18n 化）：
- `i18n/zh-CN.js`、`i18n/en-US.js`：`learn` 模块扩充 40+ 词条（native-gua 详情页、achievement 成就页、learn 主页弹窗/标签/toast/分享文案）
- `sub/learn/native-gua/*`：新增 `applyI18n`、`ownerLabel`（模板填充 `{name}`），分享消息双语化，`/api/gua/:id` 带 `lang`
- `sub/learn/achievement/*`：标题/描述/徽章/按钮接入 i18n，成就序号模板 `achOrderText` 双语，分享文案双语化
- `sub/learn/learn/*`：弹窗标签（卦辞/象辞/人格/情感/天赋/盲点/历史人物/介绍/包含内容/在推演中的作用）、欢迎弹窗、罗盘引导、toast、分享文案全部接入 i18n；`loadGuaList`、`onGuaTap` 接口带 `lang`
- `sub/match/match/index.js`、`sub/match/letter-write/index.js`、`sub/match/letter-thread/index.js`：遗留 `user/profile`、`letter/thread` 调用补齐 `lang` 参数

**部署验证**（生产实测通过）：match-pool 三分支英文输出 ✅ / 建档返回英文卦信息 ✅ / user/me?lang=en ✅ / 默认中文不受影响 ✅ / relationship 英文 ✅ / friends 空列表不报错 ✅ / 干支拼音（Ji-Wei Year）✅

**部署验证（2026-08-18 完成，生产 YOUR_SERVER_HOST）**
- 部署方式：`deploy_v191_smtp.py`（paramiko 上传 8 个后端文件 + .env 追加 SMTP + npm install + pm2 restart）
- SMTP：QQ 邮箱 smtp.qq.com:587（STARTTLS），配置于远程 `.env`（5 行 SMTP_*）
- 实测通过：email-send-code 真实发信 ✅ / email-register 建号+赠10积分 ✅ / email-login 密码登录 ✅ / 错误密码 401 PASSWORD_WRONG ✅ / gua/1?lang=en 全英文输出 ✅（v2.9 起静态文件直读毫秒级，无首次翻译延迟）
- 部署中发现并修复 2 个 BUG：
  1. `auth.js` ensureEmailColumns：PM2 cluster 多实例并发 ALTER TABLE 报 Duplicate column 被误判失败 → 捕获 ER_DUP_FIELDNAME 视为成功
  2. `translator.js`：max_tokens 4096 导致长文本 JSON 截断（Unexpected end of JSON input）→ 提至 8192 + `response_format: json_object` + 失败自动重试 1 次
- 测试账号遗留：`email_76c9c43c08dde93331b0`（462889331@qq.com，密码 test123456），如需可在管理后台删除

#### v2.8.2 节气组件双语重构「raw 数据 + JS 预翻译」（2026-08-19，P11）

**背景**：此前 P7-P10 的 WXML 端翻译方案（WXML 内插值调用翻译逻辑）导致节气按钮点击失效、详情浮层无法弹出；本次从备份 `v18.21-cn-baseline-20260818.zip` 回退中文基线后重新实现。

**架构原则**：WXML 零函数调用，所有文本在 JS 端预翻译完成后 setData。
- `components/jieqi-bar/jieqi-bar.js`：`_rawTermData`/`_rawAdviceData` 保存 API 原始中文数据；`_applyLang()` 统一入口；`_buildTermView()`/`_buildAdviceView()` 构建视图（图标匹配基于中文原文，先于翻译）；`refreshI18n()` 由 `pages/index/index.js` onShow 调用
- 展示字段与索引字段分离：`wuxing` 保留中文（供 `wuxingColorLight`/`wuxingBgTint` 颜色映射），显示用 `wuxingText`/`organText`；预计算字段 `daysInText`/`wuHouView`/`guaGeText`/`loadingText`/`diaryHistoryText`
- 动态数据映射表：`en-US.js` `jieqi` 模块 25 个映射表（24 节气名/五行/脏腑/83 食材/72 菜谱/65 活动/43 情志/72 物候/128 卦格/25 五行关系/L2+L3 经典引文等，基于数据库真实导出数据构建）；未命中词条回退中文原文
- 物候日记存储 key 用中文原始节气名（`jieqi_diary_立秋`），语言切换不丢数据
- `.lang-en` CSS 适配块：竖排拉杆 `.tab-name` 横排化 + 字号微调（中文态样式零改动）

**部署验证**：不适用（纯前端改动，后端无变更；需在开发者工具清缓存重编译验证）

#### v2.8.3 推演结果页动态数据翻译 + 账号合并（2026-08-19，P12/P13）

**推演结果页动态数据翻译**（复用 v2.8.2「raw 数据 + JS 预翻译」架构）：
- `pages/result/index.js`：`_rawRecord`/`_rawQimen` 保存原始数据；`_tr()` 映射翻译、`_trPillars()` 四柱干支翻译；`_buildRecordView()`/`_buildQimenView()` 构建多语言视图（卦名/九星/八门/八神/五行关系/卦格/干支）；onShow 语言切换时重建
- `en-US.js` `result` 模块新增 20+ 映射表（guaNameMap 64卦全名+单字/starMap/gateMap/spiritMap/relMap/relDescMap/ganMap/zhiMap 等）；`jieqi` 模块补全 activityMap/keywordMap/recipeMap 遗漏词条
- 覆盖率校验：临时脚本对比后端配置（qimen-config.js/hexagrams.js/jieqi-health.js/wuxing-relation.js）与前端映射表，补全全部缺失词条（含 56 个全名卦名）

**账号合并（邮箱账号 ↔ 微信账号，v19.4）**：
- 后端 `src/routes/auth.js`：`email-send-code` purpose 扩展 `bind`；`email-register` 新增 `MERGE_CONFIRM` 分支；新增 `email-bind` 接口 + `mergeEmailAccountInto()`（事务合并，复用 bind-phone 逻辑）+ `migrateEmailAccountRedis()`（Redis 迁移清理）；场景详见 2.3 节场景D
- 前端：`sub/profile/bind-email/*`（新增绑定页）；`pages/my/*`（绑定邮箱入口 + 已绑定邮箱展示）；`pages/login/login.js`（注册 MERGE_CONFIRM 弹窗合并）；`utils/api.js`（非 2xx 错误响应保留 data 字段，boundNickname 得以透传）

**部署验证**：✅ 已部署并实测通过（2026-08-19，生产 YOUR_SERVER_HOST）：PM2 4 实例 online；`email-bind` 无 token → 401 AUTH_TOKEN_MISSING（路由挂载+鉴权生效）；`email-send-code` purpose=bind 非法邮箱 → 400 INVALID_PARAM；`email-register`/`email-login` 参数与流程正常（400/404 预期响应）。前端需开发者工具清缓存重编译验证。

#### v2.8.4 宜忌栏英文版式重构 + 注册页勾选滚动修复（2026-08-19，P14）

- **宜忌栏英文截断**：英文 AI 词条（≤8 words）在左右两栏 50% 宽 pill 中换行溢出截断。`pages/result/index.wxss` 版式重构为宜/忌纵向堆叠整行块 + pill 可换行（`max-width:100%`/`word-break:break-word`/`white-space:normal`）+ 标题细金线延伸装饰 + `.lang-en` 字号微调；`src/services/tuiyan.js` 英文提示词词条长度 ≤8 → **≤5 words** 双保险。历史长词条记录同样完整显示。
- **注册页协议勾选被遮挡**：根因 `login.json` 的 `"disableScroll": true` 禁止整页滚动，注册模式内容超高时底部勾选框截在屏幕外（英文版更长故完全看不见）。修复：移除 `disableScroll` + 布局紧凑化（padding-top 180→120 / header mb 96→56 / form-group mb 56→44 / footer mt 48→32rpx）。

**部署验证**：✅ 已部署并实测通过（2026-08-19）：tuiyan.js + auth.js 上传，PM2 4 实例 online，四项接口实测（email-bind 401 鉴权 / send-code purpose=bind 400 校验 / email-register 400 / email-login 404）全部预期响应；公网 claw-book.cn 正常。前端部分需开发者工具清缓存重编译验证（宜忌版式 + 注册页滚动）。

#### v2.9 静态数据英文版全量预生成「方案B」（2026-08-20，v20）

**架构决策**：v19.4 的「懒加载 AI 翻译 + Redis 永久缓存」方案存在首次翻译 20-30s 超时（Nginx 30s 网关 502）、AI 输出截断、需预热脚本维护三大问题。评估后改为**方案B：静态数据全量预生成英文文件，路由直读**——中文版调中文文件、英文版调英文文件，仅推演（不固定数据）保留 AI 翻译（lang 参数直接传入提示词生成英文）。收益：英文接口 Redis/AI 零依赖、毫秒级响应、永无 502、删除整套预热/防击穿/重试链路。

**静态英文文件（`config/` 下 6 个，由 scripts 生成）**：
| 文件 | 规模 | 生成脚本 |
|------|------|---------|
| `relationship-en.js` | 2080 条关系解读（key 与中文版 `{min}-{max}` 一一对应） | `gen-en-files.js` |
| `hexagrams-en-long.js` | 64 卦长文（renGe/emotionMode/judgment/image 等） | `gen-en-files.js` |
| `jieqi-health-en.js` | 24 节气通用养生（L1） | `gen-en-files.js` |
| `jieqi-wuxing-en.js` | 24 节气五行归属 + 脏腑映射 | `gen-en-files.js` |
| `wuxing-relation-en.js` | 25 条五行关系规则（L2） | `gen-en-files.js` |
| `solar-advice-en.js` | 1536 条卦格×节气养生建议（L3，源自数据库表） | `gen-l3-en.js` |

**生成脚本机制**（`scripts/gen-en-files.js` / `gen-l3-en.js`，可重跑）：
- 种子数据：从 Redis `tianji:i18n:*` 导出 v19.4 已缓存的翻译，AI（DeepSeek）仅补翻缺口
- 断点续传：checkpoint 文件记录已完成 key，中断重跑只补剩余
- 校验：`verify-en-files.js` 对 6 个文件做「键集合与中文版一致 + 字段非空 + 无 CJK 残留」三维校验（查询键如卦格名保留中文除外）
- 大对象分片翻译（wuxing-relation 9 条/片）避免 AI 输出截断

**后端路由改造**（`?lang=en` 或 body `lang:'en'`，缺失 key 降级中文）：
- `src/routes/relationship.js`：`applyEnglishRel` 改同步直读 `relationship-en.js`
- `src/routes/gua.js`：`applyEnglish`/`getListTextsEn` 改同步直读 `hexagrams-en-long.js`（列表 judgment/image 内存缓存一次）
- `src/routes/solar-term.js`：新增 `lang=en` 支持，L1/L2/L3 + 节气五行全部静态直读；术语（五行/脏腑/五味/方位/五色/季节含"春末/夏末"等）程序化映射补齐
- `src/routes/letter.js`：`translatePhrase` 改静态映射查表（`relationship-en.js` 与中文版按同 key 对照构建 `_relNameEnMap`/`_relLevelEnMap`）

**旧链路清理**：
- 删除 `src/utils/translator.js`（本地+服务器，grep 确认无残留引用）
- 删除预热脚本 `warm-rel-cache.js` + `warm-rel.log`（服务器）
- Redis `tianji:i18n:*` 缓存确认为 0
- PM2 reload 后 4 实例 online，健康检查通过，英文接口抽查正常

**前端英文适配收尾**：
- `utils/i18n.js`：新增 `NAV_TITLES` 映射 + `applyNavTitle(pagePath, overrideTitle)`，各页 onShow 调用实现导航栏标题随语言切换
- 10 个页面批量补齐 `lang-en` 根类绑定与语言切换字典刷新逻辑（英文布局样式生效）
- `components/jieqi-bar/jieqi-bar.js` + `sub/match/letter-write/index.js`：英文态节气数据改为直接请求后端 `?lang=en`（替代前端 25 个映射表方案，杜绝词典遗漏）
- `pages/result/index.wxss`：宜忌栏英文纵向堆叠版式（见 v2.8.4）

**部署验证**（2026-08-20，生产 YOUR_SERVER_HOST）：
- `verify-en-files.js` 本地校验 6 文件全部通过（键一致/字段非空/无 CJK 残留）
- 全接口双语实测脚本（device-login + 9 组接口中英对照）：**PASS=31 FAIL=0**——relationship/gua/list/solar-term(current/all/advice)/letter(match-pool/friends) 中英结构一致、英文无中文残留、响应毫秒级
- PM2 4 实例 online，`/api/health` OK，公网 claw-book.cn 正常

**修改文件清单**：
- 后端新增：`config/relationship-en.js`、`config/hexagrams-en-long.js`、`config/jieqi-health-en.js`、`config/jieqi-wuxing-en.js`、`config/wuxing-relation-en.js`、`config/solar-advice-en.js`、`scripts/gen-en-files.js`、`scripts/gen-l3-en.js`、`scripts/verify-en-files.js`
- 后端修改：`src/routes/relationship.js`、`src/routes/gua.js`、`src/routes/solar-term.js`、`src/routes/letter.js`
- 后端删除：`src/utils/translator.js`、`scripts/warm-rel-cache.js`
- 前端修改：`utils/i18n.js`、`components/jieqi-bar/jieqi-bar.js`、`sub/match/letter-write/index.js`、10 个页面 lang-en 根类补齐
