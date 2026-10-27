# Google Play 商店运营交付说明（中英双语商品页 + 内购 Billing）

日期：2026-10-12（最终确认版，基于 Play Console 线上状态与官方机制核查）

适用项目：天机推演 I Ching Insight（包名 com.clawbook.tianji，正式版 v3.4.7/127）

> 修订记录：
> 1. 初版误判"服务账号凭据未就绪" → 核查开发记录后纠正：**后端 Google Play 验签链路 2026-09-17 已全部完成并生产运行**。
> 2. 二版误判"商品详情必须随下一次发版（重传 AAB）才生效" → 查证 Google 官方文档（support.google.com/googleplay/android-developer/answer/9859654）后纠正：**商品详情更改不需要重新上传 AAB，保存后送审、审核通过自动上线（本应用未开自管式发布模式）**。
> 3. 二版曾按 uni-app 工程误写"App 端需装原生插件" → 核查 `docs\release.md` 与上架工程 `tianji-tuiyan-miniprogram-v10` 后纠正：**真实上架工程是微信多端（Donut）框架，Billing 由官方能力 `useExtendedSdk.googleplay=true` 注入，App 端 `wx.miniapp.GooglePlayBilling` 已在 v20.2 完整实现，无需任何原生插件**。

---

## 一、为什么 App 在 Google Play 搜不到（已诊断 + 二次修复 + 已送审）

根因（2026-10-12 二次实测修正）：详情页中文内容虽曾在线上显示，但 **Play 商店搜索主要匹配应用名称（默认 en-US）**；此前默认名称是纯英文 "I Ching Insight"，中文词（天机推演/易经/本命卦）无法命中名称索引 → 搜「天机推演」返回竞品、搜「I Ching Insight」才能搜到本应用。且 zh-CN 语言包一度停留在"保存供日后使用"草稿态，未随名称进入搜索索引。

修复动作（Play Console 实际操作，2026-10-12 已完成并送审）：

* **默认（en-US）应用名称改为中英双语「I Ching Insight - 天机推演」**（21/30 字符）——中文词进入默认名称，搜索立即具备中文命中能力（不等 zh-CN 语言包收录）；
* **zh-CN 语言包正式送审**（应用名：天机推演 - I Ching Insight，简短说明/完整说明已填）；en-US 简短说明与完整说明同步规范化送审；
* 清理了此前 en-US 中"含 test 字样 + 中英混排"的劣质草稿串；
* 发布概览现确认「正在审核中的更改」共 4 项（zh-CN 添加语言 + en-US 名称 + en-US 简短说明 + en-US 完整说明），已无待提交项。
* **预期**：商品详情审核通常数小时~7 天；审核通过发布后，搜索命中还需等 Google 索引收录（数天~数周）。届时"天机推演"搜索可见。

---

## 二、历史已完成（2026-09-17 部署，2026-10-12 只读核查确认，无需重做）

| 项 | 生产现状（服务器 YOUR_SERVER_HOST，2026-10-12 只读核查） |
| --- | --- |
| 服务账号密钥 | ✅ 已上传 `config/gplay-service-account.json`（2372B，9/17 17:59） |
| 服务器 .env | ✅ `GOOGLE_PLAY_PACKAGE`、`GOOGLE_PLAY_CREDENTIALS_PATH`、`GOOGLE_PLAY_API_BASE=https://tianji-gplay-proxy.pages.dev`（Cloudflare Pages 代理）均已配置；未设 TEST_MODE（生产不跳过验签） |
| 后端验签模块 | ✅ `src/utils/googleplay.js`（代理版）已部署，`node --check` 通过 |
| 验签路由 | ✅ `src/routes/payment.js` google-verify / activateGoogleVip 已部署（假 token 链路测试 400 = 预期 PASS） |
| 进程 | ✅ PM2 `tianji-tuiyan-api` 运行中 |
| Play Console 商品 | ✅ `vip_monthly`（$2.99）、`vip_yearly`（约 $29.24）已创建并启用（10/12 再次确认激活） |

**结论：后端购买验签 / 开通链路无需任何操作。**

---

## 三、App 端 Billing（Donut 官方能力，已随正式版 3.4.7 上线，无需任何工程改动）

* 真实上架工程：`D:\MyCode\天机推演\tianji-tuiyan-miniprogram-v10`（微信 Donut 框架）
  * `project.miniapp.json`：`useExtendedSdk.googleplay = true` → Donut 云打包端注入 Google Play Billing 能力
  * App 端实现：`sub\vip\vip\index.js`（v20.2 蓝本）——Google 渠道走 `wx.miniapp.GooglePlayBilling`
* 购买闭环（上架工程已完整实现）：
  ```
  用户点"开通会员" → env.CHANNEL==='google' → startConnection
    → launchBillingFlow({productId: vip_monthly/vip_yearly, productType: 'INAPP'})
    → onPurchasesUpdatedMethod 回调 → _handleGooglePurchase(purchaseToken, productId)
    → POST /api/payment/google-verify → 服务端调 Play Developer API 验签（9/17 已部署）
    → activateVip 开通 → consumeAsync 消耗 → 刷新会员状态
  恢复购买：queryPurchasesAsync；价格显示：gpPriceMonthly/gpPriceYearly（Google 渠道不显示 ¥）
  ```
* 线上商店页已显示 **"In-app purchases"** 标签（10/12 实测），证明 Billing 商品已正确关联、付费能力对外可见。

### ⚠️ 冗余代码说明（不影响上架版，可删除）

2026-10-12 曾误在非上架 uni-app 工程（`app\tianji-tuiyan-app-ready`，versionCode 100）中新建 Billing 适配层与 VIP 页改造。该工程**不是**上架来源（上架包为 Donut 工程 3.4.7/127），因此以下文件属重复劳动、对线上无影响：

| 文件 | 说明 |
| --- | --- |
| `D:\MyCode\天机推演\app\tianji-tuiyan-app-ready\tianji-tuiyan-app\src\utils\google-billing.js` | 冗余（上架工程已有等价实现） |
| `D:\MyCode\天机推演\app\tianji-tuiyan-app-ready\tianji-tuiyan-app\src\sub\vip\vip\index.vue` | 冗余（上架工程 sub\vip\vip\index.js 已实现） |

如需清理可直接删除上述两文件 + 对应构建产物 `dist\build\app`；不删也不影响线上。

---

## 四、不需要做的事（避免重复劳动）

1. ❌ **不需要装原生插件**：Donut 官方能力注入 GooglePlayBilling，无 nativePlugins；HBuilderX 插件市场方案与本项目无关。
2. ❌ **不需要重新打包 / 重新上传 AAB**：商品详情更改（含本次中文语言 + 名称双语）已通过发布概览送审（2026-10-12 重新发送审核申请，4 项正在审核中）；Billing 已随 3.4.7 正式版上线。除非后续改 App 代码或版本号，才需要走发版流程。
3. ❌ **不需要重传 AAB 来让商品页生效**：商品详情（含新增语言）与 AAB 发版解耦，官方机制已确认。

---

## 五、发布后测试清单（状态核对）

* [x] `GET /api/payment/status` 返回 `googlePlayConfigured: true`（生产已满足）
* [x] Play Console 创收产品 → 一次性商品 → vip_monthly / vip_yearly 均「已启用」
* [x] 线上商店页显示 In-app purchases、中英文双语详情在线
* [ ] （可选）用 Play Console「许可测试」账号真实购买小额档位 → App 内开通成功
* [ ] （可选）再次购买同一商品 → 不重复扣款（消耗正常）
* [ ] （可选）断网 / 中断场景 → 重进 App 自动恢复未消耗购买

---

## 六、文件与交付

| 文件 / 位置 | 说明 |
| --- | --- |
| `D:\MyCode\天机推演\docs\play-store-zh-CN.png` | 线上中文版商店页截图（2026-10-12） |
| `D:\MyCode\天机推演\docs\play-store-en-US.png` | 线上英文版商店页截图（2026-10-12） |
| `D:\MyCode\天机推演\_backend_src\.env` | 本地联调镜像（注明"生产 9/17 已配"） |
| Play Console 发布概览（2026-10-12 送审） | 4 项更改正在审核中：zh-CN 添加语言 / en-US 名称改双语 / en-US 简短说明 / en-US 完整说明 |

**当前真实状态（2026-10-12 修正，不再宣称"全部完成"）：**

| 需求 | 状态 |
| --- | --- |
| ① 中文可搜（天机推演/易经/本命卦） | ✅ 已完成全部可控动作并送审（名称含中文 + zh-CN 语言包）——**待 Google 审核通过 + 索引收录**（数小时~数周，不可加速） |
| ② 会员购买可走通 | ✅ 链路全部核查就绪（AAB 含 Billing 7.0.0 / App 端购买-验签-消耗全链 / 后端 /api/payment/google-verify 已部署 / 服务账号有效 / 商品已激活 / 购买前闸门 googlePlayConfigured=true）——**剩最后一步：真机实测**（手机装 3.4.7 正式版 → 会员页点购买 → 收银台支付 → 会员开通；此步只能用户操作，预计花费 USD 2.99 或 29.24，或用许可测试账号免扣费） |

**真机验证步骤（用户执行，约 2 分钟）**：
1. 手机（已装 3.4.7 正式版，登录可支付 Google 账号，非国内号也可，Play 商店正常联网）
2. 打开 App → 会员/VIP 页 → 选"月度会员"(USD 2.99) 点购买
3. 若弹出 Google 收银台 → 完成支付 → 回到 App 显示"购买成功"、会员状态变为已开通 → ✅ 闭环
4. 若收银台未弹出或支付后未开通 → 记下屏幕提示的 code=xxx，反馈我排查
