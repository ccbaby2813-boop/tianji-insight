# 前端开发文档

> **适用版本**：v3.6 | **最后更新**：2026-09-03

---

## 目录

- [1. 项目架构](#1-项目架构)
- [2. 技术栈](#2-技术栈)
- [3. 目录结构](#3-目录结构)
- [4. 双端差异说明](#4-双端差异说明)
- [5. 核心模块](#5-核心模块)
- [6. 组件开发规范](#6-组件开发规范)
- [7. 样式规范](#7-样式规范)
- [8. API 调用规范](#8-api-调用规范)
- [9. 本地存储规范](#9-本地存储规范)
- [10. 分享功能](#10-分享功能)
- [11. 支付功能](#11-支付功能)
- [12. 常见问题](#12-常见问题)

---

## 1. 项目架构

### 1.1 双端架构

本项目使用**微信小程序原生开发** + **Donut 多端框架**，一套代码同时运行在：
- 微信小程序
- Android App（通过 Donut 编译）
- iOS App（通过 Donut 编译）

### 1.2 系统架构图

```
┌─────────────────────────────────────────────────────────┐
│                    客户端（双端）                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  微信小程序原生（WXML/WXSS/JS）                     │   │
│  │  通过 Donut 编译为 Android/iOS App                 │   │
│  └──────────────────────┬───────────────────────────┘   │
─────────────────────────┼───────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Nginx 反向代理 (claw-book.cn/tianji)         │
│                  proxy_pass → 127.0.0.1:3003              │
└────────────────────────────┬────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────┐
│              Express.js 后端服务 (:3003)                  │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 技术栈

### 2.1 微信小程序

| 技术 | 说明 |
|------|------|
| WXML/WXSS/JS | 小程序原生开发 |
| Donut 多端框架 | 编译为 Android/iOS App |
| miniprogram-ci | 持续集成/上传 |

### 2.2 构建与部署

- **开发工具**：微信开发者工具（Nightly Build ≥ 1.06.2406312）
- **构建命令**：开发者工具内构建
- **App 构建**：多端应用模式 → 构建 Android/iOS

---

## 3. 目录结构

```
tianji-tuiyan-miniprogram-v10/
├── app.js                              # 入口（登录、全局状态）
├── app.json                            # 小程序配置
├── app.wxss                            # 全局样式
├── project.config.json                 # 项目配置
├── project.miniapp.json                # Donut 多端配置
├── app.miniapp.json                    # 多端应用配置
├── config/
│   └── env.js                          # 环境配置
├── utils/
│   ├── api.js                          # HTTP 请求封装
│   ├── storage.js                      # 本地存储
│   ├── audio.js                        # 音效管理
│   ├── share.js                        # 分享功能
│   ├── rewardAd.js                     # 激励视频广告封装（v17.0，adunit-b1076c917f651348）
│   └── fonts.js                        # 字体加载
├── pages/                              # 主包页面
│   ├── index/                          # 首页（推演入口）
│   ├── my/                             # 我的页面
│   ├── result/                         # 推演结果
│   ├── profile/                        # 档案页
│   ├── about/                          # 关于我们
│   ├── login/                          # 登录页
│   └── webview/                        # WebView 页
├── sub/                                # 分包页面
│   ├── learn/                          # 知识库（64 卦 + 奇门遁甲）
│   ├── profile/                        # 档案编辑
│   ├── vip/                            # VIP 购买
│   ├── match/                          # 易缘传书
│   └── legal/                          # 协议与隐私
├── components/                         # 通用组件
│   ├── bottom-declaration/             # 底部声明
│   ├── compass/                        # 罗盘组件
│   ├── icon-guo/                       # 图标组件
│   ├── jieqi-bar/                      # 节气条（v2.0：推荐食材宫格 + 推荐菜卡片 + 内经"说人话/今天照做"）
│   ├── letter-tab-bar/                 # 信件底部导航
│   ├── match-card/                     # 匹配卡片
│   ├── protocol-viewer/                # 协议查看器
│   ├── qimen-compass/                  # 奇门遁甲罗盘
│   ├── share-button/                   # 分享按钮
│   └── share-poster/                   # 分享海报
├── assets/                             # 静态资源
│   ├── audio/                          # 音效文件
│   └── images/                         # 图片资源
└── static/                             # 分包静态资源
```

---

## 4. 双端差异说明

### 4.1 双端对比

| 维度 | 小程序端 | App 端 |
|------|----------|--------|
| **运行环境** | 微信客户端 | Android/iOS 原生 |
| **登录方式** | `wx.login` 静默登录 | `wx.weixinAppLogin` 唤起小程序授权 |
| **视频播放** | 远程视频（同层渲染） | 远程视频（同层渲染，依赖 xweb 内核就绪；未就绪时 bindrendererror 自动降级海报，详见 4.3） |
| **支付方式** | 虚拟支付 | APP 支付 |
| **分享机制** | 小程序原生分享 | Open SDK 分享 |
| **层级控制** | video 同层渲染，z-index 有效 | 同左（xweb 内核就绪后）；未就绪时自动降级海报 |

### 4.2 登录方式差异

**小程序端**：
```javascript
wx.login({
  timeout: 10000,
  success: (res) => {
    // 调用 /api/auth/login
  }
})
```

**App 端**：
```javascript
wx.weixinAppLogin({
  success: (res) => {
    // 调用 /api/auth/miniapp-login
  }
})
```

### 4.3 视频播放策略

**v18.19 方案**：双端统一渲染视频 + `bindrendererror` 同层渲染失败降级

```xml
<!-- 视频：双端统一渲染（保持自闭合标签，禁止内嵌 cover-view） -->
<video class="bg-video" src="{{mediaBase}}/tianji-compass-bg.mp4"
  wx:if="{{showVideo && !bgVideoFailed}}"
  autoplay loop muted object-fit="cover"
  binderror="onVideoError"
  bindrendererror="onVideoRenderError" />

<!-- 海报底图：视频下方兜底（视频卸载/加载中时透出） -->
<image class="bg-poster" src="/assets/images/poster-compass.jpg" wx:if="{{showVideo}}" />
<!-- 低端设备降级：仅海报 -->
<image class="bg-poster" src="/assets/images/poster-compass.jpg" wx:if="{{!showVideo}}" />
```

**App 端 video 同层渲染机制（官方文档核实，v18.19 重新结论）**：
1. Donut App 端 video 同层渲染依赖 **Xweb 扩展 SDK**（`project.miniapp.json` → `mini-android.useExtendedSdk.xweb: true`，本项目已开启）——这正是之前 App 视频背景+组件正常叠加的原因
2. 官方说明：Xweb 内核"**首次启动需要异步下载 xweb 浏览器内核资源，加载完成后，下次冷启动才会使用到对应的渲染效果**"
3. 因此**全新安装/卸载重装**的 App，在内核未就绪期间，video 会退化为原生组件（层级最高，盖住节气条/气泡/玉璧/输入框/按钮）——**这是运行时环境问题，与前端代码无关**。8.17/8.18 APK 首页组件被视频盖住即此原因
4. 修复：官方推荐的 `bindrendererror` 监听同层渲染失败 → `bgVideoFailed = true` 卸载 video → 海报兜底，所有组件恢复可见；内核就绪后（下次冷启动）视频自动恢复

**v18.18 错误结论（已废弃，勿再采信）**：曾判定"xweb 对 video 同层渲染不生效，App 端应弃用视频改海报"。实际是 xweb 内核未就绪的暂时状态，双端视频方案是可行的。

**v18.17 踩坑记录（勿再踩）**：把 `<video>` 从自闭合改为内嵌 `<cover-view>` 结构，会导致小程序端 video 退出同层渲染（开发者工具中页面错乱）；cover-view 不支持渐变/动画/背景图，复杂组件无法用它还原。"video 内嵌 cover-view"路线不可行。

**验证方法（App 端）**：全新安装 APK → 联网打开 App 等待 1-2 分钟（内核下载）→ 完全杀掉 App → 重新冷启动 → 视频应正常同层显示且组件全部可见。若多次冷启动后仍被视频盖住，需检查构建时 Donut SDK 版本（可在开发者工具构建面板尝试回退 sdkVersion）。

---

## 5. 核心模块

### 5.1 登录模块（`app.js`）

```javascript
// v18.7：login() 带并发锁（核心）——进行中的登录复用同一 Promise，
// 防止页面 onLoad+onShow 双调等并发场景反复唤起 wx.weixinAppLogin（微信授权界面"闪几次"）
async login() {
  if (this.globalData.token && this.globalData.openid) return;
  if (this._loginInflight) return this._loginInflight; // 复用进行中的登录
  this._loginInflight = this._doLogin();
  try { await this._loginInflight; } finally { this._loginInflight = null; }
},

async _doLogin() {
  let code;
  
  if (this.globalData.isMpWeixin) {
    // 小程序端（静默）
    const res = await new Promise((resolve, reject) => {
      wx.login({ timeout: 10000, success: resolve, fail: reject });
    });
    code = res.code;
  } else {
    // App 端（唤起微信授权）
    const res = await new Promise((resolve, reject) => {
      wx.weixinAppLogin({ success: resolve, fail: reject });
    });
    code = res.code;
  }
  
  // 双端调用不同接口
  const loginPath = this.globalData.isMpWeixin 
    ? '/api/auth/login' 
    : '/api/auth/miniapp-login';
  
  const result = await api.request(loginPath, 'POST', { code });
}
```

**登录触发约定（v18.7）**：
- 页面需登录时调 `app.login()` 并 `await`（如 VIP 页 `loadVip`：未登录 → `await app.login()` → 成功后立即拉数据；用户取消则静默返回）
- 页面生命周期只在一个钩子里触发（VIP 页仅在 `onShow`，`onLoad` 不再调，避免首次进入双触发）
- `my` 页微信登录按钮（`goWechatLogin`）为用户主动点击的独立实现，带完整状态检查（小程序环境提示已登录 / 已登录兜底 / `wx.weixinAppLogin` 不存在提示 / errCode 映射：10001005 未接入身份管理、10001007 未绑定移动应用、10001015 不支持移动应用助手调试、签名失败、未安装微信、用户取消）

**App 登录页（`pages/login/`，手机号+验证码）协议勾选（v18.7）**：
- `agreed` 默认 `false`（复选框默认不勾选），"获取验证码"与"登录"前均校验，未勾选 toast 拦截
- 《用户协议》《隐私政策》为可点击链接（`goAgreement`/`goPrivacy` 跳 `sub/legal/`）
- 官网会员区块（`web/index.html`）同样默认不勾选；协议/隐私点击弹出摘要阅读层（`Member.showDoc`）

### 5.2 API 封装（`utils/api.js`）

```javascript
const request = (url, method, data) => {
  return new Promise((resolve, reject) => {
    wx.request({
      url: env.API_BASE + url,
      method,
      data,
      header: {
        'Authorization': `Bearer ${getToken()}`
      },
      success: resolve,
      fail: reject
    });
  });
};
```

### 5.3 本地存储（`utils/storage.js`）

```javascript
// 统一存储接口，兼容双端
const set = (key, value) => {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {
    console.error('[storage] set error:', e);
  }
};

const get = (key) => {
  try {
    return wx.getStorageSync(key);
  } catch (e) {
    return null;
  }
};
```

### 5.4 积分体系模块（v17.0）

**前端入口**（Donut 双端同步）：

| 位置 | 说明 |
|------|------|
| 首页推演按钮 | 正面"易学解读"不再显示积分小字（积分体系说明移至「关于我们」页）；积分不足（402）弹窗引导"看视频 +10 / 去签到" |
| "我的"页积分区 | v18.3 定为**印章签到模块**（`.signature-module`），作为桃心易缘区与功能菜单之间"独立的节气章节"：由两段构成——① 顶部"印章装饰线"（短金线 + 圆点 + 印章图标，仿章节起笔）② 居中"签到 +10"签章式胶囊按钮（点开签到弹窗；已签态灰显"今日已签"）。间距（v18.3 移除引导文案后重设）：模块上边距收敛紧贴易缘区、底部 `44rpx` 过渡到菜单，上下留白均衡（`padding: 8rpx 16rpx 44rpx`），装饰线距按钮 `26rpx`；剔除原按钮下方多余金线避免双重分隔；未签态带柔和金色呼吸辉光（`points-gold-breathe`）呼应顶部桃心悬浮动效。历史（v18.2）：含"每日一签 / 连签七日"诗意引导文案；历史（v18.1）：仅一枚签到胶囊按钮，间距割裂；历史（v17.1）：顶部为大字积分 + 签到/看视频双按钮 + 赠次提示 |
| 签到弹窗（v17.1 新增） | 墨韵黑金弹窗（与推演暗色主题一致）：金色标题 + 7 日连签轨道（已签盖印章、第 7 日大奖格金边虚线高亮标注" +100 · 深解×1"、今日格金色辉光高亮）+ 进度文案（"距连签七日大奖还差 N 天"）+ 免费/VIP 权益区分（免费：可抵一次普通推演；易学会员：每日 20 次推演 + 深度解读 1 次，签到积分照样累积）+ 主签到按钮（已签态变灰"明日再来"）。签到成功原地更新并弹合计提示；连签第 7 日 toast 含"+100 · 深度解读×1" |
| 额度菜单 | v18.1 起：免费用户入口右侧显示积分余额"`{points}` 分"；VIP 用户显示"`{points}` 分 · 每日 20 次推演"（历史：免费"推演 · 消耗积分"，VIP"每日 20 次推演"） |

**激励视频广告**（`utils/rewardAd.js`）：

```javascript
// adUnitId: adunit-b1076c917f651348
// showAndReward(onReward)：完整看完（isEnded）才回调 onReward 发奖
// 失败自动 load→show 重试；未看完提示"完整看完才能获得积分哦"
```

**接口对接**：`GET /api/points/balance`（余额/签到状态/赠次）、`POST /api/points/checkin`（签到）、`POST /api/points/ad-reward`（广告奖励，30 秒冷却防刷）

### 5.5 写信话题模板（v16.4）

写信页（`sub/match/letter-write/`）模板从"抒情"改为"话题"，按 5 组分组标签切换：

| 分组 | emoji | 注入数据 |
|------|-------|----------|
| 聊人格 | ☯ | 我的卦（`{guaName}`/`{ziChaoBiaoQian}`/`{talent}`/`{blindspot}`/`{liShiRenWu}`） |
| 聊缘分 | 💞 | 两人匹配关系（`{relationshipName}`/`{matchLevel}`/`{oneLiner}`） |
| 聊节气 | 🍃 | 当前节气（`{termName}`/`{termAction}`/`{termFood}`） |
| 聊推演 | 🎲 | 推演/卦象话题 |
| 走心 | 💌 | 节气 + 卦象 + 开放问句 |

- 数据来源：`/api/solar-term/current` + `/api/gua/{id}` + `/api/relationship/{myGua}/{otherGua}`（对方卦经 openid→profile 定位）
- 选中模板时 `renderTemplate()` 替换占位符；取不到的字段回退通用文案，不报错
- 模板结构为"我的真实信息 + 开放问句"，确保可接话、促进讨论

### 5.6 中英双语模块（v19.0，Google Play 海外上架）

一套代码运行时切换，中文默认，不做双包。中文完整基线备份于 `backup/v18.21-cn-baseline-20260818.zip`。

**核心文件**：
- `utils/i18n.js`：`getLang()/setLang()/isEn()/page(name)/t(key)/langLabel()/fill()/updateTabBar()/applyNavTitle(pagePath, overrideTitle)`，storage key `tianji_lang` 持久化；`NAV_TITLES` 映射表支持页面导航栏标题随语言切换（英文态覆盖 json 中文标题，切回中文恢复）
- `i18n/zh-CN.js`、`i18n/en-US.js`：按页面分模块的文案字典（`common` + 各页面 key + `tabBar`），两文件结构必须一一对应；`tabBar.list` 数组驱动原生 tabBar 文案

**页面改造模式**（以登录页为示范，`pages/login/`）：
- js：`onShow` 注入 `this.setData({ t: i18n.page('页面名'), lang: i18n.getLang(), langLabel: i18n.langLabel() })`；js 内 toast 文案用 `i18n.page('页面名').xxx`
- wxml：硬编码文案替换为 `{{t.xxx}}`（含 placeholder 等属性）
- 切换入口：v19.3 起从登录页迁移到「我的」页面 → 「语言」菜单项（位于「关于我们」上方），点击弹出底部浮层选择中/英文，`selectLanguage()` 调用 `i18n.setLang()` 后全局刷新；tabBar 文案自动切换（`i18n.updateTabBar()`）；其他页面靠 `onShow` 自然刷新

**推演英文输出**：前端推演请求 body 携带 `lang: 'en'|'zh'`（v19.0，见 topology.md 2.3 节），后端按 lang 拼接英文输出指令，JSON 字段名不变。

**官网双语**（`web/index.html`）：`data-i18n`（innerHTML）/`data-i18n-ph`（placeholder）属性 + 页内 `I18N` 字典（zh/en 两套）+ nav 切换按钮；`localStorage.tj_web_lang` 记忆，`?lang=en` 可直链；Member 支付流程的动态提示也已接入。
- 官网 nav 登录入口：中文「登录 / 注册」、英文 `nav_delete: 'Sign in / Register'`（首页与 `delete-account.html` 均如此）；勿再用「注销账户 / Delete Account」。
- 官网三入口 href：协议 `/agreement`（英文 `/agreement.en`）、隐私 `/privacy`（英文 `/privacy.en`）、登录 `/delete-account`；均可直达。
- 官网 `delete-account.html` 与 `index.html` 的 API 基址必须是 `location.origin + '/tianji'`（若写成 `/tianji/api` 会拼出 `/tianji/api/api/...` 404，登录必失败）。
- **官网购买入口（2026-08-21 融合）**：首页 `#member` 为**唯一** H5 购买入口；`delete-account.html` 账户中心已移除 plans/开通按钮，仅保留会员状态 + 注销 + 「前往首页开通会员」链接。两侧登录统一为**邮箱+密码**（`/api/auth/email-login`），消除早期「首页验证码账号 / 登录页密码账号」不一致；首页新用户经「去注册」跳 `/delete-account?view=register` 完成「邮箱验证码+设密码」后再回首页开通。
- 部署目录：`/home/admin/.openclaw/workspace/projects/web/`（server.js 的 `webPath = __dirname/../web`），勿用 `tianji-tuiyan/web/`；见 `_deploy_web.sh`（除 index.html 外，改动 `delete-account.html` 时需自行 `scp` 上传）。

**品牌与术语对照表（v19.1 定稿，全部英文文案必须遵循）**：

| 中文 | 英文（唯一标准） |
|---|---|
| 天机推演 | **I Ching Insight** |
| 推演（产品功能名） | Insight |
| 深度解读/深度推演 | Deep Insight |
| 易缘匹配 | Soul Match |
| 节气养生 | Solar Term Wellness |
| 卦 | Hexagram |
| 卦格 | Hexagram Archetype |
| 卦名 | Wilhelm/Baynes 标准英译（如 乾→Qian (The Creative)） |
| 五行 | Metal / Wood / Water / Fire / Earth |
| 《梅花易数》 | Plum Blossom Numerology |

**英文字体规范**：英文态使用衬线体 `Georgia, 'Times New Roman', serif`（美国文化/神秘学产品惯例，双端系统内置免加载）；标题斜体（italic）营造艺术感，正文正体保证可读。App 端通过 `.lang-en` class、官网通过 `html[lang="en"]` 生效。禁用手写体（script 类）用于正文/表单（可读性差）。

**v19.4 邮箱+密码登录（海外用户，移除手机号登录）**：
- 登录页三 tab：登录 / 注册 / 找回密码（signin/signup/forgot）
- 注册流：邮箱 → 收验证码（邮件，purpose=register）→ 设置密码（≥6位）→ 建号（openid=`email_`+sha256 前20位，赠10积分）；若该邮箱已被微信账号绑定（无密码）→ 后端返回 409 `MERGE_CONFIRM` + `boundNickname` → 前端弹窗确认合并 → 带 `confirmMerge:true` 重新提交 → 两账号合一（微信账号补设邮箱+密码）
- 登录流：邮箱+密码 → bcrypt 校验 → token
- 找回密码流：邮箱 → 收验证码（邮件，purpose=reset）→ 设置新密码 → 重置成功
- 绑定邮箱流（「我的」页入口，`sub/profile/bind-email/`）：邮箱 → 收验证码（purpose=bind）→ 设置密码（≥6位）→ `POST /api/auth/email-bind`；邮箱未占用直接绑定；邮箱已有独立邮箱账号 → 返回 `mergeable:true` + `mergeSummary` → 弹窗确认合并（积分/推演记录/信件迁移到当前账号）→ 带 `confirmMerge:true` 重新提交
- 后端接口：`POST /api/auth/email-send-code`（含 `purpose` 参数：register/reset/bind）/ `email-register` / `email-login` / `email-reset-password` / `email-bind`（详见 topology.md）
- 依赖：users 表 `email`(UNIQUE)/`password_hash` 列；nodemailer + .env `SMTP_*`

**v20 静态数据英文化（64卦人格 + 2080条匹配关系 + 节气养生）**：
- 短字段静态表：`_backend_src/config/hexagrams-en.js`（64卦 name/gua_ge/social_tag，Wilhelm 译名，已完整）
- 长文本（renGe/emotionMode/growthAdvice/关系解读/节气养生等，总量几十万字）：**全量预生成英文静态文件直读**（v20 方案B，`config/` 下 6 个 `*-en.js` 文件，由 `scripts/gen-en-files.js`/`gen-l3-en.js` 生成，`verify-en-files.js` 校验），英文接口毫秒级响应、Redis/AI 零依赖；文件缺失某 key 时降级返回中文
- API：`GET /api/gua/:id?lang=en`、`GET /api/relationship/:a/:b?lang=en`、`GET /api/solar-term/*?lang=en`、`POST /api/letter/match`（body lang）

**已完成批次**：
- ✅ P1：登录页（含邮箱双 tab + 语言切换入口）
- ✅ P2：首页/建档/推演结果/VIP/我的 五页文案提取 + 推演请求携带 `lang`（2026-08-18 完成）
- ✅ P0/P1 接口补传（2026-08-18 v19.2）：match 结果页 `/api/relationship`、match-pool 页 `/api/letter/match-pool`+`/api/letter/match`、letter-write 页 `/api/gua`+`/api/relationship`+`/api/user/profile`、my-matches 页 `/api/letter/friends`、my 页 `/api/user/profile`、建档/编辑档案 POST body `lang`；match-pool 头像配色兼容英文五行值；match 页 `_getLevelClass` 兼容英文等级词（Heaven-Made/Kindred/Complementary，固定译法已固化在 `relationship-en.js`）
- ✅ P3（2026-08-18）：匹配链路 / 信件链路 / 协议页 / 学习模块 静态文案全量提取 + 接口 `lang` 参数补传
  - 字典扩充：`zh-CN.js`/`en-US.js` 新增 `learn` 模块词条（native-gua 详情页、achievement 成就页、learn 主页弹窗与标签）
  - `sub/learn/native-gua/*`：人格详情页改造，新增 `applyI18n`、`ownerLabel` 模板填充，接口 `/api/gua/:id` 带 `lang`
  - `sub/learn/achievement/*`：成就页改造，标题/描述/徽章/按钮全部接入 i18n，分享文案双语化
  - `sub/learn/learn/*`：收集页弹窗（卦辞/象辞/人格/情感/天赋/盲点/历史人物）、欢迎弹窗、罗盘引导、toast、分享文案全部接入 i18n；`loadGuaList`、`onGuaTap` 接口带 `lang`
  - `sub/match/match/*`、`sub/match/letter-write/*`、`sub/match/letter-thread/*`：遗留 `user/profile` 调用补齐 `lang` 参数
- ✅ P4（2026-08-19）：关于我们 / 修改档案 / 奇门遁甲罗盘 页面 i18n 改造
  - `pages/about/*`：关于页全量文案提取（产品宣言、核心功能卡牌、积分体系、公司信息、APP下载、协议、注销账户），JS 注入 `t` + `lang`，WXML 全量 `{{t.xxx}}` 绑定
  - `sub/profile/edit-profile/*`：修改档案页文案提取（标题/表单/性别/提交状态/错误提示），JS 新增 `applyI18n` + 时辰选项本地化，WXML 全量 `{{t.xxx}}` 绑定
  - `components/qimen-compass/*`：罗盘组件接入 i18n，`_getRingDetail` 按 `lang` 切换中/英文；i18n 字典新增 `qimen.rings`（7层环概述：title/desc/role/items）
  - 字典扩充：`zh-CN.js`/`en-US.js` 新增 `about`、`editProfile`、`qimen` 模块词条
- ✅ P5（2026-08-19）：全页面硬编码中文排查与修复
  - `sub/match/match/*`：修复 WXML 中 `{{t.analysis}}`/`{{t.resonance}}`/`{{t.conflict}}`/`{{t.advice}}`/`{{t.share}}`/`{{t.writeLetter}}`/`{{t.prefaceLine}}` 等 key 与字典不匹配问题；修复 JS 中 loadingText/errorMsg/toast/shareTitle 共 7 处硬编码中文
  - `sub/learn/native-gua/*`：修复 onShareAppMessage/onShareTimeline 分享标题中的硬编码中文 fallback
  - 字典扩充：`zh-CN.js`/`en-US.js` 新增 `match` 模块 15 个 key（analysis/resonance/conflict/advice/share/writeLetter/prefaceLine/loadingTextProfile/errorNoProfile/errorIncomplete/errorNoRelation/errorLoadFail/toastNoProfile/toastNoTarget/shareMatchTemplate）+ `learn` 模块 `guaShareTitle` key
- ✅ P6（2026-08-19）：深度国际化 + 语言切换迁移
  - `components/jieqi-bar/*`：节气组件全量国际化（30+ 处 WXML 硬编码 + 8 处 JS toast/label），新增 `jieqi` 模块 33 个 key（节气标题/section/日记/按钮/Toast 等）
  - `sub/match/letter-thread/*`：13 处硬编码替换（toast/modal/actionSheet/formatTime），新增 letter 模块 21 个 key
  - `sub/match/letter-write/*`：3 处 modal/actionSheet 硬编码替换，新增 letter 模块 5 个 key
  - `sub/profile/edit-profile/*`：10 处微信登录相关硬编码 toast 国际化
  - `sub/match/match-pool/*`：网络异常 toast 国际化
  - `pages/webview/*`：3 处硬编码 toast/分享标题国际化
  - `pages/login/*`：移除语言切换按钮（迁移至「我的」页）
  - `pages/my/*`：新增「语言」菜单项 + 底部浮层选择器（中/英文切换，含当前选中态指示）
  - `utils/i18n.js`：新增 `updateTabBar()` 方法，`setLang()` 自动调用刷新原生 tabBar
  - `app.js`：onLaunch 调用 `i18n.updateTabBar()` 启动时渲染正确 tabBar 文案
  - `app.json`：tabBar 保留中文默认文案（运行时由 `updateTabBar()` 覆盖）
  - 字典扩充：`zh-CN.js`/`en-US.js` 新增 `jieqi` 模块 33 key、`letter` 模块 26 key、`common` 模块 3 key、`my` 模块 8 key、顶层 `tabBar` 配置
- ✅ P7（2026-08-20）：节气动态数据国际化 + 网页版部署
  - `i18n/en-US.js`：`jieqi` 模块新增 13 个动态数据映射表（termMap/wuxingMap/organMap/seasonMap/foodMap/recipeMap/activityMap/emotionMap/wuhouMap/seasonDescMap/keywordMap/guaGeMap + translate 方法），覆盖 24 节气名、五行、脏腑、食材、菜谱、物候、卦格等所有后端返回的中文数据
  - `i18n/zh-CN.js`：同步新增对应映射表字段（值为 null，保持结构对齐）
  - `components/jieqi-bar/jieqi-bar.js`：新增 `_t()`/`_tArr()`/`_tObjArr()` 翻译辅助方法，`enrichTermData`/`enrichAdviceData` 中对所有动态数据应用翻译映射；修复 `_foodIcon`/`_activityIcon` 在翻译前调用的时序 bug（图标匹配基于原始中文名）
  - `components/jieqi-bar/jieqi-bar.wxml`：卦格标签使用 `translatedGuaGe || guaGe` 确保翻译后卦格名正确显示
  - `pages/index/index.js`：`onJieqiShare` 分享标题移除硬编码中文，改用 `i18n.page('index')` 字典
  - `sub/match/letter-write/index.js`：节气数据加载后通过 `_translateTermData()` 翻译 term/activity/food 字段
  - `_backend_src/server.js`：新增 `/agreement.en`、`/privacy.en` 路由支持英文协议页
  - Nginx：新增 `/agreement.en`、`/privacy.en` location 代理到后端
  - 网页版：上传 `agreement.html`/`privacy.html`/`agreement.en.html`/`privacy.en.html`/`index.html` 到服务器 `/home/admin/.openclaw/workspace/projects/web/`

- ✅ P8（2026-08-25）：排版适配 + 翻译完整性修复
  - **CSS 排版适配**（英文长文本防撑破）：
    - `components/jieqi-bar/jieqi-bar.wxss`：`.hero-tag`/`.keyword-item`/`.cell-name`/`.recipe-name`/`.recipe-effect`/`.node-text`/`.btn-text`/`.tab-name` 添加 `max-width`/`white-space:nowrap`/`overflow:hidden`/`text-overflow:ellipsis`，字号微调（28-22rpx），padding 收紧
    - `sub/match/letter-write/index.wxss`：`.template-chip`/`.chip-label`/`.topic-tab`/`.topic-tab-label` 添加截断处理，`.letter-textarea` 支持英文换行（`word-break:break-word`/`white-space:pre-wrap`）
  - **菜谱翻译补全**：
    - `jieqi-bar.js`：`enrichTermData` 中菜谱 `recipes` 字段翻译完善（`effect`→`recipeEffectMap`、`main`→`foodMap`、`steps`→`recipeStepsMap`）
    - `en-US.js`：`jieqi` 模块新增 `recipeEffectMap`（28 条功效翻译）、`recipeStepsMap`（18 条步骤类型）
  - **写信模板全量翻译**：
    - `en-US.js`/`zh-CN.js`：`letter` 模块新增 `templateContents`（8 组模板正文中英对照）、`templateFallbacks`（11 条占位符回退文案）
    - `letter-write/index.js`：`refreshI18nTopics`/`setTopicGroup` 方法改为从语言包加载模板 `content` 和 `label`；`renderTemplate` 方法回退文案改为读取 `templateFallbacks`
  - **节气建议关系翻译**：
    - `jieqi-bar.js`：`enrichAdviceData` 中 `relation.warning`/`relation.principle` 字段接入 `keywordMap` 翻译

- ✅ P9（2026-08-25）：节气按钮英文适配 + 协议勾选位置调整 + 网页协议链接修复
  - **节气按钮英文样式适配**：
    - `jieqi-bar.js`：新增 `isEn` 状态，`applyI18n` 方法读取当前语言
    - `jieqi-bar.wxml`：节气按钮添加 `lang-en` class，英文模式下隐藏分割线和"养生/秘典"文字
    - `jieqi-bar.wxss`：英文模式下节气名改为横排（`writing-mode: horizontal-tb`），按钮宽度扩展至 120rpx，字号调至 18rpx
  - **协议勾选位置调整**：
    - `login.wxml`：协议勾选改为仅在注册模式（`emailMode === 'signup'`）时显示
    - `login.js`：`updateSubmitState`/`sendEmailCode`/`submitAction` 方法仅在注册模式检查协议勾选
  - **网页协议链接修复**：
    - `web/index.html`：协议链接从 `/agreement.html`/`/privacy.html` 改为 `/agreement`/`/privacy`（与后端路由一致）
    - `web/agreement.html`、`web/privacy.html`、`web/agreement.en.html`、`web/privacy.en.html`：语言切换链接移除 `.html` 后缀

- ✅ P10（2026-08-19）：节气组件语言切换修复 + 登录页协议勾选修复
  - **节气组件语言切换修复**：
    - `jieqi-bar.js`：新增 `refreshI18n()` 方法，语言切换时重新翻译已加载的 `termData` 和 `adviceData`
    - `jieqi-bar.js`：`fetchCurrentTerm()` 和 `fetchAdvice()` 方法保存原始数据（`_rawTermData`、`_rawAdviceData`），供语言切换时重新翻译
    - `pages/index/index.js`：`onShow` 方法中调用 `jieqiBar.refreshI18n()`，确保语言切换后节气组件及时刷新
  - **节气按钮 WXML 修复**：
    - `jieqi-bar.wxml`：将 `wx:if="{{termData && !isEn}}"` 改为 `<block wx:if="{{termData}}">` 嵌套 `<view wx:if="{{!isEn}}">`，避免小程序表达式兼容性问题
  - **登录页协议勾选修复**：
    - `login.js`：`switchEmailMode()` 方法切换模式时重置 `agreed` 状态为 `false`，避免用户切换模式后忘记重新勾选

- ✅ P11（2026-08-19）：节气组件英文版重构（v19.2「raw 数据 + JS 预翻译」架构）
  - **背景**：P7-P10 的 WXML 端翻译方案导致节气按钮点击失效、详情浮层无法弹出，本次从备份 `v18.21-cn-baseline-20260818.zip` 回退到中文基线后按新架构重新实现
  - **核心架构**（杜绝 WXML 调用函数）：
    - `jieqi-bar.js`：`_rawTermData`/`_rawAdviceData` 保存 API 原始中文数据；`_applyLang()` 统一入口基于 raw 重建展示数据；`_buildTermView()`/`_buildAdviceView()` 构建视图（先按中文匹配图标再翻译文本）；`refreshI18n()` 供 index.js `onShow` 调用
    - `jieqi-bar.wxml`：静态文案全部改 `{{t.xxx}}` 字典引用；动态数据用预翻译字段（`wuxingText`/`organText`/`daysInText`/`wuHouView`/`guaGeText`/`loadingText`/`diaryHistoryText`）；`wuxing` 保留中文用于 `wuxingColorLight`/`wuxingBgTint` 颜色索引
    - `jieqi-bar.wxss`：追加 `.lang-en` 适配块（竖排拉杆 `.tab-name` 改横排 15rpx 换行、`hero-name` 72→46rpx、宫格/物候/关系图/日记标签字号微调），中文态样式零改动
  - **字典**：`i18n/en-US.js` `jieqi` 模块 63 key 含 25 个映射表（termMap/wuxingMap/organMap/seasonMap/foodMap 83 词条/activityMap 65/emotionMap 43/jiMap/wuhouMap 72/seasonDescMap/keywordMap/relationTypeMap/relationTitleMap/relationWarningMap 25/strategyMap/l2ClassicQuoteMap/l2ClassicSourceMap/l2ClassicDescMap/neijingQuoteMap/neijingPlainMap/neijingInterpretationMap/neijingActionMap/neijingSourceMap/guaGeMap 128/recipeMap 72 道菜谱）；`i18n/zh-CN.js` 补 `exclusiveSuffix`/`shareSuffix`/`l2Hint` 3 key（映射表值为 null 保持结构对齐）
  - **数据兼容**：L2/L3 双映射回退（classicQuote 先 `l2ClassicQuoteMap` 再 `neijingQuoteMap`；recommendActivity 先 `activityMap` 再 `strategyMap`），未命中词条回退中文原文；物候日记存储 key 用中文原始节气名（语言切换不丢数据）；toast/分享标题跟随当前语言

- ✅ P12（2026-08-19）：推演结果页/节气详情页动态数据翻译 + 注册页协议勾选显示修复
  - **推演结果页动态数据翻译**（`pages/result/index.js`，与节气组件同款「raw 数据 + JS 预翻译」架构）：
    - 新增 `_tr()` 通用映射翻译、`_trPillars()` 四柱干支翻译（如 `甲子年` → `JiaZi Year`）
    - 新增 `_buildRecordView()`/`_buildQimenView()` 基于 raw 数据构建多语言视图：卦名（guaNameMap 含64卦单字+全名）、九星（starMap）、八门（gateMap）、八神（spiritMap）、五行关系（relMap/relDescMap）、卦格（guaGeMap）、四柱干支等
    - `onShow` 语言切换时基于 `_rawRecord`/`_rawQimen` 重建视图
  - **字典扩充**：`en-US.js` `result` 模块新增 20+ 映射表（guaNameMap 64卦/starMap 9星/gateMap 8门/spiritMap 8神/relMap/relDescMap/ganMap 10天干/zhiMap 12地支 等）；`jieqi` 模块补全 activityMap/keywordMap/recipeMap 遗漏词条；`zh-CN.js` 同步补 key（值 null 对齐结构）
  - **翻译覆盖率校验**：临时脚本（已清理）对比后端 jieqi-health.js/wuxing-relation.js/qimen-config.js/hexagrams.js 与前端映射表，定位并补全全部缺失词条（含 56 个全名卦名）
  - **注册页协议勾选显示修复**（`pages/login/login.wxss`）：`.login-page` 移除 `overflow:hidden`（勾选框被裁切不可见的根因），新增 `padding-bottom` 安全区适配 + `box-sizing`；`.login-footer` margin-top 80→48rpx

- ✅ P13（2026-08-19）：账号合并（邮箱账号 ↔ 微信账号）前端全链路
  - **「我的」页绑定邮箱入口**（`pages/my/*`）：菜单区「修改档案」下方新增「绑定邮箱」项（仅登录态显示）；`loadProfile` 提取 `email` 字段，已绑定显示邮箱（限宽截断防溢出），未绑定进入绑定流程
  - **绑定邮箱页**（`sub/profile/bind-email/*`，新增，app.json 注册于 profile 分包）：邮箱 + 验证码（purpose=bind）+ 密码表单，风格与登录页统一（墨韵黑金/聚焦金边/衬线体英文态）；提交 `POST /api/auth/email-bind`，`mergeable:true` 时 wx.showModal 弹窗展示待合并账号昵称，确认后带 `confirmMerge:true` 重新提交；成功后同步 `app.globalData.profile.email` 并返回「我的」页；已绑定态显示当前邮箱
  - **登录页注册合并**（`pages/login/login.js`）：`doEmailAuth(confirmMerge)` 处理 409 `MERGE_CONFIRM`，弹窗展示 `boundNickname`，确认后带 `confirmMerge:true` 重新提交（验证码未消费可复用）
  - **api.js**：非 2xx 错误响应保留 `data` 字段（`resolve({ success:false, code, message, data: res.data.data })`），409 MERGE_CONFIRM 的 `boundNickname` 得以透传前端
  - **字典**：`zh-CN.js`/`en-US.js` 新增 `bindEmail` 模块 25 key；`login` 模块新增 4 key（mergeTitle/mergeContent/mergeConfirm/mergeCancel）；`my` 模块新增 `menuBindEmail`
  - **后端配套**（`_backend_src/src/routes/auth.js`）：`email-send-code` purpose 扩展 `bind`；`email-register` 返回 `MERGE_CONFIRM`；新增 `email-bind` 接口 + `mergeEmailAccountInto()` 事务合并 + `migrateEmailAccountRedis()` 缓存迁移（详见 topology.md）

- ✅ P14（2026-08-19）：宜忌栏英文版式重构 + 注册页协议勾选滚动修复（v19.4.1）
  - **宜忌栏英文截断问题**（`pages/result/index.wxss`）：英文模式下 AI 生成英文宜忌词条（≤8 words，远长于中文4-6字），原版式为左右两栏各占 50% 宽的 pill 标签，长词条换行溢出被截断。版式重构：
    - `.yiji-grid` 改为**纵向堆叠**（宜块/忌块各占整行），pill 拥有全行宽度
    - `.yi-item/.ji-item` 加 `max-width:100%` + `word-break:break-word` + `white-space:normal` + `text-align:center`，长英文词条在 pill 内优雅换行，历史长词条记录同样完整显示
    - 标题行改为 flex + `::after` 细金线延伸装饰（宜金色渐隐/忌灰银渐隐），中英文标题均协调
    - `.lang-en` 态：pill 字号 26→24rpx、letter-spacing 归零、行高 1.4；标题 32→30rpx
  - **后端英文词条长度收紧**（`src/services/tuiyan.js`）：AI 提示词英文宜忌词条 ≤8 words → **≤5 words**（示例 "Sign key contracts"），从源头控制长度，双保险
  - **注册页协议勾选被遮挡修复**（`pages/login/login.json` + `login.wxss`）：
    - **根因**：`login.json` 中 `"disableScroll": true` 禁止整页滚动——注册模式内容（tabs+邮箱+验证码+密码+按钮+链接+协议勾选）超出屏幕高度，底部协议勾选被截在屏幕外（英文文字更长被推得更远，故英文版完全看不见）
    - 修复：移除 `disableScroll`（小屏机型可滚动兜底）+ 布局紧凑化：`.login-page` padding-top 180→120rpx、`.login-header` margin-bottom 96→56rpx、`.form-group` margin-bottom 56→44rpx、`.mode-tabs` margin-bottom 48→40rpx、`.login-footer` margin-top 48→32rpx（大屏机型注册模式一屏内完整显示勾选框）

- ✅ P15（2026-08-19）：英文版易缘匹配 502 修复（v19.4.2）
  - **现象**：英文版匹配结果页报 "Relationship reading not found"；中文版正常
  - **根因**：`/api/relationship/:a/:b?lang=en` 首次请求某关系 key 需 DeepSeek 翻译 20-30s，超过 Nginx 30s 网关超时返回 502；翻译完成后 Redis 缓存命中，同 key 再请求毫秒级返回（实测 100-236ms）
  - **前端修复**（`sub/match/match/index.js` + `i18n`）：loadMatch 失败分支对 NETWORK_ERROR/INTERNAL_ERROR（502 场景 api.js 归一为 NETWORK_ERROR）自动重试——间隔 8s、最多 2 次，重试期间 loading 态显示"首次加载英文版较慢，正在加速…"（`loadingTextTranslating` 中英词条）；最终失败按 code 区分文案：404 RECORD_NOT_FOUND → "关系解读不存在"，其余 → "加载失败"
  - **后端修复**：`src/utils/translator.js` 加 in-flight Map 并发防击穿（同 key 在途翻译共享 Promise，多请求不重复调 AI）；服务器后台跑 `warm-rel-cache.js` 全量预热 2080 条关系翻译进 Redis（详见 topology.md）
  - **注**：重试期间不会重复写 match/record（仅 success 分支才写）
  - **已被 v20 方案B取代（2026-08-20）**：关系解读全量预生成 `relationship-en.js` 静态直读，永无 502，前端重试兜底成为冗余保险；`translator.js`/`warm-rel-cache.js` 已删除，Redis i18n 缓存已清空

- ✅ P16（2026-08-20）：v20 方案B前端英文适配收尾
  - **导航栏标题动态切换**（`utils/i18n.js` + 各页面）：新增 `NAV_TITLES` 映射表（页面路径 → 中/英文标题）与 `applyNavTitle(pagePath, overrideTitle)` 方法；各页 `onShow` 调用，英文态覆盖 json 中文标题、切回中文恢复；profile 页 fromMatch 场景通过 `overrideTitle` 传 `navMatchTitle`
  - **10 个页面补齐 `lang-en` 根类与字典刷新**（批量脚本处理）：页面根节点绑定 `class="lang-en"`，`onShow` 时刷新 `t`/`lang`/`langLabel`——确保英文衬线字体与 `.lang-en` 布局样式在所有页面生效
  - **节气组件英文数据改后端直读**（`components/jieqi-bar/jieqi-bar.js`）：英文态直接请求 `/api/solar-term/current?lang=en` 与 `/advice?lang=en`（替代 P11 的前端 25 个映射表方案，杜绝词典遗漏；中文态仍走原链路）；图标匹配仍基于中文原文（接口英文响应保留查询键中文）
  - **写信页节气数据同步直读**（`sub/match/letter-write/index.js`）：英文态请求后端 `?lang=en`，移除前端词典翻译依赖
  - **部署验证**：全接口双语实测 PASS=31 FAIL=0（详见 architecture.md v2.9 节）；前端需开发者工具清缓存重编译验证

- ✅ P17（2026-08-20）：推演结果页宜忌栏英文改为竖排整行显示（`pages/result/index.wxss`）
  - **现象**：P14/v19.4.1 虽已把宜/忌各占整行，但 `.yi-items/.ji-items` 仍为 `flex-wrap:wrap` 横排 pill；英文宜忌词条较长时在 pill 宽度内被截断，未完整显示
  - **修复**：`.yi-items/.ji-items` 改为 `flex-direction:column` 竖排，每条 `.yi-item/.ji-item` `width:100%` 独占一整行，`text-align:left` + `word-break:break-word` + `white-space:normal`，词条多长都完整显示不被截断（中文短词条同样整行展示，视觉一致）
  - **双端同步**：Donut 共用一套代码，双端自动生效；需开发者工具清缓存重编译验证

- ✅ P18（2026-08-20）：官网注册/登录/购会员/注销账户逻辑完善 + 后端故障修复
  - **官网会员购买登录改走「邮箱+验证码」**（`web/index.html`）：原调 `/api/auth/email-login` 传 `{email, code}`（该接口只认 password）必然失败；改为调新增后端接口 `/api/auth/email-code-login`（详见 topology.md v版本号），购物车逻辑不变
  - **官网注销页**（`web/delete-account.html`）：邮箱+密码登录 → 二次确认 → 调 `/api/user/profile/{openid}/request-delete`；nginx 新增 `location = /delete-account` 精确路由代理 3003（原 `/` 静态 alias 命中该路径找不到文件返回 404）
  - **后端故障修复**：服务器 `server.js` 第 249 行裸 `# 注释` 导致 JS 语法错误，PM2 四个 `tianji-tuiyan-api` 全部 `waiting`；用本机正确版覆盖并 `pm2 restart` 恢复 `online`
  - **部署验证**：`/api/health` OK、`/api/auth/email-code-login` 返回预期 `CODE_INVALID`、`/delete-account` 公网 200、官网首页 200
  - **双端同步**：官网单文件，不涉及小程序/App
- ✅ P19（2026-08-20）：修复官网 API 基址拼接错误导致「登录接口不存在」（404）
  - **根因**：`web/delete-account.html` 与 `web/index.html` 均写 `const API = location.origin + '/tianji/api'`，其后调用路径以 `/api/...` 开头（如 `'/api/auth/email-login'`），最终拼成 `/tianji/api/api/...`；nginx `location /tianji/` → `:3003/` 去掉前缀后后端收到 `/api/api/...` → 命中 404「接口不存在」
  - **修复**：两文件 API 基址统一改为 `location.origin + '/tianji'`，调用路径保持 `/api/...` 不变 → `/tianji/api/auth/email-login` 正确
  - **部署验证**：已将两文件上传 `projects/tianji-tuiyan/web/`；公网实测 `POST /tianji/api/auth/email-login` 返回 `ACCOUNT_NOT_FOUND`（已进入路由，非 404）、`/tianji/api/payment/vip-info/{id}` 返回 `AUTH_TOKEN_MISSING`（仅缺 token）、`create-h5-order` 返回 400（已进入路由检索出无 token）
  - **会员身份统一说明**：首页购会员走 `email-code-login`（邮箱+验证码），注销页走 `email-login`（邮箱+密码），两者均经 `emailOpenidOf(email)=email_<sha256>` 解析到同一 openid；APP 用户经 `email-bind` 绑定邮箱后（场景B合并），网页端 H5 购会员 → 同 openid 写订阅 → APP 同邮箱登录即享受权益，实现跨端会员统一
  - **双端同步**：官网单文件，不涉及小程序/App
- ✅ P20（2026-08-21）：融合官网两个「开通会员」购买入口 + 统一网页身份登录方式
  - **背景**：官网首页 `#member` 与注销页 `/delete-account` 账户中心各有购买块，且登录方式不一致（首页邮箱+验证码 / 注销页邮箱+密码），造成账号体系分裂。
  - **决策**（用户确认）：首页为**唯一** H5 购买入口；网页身份登录统一为**邮箱+密码**。
  - **改动**：① `web/index.html` 会员登录改为邮箱+密码框，`Member.buy()` 未登录走 `/api/auth/email-login`，新增「去注册 / 忘记密码」入口，删除遗留 `sendCode` 死函数；② `web/delete-account.html` 移除账户中心 plans/开通按钮及 `selectPlan/doBuy/pollOrder/ORDER_KEY/pollTimer` 死代码，仅保留会员状态+注销+「前往首页开通会员」链接，中英文新增 `upgradeTip/goUpgrade`、保留 `msgNotLogin` 供 `refreshVip` 兜底显示。
  - **部署验证**：见 P20 对应部署摘要（index.html 用 `_deploy_web.sh`，`delete-account.html` 需 `scp` 上传）。（本轮文档记录）
  - **双端同步**：官网单文件，不涉及小程序/App；双向会员统一逻辑不变（见 P19 说明）

## 6. 组件开发规范

### 6.1 组件命名

- 文件夹名：kebab-case（如 `match-card`）
- 组件名：camelCase（如 `MatchCard`）

### 6.2 组件结构

```
components/
└── match-card/
    ├── match-card.js       # 组件逻辑
    ├── match-card.json     # 组件配置
    ├── match-card.wxml     # 组件模板
    └── match-card.wxss     # 组件样式
```

### 6.3 组件通信

```javascript
// 父 → 子：properties
properties: {
  guaId: { type: Number, value: 0 }
}

// 子 → 父：triggerEvent
this.triggerEvent('tap', { guaId: this.data.guaId });
```

---

## 7. 样式规范

### 7.1 单位使用

- 布局尺寸：`rpx`（响应式）
- 字体大小：`rpx` 或 `px`
- 边框：`px`（1px 物理像素）

### 7.2 颜色变量

```css
/* 全局颜色变量（app.wxss）— 深色主题（推演板块默认） */
page {
  /* 背景 */
  --bg-base: #0A0A1A;           /* 深蓝黑 */
  --bg-elevated: #14142B;       /* 卡片背景 */
  --bg-muted: rgba(232, 232, 240, 0.03);
  --bg-card: rgba(20, 20, 43, 0.6);

  /* 文字 */
  --text-primary: #E8E8F0;      /* 主文字 */
  --text-secondary: #A0A0B0;    /* 次要文字 */
  --text-muted: #6A6A7A;        /* 弱化文字 */
  --text-inverse: #0A0A1A;      /* 反色文字 */

  /* 金色强调 */
  --accent-gold: #C8A55B;       /* 主金色 */
  --accent-gold-hover: #D4B570; /* 金色悬停 */
  --accent-gold-muted: rgba(200, 165, 91, 0.15);
  --accent-gold-subtle: rgba(200, 165, 91, 0.06);
  --accent-gold-border: rgba(200, 165, 91, 0.25);

  /* 边框 */
  --border-subtle: rgba(232, 232, 240, 0.04);
  /* ... 更多变量见 app.wxss */
}
```

### 7.3 z-index 层级规范

| 层级 | 用途 |
|------|------|
| 0 | 背景海报 |
| 1 | 背景视频 |
| 2 | 遮罩层 |
| 5 | 普通按钮 |
| 8 | 节气条 |
| 10 | 主内容区 |
| 20 | 导航栏 |
| 100 | 弹窗/覆盖层 |
| 400 | 最高层级（加载动画） |

---

## 8. API 调用规范

### 8.1 接口路径

所有接口统一前缀：`/tianji/api/`

### 8.2 认证方式

```javascript
header: {
  'Authorization': `Bearer ${token}`
}
```

### 8.3 错误处理

```javascript
try {
  const result = await api.request('/api/xxx', 'POST', data);
  if (result.success) {
    // 成功处理
  } else {
    // 业务错误
    wx.showToast({ title: result.message, icon: 'none' });
  }
} catch (e) {
  // 网络错误
  wx.showToast({ title: '网络异常', icon: 'none' });
}
```

---

## 9. 本地存储规范

### 9.1 存储 Key 命名

- 用户相关：`user_*`（如 `user_token`、`user_openid`）
- 配置相关：`config_*`（如 `config_theme`）
- 缓存相关：`cache_*`（如 `cache_gua_list`）

### 9.2 存储限制

- 单个 Key：≤ 1MB
- 总存储：≤ 10MB
- 大数据使用分页或压缩

---

## 10. 分享功能

### 10.1 小程序分享

```javascript
onShareAppMessage() {
  return {
    title: '分享标题',
    path: '/pages/index/index?scene=xxx',
    imageUrl: '/assets/images/share.jpg'
  };
}
```

### 10.2 App 分享（Open SDK → H5 链接）

> v19.8 起：App 端**所有**分享入口分享的都是 **H5 链接**，不再分享小程序卡片（接收方打开即官网/落地页，可下载 App 或经 scheme 唤起）。

```javascript
// 使用 share.js 封装（utils/share.js）
// H5_WEB_BASE = 'https://claw-book.cn/tianji/web/'（官网/首页落地页基址）
share.shareWebPageMessage({
  webpageUrl: shareUtil.H5_WEB_BASE,   // 通用内容分享：官网首页
  title: '分享标题',
  description: '分享描述'
});

// 匹配分享有专用落地页（web/match.html?sid=）
share.shareWebPageMessage({
  webpageUrl: 'https://claw-book.cn/tianji/web/match.html?sid=' + shareId,
  title: shareTitle,
  description: shareDesc
});
```

**App 端分享入口清单（v19.8 全部走 `shareWebPageMessage`）**：
- 首页 `pages/index/index.js`：`onShareTap`（`H5_WEB_BASE`）、`onJieqiShare`（`H5_WEB_BASE`）
- 节气条组件 `components/jieqi-bar/jieqi-bar.js`：`onShareTap`（`H5_WEB_BASE`）
- 推演结果页 `pages/result/index.js`：`onShareTap`（`result.html?sid=&rid=`）
- 我的匹配页 `sub/match/my-matches/index.js`：`onShareTap`（`H5_WEB_BASE`）
- 卦象详情页 `sub/learn/native-gua/index.js`：`onShareTap`（`match.html?sid=`）
- 学习页 `sub/learn/learn/index.js`：`onShareTap`（`H5_WEB_BASE`）
- 成就页 `sub/learn/achievement/index.js`：`onShareTap`（`H5_WEB_BASE`）
- 匹配结果页 `sub/match/match/index.js`：`onShareTap`（有短码走 `match.html?sid=`；无短码回退 `H5_WEB_BASE`）

### 10.3 三种分享类型完整链路（v3.6 起）

> **语义**（用户锁定，2026-09-03）：
> 1. **推演结果分享** → 接收者打开落地页看到**分享者当时的完整推演记录**（只读，不设"和 TA 易缘匹配"按钮）；落地页 `result.html` 照 APP `pages/result` 1:1（深色水墨）；
> 2. **匹配结果分享** → 接收者打开落地页看到**分享者当时的完整匹配结果**（双卦+关系名+等级+分析/共鸣/冲突/建议）；落地页 `match.html` 照 APP `sub/match/match` 1:1（宣纸主题），匹配结果来自静态关系数据 `config/relationship.js`，**不依赖双方在线**；
> 3. **个人人格分享** → 落地页展示分享者人格（卦符/卦名/昵称），接收者打开 App 后用自己的卦进入双方匹配。

**分享码类型与 scene 约定**：

| 分享类型 | `type` | `scene` | 落地页 URL | 落地页展示 |
|---------|--------|---------|-----------|-----------|
| 推演结果 | `result` | 推演记录 ID | `result.html?sid=&rid=` | 完整推演记录 |
| 匹配结果 | `match_result` | `guaA:guaB` | `match.html?sid=` | 完整匹配结果 |
| 个人人格 | `match` | 空 | `match.html?sid=` | 分享者人格 + 引导匹配 |

**各分享入口实现**：
- 推演结果页 `pages/result/index.js`：`_preGenerateShareCode` 用 `{ type:'result', scene: recordId }`；`onShareTap` 拼 `H5_WEB_BASE + 'result.html?sid=' + shareId + '&rid=' + recordId`。
- 匹配结果页 `sub/match/match/index.js`：`_preGenerateShareCode(guaA, guaB)` 用 `{ type:'match_result', scene: guaA + ':' + guaB }`（双方卦象在 `loadMatch` 成功后确定，此时重新生成覆盖兜底码）；`onShareTap` 拼 `'https://claw-book.cn/tianji/web/match.html?sid=' + shareId`。
- 个人人格页 `sub/learn/native-gua/index.js`：`{ type:'match' }`（scene 空）；`onShareTap` 拼 `match.html?sid=`。

**发送端 6 渠道唤起第三方 App（v3.6）**：
- 分享面板 `sub/profile/share/index.js`（`env.CHANNEL==='google'` 时走面板）+ `utils/share-logos.js`（base64 真实 logo，避免多端资源目录 SVG 加载失败）。
- 微信：`wx.miniapp.shareWebPageMessage`（预填文字+链接，`thumbPath='/assets/images/share-thumb.png'` 必须本地路径）。
- WhatsApp：`whatsapp://send?text=`（openUrl 直接唤起）
- Facebook：`fb://share/?link=`
- Messenger：`fb-messenger://share?link=`
- X（Twitter）：`twitter://post?message=`
- Telegram：`tg://msg_url?url=&text=`
- 5 个 openUrl 渠道失败时弹模态框（含 errMsg/errCode+原因+复制链接兜底），不降级为纯复制。
- 微信开放平台第三方 App 配置：X(`twitter://`)、WhatsApp(`whatsapp://`)、Facebook(284882215, `fb://`)、Messenger(454638411, `fb-messenger://`)、Telegram(686449807, `tg://`) 均已配置 URL Scheme（白名单构建时写入 AndroidManifest，**需重新构建 APK 生效**）。

### 10.4 App 分享 H5 落地页 + 深链唤起（v19.5 起，v3.3 补 iOS 与微信引导）

> 目的：接收方无论装没装 App，点开分享链接都能被引导；已装 App 的接收方点开链接直接看到**完整分享内容**（推演记录/匹配结果/人格），并可经深链唤起 App。v3.3 起打通 iOS（Universal Link）并在微信内置浏览器内给出唤起引导，Android 用 scheme，iOS 用 Universal Link。

> 🔴 **部署目录（2026-09-03 勘正）**：落地页 `match.html`/`result.html` 必须部署到**后端 Express 实际 webPath**：`/home/admin/.openclaw/workspace/projects/web/`（server.js 中 `webPath = path.join(__dirname, '..', 'web')`）。曾误传至 `projects/tianji-tuiyan/web/`，导致 `/tianji/web/` 请求兜底返回官网首页——这是"打开分享链接看到静态网页/官网首页"的根因。落地页源码在 `_backend_src/web/`。

**分享侧（`sub/match/match/index.js` → `onShareTap`）**：
- 有分享短码 `shareId` 时，用 `utils/share.js` 的 `shareWebPageMessage`（Donut `wx.miniapp.shareWebPageMessage`）分享 H5 落地页：
  `https://claw-book.cn/tianji/web/match.html?sid={shareId}`
- 无短码时回退分享官网 H5（`H5_WEB_BASE`）。

**H5 落地页（`web/match.html` / `web/result.html`，已部署 `/tianji/web/`）**：
- 通过公开接口 `/api/share/resolve/:shareId` 取数，按 `data.type` 分派渲染：
  - `match_result`：**完整展示匹配结果**——双卦交辉（双方真实卦符/卦名/卦格）+ 关系名 + 一句话 + 等级印章 + 4 个折叠区**默认展开**（详细分析/共鸣点/冲突点/建议）+ 底部固定栏（打开 App / 下载 App）+ 微信顶部引导条 + 全屏引导遮罩；非微信环境数据渲染后 800ms 自动唤起 `tianji://match?sid=`。
  - `match`：展示分享者人格（卦符/卦名/昵称）+ 右侧"你的卦象？"+ 引导打开 App 匹配。
- `result.html`（深色水墨，照 APP `pages/result` 1:1）：完整展示推演记录（判词/卦象/人格标签/历史对标金句/自嘲标签/折叠区：时空变量·详细解读·宜忌竖排）+ 自动唤起 `tianji://result?sid=&rid=`。
- 「打开 App」按钮（v3.3 平台分流 `openApp()`）：
  - **Android** → scheme `tianji://match?sid={shareId}` 唤起；
  - **iOS** → Universal Link `https://claw-book.cn/app?sid={shareId}`（AASA 实配路径为 `/app`、`/app/*`）唤起；
  - 「下载 App」→ 跳官网首页【下载】板块（`/#download`）。中英文双语。
- **微信内置浏览器引导（v3.3）**：UA 含 `MicroMessenger` 时，点「打开 App」2.5s 未唤起（scheme/Universal Link 均易被微信拦截）→ 展示 `wechat_hint`：「点右上角 ··· 选『在浏览器打开』后重试」，再由浏览器拉起 App。

**官网首页【下载】板块（`web/index.html`，v19.14 起动态化）**：
- Android 按钮加 `id="apkLink"`、版本号占位 `#apkVersion`；页面加载时 `fetch /tianji/api/app-download` 动态读取下载配置并更新 `href`（真实下载地址）与版本号（`vX.Y.Z`）。
- `data.enabled=false` 时按钮置灰并失效（`removeAttribute('href')` + `preventDefault`）；接口异常则保留 HTML 默认链接，绝不因接口问题让下载入口失效。
- 配置由管理后台「内容资产 → App下载版本」维护（见 `docs/topology.md` §2.12），换版本无需改代码。

**管理后台「内容资产 → App下载版本」页（`public/admin/index.html`，v19.16 起支持上传 APK）**：
- 新增「上传 new APK（一键换版本）」区：**原生 `<input type="file">`** 选 `.apk`（`onNativeFileSelect` 取 `e.target.files[0]`）+ 版本号输入 + 「上传并生效」按钮 → `POST /api/admin/app-download/upload`，用 `FormData(file, version)` 提交。上传成功后官网下载按钮立即指向 `/api/app-download/file` 新文件。
- 原「手动配置下载链接（url/version/enabled/保存）」降级为「高级」区保留。
- 依赖：服务器 `multer` 已装、nginx `location /api/admin/` 与 `location /tianji/api/admin/` 的 `client_max_body_size` 均已调为 1024M（见 `ops.md` §2.8/§6.3）。

**接收侧深链（`app.js`）**：
- `_registerDeepLink()` 注册 Donut `wx.miniapp.registOpenURL`，监听唤起来源并解析 `sid`。v19.5 仅认 `action==='scheme'`；**v3.3 放开 action 判断**，统一从 `param.data.url/query` 提取 sid——兼容 Android scheme 与 iOS Universal Link 两种唤起；`handleScene()` 同步做 `sid` 冷启动兜底解析。
- 解析到 `sid` → `resolveMatchShare()`，按 resolve 返回的 `type` 分流：
  - `type==='match_result'`（匹配结果分享）：直接用 scene 里的双方卦象跳 `sub/match/match/index?sharerGuaId=A&myGuaId=B&fromHistory=1` → 展示**分享者当时的匹配结果**（接收者无论是否为原匹配方，看到的就是这份 A-B 匹配结果，`fromHistory=1` 不重复写记录）；
  - `type==='match'`（个人人格分享）：已建档 → 跳 `sub/match/match/index?sharerGuaId=&myGuaId=<我的卦>` → `/api/relationship/{分享人卦}/{我的卦}` 实时展示双方匹配关系；未建档 → 跳建档页，建档完成后 `navigateToMatchIfNeeded()` 自动续接展示。
- `shareType==='result'`（推演结果分享）：`_registerDeepLink` 从 `param.data` 提取 `rid`（URL 含 `result.html` 或带 `rid`），`handlePendingShare` 跳 `pages/result/index?id=<recordId>&shared=1` 展示只读推演结果。

**深链配置**：
- Android scheme：`project.miniapp.json` → `mini-android.schemes.scheme = "tianji"`。
- iOS Universal Link：`project.miniapp.json` → `mini-ios.enableOpenUrlNavigate = true` + 开放平台移动应用已配 Universal Link `https://claw-book.cn`，buildCloud 构建自动注入；域名侧 AASA（`/.well-known/apple-app-site-association`，paths `/app`、`/app/*`）见 `ops.md`。
- Android App Links（v3.3）：`.well-known/assetlinks.json` 已上线，package=`com.clawbook.tianji`、release SHA256 指纹（见 `ops.md`）；需重新构建 APK 使 Android App Links 生效（构建方式见 `docs/release.md` §9.5）。

**验收判据**：已装 App + 已建档 + 已登录的接收方点开分享链接 → 「打开 App」唤起 → 直接看到与分享人的卦象匹配关系；未建档先建档后自动续接。Android 走 scheme/App Links，iOS 走 Universal Link；微信内被拦截时按 `wechat_hint` 引导「在浏览器打开」。iOS 真机、微信内唤起为后续重点实测项。

---

## 11. 支付功能

### 11.1 小程序虚拟支付

```javascript
// 先调用后端创建订单，获取签名参数
const order = await api.request('/api/payment/create-order', 'POST', {
  productId: 'vip_monthly'
});

// 使用后端返回的签名数据发起虚拟支付
const { signData, paySig, signature, mode } = order;
wx.requestVirtualPayment({
  signData: signData,
  paySig: paySig,
  signature: signature,
  mode: mode,
  success: () => {
    // 支付成功
  }
});
```

### 11.2 App 原生支付（APP支付）

> 🔴 原生 App 内**不能使用 H5 支付**（微信官方限制 H5 支付仅限手机浏览器），App 端购买 VIP 走**微信 APP 支付**。

```javascript
// 调用后端 APP 支付下单，获取 payParams
const orderRes = await api.request('/api/payment/create-app-order', 'POST', {
  productId: 'vip_monthly' // 或 'vip_yearly'
});
const pp = orderRes.data.payParams;

// 将 payParams 序列化为 orderInfo，provider=wxpay 调起微信
const orderInfo = JSON.stringify({
  appid: pp.appid,
  partnerid: pp.partnerid,
  prepayid: pp.prepayid,
  package: pp.package || 'Sign=WXPay',
  noncestr: pp.noncestr,
  timestamp: pp.timestamp,
  sign: pp.sign
});
wx.requestPayment({
  provider: 'wxpay',
  orderInfo: orderInfo,
  success: () => { /* 支付成功，后端回调发货 */ }
});
```

> 说明：代码位于 `sub/vip/vip/index.js`。后端返回 `{ outTradeNo, payParams }`；支付成功后由后端
> `h5-notify` 回调发货，前端配合 `check-order`/`sync-order` 轮询兜底。

### 11.3 官网 H5 会员购买（网页版）

> 官网 `web/index.html` 新增「易学会员」区块（id=`member`），供**手机浏览器**访问官网时开通会员（改用 H5 支付，绕开 APP 支付需上架商店的门槛）。**首页为官网唯一购买入口**（2026-08-21 起，账户中心 `/delete-account` 已移除购买块，仅保留会员状态+注销+「前往首页开通会员」链接）。

**流程**：邮箱+密码登录（未注册会因 `ACCOUNT_NOT_FOUND` 引导去登录页注册）→ 选择月度/年度 → 调 `/api/payment/create-h5-order` 拿 `h5Url` → 跳转微信 → 回页后轮询 `check-order` 发货。

```javascript
// 1. 未登录：邮箱+密码登录（与登录页 /delete-account 同账号体系，走 email-login）
const login = await apiPost('/api/auth/email-login', { email, password }); // 存 login.data.token
// 新用户：跳 `/delete-account?view=register` 完成「邮箱验证码 + 设密码」注册后回首页开通

// 2. H5 下单
const order = await apiPost('/api/payment/create-h5-order', { productId: 'vip_monthly' }, true);
location.href = order.data.h5Url; // 调起微信支付

// 3. 回页轮询 check-order 确认发货
```

**关键点**：
- 官网走 `location.origin + '/tianji'` 前缀（与后端同域）；`delete-account.html` 与 `index.html` 一致。
- 登录 token 存 `localStorage`（key: `tj_web_token`），下单时用 `Authorization: Bearer`。
- 登录统一走「邮箱+密码」接口 `email-login`（2026-08-21 统一，消除首页验证码账号与登录页密码账号不一致问题）；旧方案「邮箱+验证码」`email-code-login` 仅官网购会员早期版本用过，现已废弃首页使用，保留后端接口供注销页/其他复用。
- 会员身份统一：首页购会员 `email-login` 与注销页 `email-login` 均经 `emailOpenidOf(email)=email_<sha256>` 解析到同一 openid；APP 用户经 `email-bind` 绑定邮箱后（场景B合并），网页端 H5 购会员 → 同 openid 写订阅 → APP 同邮箱登录即享受权益，实现跨端会员统一。
- H5 支付回调由后端 `h5-notify` 发货；前端 `visibilitychange`/`focus` 触发 `check-order` 轮询（最多 60s）。
- API 根地址 `https://claw-book.cn/tianji/api`；`WXPAY_APPID` 需为与商户号关联的**公众号 AppID**（H5 支付用）。
- nginx 需为 `/delete-account` 配精确路由（`proxy_pass http://127.0.0.1:3003/delete-account`），否则被 `/` 静态 alias 拦截返回 404。
- **注销页会员状态判断**（`refreshVip`）：后端 `/api/payment/vip-info/:openid` 返回字段为 `plan_type`（`monthly`/`yearly`=VIP，`free`=免费），**没有 `is_vip` 字段**；前端须用 `plan_type === 'monthly' || 'yearly'` 判断，勿读 `is_vip`（2026-08-21 曾因此误判「当前为免费用户」）。

---

## 12. 常见问题

### 12.1 视频播放问题

**问题**：App 端视频遮挡按钮/组件

**v18.19 结论**：同层渲染依赖 xweb 内核，全新安装后内核需异步下载、下次冷启动才生效（官方机制），期间 video 退化为最高层级原生组件盖住页面

**解决**：
1. 确认 `project.miniapp.json` → `mini-android.useExtendedSdk.xweb: true`（已开启）
2. video 加 `bindrendererror` → 失败时 `bgVideoFailed = true` 卸载 video，海报兜底（官方推荐降级路径）
3. 全新安装后首页首次显示海报属预期行为：联网等 1-2 分钟 → 完全杀掉 App → 冷启动 → 视频恢复
4. 若多次冷启动后仍异常，在开发者工具构建面板尝试回退 Donut SDK 版本（当前 sdkVersion 1.7.0，可能是升级引入的回归）

**血泪教训（勿再踩）**：
- ❌ 不要在 `<video>` 内嵌 `<cover-view>` 承载页面内容——小程序端会导致 video 退出同层渲染（页面错乱），App 端 cover-view 样式能力太弱
- ❌ 不要因为一次"组件被视频盖住"就判定 xweb 同层渲染不可用——先区分是内核未就绪的暂时状态还是真回归
- ✅ `<video>` 保持自闭合标签 `<video ... />`
- ✅ 用 `bindrendererror` 做自动降级，保住页面可用性

### 12.2 登录失败

**问题**：App 端登录报错 `-700000`

**解决**：
1. 确认多端应用已绑定移动应用账号
2. 确认 `app.miniapp.json` 中 `identityServiceConfig` 配置正确
3. 确认后端 `MINIAPP_APPID` 和 `MINIAPP_APPSECRET` 配置正确

### 12.3 代码包超限

**问题**：子包大小超过 2048KB

**解决**：
1. 检查 `project.config.json` 的 `packOptions.ignore`
2. 大文件（视频/图片）使用远程 URL

---

## 13. 官网英文 GEO 页与静态站部署（2026-10-21）

> 目标：让 ChatGPT / Perplexity / Google AI Overview 等生成式搜索能抓到**英文**产品事实并引用；同时把所有英文下载入口指向 Google Play。

### 13.1 静态英文落地页 `web/content/i-ching-personality.en.html`

- 为什么需要独立静态页：首页 `web/index.html` 的英文态是 JS 切换，只改了 `document.title`，`meta description`、OG、JSON-LD 仍是中文 → 不执行 JS 的 AI 爬虫只能拿到中文元信息。
- 页面内容：一句话定义（AI 可直接摘）→ 三步流程 → 功能 → FAQ 6 条 → Play 下载区。
- 结构化数据：单个 `@graph`，含 `SoftwareApplication`（`downloadUrl` 指 Play、`operatingSystem: Android`、`offers` 免费）、`FAQPage`、`Organization`；**不写 `aggregateRating`**（无真实评分数据，禁止伪造）。
- 可见 FAQ 与 JSON-LD `FAQPage` 文本必须保持一致，改一处要同步改另一处。
- `web/index.html` 的 `hreflang="en"` / `x-default` 指向该页，`zh-CN` 仍指 `/`；`?lang=en` 的 JS 切换保留不变。

### 13.2 事实口径（文案红线）

基于 `_backend_src/src/routes/user.js` 与 `pages/profile/index.js` 实测：

- 建档采集 **出生日期（必填）+ 时辰（可选）**：12 个两小时时段 + 「不确定」；未选或选「不确定」时默认 `11:00-13:00`。
- 本命卦计算：先 `solarToLunarForGua` 转农历，再 `calculateGua(lunarYear, lunarMonth, lunarDay, shichen)`；上卦不含时辰、下卦与动爻含时辰。
- 因此英文文案只能写 "birth hour is optional"，**不得写 "birth time is not used in the calculation"**。

### 13.3 下载入口

- 全站英文内容页（`web/content/*.en.html`，109 个）CTA 统一指向 `https://play.google.com/store/apps/details?id=com.clawbook.tianji`。
- 首页下载板块在原 APK 下载按钮旁并列新增 Play 按钮，**APK 动态下载逻辑（`/tianji/api/app-download`）保持不变**。
- **会员购买渠道标注（2026-10-21）**：APK 按钮下方 `dl-note` 明确提示「直接下载的 APK 无法在应用内购买会员」，Play 按钮下方提示「Google Play 版本支持应用内购买会员」。依据：`sub/vip/vip/index.js` 仅在 `env.CHANNEL==='google'` 时走 `GooglePlayBilling`，侧载包无法调用商店计费。中英文文案分别在 i18n 字典的 `dl_apk_note` / `dl_play_note`。

### 13.4 部署路径规则（易错）

- nginx 有正则 `location ~* ^/([a-z0-9-]+)\.en\.html$ → alias /var/www/tianji-tuiyan/content/$1.en.html`。
- 因此新增的英文页**必须部署到 `content/`**；放到站点根目录不会被该 URL 提供（`/h5/gua/` 直连为 404，计算器公网入口是 `/tianji/gua/`）。
- 纯静态改动**不要重启 PM2**。

### 13.5 `llms.txt` 与 `sitemap.xml` 维护

- `web/llms.txt`：`## App facts`（Play 直链、平台、定价、计算口径）+ `## Tools`（中英计算器入口）+ 64 卦与节气列表。新增页面时同步补 `## Core pages`。
- `web/sitemap.xml`：新增页需带 `en` / `zh-CN` / `x-default` 三条 `xhtml:link`；改完用 `xml.etree` 解析校验，并确认无重复 `loc`。

---

## 附录：双端检查清单

每次提交前必查：

- [ ] 小程序端功能正常
- [ ] App 端功能正常（真机测试）
- [ ] 登录流程双端一致
- [ ] 支付流程双端可用
- [ ] 分享功能双端正常
- [ ] 样式双端一致
- [ ] 文案双端一致
