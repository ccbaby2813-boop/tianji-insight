# Android 发布签名配置说明（安全）

> 2026-08-26 安全审计处理记录：
> - keystore 文件已移至 `.secrets/tianji-release.keystore`，并由根 `.gitignore` 排除（`*.keystore` / `.secrets/`），不再随项目分发。
> - 2026-08-26 用户确认：**密钥未外泄、App 尚未发布，暂不改密**。故 `project.miniapp.json` 的 `storePassword` / `aliasPassword` 沿用原值 `tianji2026`，保证本机可直接构建。
> - 变更记录：安全审计报告 `代码审计报告-20260826.md` 修复进度表 P0-1 已同步更新。
> - **2026-09-03 补充**：App 已用本证书签名并上架 Google Play（3.3.6/116）。**Android 签名一经发布不可更改**，此密钥库即为对外发布正式证书——务必离线备份，不要再做改密/换证书操作（否则需 Google App Signing 迁移，成本极高）。下方"后续加固建议"第 1、2 条已不适用，仅保留备份与 CI 注入建议。

## 当前状态

- 密钥库文件：`.secrets/tianji-release.keystore`（**不要提交到仓库、不要随项目分发**）
- `project.miniapp.json` 中 `androidCertificate`：
  - `storeFilePath`: `.secrets/tianji-release.keystore`
  - `storePassword` / `aliasPassword`: `tianji2026`（用户确认暂不改密）
  - `alias`: `tianji`
- 证书权威值（含 MD5/SHA1/SHA256/公钥，供开放平台/Play/备案填写）见 `docs/ops.md` §2.5.2。

## ⚠️ 后续加固建议（发布后择机执行）

1. **为密钥库设置新的强随机密码**（至少 20 位，与项目名无关），并同步更新：
   - `project.miniapp.json` 的 `storePassword` / `aliasPassword`
   - 开放平台移动应用「应用签名」若因换证书而变化需同步更新（MD5 口径见 ops.md）
   ```bash
   # 修改密钥库密码
   keytool -storepasswd -keystore .secrets/tianji-release.keystore
   # 修改别名密码（与 storepasswd 需一致）
   keytool -keypasswd -alias tianji -keystore .secrets/tianji-release.keystore
   ```
2. 若此密钥将来**已用于对外发布**且曾以明文出现在代码/历史中，应重新生成全新密钥对并在发布平台完成签名迁移（Android 签名一经发布不可更改）。
3. 密钥库做离线备份（加密存储，如密码管理器 / 离线 U 盘）。
4. 若后续改用 CI 构建，可将密码改为从 CI Secret 注入（构建前写入 JSON），避免密码常驻仓库。

## 常见问题

- **微信能力（登录/分享/支付）签名校验不通过**：开放平台「应用签名」必须与构建 APK 所用证书的 MD5 一致（当前 release MD5 `e804889b567f1a4baf382730a6383727`，用户已核对）。
- **Google Play 上架**：Play 控制台显示的 5 组指纹中，`E6:42:9D:...:0E:2D` 即本 release 证书 SHA256；其余为 Google App Signing（Peppermint）二次签名密钥组，属正常。
