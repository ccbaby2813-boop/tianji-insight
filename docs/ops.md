# 运维文档

> **适用版本**：v3.6 | **最后更新**：2026-09-03

---

## 目录

- [1. 服务器环境](#1-服务器环境)
- [2. 部署流程](#2-部署流程)
- [3. 监控与告警](#3-监控与告警)
- [4. 故障排查](#4-故障排查)
- [5. 备份策略](#5-备份策略)
- [6. 安全配置](#6-安全配置)
- [7. 性能优化](#7-性能优化)
- [8. 常用命令](#8-常用命令)

---

## 1. 服务器环境

### 1.1 服务器配置

| 项目 | 配置 |
|------|------|
| 服务商 | 阿里云 VPS |
| IP | YOUR_SERVER_HOST |
| 操作系统 | Linux |
| SSH 用户 | admin |
| 项目路径 | `/home/admin/.openclaw/workspace/projects/tianji-tuiyan/` |

### 1.2 软件环境

| 软件 | 版本 | 用途 |
|------|------|------|
| Node.js | nvm 管理 | 运行环境 |
| MySQL | 8.0 | 主数据库 |
| Redis | 7.x | 缓存/限流 |
| PM2 | 最新 | 进程管理（cluster 模式） |
| Nginx | - | 反向代理 |

### 1.3 端口配置

| 端口 | 用途 |
|------|------|
| 3003 | Express 后端服务 |
| 443 | HTTPS（Nginx） |
| 80 | HTTP → HTTPS 重定向（Nginx） |
| 6379 | Redis（默认端口，非 Docker 独立端口） |
| 3306 | MySQL |

---

## 2. 部署流程

### 2.1 后端部署

#### 完整更新部署

```bash
# 1. 登录服务器
ssh admin@YOUR_SERVER_HOST

# 2. 进入项目目录
cd /home/admin/.openclaw/workspace/projects/tianji-tuiyan

# 3. 拉取最新代码
git pull origin main

# 4. 安装依赖（如有新依赖）
npm install --production

# 5. 重启服务（零停机）
pm2 reload tianji-tuiyan-api

# 6. 验证启动
pm2 logs tianji-tuiyan-api --lines 20
curl http://127.0.0.1:3003/api/health
```

#### 单文件热更新

```bash
# 上传单个文件
scp src/routes/user.js admin@YOUR_SERVER_HOST:/home/admin/.openclaw/workspace/projects/tianji-tuiyan/src/routes/

# 重启服务
ssh admin@YOUR_SERVER_HOST "cd /home/admin/.openclaw/workspace/projects/tianji-tuiyan && pm2 reload tianji-tuiyan-api"
```

### 2.2 数据库迁移

```bash
# 1. 备份数据库
mysqldump -u root -p tianji_tuiyan > tianji_backup_$(date +%Y%m%d).sql

# 2. 上传迁移脚本
scp migrations/005_xxx.sql admin@YOUR_SERVER_HOST:/tmp/

# 3. 执行迁移
ssh admin@YOUR_SERVER_HOST "mysql -u root -p tianji_tuiyan < /tmp/005_xxx.sql"
```

### 2.3 小程序部署

```bash
# 1. 微信开发者工具 → 上传
# 2. 微信公众平台 → 提交审核
# 3. 审核通过后 → 发布
```

### 2.4 App 部署

```bash
# 1. 微信开发者工具 → 多端应用模式
# 2. 构建 Android/iOS
# 3. 上传应用市场
```

### 2.5 微信开放平台 / 多端应用配置基准（统一基准，禁止随意变更）

> **此节为唯一权威配置基准**。所有微信开放平台、多端应用的关键标识信息以本节为准，任何变更必须先在文档中更新后再操作平台，禁止直接改平台后不留记录。

#### 2.5.1 配置体系总览（Donut 官方口径，2026-08-25 核实）

一个 App 上架涉及**三层配置**，存在先后依赖：

1. **微信开放平台创建「移动应用」**：填包名 / 应用签名 / Bundle ID / Universal Link → 提交审核
2. **移动应用审核通过后**，在**多端应用控制台**（developers.weixin.qq.com/platform）把它**绑定到多端应用**（关键是「立即绑定移动应用账号」）
3. **微信开发者工具**构建 APK/IPA 时，自动从上述配置拉取包名 / Bundle ID，另需填入**证书配置**

**官方强调的绑定依赖关系**：
- 多端应用必须先绑定「小程序账号」且主体/资质正常，才能创建/绑定移动应用。
- 绑定后构造 APK 用移动应用的 Package Name、构造 IPA 用移动应用的 Bundle ID / Universal Link，工具会自动注入 `<manifest>` 的 `package` 和 iOS Bundle ID。
- 若**未绑定**移动应用：用平台默认测试包名/测试 Bundle ID（`com.tencent.weauth` / `com.tencent.devtoolssaaademo.db`），**仅供测试不可上架**。
- 改包名/Bundle ID 需回开放平台修改并**重新提审**。

**官方文档源（均已抓取核实）**：
- 打包生成 APK 和 AAB：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/build/build-apk.html
- 打包生成 IPA：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/build/build-ipa.html
- Android 签名证书生成：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/build/android-cert.html
- 生成开放平台 Android 签名：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/build/open_android_cert.html
- Android 签名与公钥（含备案）：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/build/record.html
- iOS 证书申请与配置：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/certificate/ios.html
- 配置 iOS Bundle ID：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/web/bundleid-guide.html
- Universal Link 配置：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/web/universal-link-guide.html
- 创建移动应用（开放平台）：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/web/open_application_create.html
- 复用多端应用创建移动应用：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/handbook/web/mobile_app.html
- project.miniapp.json 配置：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/miniapp/pre-read/config.html

**Android 配置项要点**：
- 签名证书（keystore）：工具内「签名证书管理」或 keytool 生成；构建 APK 面板须填 4 项——证书别名（`keyAlias`）/证书密码（`keyPassword`）/证书文件密码（`storePassword`）/签名文件（keystore 路径）。
- 应用签名（**MD5 值**）：填到 `开放平台-移动应用-Android 开发信息-应用签名`。官方原文"sign(你的App)=固定应用签名(md5)"；用工具「Android 签名与公钥」一键生成，**不要求填 SHA1/SHA256**。
- 包名（ApplicationId）：填 `开放平台-移动应用-Android 开发信息-应用包名`，反转域名，**不可填测试包名 `com.tencent.weauth`**。
- 关键规则：签名**只与证书有关、与包名无关**；用微信能力（登录/分享/支付）则开放平台签名必须与构建 APK 用的证书签名**一致**，否则"签名校验不通过"。
- 构建格式：Google Play 选 **AAB**（`useAab=true`）；国内市场选位 `armeabi-v7a`(32) / `arm64-v8a`(64)，都不勾默认 64 位。
- 公钥用途：**用于 App 备案**（平台公钥 + 签名 MD5 值），**不填开放平台**。

**iOS 配置项要点**：
- 证书：Apple Developer 付费账号申请，上架用**分发证书（Distribution）**导出 P12；不足 "证书签名"方式 / 资源包类型选「正式版」/ 用分发证书，临时签名的 IPA **不能上架**。
- Bundle ID：先在 Apple 注册 App ID，再到 `开放平台-移动应用-iOS 开发信息-Bundle ID` 填同一值；**不可填测试 Bundle ID `com.tencent.devtoolssaaademo.db`**。
- Universal Link：填 HTTPS 链接；**用微信能力则必须是能真正唤起 App 的有效链接**，建议带通配 path（如 `/app/*`）。验证：Safari 打开 `UniversalLink+随机串`，下拉出现「在 App 中打开」即生效。
- 构建 IPA 面板须填：`Certificate（P12）` / `Certificate 密码` / `Provisioning Profile（.mobileprovision）` / `签名证书名`（P12 证书名括号内内容）。

**关于 `miniModuleId`（与官方两代文档的关系，如实记录）**：
- 腾讯官方 Donut 文档分**两代**：旧版（dev.weixin.qq.com/info-docs）用 `miniModuleId`（开发平台申请的模块 id，必填）；新版（developers.weixin.qq.com）顶层完整示例**已不含** `miniModuleId`，改以 `miniVersion`("v2") + `mini-ohos/mini-android/mini-ios` 结构。
- 本项目 `project.miniapp.json` 两代字段并存：`miniVersion:"v2"`（新版）+ `miniModuleId`（旧版，2026-08-25 新增以消除「构建项目资源包」报错）。二者同设为多端应用 AppID `wxa2b41a8a0a8843f5`。

#### 2.5.2 统一权威配置总表（唯一口径，已按 release 签名方案定稿）

> **2026-08-25 全面校准**：经 `keytool` 对 `tianji-release.keystore` 实测，并交叉核对 `project.miniapp.json` / 源码 / 多端配置后重写。**状态列**定义：
> - **① 已实测**：本机 keystore/APK/文件实测得出，可直接照填；
> - **② 待后台核对**：需你在对应控制台（微信开放平台 / 多端应用控制台 / 应用市场 / Apple）对照我提供的值检查或填入。
>
> ⚠️ **口径（2026-08-25 用户已确认选 A）**：正式发布用 **release 证书（`tianji-release.keystore`）签名**；旧 Debug 证书（MD5 `bb7e7c0d`）仅历史测试用，含微信能力（登录/分享/支付）在切换 release 后必须同步把开放平台"应用签名"改为 release 的 MD5。

| 配置项 | 值 | 状态 | 填到哪 | 说明 |
|--------|-----|------|--------|------|
| 小程序 AppID | `wx3bf727c0fbdd4f8e` | ① 已实测 | 后端 `WX_APPID` | 微信小程序 |
| 多端应用 AppID | `wxa2b41a8a0a8843f5` | ① 已实测 | 后端 `MINIAPP_APPID`、`project.miniapp.json` 的 `miniModuleId` | Donut 多端应用 |
| 小程序原始 ID | `gh_3d91a850c688` | ① 已实测 | `utils/share.js`、`app.miniapp.json` userName | 分享卡片 |
| Android 包名（ApplicationId） | `com.clawbook.tianji` | ① 已实测 | 开放平台移动应用·Android 开发信息 | **官方标注"不可填测试包名 com.tencent.weauth"** |
| 移动应用 AppID | `wx3260c7ff02b6ba90` | ✅ 已确认（2026-08-25 用户核对） | 后端 `WXPAY_APP_APPID`（APP 微信支付预留）、开放平台·移动应用 | 移动应用标识，用户已确认；**APP 微信支付尚未审批**（需拿到软著后再上应用市场，上架后腾讯才批 APP 支付，见 §2.5.3） |
| iOS Bundle ID | （待 iOS 启动时补） | ② 待后台核对 | Apple + 开放平台 iOS 开发信息 | 目前只上 Google Play（Android），iOS 暂缓 |
| 官方开放平台当前生效签名（MD5） | `e804889b567f1a4baf382730a6383727` | ✅ 已切换 release（2026-08-25 用户后台确认） | 开放平台·移动应用·应用签名 | 原为 Debug `bb7e7c0d...`，**用户已改为 release MD5 并核对无误** |
| 官网域名 | `claw-book.cn` | ① 已实测 | 分享 webpageUrl / Universal Link / 备案 | 含 www |

**【正式发布所用 release 证书 `tianji-release.keystore`（2026-08-25 keytool 实测，权威值）】**

| 配置项 | 值 | 状态 | 填到哪 | 说明 |
|--------|-----|------|--------|------|
| 证书文件（keystore）路径 | `d:\MyCode\天机推演\tianji-tuiyan-miniprogram-v10\tianji-release.keystore` | ① | 微信工具·证书签名、`project.miniapp.json` `androidCertificate.storeFilePath` | 全市场同一把 |
| 证书别名（keyAlias） | `tianji` | ① | 构建面板 / `androidCertificate.alias` | |
| 证书密码（keyPass / aliasPassword） | `tianji2026` | ① | 构建面板 / `androidCertificate.aliasPassword` | 勿填 AppID |
| 证书文件密码（storePass / storePassword） | `tianji2026` | ① | 构建面板 / `androidCertificate.storePassword` | |
| 证书 MD5（微信"应用签名"填此） | `e804889b567f1a4baf382730a6383727` | ① **已实测确认** | 开放平台·移动应用·应用签名 | 带冒号 `E8:04:88:9B:56:7F:1A:4B:AF:38:27:30:A6:38:37:27` |
| 证书 SHA1 | `0C:74:2A:1E:C7:EB:82:4F:66:09:F3:9F:C1:8A:DA:8E:F0:5F:64:BE` | ① | Google Play / 微信工具绑定、多端应用控制台 | |
| 证书 SHA256 | `E6:42:9D:1E:49:20:D9:01:B4:06:5D:9D:66:93:3B:2C:57:FD:AD:41:8B:B6:EC:C1:B3:74:11:5A:5D:D4:0E:2D` | ① | 备案/部分平台 | |
| 证书公钥（SPKI/DER Base64，备案用） | `MIIBCgKCAQEApujwWhIImr5o637h+X6QFv3qnTFv53GzvOLqzAD2wyufRnNiv3R8VOmpNHtHXKC2MF/y91jEdePC7mld5vBFBdnLy5xw0M977kqi5bANWiZ+fezCEJ+G2XVEegK95WIjy7VDWLRL4t96tDP09V97lZzQoeww+hFfVlbMTqCwPAy/fOAT2JLsZXN+S451RNMvqFMgLt2yddm7Q9NUXaTi8SsDH5XboezdY1SU+mgs9CTjDThxibW80FNbVveYcHzYIMFXfWgN+RYiR+z5Pcaka7/O/RYrY934EA+SKki5rMvObFwCKceSsECqmEqoKcNhJQQd4cY4YIiBNxAeyxu0owIDAQAB` | ① | App 备案（非开放平台） | |
| 所有者 | `CN=Beijing Wuyuan Digital Technology Co Ltd, OU=Development, O=Beijing Wuyuan, L=Beijing, ST=Beijing, C=CN` | ① | —— | 有效 2026-08-01 ~ 2053-12-17，2048 位 RSA，SHA256withRSA |
| URL Scheme | `tianji` | ① | `project.miniapp.json` `mini-android.schemes.scheme` | 唤起 `tianji://match?sid=` |
| 有效期限 | `2026-08-01 ~ 2053-12-17` | ① | —— | 2048 位 RSA，SHA256withRSA |

> ✅ **2026-08-25 确认**：开放平台"应用签名"已切换为 release MD5 `e804889b...`，用户已在后台核对无误。微信能力（登录/分享/支付）将以 release 签名校验。

**Google Play 签名指纹记录（2026-08-25 用户从 Play 控制台核对）**：

控制台「应用签名 / App signing」显示的 5 组指纹（用户已逐一标记"已验证"）均为 **SHA256**。其中：

| 指纹（SHA256） | 归属 |
|---|---|
| `E6:42:9D:1E:49:20:D9:01:B4:06:5D:9D:66:93:3B:2C:57:FD:AD:41:8B:B6:EC:C1:B3:74:11:5A:5D:D4:0E:2D` | ✅ **= release 证书 `tianji-release.keystore` 的 SHA256**，本地已实测一致 |
| `E1:60:EA:30:21:DB:63:94:03:3A:9C:F4:5C:E6:01:B2:42:E3:DE:25:13:A1:33:AC:19:35:D7:17:6C:70:13:BC` | Google 密钥组（Peppermint）之一 |
| `C9:3D:A1:6A:3F:B0:9A:58:0F:44:29:91:31:15:61:FD:81:C7:98:65:1C:56:81:81:4A:18:23:B7:26:C7:D9:B7` | Google 密钥组之一 |
| `EB:2D:2D:E9:01:62:98:C2:8E:BE:46:FE:F0:F6:5A:ED:F3:BD:63:D9:77:7D:3C:C8:B7:CE:F8:20:EB:40:16:04` | Google 密钥组之一 |
| `71:2C:70:4B:8F:3B:3B:FD:B1:53:44:C2:0C:78:7F:7F:04:0C:6C:4A:CA:95:9A:5F:2A:A2:B3:E2:4C:C5:50:07` | **Play 实际用于分发的二次（应用）签名证书**（2026-10-16 实测 `deployment_cert.der` 确认，MD5 `fc90532aee3769032e8b8824b6753a66`） |

> 应用名 `天机推演`、包名 `com.clawbook.tianji`、状态「已注册/已验证」。release 证书（上传密钥）与 Google 二次签名（Peppermint）指纹并存属正常。

> 🔴 **2026-10-16 实测结论（Play 版启动崩溃根因）**：Play 分发的 APK 由 **`deployment_cert.der`** 二次签名，其 MD5 = `fc90532aee3769032e8b8824b6753a66`、SHA1 `bf7eecf25e5e37697e533ea30c93b91387ce82fd`、SHA256 `712c704b8f3b3bfdb15344c20c787f7f040c6c4aca959a5f2aa2b3e24cc55007`。该证书与开放平台登记的 release MD5 `e804889b...`（同表上方 ①）**不一致** → 设备上装的 App 签名与被登记值不符 → 多端 SDK 启动期签名校验失败，荣耀机上表现为启动即报 Donut 错误页（`Powered By Donut` + `errMsg:kotlinx.serialization...`）；同一台机装官网 release 包（3.4.7）则正常。
> 处置见 `release.md` §9.6：**首选**「Play 应用签名密钥升级」为自有 release 证书（可同时兼容官网直装与 Play 分发）；**备选**把开放平台应用签名改为 Play 的此 MD5（代价：官网直装包失去微信能力）。
> ⚠️ 口径：凡与「最终分发签名」相关的配置（`.well-known/assetlinks.json`、多端应用控制台、开放平台应用签名）都必须以**最终分发渠道**的实际签名证书为准。

> ✅ **2026-10-16 处置（已执行）**：在 `open.weixin.qq.com` 移动应用 `天机推演`（AppID `wx3260c7ff02b6ba90`）→ 开发配置 → Android 应用 中配置**备用签名** = Play 分发包签名 `fc90532aee3769032e8b8824b6753a66`；**应用签名（主）保持 release 的 `e804889b567f1a4baf382730a6383727`**。官方规则（《配置 Android 应用备用签名》）：正式签名与备用签名**均为有效签名**、**修改后即时生效、无需提交审核**。⇒ 官网直装（release 签名）与 Play 分发（Google 二次签名）两个渠道可并存，解决"Play 版启动即崩"问题。回滚：把备用签名改回 `e804889b...`。

**Android App Links / `.well-known/assetlinks.json`（v3.3）**：
- 作用：http(s) 域内链接直接拉起已安装的 Android App（比 scheme 更友好），未装 App 时浏览器回退。与 scheme、iOS Universal Link 共同构成"网页 → App 合盘"的深链三件套（见 `frontend.md` §10.3）。
- 文件：本地 `.well-known/assetlinks.json`，线上部署于 `/var/www/tianji-wellknown/.well-known/assetlinks.json`，复用既有 `location /.well-known/`（root `/var/www/tianji-wellknown`），**无需改 nginx**。
- 内容：`package_name = com.clawbook.tianji`，`sha256_cert_fingerprints` = release 证书 SHA256（**小写、冒号分隔**）`e6:42:9d:1e:49:20:d9:01:b4:06:5d:9d:66:93:3b:2c:57:fd:ad:41:8b:b6:ec:c1:b3:74:11:5a:5d:d4:0e:2d`（即上表 ① 值转小写）。
- 线上验证：`https://claw-book.cn/.well-known/assetlinks.json` 返回 200 且内容正确。
- ⚠️ **指纹口径**：App Links 校验的是**最终分发 APK 的签名证书**。目前官网下载 APK 用 release 证书签名，故先用上表 release SHA256；若后续改经 Google Play 分发（Play App Signing 的二次签名证书是 Google 的，见下方「Google Play 签名指纹记录」），需把该文件指纹替换为 Play Console 应用签名证书的 SHA256，否则 App Links 失效。

#### 2.5.3 后台待核对 / 待填写清单（② 状态项，需你在各后台对照检查）

> 以下项我无法从本机/文档确认真实当前值（属后台或密文），整理成清单供你逐个核对。**凡与上表 release 签名不一致处，以切换 release 后的口径为准**。

| 后台 / 位置 | 配置项 | 类型 | 现状文档记录 | 你需要做的事 |
|------------|--------|------|--------------|--------------|
| 微信开放平台·移动应用 | Android 应用签名 | 核对 | 现为 Debug MD5 `bb7e7c0d...` | **切 release 后改为 release MD5 `e804889b...`** |
| 微信开放平台·移动应用 | Android 包名 | 核对 | `com.clawbook.tianji` | 确认与 `project.miniapp.json` 一致 |
| 微信开放平台·移动应用 | iOS Bundle ID | 待填 | 无 | iOS 启动时再填，目前空缺 |
| 微信开放平台·移动应用 | Universal Link | 核对 | `https://claw-book.cn` | 确认有效且能唤起 App |
| 微信开放平台·移动应用 | **移动应用 AppID** | ✅ 已确认 | `wx3260c7ff02b6ba90` | 用户已核对确认；APP 微信支付预留用（APP 支付未审批，等软著+应用市场上架后腾讯再批） |
| 多端应用控制台 | 绑定移动应用账号 | 核对 | —— | 确认已绑定（决定包名/Bundle ID 来源） |
| Google Play 控制台 | 签名归属（指纹匹配） | ✅ 已核对（2026-08-25 用户确认） | 应用签名证书 | 控制台 5 组指纹中 `E6:42:9D:1E:...D4:0E:2D` = release 证书 SHA256，**与本地 release 证书一致**；其余为 Google App Signing(Peppermint) 密钥组（详见下方 Play 指纹记录） |
| Google Play 控制台 | 商店信息/隐私/数据安全 | 待填 | —— | 上架表单 |
| 后端 `.env`（服务器） | 微信虚拟支付 | ✅ 已实测 | 服务器 `.env` 存在 `XPAY_OFFER_ID`/`XPAY_APP_KEY`/`XPAY_ENV=0`（正式） | **当前双端支付走虚拟支付 XPAY，正式环境** |
| 后端 `.env`（服务器） | `WXPAY_*`（APP/H5 微信支付 V3） | ❌ 未配置 | 服务器 `.env` **无 `WXPAY_MCHID`/`WXPAY_APPID`/`WXPAY_APP_APPID`/`WXPAY_API_V3_KEY`/`WXPAY_SERIAL_NO`/`WXPAY_PRIVATE_KEY`** | 与 release.md §4.1"国内统一微信支付"描述**不一致**，当前未启用；`.env.example` 仅预留模板。**原因（用户确认 2026-08-25）**：APP 微信支付尚未审批，需先拿到**软著**、再**上应用市场**，上架后腾讯才会批 APP 支付；届时再申请 APP 支付商户号并启用 |
| 后端 `.env`（服务器） | `WX_APPID` | ✅ 已实测 | `wx3bf727c0fbdd4f8e` | 与总表一致 |
| 后端 `.env`（服务器） | `GOOGLE_PLAY_PACKAGE` / `GOOGLE_PLAY_CREDENTIALS_JSON`(或PATH) / `GOOGLE_PLAY_TEST_MODE` | 待填（v20.2） | 未配置 | **Google Play Billing 服务端验签**（海外版内购）。凭据=Google Cloud 服务账号 JSON 密钥，并在 Play Console「用户和权限」关联授权；`GOOGLE_PLAY_TEST_MODE=1` 仅联调用，生产严禁。详见 release.md §4.2 |
| 后端 `.env`（服务器） | `MINIAPP_APPID` | ✅ 已实测 | 存在 | 与总表一致 |
| 后端 `.env`（服务器） | `MOBILE_APP_ID`（移动应用凭证） | ✅ 已实测 | 已配置（18 位，wx 开头） | APP 分享/登录 OAuth2 用 |
| 后端 `.env`（服务器） | `WX_WEB_APPID` | ✅ 已实测 | 存在 | 官网网页扫码登录 |
| Apple Developer | 分发证书 / P12 / Provisioning Profile / Bundle ID | 待填 | 无（iOS 未启动） | iOS 上架时再补 |
| App 备案平台 | 平台公钥 + 签名 MD5 | 待填 | release 公钥见 §2.5.2 | 上架应用市场前备案需用 |

> `XPAY_OFFER_ID` / `XPAY_APP_KEY` / `WX_MSG_TOKEN` / `WX_MSG_AES_KEY` 未列入 `.env.example`（模板缺），已在 §2.5.1 备注，需在服务器 `.env` 确认存在。

**签名核验记录**：
- `app/com.clawbook.tianji-0.0.1.apk` 实际签名 = Android Debug 调试证书，MD5 `bb7e7c0d32d67753690c7a6863a2ca8e`（历史值；2026-08-12 记录，当时登录验证通过）。
- ✅ **2026-08-20 已勘正**：此前的「微信开发者工具多端应用构建无法使用 release 签名」为**误判**。官方文档与 CLI（`cli build-apk --keyStore --storePass --keyPass --keyAlias`）均支持 release 签名。仓库 `tianji-release.keystore`（2824 字节）经 keytool 实测口令/别名匹配、证书有效（见上表）。正式发布以 release 证书为准，详见 `docs/release.md` §9。

### 2.6 分享功能修复记录（2026-08-12）

**问题**：APP 端分享小程序卡片到微信失败，错误信息：
```
[share] 分享失败 detail:
  errMsg: "sendOpenReq:fail opensdk failed 并没有通过微信返回多端App。"
  errno: 10100001
```

**根因分析**：
- 签名/包名已核验匹配（登录成功证明 OpenSDK 通路正常）
- 错误表明微信完成分享后无法回调到多端 App
- 多端框架（Donut）应自动生成 `WXEntryActivity`，但可能未正确注册

**修复方案**：
- 在 `miniapp/android/nativeResources/AndroidManifest.xml` 手动注册 `WXEntryActivity`：
  ```xml
  <activity
      android:name="${applicationId}.wxapi.WXEntryActivity"
      android:exported="true"
      android:launchMode="singleTask"
      android:taskAffinity="${applicationId}"
      android:theme="@android:style/Theme.Translucent.NoTitleBar" />
  ```

**验证步骤**：
1. 微信开发者工具 → 清除缓存 → 重新编译
2. 构建 Android APK
3. 安装到手机测试分享功能
4. 检查 vConsole 日志确认是否成功

**注意**：此修复为尝试性方案，若无效可能需要检查多端框架版本或联系微信技术支持。

### 2.7 多端应用签名配置（release 签名已确认可用）

> **2026-08-20 勘正**：本节的旧标题"构建限制/无法使用 release 签名"为 **2026-08-12 的误判**，已更正。官方文档与 CLI 均支持 release 签名，正式发布用 `tianji-release.keystore`（详见 `docs/release.md` §9 签名专项）。

**实测核验（详见 §2.5.2 总表）**：
- `tianji-release.keystore`：别名 `tianji`、口令 `tianji2026`，2048 位 RSA / SHA256withRSA，所有者 `Beijing Wuyuan Digital Technology Co Ltd`，有效期 2026-08-01 ~ 2053-12-17。
  - MD5 `e804889b567f1a4baf382730a6383727`（微信开放平台"应用签名"用此）
  - SHA1 `0C:74:2A:1E:C7:EB:82:4F:66:09:F3:9F:C1:8A:DA:8E:F0:5F:64:BE`
  - SHA256 `E6:42:9D:1E:49:20:D9:01:B4:06:5D:9D:66:93:3B:2C:57:FD:AD:41:8B:B6:EC:C1:B3:74:11:5A:5D:D4:0E:2D`
- 构建 APK/AAB 时选用此 keystore（工具"证书签名"或 CLI `cli build-apk`），即可产出 release 签名包。

**开放平台同步情况（✅ 2026-08-25 已完成）**：
- 开放平台移动应用"应用签名"原为 Debug MD5 `bb7e7c0d32d67753690c7a6863a2ca8e`（历史值），**用户已在后台改为 release 的 MD5 `e804889b...` 并核对无误**。微信能力（登录/分享/支付）现以 release 签名校验。

### 2.8 官网 APK 发版部署（2026-08-18 确认，8.18 版实测）

> **✅ 推荐快捷通道（v19.15 起，无需登服务器/改 nginx）**：管理后台「内容资产 → App下载版本 → 上传 APK → 上传并生效」即可换版本。后端把文件流式存到 `public/apk-current/tianji.apk`，`app_configs` 的 `url` 自动指向 `/api/app-download/file` 流式下发。依赖：服务器 `node_modules/multer` 已装；nginx **两处** admin location（`/tianji/api/admin/` 与 `/api/admin/`，前者走小程序/App 管理入口、后者走官网 `/api/admin`，前端 axios `baseURL=/api/admin` 命中后者）的 `client_max_body_size 1024M`（见 §6.3）。上传后点官网下载按钮即指向新文件。以下原「手动 sftp + 改 nginx」流程仅作兜底参考。

**关键结论（踩坑记录）**：APK **不能**直接传到官网 web 目录（`/home/admin/.openclaw/workspace/projects/web/`），nginx 对 APK 走的是**精确 location + alias**，传错目录会 404。

**APK 实际服务路径**：`/var/www/tianji-tuiyan/`（root 可读，避免 web 目录权限问题）

**发版步骤**：
1. 上传 APK 到服务器并移到服务目录：
   ```bash
   sftp put 本地.apk -> /home/admin/.openclaw/workspace/projects/web/
   sudo mv .../web/com.clawbook.tianji-<版本>.apk /var/www/tianji-tuiyan/
   ```
2. 修改 `/etc/nginx/conf.d/claw-book.conf`：复制现有 `location = /com.clawbook.tianji-0.0.1.apk` 块，改成新版本文件名（alias 指向 `/var/www/tianji-tuiyan/com.clawbook.tianji-<版本>.apk`）
   - 建议保留旧版本 location 不删（已分发的旧链接继续可用）
3. `sudo nginx -t && sudo nginx -s reload`
4. 修改本地 `web/index.html` 下载按钮 href 为新版本文件名，上传到服务器 web 目录
5. 验证：`curl -sI https://claw-book.cn/com.clawbook.tianji-<版本>.apk` 应返回 `200` + `Content-Type: application/vnd.android.package-archive`

**当前线上版本（2026-08-21 更新为 3.1.0）**：
- 下载链接：`com.clawbook.tianji-3.1.0.apk`（versionName `3.1.0`，三段式）
- 历史保留：`com.clawbook.tianji-8.18.apk`、`com.clawbook.tianji-0.0.1.apk`（兼容旧分发链接）；无效版 `3.1` 已删除
- nginx：`claw-book.conf` 已更新 `location = /com.clawbook.tianji-3.1.0.apk`（alias `/var/www/tianji-tuiyan/com.clawbook.tianji-3.1.0.apk`），备份 `claw-book.conf.bak.20260821_3.1.0`
- ⚠️ 约束：Donut 构建 versionName 取自 [project.miniapp.json](../tianji-tuiyan-miniprogram-v10/project.miniapp.json) 的 `version` 字段，**必须三段式**（如 `3.1.0`），否则 Google Play 报「无效的 versionName」被拒。

### 2.9 管理后台白屏排查（2026-08-18 确认，v18.20 修复）

**现象**：`https://claw-book.cn/tianji/admin/` 打开白屏，浏览器无任何 admin API 请求

**根因**：8/16 部署的前端把 CDN（unpkg.com）改成本地 `/tianji/lib/`，但 nginx **没有** `/tianji/lib` 路由；`location /tianji/` alias 指向 `/var/www/tianji-h5/`（无 lib 目录），`try_files` 兜底把所有缺失的 .js 请求回落为 H5 首页 HTML（574B text/html）。浏览器拿 HTML 当 JS → `Vue is not defined` → 应用崩溃白屏。库文件实际在 `/var/www/tianji-tuiyan/lib/`（8/7 放置），一直无路由指向。

**修复**：claw-book.conf 在 `location /tianji/` 前增加：
```nginx
location /tianji/lib/ {
    alias /var/www/tianji-tuiyan/lib/;
    expires 7d;
}
```

**教训**：
- 前端从 CDN 切本地库时，必须同步验证公网 URL 实际返回的 Content-Type 和文件大小（`curl -o /dev/null -w '%{http_code} %{content_type} %{size_download}B'`）
- `try_files` SPA 兜底会把 404 变成 200 HTML，静态资源缺失极易被掩盖
- 白屏 + 零 API 请求 = 前端启动崩溃（查 JS 库加载），区别于"有请求但报错"（查后端）

### 2.10 商店审核体验账号（2026-08-18 上线，v18.21）

**用途**：App 上架应用商店时，审核人员需要一个可登录且额度充足的账号体验完整功能。

**实现**（`src/routes/auth.js`）：
- 环境变量 `REVIEW_PHONE` + `REVIEW_CODE` 控制开关；**不配置则通道完全关闭**
- 审核手机号调用 `send-code` 时跳过真实短信发送和限流；登录时固定验证码直接通过（`isReviewAccount` 判断，其他账号完全不受影响）
- 首次登录自动建号并预置额度：**500 积分**（普通推演用）+ **10 次 VIP 深度解读**（Redis `tianji:extra_vip_decode:<openid>`，永久有效）
- 审核账号为 free 计划，每日普通推演 3 次（resetDailyQuota 正常重置，属预期）

**线上配置**（服务器 `.env`，v18.21 已部署验证）：
```
REVIEW_PHONE=13800001380
REVIEW_CODE=666888
```

**商店提审时填写**：
- 体验账号：`13800001380`
- 验证码：`666888`（任意时候都固定为此码，无需接收短信）

**验证结果**（2026-08-18 实测）：
- 固定验证码登录 ✅（返回 openid `phone_2b170aba83ece88abecf`，points=500）
- `GET /api/payment/vip-info/:openid` ✅（`extraVipDecode: 10`）
- 深度解读扣减逻辑 ✅（free 用户 `extraVipDecode>0` 可直接用，见 `src/routes/tuiyan.js` v18 权限判断）

**维护命令**：
```bash
# 查看审核账号剩余深度解读次数
redis-cli -h localhost -p 6380 -a <REDIS_PASSWORD> GET tianji:extra_vip_decode:phone_2b170aba83ece88abecf
# 审核消耗完后补满 10 次（先删再自增）
redis-cli -h localhost -p 6380 -a <REDIS_PASSWORD> SET tianji:extra_vip_decode:phone_2b170aba83ece88abecf 10
```

### 2.11 国际化 + 网页协议链接修复（2026-08-19 上线验证）

**改动内容**：
1. 节气按钮英文样式适配：英文模式下改为横排显示
2. 协议勾选位置调整：从登录页移至注册页
3. 网页协议链接修复：`.html` 后缀改为路由路径

**部署文件**：
```bash
# 网页版（上传到 /home/admin/.openclaw/workspace/projects/web/）
scp web/index.html admin@YOUR_SERVER_HOST:/home/admin/.openclaw/workspace/projects/web/
scp web/agreement.html admin@YOUR_SERVER_HOST:/home/admin/.openclaw/workspace/projects/web/
scp web/privacy.html admin@YOUR_SERVER_HOST:/home/admin/.openclaw/workspace/projects/web/
scp web/agreement.en.html admin@YOUR_SERVER_HOST:/home/admin/.openclaw/workspace/projects/web/
scp web/privacy.en.html admin@YOUR_SERVER_HOST:/home/admin/.openclaw/workspace/projects/web/
```

**验证结果**（2026-08-19 实测）：
- `https://claw-book.cn/` ✅ HTTP 200
- `https://claw-book.cn/agreement` ✅ HTTP 200
- `https://claw-book.cn/privacy` ✅ HTTP 200
- `https://claw-book.cn/agreement.en` ✅ HTTP 200
- `https://claw-book.cn/privacy.en` ✅ HTTP 200
- PM2 进程状态 ✅ 4 个 cluster 实例在线

**待小程序端验证**：
- 英文模式下节气按钮显示
- 注册页协议勾选位置
- 写信模板英文翻译完整性

### 2.12 分享系统完整修复 + 落地页部署目录勘正（2026-09-03）

> 🔴 **关键勘正（根因）**：落地页 `match.html`/`result.html` 必须部署到**后端 Express 实际 webPath**：
> `/home/admin/.openclaw/workspace/projects/web/`（server.js `webPath = path.join(__dirname, '..', 'web')`）。
> **此前误传至 `/home/admin/.openclaw/workspace/projects/tianji-tuiyan/web/`**，导致 `/tianji/web/` 请求兜底返回官网首页 index.html——"打开分享链接看到静态网页/官网首页"的根因。落地页源码在本地 `_backend_src/web/`。

**部署落地页（三种分享）**：
```bash
# 推演结果落地页 + 匹配/人格落地页 → 必须传到 projects/web/
scp _backend_src/web/result.html admin@YOUR_SERVER_HOST:/home/admin/.openclaw/workspace/projects/web/
scp _backend_src/web/match.html  admin@YOUR_SERVER_HOST:/home/admin/.openclaw/workspace/projects/web/
pm2 restart tianji-tuiyan-api
```

**部署分享路由（后端）**：
```bash
scp _backend_src/src/routes/share.js admin@YOUR_SERVER_HOST:/home/admin/.openclaw/workspace/projects/tianji-tuiyan/src/routes/
pm2 restart tianji-tuiyan-api
```

**验证**：`curl -s 'https://claw-book.cn/tianji/web/match.html?sid=<shareId>'` 应返回落地页（标题「易缘契合 · 天机推演」），而非官网首页；`curl -s https://claw-book.cn/tianji/api/share/resolve/<shareId>` 按 type 返回完整推演记录 / 完整匹配结果 / 分享者卦象。

### 2.13 推送通知 + 节气定时推送（v3.5 起）

- **表**：`notifications`（见 `docs/backend.md`），写入方：`src/routes/match.js`（匹配回应）、`src/routes/letter.js`（信件到达）、`scripts/jieqi-notification.js`（节气提醒）。
- **推送链路**：前端 `utils/push.js` 注册腾讯云 IM Push（SDKAppID 1600161254）→ 后端 `src/services/push-service.js` 按厂商通道下发 → 点击通知按 `ext.type` 跳转（jieqi_reminder→首页；letter_received/match_reply→易缘传书列表）。
- **厂商通道现状**（腾讯云 IM 推送设置页，2026-09-16）：华为 ✅（证书 49769，点击动作=打开应用内指定页面 intent://com.tencent.qcloud.uniapp/detail#Intent;scheme=pushscheme;launchFlags=0x4000000;end）、FCM ✅（49570）、**小米 ✅（49908，ChannelID 160531「易缘传书」，点击动作=打开应用，App 内自行跳转）**；OPPO/vivo/荣耀/魅族 待用户注册开放平台拿凭据。
- **小米 channel**：信函「易缘传书」160531 审核通过（2026-09-16）；节气「节气提醒」已提交审核（消息分类=天气预报，审核通过后把下面脚本 xiaomiChannelID 'tianji_jieqi' 改为真实 id）。
- **节气推送 cron**（服务器 crontab）：
```bash
0 9 * * * cd /home/admin/.openclaw/workspace/projects/tianji-tuiyan && /usr/bin/node scripts/jieqi-notification.js >> /home/admin/tianji-db-backups/jieqi-notification.log 2>&1
```
- 每日 9:00 触发，脚本内部 `lunar.getJieQi()` 判断**仅节气变更当天**才写入通知（非节气日跳过）。
- 通知路由：`src/routes/notification.js`（GET /api/notifications 列表、未读数、标记已读、全部已读）。
- **小米消息分类新规（2026）**：好友聊天类推送标题=发送人昵称、内容=实际聊天内容（禁止模糊消息）——letter.js 已按 `[好友消息]${senderNick}` + 真实信件内容（≤50字）合规。



---

## 3. 监控与告警

### 3.1 PM2 监控

```bash
# 查看进程状态
pm2 status

# 实时监控
pm2 monit

# 查看详细信息
pm2 describe tianji-tuiyan-api
```

### 3.2 日志查看

```bash
# 实时日志
pm2 logs tianji-tuiyan-api

# 最近 100 行
pm2 logs tianji-tuiyan-api --lines 100

# 错误日志
pm2 logs tianji-tuiyan-api --err

# 日志位置（PM2 配置自定义路径）
/home/admin/logs/tianji-out.log
/home/admin/logs/tianji-error.log
```

### 3.3 健康检查

```bash
# API 健康检查
curl http://127.0.0.1:3003/api/health

# 响应示例
# {"success":true,"status":"ok","version":"10.3","db":{"status":"active","totalConnections":4,"activeConnections":1,"idleConnections":3,"pendingAcquires":0,"config":{"connectionLimit":15,"queueLimit":100}},"redis":"connected","openidResolve":{"total":0,"cacheHit":0,"dbHit":0,"dbError":0,"cacheSize":0},"timestamp":"2026-08-12T00:00:00.000Z"}

# 数据库连接检查
mysql -u root -p -e "SELECT 1"

# Redis 连接检查
redis-cli ping
```

### 3.4 关键指标监控

```bash
# 30s 周期监控连接池
watch -n 5 'curl -s http://127.0.0.1:3003/api/health | jq .db'

# VIP 推演计数
redis-cli keys "tianji:vip_decode:*"

# session_key
redis-cli keys "tianji:session_key:*"

# 缓存数据
redis-cli keys "tianji:cache:*"
```

---

## 4. 故障排查

### 4.1 常见问题

| 问题 | 排查方式 | 常见原因 |
|------|---------|---------|
| 服务无响应 | `pm2 status` → `netstat -tlnp \| grep 3003` → `pm2 logs --lines 100` | 进程崩溃 / 端口占用 |
| 502 Bad Gateway | `pm2 status` / `pm2 logs` | 4 实例全部崩溃 |
| 504 Gateway Timeout | 检查 Nginx `proxy_read_timeout` / 推演耗时 | VIP 推演超 300s |
| 连接池耗尽 | `GET /api/admin/settings/db-stats` / `pm2 logs \| grep "DB WARN"` | 慢 SQL / 连接泄漏 |
| 数据库连接失败 | `systemctl status mysql` / `mysql -e "SELECT 1"` / `SHOW PROCESSLIST` | MySQL 宕机 / 连接数满 |
| Redis 连接失败 | `systemctl status redis` / `redis-cli ping` / `redis-cli keys "tianji:*"` | Redis 宕机 → VIP 推演拒绝 |
| DeepSeek 超时 | 检查 `.env` 的 `DEEPSEEK_API_KEY` / `curl -I https://api.deepseek.com` | 网络不通 / API Key 失效 |
| AI 结果解析失败 | `pm2 logs \| grep "AI_ERROR"` / 检查 max_tokens | JSON 格式错误 / token 截断 |
| 支付回调异常 | 检查回调 URL / Token `tianji2026` / `pm2 logs \| grep "[virtual-notify]"` | 签名错误 / 订单不匹配 |
| session_key 缺失 | `redis-cli get tianji:session_key:<openid>` | 用户登录过久（>2h） / Redis 重启 |
| 限流触发 | `pm2 logs \| grep "RATE_LIMITED"` | 真实流量 / 攻击 |
| 内存溢出 | `pm2 monit` / `pm2 logs \| grep "max_memory_restart"` | 单实例超 800M → 自动重启 |

### 4.2 故障恢复流程

```bash
# 1. 查看进程状态
pm2 status

# 2. 重启服务
pm2 restart tianji-tuiyan-api

# 3. 查看日志定位问题
pm2 logs tianji-tuiyan-api --lines 100

# 4. 如需回滚
git reset --hard <previous-commit>
pm2 reload tianji-tuiyan-api

# 5. 数据库回滚（谨慎操作）
mysql -u root -p tianji_tuiyan < tianji_backup_YYYYMMDD.sql
```

> ### 🔴 4.3 OpenClaw 升级事故恢复（2026-09-02 实战）
>
> **事故**：服务器 OpenClaw 升级时删除了 `/home/admin/.openclaw/workspace/` 目录（含 `projects/tianji-tuiyan/` 全部代码、`.env`、`web/`、`scripts/`），导致 App 登录超时、后端数据全空。
>
> **恢复步骤**：
> 1. 从备份恢复：`/home/admin/.openclaw.bak.20260902/`（OpenClaw 升级前的完整 workspace 备份）；
> 2. 将 `projects/` 下的天机推演项目目录还原到 `/home/admin/.openclaw/workspace/projects/`；
> 3. 核对 `.env`（JWT_SECRET / DB / Redis / 微信凭证）完整；
> 4. `pm2 restart tianji-tuiyan-api`，确认 4 cluster 实例在线、`/api/health` 正常；
> 5. 数据库与 Redis 数据未受影响（MySQL/Redis 独立于 workspace），恢复后业务数据完整。
>
> **教训**：升级 OpenClaw 前必须先备份 workspace；本项目关键代码在 Git 仓库 + `.openclaw.bak.*` 双保险。


---

## 5. 备份策略

### 5.1 数据库备份

```bash
# 手动备份
mysqldump -u root -p tianji_tuiyan > tianji_backup_$(date +%Y%m%d).sql

# 恢复
mysql -u root -p tianji_tuiyan < backup_file.sql
```

### 5.2 备份脚本

```bash
#!/bin/bash
# scripts/mysql-backup.sh

BACKUP_DIR="/home/admin/backups"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="tianji_tuiyan"

mysqldump -u root -p"$DB_PASSWORD" "$DB_NAME" > "$BACKUP_DIR/${DB_NAME}_${DATE}.sql"

# 保留最近 30 天备份
find "$BACKUP_DIR" -name "*.sql" -mtime +30 -delete
```

### 5.3 备份计划

| 备份类型 | 频率 | 保留时间 |
|----------|------|----------|
| 数据库完整备份 | 每日凌晨 3 点 | 30 天 |
| 代码备份 | 每次部署前 | 永久 |
| 配置文件备份 | 每次修改后 | 永久 |

---

## 6. 安全配置

### 6.1 SSH 安全

```bash
# 禁用 root 登录
# /etc/ssh/sshd_config
PermitRootLogin no

# 使用密钥登录
PasswordAuthentication no
```

### 6.2 防火墙配置

```bash
# 只开放必要端口
ufw allow 22    # SSH
ufw allow 443   # HTTPS
ufw allow 80    # HTTP（重定向）
ufw enable
```

### 6.3 Nginx 安全

```nginx
# 隐藏版本号
server_tokens off;

# 限制请求体大小
# v19.15/16 管理后台上传 APK：两处 admin location（/tianji/api/admin/ 与 /api/admin/）内已放大到 1024M（此 20M 只影响其他接口）
client_max_body_size 20M;

# 添加安全头
add_header X-Frame-Options "SAMEORIGIN";
add_header X-Content-Type-Options "nosniff";
```

### 6.4 环境变量安全

```bash
# .env 文件权限
chmod 600 .env

# 不要提交 .env 到 Git
echo ".env" >> .gitignore
```

---

## 7. 性能优化

### 7.1 PM2 Cluster 模式

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'tianji-tuiyan-api',
    script: 'server.js',
    cwd: '/home/admin/.openclaw/workspace/projects/tianji-tuiyan',
    instances: 4,  // 4 实例充分利用多核 CPU
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

### 7.2 MySQL 连接池

```javascript
// middleware/db.js
const CONNECTION_LIMIT = parseInt(process.env.DB_CONNECTION_LIMIT || '15', 10);
const QUEUE_LIMIT = parseInt(process.env.DB_QUEUE_LIMIT || '100', 10);

const pool = mysql.createPool({
  connectionLimit: CONNECTION_LIMIT,  // 默认 15（PM2 4 进程 × 15 = 60 总连接）
  queueLimit: QUEUE_LIMIT,
  waitForConnections: true,
  idleTimeout: 60000,                 // 60 秒回收空闲连接
  charset: 'utf8mb4',
  dateStrings: true,
  connectTimeout: 10000,
  enableKeepAlive: true,
  multipleStatements: false,
});
```

### 7.3 Redis 缓存

```javascript
// 热点数据缓存
const cacheKey = `tianji:cache:${type}:${id}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);

// 查询数据库
const data = await db.query(...);

// 写入缓存（TTL 1 小时）
await redis.setEx(cacheKey, 3600, JSON.stringify(data));
```

### 7.4 Nginx 超时配置

```nginx
location /tianji/ {
  proxy_read_timeout 300s;  // 适配 VIP 推演 5 分钟超时
}
```

---

## 8. 常用命令

### 8.1 PM2 命令

| 命令 | 用途 |
|------|------|
| `pm2 status` | 查看所有进程状态 |
| `pm2 logs tianji-tuiyan-api --lines 50` | 查看最近 50 行日志 |
| `pm2 restart tianji-tuiyan-api` | 重启所有 4 实例 |
| `pm2 reload tianji-tuiyan-api` | 零停机重启（cluster 模式逐个重启） |
| `pm2 stop tianji-tuiyan-api` | 停止服务 |
| `pm2 monit` | 实时监控 CPU/内存 |
| `pm2 describe tianji-tuiyan-api` | 查看进程详细信息 |
| `pm2 flush` | 清空日志 |

### 8.2 数据库命令

```bash
# 登录数据库
mysql -u root -p tianji_tuiyan

# 查看连接数
SHOW PROCESSLIST;

# 查看表大小
SELECT table_name, ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
FROM information_schema.TABLES
WHERE table_schema = 'tianji_tuiyan'
ORDER BY size_mb DESC;

# 优化表
OPTIMIZE TABLE tuiyan_records;
```

### 8.3 Redis 命令

```bash
# 连接 Redis
redis-cli -a <password>

# 查看所有 key
KEYS tianji:*

# 查看 key 数量
DBSIZE

# 清空缓存（谨慎）
FLUSHDB

# 查看内存使用
INFO memory
```

### 8.4 系统命令

```bash
# 查看 CPU/内存
top
htop

# 查看磁盘空间
df -h

# 查看网络流量
iftop

# 查看端口占用
netstat -tlnp | grep 3003

# 查看系统负载
uptime
```

---

## 附录：Nginx 配置

> 以下配置取自 `_nginx_config.conf`，为服务器上实际生效的配置。

```nginx
# /etc/nginx/sites-enabled/tianji
# HTTP → HTTPS 重定向（所有域名）
server {
    listen 80;
    server_name claw-book.cn www.claw-book.cn;
    return 301 https://claw-book.cn$request_uri;
}

# HTTPS 主站
server {
    listen 443 ssl http2;
    server_name claw-book.cn www.claw-book.cn;

    # SSL 证书（Let's Encrypt）
    ssl_certificate /etc/letsencrypt/live/claw-book.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/claw-book.cn/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Web 落地页（根路径）
    location / {
        alias /home/admin/.openclaw/workspace/projects/tianji-tuiyan/web/;
        try_files $uri $uri/ /index.html;
        expires 1h;
        add_header Cache-Control "public, no-transform";
    }

    # API 反向代理
    location /tianji/ {
        proxy_pass http://127.0.0.1:3003/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    # 媒体资源
    location /tianji-media/ {
        alias /home/admin/.openclaw/workspace/projects/tianji-tuiyan/media/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```
