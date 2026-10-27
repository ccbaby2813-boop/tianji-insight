// src/routes/app-download.js - App 下载版本公开读取路由
//
// 提供官网下载板块的动态 APK 下载配置：
//   GET /api/app-download - 返回最新 App 下载配置（无需登录）
//
// 数据来源：app_configs 表，config_key='app_download'，config_value 为 JSON：
//   { "url": "/com.clawbook.tianji-3.1.0.apk", "version": "3.1.0", "enabled": true }
// 该配置由管理后台「内容资产 → App下载版本」维护（见 admin.js）。
// 表或数据不存在时回退到默认硬编码值，保证官网页始终可用。

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../middleware/db');

const CONFIG_KEY = 'app_download';
// 默认值：下载链接指向后端流式下发地址（后台上传 APK 后即改为该地址）；版本 3.1.0 与历史一致
const DEFAULT = { url: '/tianji/api/app-download/file', version: '3.1.0', enabled: true };
// 后台上传的当前 APK 文件（见 admin.js 上传接口）
const APK_FILE = path.join(__dirname, '..', '..', 'public', 'apk-current', 'tianji.apk');

// 读取当前版本号（用于命名的 Content-Disposition 文件名）
async function currentVersion() {
  try {
    const [rows] = await db.query(
      'SELECT config_value FROM app_configs WHERE config_key = ? LIMIT 1',
      [CONFIG_KEY]
    );
    if (rows.length > 0) {
      try { return (JSON.parse(rows[0].config_value || '{}').version) || DEFAULT.version; } catch (_) {}
    }
  } catch (_) {}
  return DEFAULT.version;
}

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT config_value, updated_at FROM app_configs WHERE config_key = ? LIMIT 1',
      [CONFIG_KEY]
    );
    if (rows.length > 0) {
      let parsed;
      try { parsed = JSON.parse(rows[0].config_value || '{}'); }
      catch (_) { parsed = {}; }
      return res.json({
        success: true,
        data: {
          url: parsed.url || DEFAULT.url,
          version: parsed.version || DEFAULT.version,
          enabled: parsed.enabled !== false,
          updated_at: rows[0].updated_at || null
        }
      });
    }
    return res.json({ success: true, data: { ...DEFAULT, updated_at: null } });
  } catch (err) {
    console.error('[app-download] 读取配置失败:', err.message);
    return res.json({ success: true, data: { ...DEFAULT, updated_at: null } });
  }
});

// GET /api/app-download/file - 流式下发当前 APK（公开，官网下载按钮点击它，无需登录）
// 文件由管理后台「内容资产 → App下载版本 → 上传 APK」维护，路径固定，换版本不再改 nginx
router.get('/file', async (req, res) => {
  try {
    if (!fs.existsSync(APK_FILE)) {
      return res.status(404).json({ success: false, code: 'APK_NOT_FOUND', message: 'APK 尚未上传，请到管理后台内容资产上传' });
    }
    const version = await currentVersion();
    const fname = `com.clawbook.tianji-${version}.apk`;
    const stat = fs.statSync(APK_FILE);
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(APK_FILE).pipe(res);
  } catch (err) {
    console.error('[app-download] 下发 APK 失败:', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, code: 'SERVE_ERROR', message: '下发失败' });
    else res.end();
  }
});

module.exports = router;