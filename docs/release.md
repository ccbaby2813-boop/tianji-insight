# 上架发布方案（渠道拆分）

> **适用版本**：v3.6 | **最后更新**：2026-09-03
> 配套：`微信多端应用官方说明书.md`（Donut 官方文档摘录）、`ops.md`（服务器运维）
> **当前状态**：Android 已上架 Google Play（海外版 3.3.6，封闭测试 → 生产审核中）；Google Play Billing 接口已留占位待封闭测试后开通。

---

## 目录

- [1. 渠道拆分总览](#1-渠道拆分总览)
- [2. 海外版：Google Play](#2-海外版google-play)
- [3. 国内版：华为 / 应用宝等](#3-国内版华为--应用宝等)
- [4. 支付分叉方案](#4-支付分叉方案)
- [5. 项目现状基线（2026-08-20 盘点）](#5-项目现状基线2026-08-20-盘点)
- [6. 上架前置合规清单](#6-上架前置合规清单)
- [7. Google Play 首发推进计划](#7-google-play-首发推进计划)
- [8. 待确认 / 风险](#8-待确认--风险)
- [9. 签名切 Release 专项（2026-08-20）](#9-签名切-release-专项2026-08-20)
- [10. Google Play 上架合规（targetSdk / 广告 / 符号，2026-08-20）](#10-google-play-上架合规targetsdk--广告--符号2026-08-20)

---

## 1. 渠道拆分总览

天机推演后续上架分为**两个渠道域**，共享同一套 Donut 小程序代码（`tianji-tuiyan-miniprogram-v10/`），仅**应用元数据（包名/签名/图标/隐私）、支付通道、部分原生 SDK** 存在差异。

| 维度 | 海外版 | 国内版 |
|------|--------|--------|
| 目标市场 | Google Play（首发） | 华为 AppGallery、应用宝（腾讯）、OPPO/VIVO/小米等后续 |
| 应用格式 | **AAB**（`useAab=true` 构建） | APK（OPPO 需 64 位） |
| Android 签名 | 同一 `tianji-release.keystore`（单签名，全渠道一致，便于跨市场统一包名升级） | 同左 |
| 内购支付 | **Google Play Billing**（Google 强制，禁用云支付/第三方支付） | **统一微信支付**（当前 `create-app-order` 已实现） |
| 隐私弹窗/政策披露 | 需披露第三方 SDK（多端框架/微信 Open SDK） | 同左 + 各市场差异要求 |
| 微信 Open SDK | 可保留微信登录；**支付能力不进入**（Google 政策） | 微信登录 + 微信支付 |

> **关键约束（官方）**：Google Play 应用内购必须走 Google Play Billing，**不允许**使用微信/支付宝等第三方支付或跳转外部 H5 支付，否则下架并禁用内购。因此海外版与国内版**必须分渠道做支付**。

---

## 2. 海外版：Google Play

### 2.1 构建格式
- 必须构建 **AAB**（Android App Bundle），不能提交 APK。构建面板「发布格式」选 AAB 或命令行 `cli build-apk --useAab true`。

### 2.2 必须移除「安装 APK」能力
- `project.miniapp.json` → `mini-android.useExtendedSdk` 中关闭 `install`（置 `false`），以移除 `android.permission.REQUEST_INSTALL_PACKAGES`。
- 当前项目 `useExtendedSdk` **未声明 `install`**（见第5节基线），需确认默认行为；若默认开启须显式关闭。

### 2.3 不可开启 GDT SDK（优量汇广告）
- 开启了 GDT SDK（广告）的 App 暂不支持上架 Google Play。当前项目 `useExtendedSdk` 无广告配置，符合要求，**上线前不得勾选 GDT**。

### 2.4 Bundle ID / 包名
- 需在多端应用控制台绑定移动应用账号后，以该应用配置的 Package Name（ApplicationId）构建。`project.miniapp.json` 中 `version`/`versionCode` 每次提审需递增。
- 海外版包名建议与国内一致（同一 ApplicationId + 同一签名），便于一个 APK/Bundle 走多市场；若需差异化（如 `...overseas`）则需评估数据/登录是否隔离。

### 2.5 登录
- Google Play 版可用微信登录（Donut 已内置）。但 Google Play 审核对"仅微信登录"可能要求在无微信环境可用其他登录，需关注实际审核反馈（对应官方"只提供微信登录可能被拒"提示，未装微信手机点微信登录会报错）。
- 已在代码中处理微信未安装检测（见前端登录逻辑）。

### 2.6 数据流与后端
- 服务器后端部署（国内阿里云 `claw-book.cn`）海外访问**延迟较高**；如需海外正式运营，应评估 CDN/海外节点。上线初期可先用国内服务器验证。

---

## 3. 国内版：华为 / 应用宝等

### 3.1 构建格式
- 华为/应用宝等接受 **APK**（当前已有 APK 构建能力）。OPPO 明确要求 64 位包（构建时注意 ABI）。

### 3.2 各市场审核
- 国内各市场均有独立审核规范（华为/小米/OPPO/VIVO/魅族/应用宝/360/阿里/百度见官方说明书第9节列出的链接）。
- 应用宝与其他市场对"定向推送/消息通知/推荐"等的隐私协议措辞敏感，若未开推送需从协议中移除相关措辞。

### 3.3 软著与备案
- 上架前需**软件著作权**，软著名称/简称须与应用名称对应。
- 产品官网需 **ICP 备案**；如涉及社区/用户生成内容模块，可能需《安全评估报告》。

---

## 4. 支付分叉方案

> 用户已确认（2026-08-20）：海外版用 **Google Play Billing**，国内版用**统一微信支付**。

### 4.1 国内版：统一微信支付（现状）
- 已实现：后端 `POST /api/payment/create-app-order` 返回 `payParams`（appid/partnerid/prepayid/noncestr/timestamp/sign），前端 `wx.requestPayment({ provider: 'wxpay', orderInfo })` 拉起微信。
- 各国内市场对"引导第三方支付"口径不一，华为曾要求接华为支付；当前策略**统一微信支付**（用户已确认），按各市场上架实际审核反馈再调整。
- ⚠️ **审批前置（用户确认 2026-08-25）**：APP 微信支付**尚未审批**，微信开放平台要求先取**软件著作权**、再**上应用市场**，上架后才会批 APP 支付（AppID `wx3260c7ff02b6ba90`）；期间后端 `WXPAY_*` 未启用，双端支付走虚拟支付 XPAY（详见 `ops.md` §2.5.3）。

### 4.2 海外版：Google Play Billing（✅ 官方原生支持，v20.2 已接入）

> **重大更正（2026-08-26）**：此前"Donut 未内置 Google Play Billing"为**过时判断**。微信官方已提供 `wx.miniapp.GooglePlayBilling` JSAPI（Android SDK ≥ 1.5.8，本项目 SDK 1.7.0-beta 满足），官方文档：`developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/api/miniapp/GooglePlayBilling.html`。

**启用配置**（`project.miniapp.json` → `mini-android`）：
```json
"sdkVersion": "1.7.0-beta.17-1477-SNAPSHOT",
"useExtendedSdk": { "googleplay": false, "skyline": true }
```
> ⚠️ 注意 flag 是 **`googleplay`**（早期误写成 `google`，会导致 Billing API 未打包，2026-08-26 已修正）。

**集成链路（v20.2 已实现）**：
1. **前端** `sub/vip/vip/index.js`：`CHANNEL==='google'` 且 App 端时，`startConnection` → `launchBillingFlow({productId, productType:'INAPP'})` → `onPurchasesUpdatedMethod` 回调拿 `purchaseToken` → `POST /api/payment/google-verify` 验签开通 → `consumeAsync` 消耗。
2. **后端** `src/routes/payment.js`：`POST /api/payment/google-verify`，用服务账号调 **Google Play Developer API**（`purchases.products.get`）验签（`purchaseState===0`），幂等（purchaseToken 唯一），开通 VIP（复用 `activateVipByOutTradeNo` 的叠加到期逻辑，`vip_orders.env=2` 标识 Google 渠道）。
3. **服务账号配置**：Google Cloud 建服务账号 → 生成 JSON 密钥 → Play Console「用户和权限」关联授权（查看财务数据/管理订单）。`.env` 配 `GOOGLE_PLAY_PACKAGE` + `GOOGLE_PLAY_CREDENTIALS_JSON`（或 PATH）；联调可临时 `GOOGLE_PLAY_TEST_MODE=1` 跳过验签（生产严禁）。
4. **商品**：Play Console 创建 INAPP 一次性商品 `vip_monthly`、`vip_yearly`（价格以 Play 商店定价为准，App 内不再显示 ¥，见 `i18n` 的 `gpPrice*` 文案）。

**待办（需用户在 Play Console/Google Cloud 操作）**：见 §7 P1-P2。

### 4.2.1 Google Play 结算库 8.0.0 合规（2026-09-15 处理）

**背景**：Google Play Console 政策通知要求应用内打包的 Play Billing Library 升级到 8.0.0+（7.x 版本 2026-08-31 起弃用，本项目获官方延期至 **2026-11-01**），否则无法提交更新。另一条「Android 开发者验证」通知：包名 com.clawbook.tianji 已注册（2026-08-20，键 5），**已满足无需操作**。

**现状证据**：
- 解包 APK（3.4.0）及本地 SDK 构建产物（1.7.0-beta.17-1477-SNAPSHOT）均含 illing.properties → ersion=7.0.0。微信 Donut Android SDK **至今未适配 Billing 8.x**（1.7.0 底层仍依赖 7.0.0），无公开适配时间表。
- Billing 8 已移除/改名一批 7.x API（querySkuDetailsAsync→queryProductDetailsAsync、无参 enablePendingPurchases、queryPurchasesAsync(String,...) 旧签名等）。直接在 push.config.json 注入 com.android.billingclient:billing:8.x 覆盖依赖，存在与 Donut SDK 内部旧 API 冲突的**编译/运行时崩溃风险**，故不采用。

**处理决策（已执行 2026-09-15）**：project.miniapp.json → mini-android.useExtendedSdk.googleplay 置 **alse**。
- 原理：Billing 库由 googleplay 扩展注入，关闭后 APK 不再打包 Billing 库 → Google 不再触发版本检查，11/1 期限解除。
- 安全性：VIP 支付当前为**占位状态**（payComingSoon，商品未在 Play Console 创建）；sub/vip/vip/index.js 对 wx.miniapp.GooglePlayBilling 缺失已有完整容错（弹"Google Play Billing unavailable"），国内版微信支付分流不受影响。
- **恢复指引（开通 Google 支付时）**：① 重新置 googleplay: true；② 确认微信 Donut SDK 已适配 Billing 8（查 SDK changelog 或解包验证 illing.properties ≥ 8.0.0，必要时升级 sdkVersion）；③ 再走 §4.2 集成链路。

**待用户操作**：下次构建并上传 Google Play 时，确认新包不再含 billing 库（Google 通知消失）；旧版本（含 billing 7）保留不影响，新提交版本合规即可。

### 4.3 官网账户与删除账号链接（2026-08-20，Google Play 上架合规）
- **需求背景**：Google Play 上架审核需在商品详情提供「删除账号与相关数据」链接；官网（`web/index.html`）仅展示+下载，此前无登录/购会员/注销完整闭环。
- **本次落地**：
  1. **删除账号链接** `https://claw-book.cn/delete-account`：新增`web/delete-account.html` 双语注销页（邮箱+密码登录 → 二次确认 → 调 `/api/user/profile/{openid}/request-delete`）；nginx 新增 `location = /delete-account` 精确路由代理 3003（否则被 `/` 静态 alias 拦截返回 404）。
  2. **官网购会员登录改走「邮箱+验证码」**：`web/index.html` 原调 `/api/auth/email-login` 传 `{email, code}`（该接口只接收 password）必然失败 → 改为新增后端接口 `/api/auth/email-code-login`（邮箱+验证码登录/注册合一，无密码，validate 校验 register 验证码）。
  3. **后端故障修复**：服务器 `server.js` 第 249 行裸 `#` 注释致 JS 语法错误，PM2 四进程 `waiting`；本机正确版覆盖 + `pm2 restart` 恢复 `online`。
- **部署验证（2026-08-20）**：`/api/health` OK、`/api/auth/email-code-login` 返回预期 `CODE_INVALID`、`/delete-account` 公网 **200**（含双语标题）、官网首页 200。
- **Google Play 表单填写建议**：账号创建方式勾选「用户名和密码」（邮箱）、「用户名和其他身份验证方法」（手机号+动态验证码）、「OAuth」（微信）；删除链接填上述地址；部分数据删除选「否」。
- **【已修正 2026-08-20】网页 API 基址 bug**：`web/delete-account.html` 与 `web/index.html` 均写 `const API = location.origin + '/tianji/api'`，但其后所有调用路径以 `/api/...` 开头（如 `'/api/auth/email-login'`），拼接成 `/tianji/api/api/...`，nginx 代理后后端收到 `/api/api/...` → **404「接口不存在」**。已将基址统一改为 `location.origin + '/tianji'`，公网实测 `/api/auth/email-login` 返回 `ACCOUNT_NOT_FOUND`（已进入后端路由，非 404）。

---

## 5. 项目现状基线（2026-08-20 盘点）

来自 `tianji-tuiyan-miniprogram-v10/project.miniapp.json` 与代码实测：

| 项 | 当前值 | 说明 |
|----|--------|------|
| Android 签名 | `storeFilePath: tianji-release.keystore`、`storePassword: tianji2026`、`alias: tianji`、`aliasPassword: tianji2026`（2026-08-20 keytool 实测：SHA1 `0C:74:2A:1E:C7:EB:82:4F:66:09:F3:9F:C1:8A:DA:8E:F0:5F:64:BE`，SHA256 `E6:42:9D:1E:49:20:D9:01:B4:06:5D:9D:66:93:3B:2C:57:FD:AD:41:8B:B6:EC:C1:B3:74:11:5A:5D:D4:0E:2D`，SHA256withRSA，所有者 `Beijing Wuyuan Digital Technology Co Ltd`，**真实有效 release 证书**） | **已核验有效**；但之前构建产物实际用的是 debug 证书，release 证书未被云构建使用（详见第 9 节签名专项） |
| `mini-android.useExtendedSdk` | `media/xweb/open=true`；`googleplay=true`；`skyline=true`；`bluetooth/network/scanner=false` | **未声明 `install`**，无 GDT，符合 Google Play；`googleplay` 为 Billing 能力开关（v20.2 修正，原误写 `google`） |
| Android 原生资源 | 仅 `AndroidManifest.xml`（微信 WXEntryActivity） | 无原生支付/能力模块，Billing 需新增 |
| 版本号 | `project.miniapp.json` 现为 `version: 3.3.6`、`versionCode: 116`（2026-09-03）；旧基线 `0.0.1`/`100` 为测试期值 | **每次提审递增** |
| 支付前端 | `sub/vip/vip/index.js` 调 `create-app-order` + `wx.requestPayment provider=wxpay` | 国内微信通道，海外不可用 |
| 支付后端 | `src/routes/payment.js`：微信虚拟支付（`create-order`/`virtual-notify`）+ App 微信支付（`create-app-order`）+ H5 微信支付（`create-h5-order`） | 均微信体系，无 Google Billing |
| iOS 配置 | `project.miniapp.json` `mini-ios` 含图标/隐私描述/隐私弹窗开启 | 完整，可供后续 iOS 上架 |

> 注：`XPAY_ENV`、`WX_APPID` 等支付相关配置在 `_backend_src/.env*`（非版本库）；后端实际生效的 App 微信支付依赖 `wxpay.isConfigured()` 通过 `create-h5-order`/`create-app-order` 配置，具体环境变量清单见 `ops.md`。

---

## 6. 上架前置合规清单

**通用（国内外都要）**
- [ ] 首次进入 App 弹出**隐私弹窗**（Donut 原生隐私弹窗模板，`project.miniapp.json` 已开启 `privacy.enable`）
- [ ] 应用内**隐私政策**披露第三方 SDK（小程序多端框架 SDK、微信 Open SDK），含收集信息与用途
- [ ] 提供**账号注销**功能
- [ ] 系统授权声明文案（相机/相册/位置等）已配置（iOS `privateDescriptions` 已填，Android 按需）

**Google Play 专属**
- [ ] 构建 **AAB**
- [ ] 无 `REQUEST_INSTALL_PACKAGES`（关闭 install）
- [ ] 无 GDT SDK / 广告能力
- [ ] 内购走 **Google Play Billing**
- [ ] 商品定价内容合规（销售策略、商品"媒介"分类——VIP 属虚拟商品，归"订阅/一次购买"）

**国内市场专属**
- [ ] 软件著作权（名称对应）
- [ ] 官网 ICP 备案（涉及社区需《安全评估报告》）
- [ ] OPPO 需 64 位包
- [ ] 隐私协议措辞避免误触发"消息推送/定向推荐"审核

---

## 7. Google Play 首发推进计划

> 用户已定：**先上 Google Play**。银行为编译→签名→支付。

### P0 准备（信息与资产）
- [ ] 注册/确认 Google Play 开发者账号（一次性 $25）
- [ ] 确认/保管 `tianji-release.keystore` 文件位置与密码（保险库化保存，丢失不可换签名更新）
- [ ] 在微信多端应用控制台**绑定 Google Play 应用**（Package Name / 签名证书指纹 SHA-1）
- [ ] 确认 `install` 默认值：关闭 `REQUEST_INSTALL_PACKAGES`

### P1 技术验证（✅ Billing 官方支持已确认）
- [x] ~~验证 Donut 是否支持原生扩展挂载 Google Play Billing~~ → **官方原生支持** `wx.miniapp.GooglePlayBilling`（Android SDK ≥1.5.8，v20.2 已确认并接入，见 §4.2）
- [x] ~~搭建最小 Billing 验证工程~~ → 前端 `launchBillingFlow` + 后端 `google-verify` 验签链路已实现（v20.2）
- [ ] **Play Console 创建商品** `vip_monthly` / `vip_yearly`（INAPP，价格自定）
- [ ] **Google Cloud 创建服务账号**并导出 JSON 密钥，Play Console「用户和权限」关联授权（查看财务数据/管理订单），后端 `.env` 填入
- [ ] **License Testers 测试账号**配置，沙箱/内测走通「下单→支付→验签→开通→消耗」全链路

### P2 支付集成（海外版）
- [x] ~~后端新增 Google Billing 验签/发货模块~~ → `src/utils/googleplay.js` + `payment.js /google-verify`（v20.2）
- [x] ~~前端按平台分流：Android+海外 → Billing；小程序/Android国内 → 微信~~ → `env.CHANNEL` 分流（v20.2）
- [ ] 测试商品 sandbox 走通下单—支付—验签—开通—消耗
- [ ] 真机回归：Google 版登录（微信/邮箱）→ VIP 购买 → 到期叠加 → 消耗/退款

### P3 构建与发布
- [ ] `cli build-apk --useAab true` 或开发者工具云构建 AAB（正式版）
- [ ] Google Play Console 上传 Bundle、填商店信息/截图/隐私/数据安全
- [ ] 提审、审核通过、发布（先内部测试→封闭测试→生产）

### P4 国内版（后置）
- [ ] 复跑国内 APK 64 位构建（OPPO 等）
- [ ] 各市场上架（华为/应用宝优先）
- [ ] 国内支付统一微信通道回归验证

---

## 8. 待确认 / 风险

1. ~~**Google Play Billing × Donut**（原判最高风险）~~ → **已解除（2026-08-26）**：官方 `wx.miniapp.GooglePlayBilling` 原生支持，v20.2 已实现前端拉单 + 后端 Play Developer API 验签发货。剩余不确定性：Play Console 商品/服务账号配置、真机支付回归、`skyline` 扩展 SDK 开启后对渲染的影响（构建后重点回归）。
2. **海外访问走国内服务器**：延迟/合规待评估，初期可接受。
3. **微信登录于 Google Play**：仅微信登录可能触审核"需提供其他登录"，待首次提审反馈。
4. **包名/数据是否隔离**：海外与国内共用 ApplicationId 与服务端，用户/订单是否隔离需产品决策（当前倾向共用，简化）。
5. **签名文件保管**：`tianji-release.keystore` 为单点资产，须备份。

---

## 9. 签名切 Release 专项（2026-08-20）

### 9.1 背景与根因

- 历史（2026-08-12，ops.md 记录）：构建出的 `com.clawbook.tianji-0.0.1.apk` 实际签名 = **Android Debug 调试证书**（SHA1 `DC:1E:8A:8E:...`，MD5 `bb7e7c0d32d67753690c7a6863a2ca8e`），开放平台应用签名也配置成 debug 的 MD5；`project.miniapp.json` 里配置的 `tianji-release.keystore`（当时记录 MD5 `e804889b...`）**未被构建流程使用**。
- 曾误判为"微信开发者工具多端构建无法配置 release 签名"。
- **2026-08-20 重新核实**：
  - 官方文档明确：构建 APK/AAB 面板可填 keyAlias/keyPassword/storePassword/签名文件；CLI `cli build-apk --keyPass --storePass --keyAlias --keyStore` 也支持。**框架支持 release 签名**。
  - 仓库 `tianji-release.keystore`（2824 字节）经 keytool 实测**口令/别名匹配、证书有效**：MD5 `e804889b567f1a4baf382730a6383727`、SHA1 `0C:74:2A:1E:C7:EB:82:4F:66:09:F3:9F:C1:8A:DA:8E:F0:5F:64:BE`、SHA256 `E6:42:9D:1E:49:20:D9:01:B4:06:5D:9D:66:93:3B:2C:57:FD:AD:41:8B:B6:EC:C1:B3:74:11:5A:5D:D4:0E:2D`、SHA256withRSA、所有者 `Beijing Wuyuan Digital Technology Co Ltd`。**经 2026-08-25 keytool 复核，MD5 即为 `e804889b...`（此前"与旧记录不同"措辞有误导，已更正，以本 MD5 为准）。**
  - 之前 release 未生效，系统已退出构建/未登录，故未能在本机跑通云构建验证；`cli` 返回 `✖ initialize`。

### 9.2 各平台签名统一结论

| 维度 | 结论 |
|------|------|
| Google Play + 国内各市场（Android） | **统一**：同一 `tianji-release.keystore` + 同一包名 `com.clawbook.tianji`，一套 release 签名覆盖所有 Android 市场 |
| iOS | **独立体系**：Apple 开发者证书 + profile + p12，无法与 Android 共用；但归入同一"正式发布"版本身份管理 |
| 微信开放平台 | **必须同步改**：现配置为 debug 证书指纹，切换 release 后须把"应用签名（MD5/SHA1）"更新为 release 证书对应指纹，否则微信登录/分享/支付验签会失败 |

### 9.3 签名填写字段（云构建面板 / 构建 APK、AAB 时如实填写）

来源：`project.miniapp.json` → `mini-android.androidCertificate`，与 keystore 实测一致。

| 面板字段 | 填的值 | 来源 |
|---|---|---|
| 证书别名 keyAlias | `tianji` | androidCertificate.alias |
| 证书密码 keyPass | `tianji2026` | androidCertificate.aliasPassword |
| 证书文件密码 storePass | `tianji2026` | androidCertificate.storePassword |
| 签名文件 keyStore | `tianji-release.keystore`（项目根目录，选择该文件） | androidCertificate.storeFilePath |
| 发布格式 | Google Play 选 **AAB**；国内选 APK | — |
| 版本号 version / versionCode | `0.0.1` / `100`（提审前递增） | project.miniapp.json 顶部 |

### 9.4 渠道默认语言（v2.9：Google 版默认英文 / 国内版默认中文）

- Donut `build-apk` 官方 CLI **不支持**注入自定义渠道/env 变量，故用构建前配置切换：
- `tianji-tuiyan-miniprogram-v10/config/env.js` 顶部的 `CHANNEL`：
  - `CHANNEL = 'google'`（当前）→ App 默认英文（`DEFAULT_LANG='en'`）
  - `CHANNEL = 'cn'` → App 默认中文（国内华为/应用宝等）
- 生效逻辑（`utils/i18n.js`）：**用户已手动选择过语言 → 优先用户选择（storage 持久化）**；否则取渠道默认；**小程序端始终默认中文**。
- 使用方式：构建对应市场前改 `CHANNEL` 一行即可，用户分级体验仍可在「我的」页自选语言。

### 9.5 切 release 实施步骤（已确认一步到位 + 同步开放平台）

1. **备份保管** keystore：将 `tianji-release.keystore` 连同口令 `tianji2026`、alias `tianji` 归档到安全保险库（丢失后无法换签名更新已有包）。
2. **打开微信开发者工具并登录**，打开 `tianji-tuiyan-miniprogram-v10` 项目，切换「多端应用模式」，确保 CLI 通道在线（`cli islogin` 返回登录态）。
3. **构建 release 包**（二选一）：
   - 工具 UI：构建 APK/AAB →「证书签名」填入 `tianji-release.keystore` 路径、密码 `tianji2026`、别名 `tianji`；发布 Google Play 选 AAB（`useAab true`）。
   - 命令行示例（keyStore 用绝对路径）：
     `cli build-apk --project "d:\MyCode\天机推演\tianji-tuiyan-miniprogram-v10" --keyStore "d:\MyCode\天机推演\tianji-tuiyan-miniprogram-v10\tianji-release.keystore" --keyPass tianji2026 --storePass tianji2026 --keyAlias tianji --useAab true --output "构建产物目录"`
4. **核验产物签名**：对构建出的 release APK 计算 MD5/SHA1（normalize 去除冒号小写），读取其实际签名指纹。
5. **同步微信开放平台**：在开放平台移动应用修改「应用签名」为该 release 的 MD5（与 AndroidManifest 包名一致），否则微信能力失效。
6. **真机回归**：验证微信登录、分享、支付（`create-app-order`）在 release 签名下全链路可用。
7. **更新本文档**：将核验得到的 release MD5/SHA1 回填到 9.1/9.3。

> ⚠️ 当前会话中 `cli` 因工具未登录/未打开项目返回 `✖ initialize`，未能现场产出 release 产物；需在工具在线环境下按上表操作。
> ⚠️ MD5 指纹（微信开放平台"应用签名"字段需要）需从 release APK 计算，采用 `keytool -printcert -jarfile xxx.apk` 或 `apksigner`/`jarsigner` 提取，本文暂不编造数值。

### 9.6 Play 应用签名重签名专项（2026-10-16）——Play 版启动崩溃根因

**现象**：荣耀手机从 Google Play 下载安装后，打开即为 Donut 错误页（底部 `Powered By Donut`）：
`err:UNKNOWN, errCode:0, errMsg:kotlinx.serialization.json.<混淆类>: U...`
（`Unexpected JSON token` 家族——SDK 拿到的内容不是它期望的 JSON，属 SDK 内部未处理异常）。

**根因（已实测坐实）**：设备上**实际装到的包**其签名证书，与**微信开放平台登记的「应用签名」**不一致：
| 包 | 签名证书 MD5 | 荣耀机表现 |
|---|---|---|
| 官网/本地 release 包（3.1.0 / 3.4.3 / 3.4.7.apk，以及上传 Play 用的 3.4.8.aab 上传密钥） | `e804889b567f1a4baf382730a6383727` | 3.4.7 **正常启动** |
| Play 分发包（Google 二次签名，`deployment_cert.der`） | `fc90532aee3769032e8b8824b6753a66` | 3.4.8 **启动报错** |
开放平台登记值（2026-08-25 用户后台切换并核对）= release MD5 `e804889b...`，与 Play 分发包不符 → 多端 SDK 启动期签名校验失败。

**排除项（证据）**：3.4.7.aab 与 3.4.8.aab 解包逐项对比——65 个 `.so` 数量与大小完全一致、dex 仅差数百字节、`base/manifest/AndroidManifest.xml` 仅差 1 字节、内嵌小程序包 `__APP__.wxapkg` 同量级、两者均含 `imPush` 插件 / `libPushSDK.so` / `timpush-configs.json`。⇒ 包内容层面两版几乎相同，**唯一实质差异是签名**；可排除包内 JSON、imPush 推送插件、荣耀通道 `HONOR_APPID` 为空、SDK 1.7.0、targetSdk 36、权限移除等假设。
**官方口径印证**：微信开放社区答复——"请确认在微信开放平台填写的应用签名是否与 **Google Play 生成的签名** 一致"。

**处置方案**：
- **C（✅ 已采用并执行，2026-10-16）用微信开放平台「备用签名」实现"一应用多签名"**：官方文档《配置 Android 应用备用签名》明确——对已配置过包名和签名的应用可新增**备用签名**，用于"签名轮换"场景，**正式签名与备用签名配置后都是有效签名**（不会再出现「应用包名签名信息校验不通过」），且**修改后即刻生效、无需提交审核**；开放社区中"Play 分发签名与微信登记不一致（Play 应用签名密钥一年只能改一次）"的同类问题，官方答复同样是改用备用签名。
  **已执行**（`open.weixin.qq.com` → 移动应用 `天机推演` AppID `wx3260c7ff02b6ba90` → 开发配置 → Android 应用）：
  - 应用签名（主）：保持 `e804889b567f1a4baf382730a6383727` → 官网直装 / 国内各渠道 release 包
  - **备用签名：已改为 `fc90532aee3769032e8b8824b6753a66`** → Play 分发包（Google 二次签名）
  ⇢ 保存成功、无二次验证、无需审核；两处签名同时有效，两个渠道并存，**无需动 Google、无需重建、无需另立包名**。
  ⇢ 回滚方式：把备用签名改回 `e804889b...`。
  ⚠️ 官方备注：备用签名逻辑在微信客户端 > 8.0.62（2025-09 起）生效；本崩溃属 SDK 启动期服务端校验，不受客户端版本影响。
- ❌ **不可行路径（2026-10-16 澄清）**：不能把"构建签名"统一成 Google Play 的签名——Play 应用签名密钥（`fc90532a...`）由 Google 保管，**开发者拿不到其私钥**，无法用它给官网直装 APK 签名；且**重新构建新版本本身不改变签名**（仍是 `tianji-release.keystore`），重新上传 Play 后 Google 依旧二次重签，Play 版照样崩。⇒ 只能反过来统一，即让 Google 改用我方证书（方案 A）。
- ⚠️ **两个密钥必须分清（2026-10-16，Play Console「请求重置上传密钥」入口易误用）**：**上传密钥 Upload Key** = 我方持有、用于签 AAB 后上传（当前 = 我方 release 证书 `E8:04:88:9B:...`，本身就正确）；**应用签名密钥 App Signing Key** = **Google 持有**、用于给最终分发给用户手机的包重签名（当前 = `712C:704B:...` / MD5 `fc90532a...`，即手机实装签名）。Play Console 的「请求重置上传密钥」**只更换上传证书，不影响应用签名密钥**（Google 官方原文：*Resetting your upload key doesn't affect the app signing key that Google Play uses to re-sign APKs before delivering them to users*）⇒ **该入口不能用于解决本崩溃**，误用只会把上传私钥与现有 keystore 的关系搞乱。
- **A（首选，双渠道统一）**：让 Play 也用自有 release 证书签名。
  Play Console → 「应用完整性 / App integrity」→「**应用签名密钥升级**」→ 用该页提供的 `pepk.jar` 与 `encryption_public_key.pem` 打包自有 keystore 后上传，经 Google 审核通过，Play 二次签名即变为我们的 release 证书，`e804889b...` 一处值同时满足官网直装与 Play 分发。
  参考命令：
  `java -jar pepk.jar --keystore=D:/MyCode/tianji-sign/tianji-release.keystore --alias=tianji --output=output.zip --include-cert --rsa-aes-encryption --encryption-key-path=encryption_public_key.pem --storepass=tianji2026`
  ⚠️ 升级后新密钥用于 **Android 13+** 设备的安装/更新签名；低版本"更新"仍由旧密钥（`fc90532a...`）签名，这些机型仍会出现本崩溃。
  🔴 **2026-10-16 Play Console 实测：方案 A 当前不可自助执行。** 应用签名页（`/keymanagement`）显示：**上传密钥证书 = 我方 release 证书**（MD5 `E8:04:88:9B:...E8:37:27`、SHA-1 `0C:74:2A:1E:…`、SHA-256 `E6:42:9D:1E:…0E:2D`）；**应用签名密钥 = Google 的**（SHA-256 `712C:704B:…:50:07` = `deployment_cert.der`，MD5 `fc90532a...`）；「应用签名密钥」板块标注「正在使用」并写明 **「自 2027 年 8 月 20 日起，您可以再次升级签名密钥」**（此前已于 2026-08-20 完成过一次密钥变更，存在「之前的应用签名密钥」，安装量 0%）；整页**不存在**「升级应用签名密钥 / Upgrade app signing key」等自助入口（仅有「请求重置上传密钥」等）。⇒ 想「让 Play 用我方证书签名」在 2027-08-20 前只能走 Google Play 支持申诉特批，否则须改走方案 B。
- **B（备选，最快但二选一）**：把开放平台「应用签名」改为 Play 的 `fc90532aee3769032e8b8824b6753a66`，并把官网下载入口改为引导 Google Play。
  ⚠️ 代价：官网直装 APK（release 证书）将与开放平台失配，**失去微信能力（登录/分享/拉起小程序）**；App 备案的平台公钥/签名 MD5 也需同步评估。
  🔴 **风险提示（比"失去微信能力"更严重）**：现状已证明"安装包签名 ≠ 微信侧登记签名 → 多端 SDK 直接拒绝启动"（Play 版即为此）。因此一旦把登记值改为 Play 的 `fc90532a...`，**所有用自有 release 证书签名的包（官网直装 APK、以及规划中的国内各市场 APK）都会同样无法启动**，而不只是微信能力失效。⇒ 走 B 必须同时解决国内渠道：官网/国内渠道需**另立包名 + 另建移动应用/多端应用**（对应 §1 渠道拆分），或在 B 生效期间官网下载入口改为引导 Google Play（国内无 GMS，需另行权衡）。
  改完需等平台生效（官方提示约半小时）再复测；Play 版**无需重新安装**即可验证（若校验走登记值）。
- **同步项**：`.well-known/assetlinks.json` 的 `sha256_cert_fingerprints` 必须改为**最终分发签名**证书的 SHA256（若走 A，则维持 release SHA256 `E6:42:9D...`；若走 B，须改为 Play 的 `712c704b...`），否则 App Links 失效。见 `ops.md` §2.5。

---

## 10. Google Play 上架合规（targetSdk / 广告 / 符号，2026-08-20）

### 10.1 问题（2026-08-20 Google Play 控制台报审）

首次上传 `com.clawbook.tianji-0.0.1.aab`（targetSdk 29、versionCode 100）后，Play 控制台提示：

- 【错误·阻断】targetSdk=29，达不到 ≥35 —— Google 自 2025-08-31 起新应用须 target Android 15（API 35）+，2025-11-01 起还要求 **16 KB page size** 对齐。
- 【警告】广告 ID 声明未完成（API 33+ 要求）。
- 【提醒】AAB 含原生代码，未上传调试符号。

### 10.2 根因与结论

- targetSdk=29 是 Donut **默认值**（官方默认 29），此前 `project.miniapp.json` 未声明该字段。
- targetSdk 可在 `project.miniapp.json:mini-android` 声明（字段 `targetSdkVersion`，Number；`minSdkVersion` 默认 21）。
- **16 KB 对齐是硬门槛**：Donut 云端注入的 XWeb / 微信运行时 / Flutter 等 .so 由微信云端编译，开发者本地无法改对齐参数；官方社区回复明确须升级 Android SDK 基座到支持 16 KB 的版本。

### 10.3 已执行改动（2026-08-20，已确认方案"升 SDK + targetSdk35"）

`tianji-tuiyan-miniprogram-v10/project.miniapp.json`：

| 字段 | 旧值 | 新值 | 说明 |
|---|---|---|---|
| `mini-android.sdkVersion` | `1.7.0` | `1.7.0-beta.17-1477-SNAPSHOT` | 官方社区为 Google Play 16KB 对齐给出的版本（SNAPSHOT 预发布基座） |
| `mini-android.targetSdkVersion` | （未声明，默认29） | `35` | 满足 Google ≥35 |
| `mini-android.minSdkVersion` | 21 | `26` | SNAPSHOT 版最低 24，官方建议 26 |

> ⚠️ 该 SNAPSHOT 基座存在行为变更，需重点回归（见 10.6）：minSdk 升到 24/26、不再支持 32 位（ABI 仅 arm64-v8a）、XWeb 大版本更新。

### 10.4 广告 ID 声明（Play 后台表单，非代码）

- 本项目**未集成广告 SDK**（无 AdMob / 广告聚合），因此**不添加** `com.android.gms.permission.AD_ID` 权限（加了反而误导）。
- 正确做法：在 **Play 管理中心 → 应用内容 → 广告声明**如实勾选“不使用广告 ID / 未使用 GAID”。那句"必须先完成广告 ID 声明"即指此表单。

### 10.5 调试符号（可选，非阻断）

- Play 建议上传 native 库 debug symbols（`symbols.zip`）以便崩溃 / ANR 分析。Donut 云构建产物通常不自动产出符号包，若无法获取可先忽略，不影响上架。

### 10.6 升级后必做回归清单

1. **Android 全功能回归**：登录、推演（普通/超级）、易缘匹配、写信/回信、节气养生、VIP/支付（微信 `create-app-order`）、分享。
2. **真机 Android 13/14/15** 各测一遍（SNAPSHOT 基座行为变更风险高）。
3. **XWeb 相关页面**重点验证（webview / 富文本渲染）。
4. 确认产物 ABI 仅 `arm64-v8a`（不再含 32 位 `armeabi-v7a`）。
5. 构建时**证书文件密码**填 `tianji2026`（勿填 AppID），格式选 AAB。
6. 重新构建、重新上传 Play 控制台，确认：targetSdk≥35、16 KB 对齐、广告声明完成。

### 10.7 待办（需在工具/后台操作）

- [ ] 开发者工具构建 release AAB（用 10.6-5 的签名），校验 targetSdk/16KB/ABI
- [ ] 核验产物签名 MD5，回填第 9 节
- [ ] 同步微信开放平台应用签名
- [ ] 真机 Android 全功能回归
- [ ] Play 后台填写广告声明、隐私政策 URL、内容分级、应用内评价数据
- [ ] 上传 AAB 复核 targetSdk + 16 KB 状态清除

### 10.8 Google Play 上架进展（2026-09-03 实测）

**已完成**（逐项核销，见对话记录）：
- ✅ **targetSdk 达标**：`project.miniapp.json` → `mini-android.targetSdkVersion = 36`（当前 3.3.6/116）、`minSdkVersion = 26`、`sdkVersion` 用支持 16KB 的 SNAPSHOT 基座；16 KB page size 状态在 Play 控制台已清除。
- ✅ **REQUEST_INSTALL_PACKAGES 已移除**：`mini-android.useExtendedSdk.install = false`，Play 控制台无"未声明敏感权限"提示。
- ✅ **广告 ID 声明**：本项目未集成广告 SDK，不添加 `AD_ID` 权限；Play 后台「应用内容 → 广告声明」如实勾选未使用广告 ID（曾报"广告 ID 声明不完整"，按要求补齐表单后通过）。
- ✅ **隐私政策 / 删除账号**：官网 `/privacy`、`/delete-account` 已登记 Google Play 合规；官网隐私政策补充了广告 ID / 权限声明说明。
- ✅ **旧版本清理**：Play 控制台删除历史旧版 AAB 后，敏感权限提示消除（同版本号重复上传触发缓存残留）。
- ✅ **Billing 占位**：海外版支付已接 Google Play Billing（`googleplay` 能力开关），**留接口占位，待封闭测试完成后正式开通**。

**当前阶段**：封闭测试（Internal/Closed Testing）→ 生产审核。3.3.6 已同时上传谷歌。

**遗留**：iOS 上架（App Store）待 Android 稳定后推进；国内各市场（华为/应用宝）后置。
