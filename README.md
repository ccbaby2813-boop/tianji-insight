# 天机推演 · I Ching Insight

> 以《易经》六十四卦为框架的**人格解读与关系匹配**应用：生日 → 本命卦 → 64 型人格 → 4096 组合盘。
> Android（Google Play）· 微信小程序 · 官网 <https://claw-book.cn>

这是一个 **source-available（源码可见）** 项目，不是 OSI 定义的开源项目。

- ✅ 个人学习、研究、非营利使用：免费，遵循 [PolyForm Noncommercial 1.0.0](./LICENSE)
- 💼 **商业用途（上架、收费、SaaS、企业内部生产、客户交付）：需取得商业授权** → [商业授权说明](./LICENSE-COMMERCIAL.md) · 联系 **ccbaby2813@139.com**

---

## 一、这是什么

天机推演把「本命卦」当作一套人格系统来用，而不是摇卦占卜：

- **本命卦**：输入出生日期（+ 可选的出生时段），按梅花易数折算为六十四卦之一
- **64 型人格**：每卦一份长文人格画像（优势、盲区、沟通风格、宜忌）
- **4096 组合盘**：64 × 64 两两匹配，输出吸引力、冲突模式、长期潜力
- **易缘传书**：匿名信件式匹配
- **二十四节气养生**：随时令的饮食与作息建议
- **每日解读**：每日一条自省式解读

## 二、目录结构

```
.
├── tianji-tuiyan-miniprogram-v10/   # 前端：微信小程序 + Donut 多端（Android App）
│   ├── pages/                       # 主包页面（首页、推演、我的等）
│   ├── sub/                         # 分包（匹配、传书、VIP、学习、档案）
│   ├── components/                  # 自定义组件
│   ├── services/  utils/  config/   # 算法、请求封装、渠道配置
│   ├── i18n/                        # 中英双语词典（zh-CN / en-US）
│   └── miniapp/android/             # Donut 原生工程（无签名密钥、无厂商配置文件）
├── _backend_src/                    # 后端：Node.js + Express + MySQL + Redis
│   ├── src/routes/                  # 接口路由
│   ├── src/services/                # 业务与算法（梅花易数、奇门、推演）
│   ├── src/utils/                   # 干支、Google Play 验签等
│   └── db/schema.sql                # 数据库结构
├── web/                             # 官网（纯静态）+ H5 落地页 + 64 卦页面
│   ├── content/                     # 中英文内容页（卦页、节气页、专题页）
│   ├── h5/                          # 本命卦计算器等 H5 工具
│   └── index.html                   # 官网首页
└── docs/                            # 架构、算法、接口、前端、运维等文档
```

## 三、技术栈

| 层 | 技术 |
|---|---|
| 前端 | 微信小程序原生语法；经 **Donut 多端框架** 编译为 Android App |
| 后端 | Node.js（Express）、MySQL、Redis |
| 官网 | 纯静态 HTML/CSS/JS，可部署到任意静态托管或 Nginx |
| 支付 | 微信 APP 支付（国内）/ Google Play Billing（海外） |
| AI | 兼容 OpenAI 风格接口的大模型（深度解读） |

## 四、本地运行

### 1. 后端

```bash
cd _backend_src
cp .env.example .env      # 填入数据库、Redis、微信、支付等配置
npm install
mysql -u root -p < db/schema.sql
npm start
```

### 2. 小程序 / App

1. 用**微信开发者工具**打开 `tianji-tuiyan-miniprogram-v10/`
2. 在 `project.config.json` 中填入你自己的小程序 AppID
3. 编译预览即可；Android App 需通过微信「多端应用」能力构建，详见 `docs/` 内相关文档

### 3. 官网

`web/` 是纯静态目录，任选其一：

```bash
python -m http.server 8080 --directory web
# 或把 web/ 交给 Nginx / 对象存储静态托管
```

## 五、配置与密钥

本仓库**不包含任何密钥**：

- `.env`、服务账号 JSON、支付私钥、Android 签名密钥（keystore）均未提交
- 厂商配置（`google-services.json`、`agconnect-services.json`）已移除，需自行生成
- 文档中的服务器地址与口令已脱敏为 `YOUR_SERVER_HOST` / `YOUR_SSH_PASSWORD`

所有环境变量见 [`_backend_src/.env.example`](./_backend_src/.env.example)。

## 六、许可证

```text
PolyForm Noncommercial License 1.0.0
Required Notice: Copyright 2026 北京无元数字科技有限公司 (https://claw-book.cn)
```

- 非商业用途：免费使用、修改、分发（需保留许可证与 Notice）
- **商业用途：必须获得书面商业授权** —— 见 [LICENSE-COMMERCIAL.md](./LICENSE-COMMERCIAL.md)
- 项目名称、Logo、官网视觉素材不随代码授权

## 七、免责声明

本项目内容属传统文化科普与自我反思工具，**不构成任何预测、医疗、法律或投资建议**。涉及人生决策时请自行判断。

---

# English Summary

**I Ching Insight** turns the 64 hexagrams of the *I Ching* into a personality system: birth date → birth hexagram → one of 64 archetypes → 4,096 compatibility pairings. Android app (Google Play), WeChat Mini Program, and a static website.

This repository is **source-available, not OSI open source**.

- Noncommercial use (study, research, teaching, hobby): free under [PolyForm Noncommercial 1.0.0](./LICENSE)
- **Commercial use requires a paid written license** → see [LICENSE-COMMERCIAL.md](./LICENSE-COMMERCIAL.md) · contact **ccbaby2813@139.com**

No secrets, keystores, service-account keys, or vendor configs are included. Configure your own via `.env.example`.
