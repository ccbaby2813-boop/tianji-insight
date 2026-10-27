// server.js - 天机推演后端服务入口
require('dotenv').config();

// ========== 全局异常兜底（防止未捕获错误导致进程崩溃） ==========
// 未捕获异常：记录后退出（状态已不可靠，必须重启）
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.message, err.stack);
  // 给日志写入时间，然后退出让 PM2 重启
  setTimeout(() => process.exit(1), 1000);
});

// 未处理 Promise 拒绝：只记录，不退出（业务错误不应杀死进程）
process.on('unhandledRejection', (reason, promise) => {
  console.error('[WARN] unhandledRejection:', (reason && reason.message) || reason);
});

const express = require('express');
const cors = require('cors');
const xmlParser = require('express-xml-bodyparser');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/user');
const tuiyanRoutes = require('./src/routes/tuiyan');
const guaRoutes = require('./src/routes/gua');
const shareRoutes = require('./src/routes/share');
const relationshipRoutes = require('./src/routes/relationship');
const matchRoutes = require('./src/routes/match');
const paymentRoutes = require('./src/routes/payment');
const eventRoutes = require('./src/routes/event');
const adminRoutes = require('./src/routes/admin');
const collectionRoutes = require('./src/routes/collection');
const letterRoutes = require('./src/routes/letter');
const solarTermRoutes = require('./src/routes/solar-term');
const pointsRoutes = require('./src/routes/points');
const appDownloadRoutes = require('./src/routes/app-download');
const notificationRoutes = require('./src/routes/notification');
const pushRoutes = require('./src/routes/push'); // v2.4 TIMPush 系统推送
const { errorMiddleware, notFoundMiddleware } = require('./src/middleware/error');
const requestId = require('./src/middleware/request-id');

const app = express();
const PORT = process.env.PORT || 3003;

// 信任 Nginx 反代（必须在 rateLimit 之前）
// 信任 Nginx 反代（必须在 rateLimit 之前）
app.set('trust proxy', 1);  // 信任第一层代理（Nginx）

// 接口限流 - 防止API滥用
// trust proxy 设为 1（只信任第一层代理=Nginx），避免 express-rate-limit 的 permissive 验证错误
const limiter = rateLimit({
  windowMs: 60 * 1000,  // 1分钟窗口
  max: 60,              // 每个IP最多60次/分钟（正常用户足够，防止攻击/扫描/爬虫）
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', message: '操作太频繁，请稍后再试' }
});
// v15.3 修复：字体代理路由不限流（避免字体加载重试消耗API配额）
app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/font/')) {
    return next();
  }
  limiter(req, res, next);
});

// v10.3 用户级限流：核心业务接口按 openid 限流（防止同一用户高频调用）
// 推演接口：每用户每分钟 5 次（配合信号量控制并发）
const tuiyanUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.openid) return req.openid;
    const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';
    return ipKeyGenerator(ip);
  },
  validate: { ip: false },
  message: { success: false, code: 'USER_RATE_LIMITED', message: '推演操作太频繁，请稍后再试' }
});
app.use('/api/tuiyan', tuiyanUserLimiter);

// 匹配接口：每用户每分钟 10 次
const matchUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.openid) return req.openid;
    const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';
    return ipKeyGenerator(ip);
  },
  validate: { ip: false },
  message: { success: false, code: 'USER_RATE_LIMITED', message: '匹配操作太频繁，请稍后再试' }
});
app.use('/api/match', matchUserLimiter);
app.use('/api/letter', matchUserLimiter);

// Middleware
// CORS：限制为已知域名（小程序无Origin头，H5和管理后台有）
// 🔴 v3.5 加固：按环境动态构建 allowedOrigins，生产环境移除 localhost
const allowedOrigins = ['https://claw-book.cn', 'https://www.claw-book.cn'];
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:8080', 'http://localhost:3000');
}
app.use(cors({
  origin: function(origin, callback) {
    // 微信小程序请求无Origin头，直接放行
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    callback(null, false); // 拒绝未知来源
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
// 🔴 v3.5 加固：XML 解析限制 body 大小，防止恶意 XML 耗尽内存
app.use(xmlParser({ limit: '2mb' }));

// v10.3 请求追踪：为每个请求生成唯一 ID，注入 req.id 并在响应头返回
app.use(requestId);

// 🔴 v3.4 安全加固：添加安全响应头，防止点击劫持/MIME嗅探/XSS
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// 请求日志：只记录慢请求（>1s）和错误（5xx），携带 Request ID 方便追踪
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (ms > 1000 || res.statusCode >= 500) {
      console.log(`[REQ] ${req.id} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// 请求超时保护：根据路由类型动态设置
// - 超级推演(AI长文本推理)最多需要5分钟
// - 普通推演最多需要90秒
// - 其他接口保持30秒（防止慢SQL长时间占用连接）
app.use((req, res, next) => {
  const path = req.path || '';
  let timeout = 30000;
  if (path.indexOf('/api/tuiyan/vip') !== -1) {
    timeout = 300000; // 5分钟（DeepSeek VIP模型最多120s×2+退避）
  } else if (path.indexOf('/api/tuiyan') !== -1) {
    timeout = 90000;  // 90秒（普通推演60s+余量）
  }
  req.setTimeout(timeout, () => {
    if (!res.headersSent) {
      res.status(504).json({ success: false, code: 'TIMEOUT', message: '请求超时，请重试' });
    }
  });
  next();
});

// 管理前端静态文件服务
const path = require('path');
const https = require('https');

// v15.1 字体代理路由（修复 CDN nginx 返回 application/octet-stream 导致 wx.loadFontFace 失败的问题）
// 微信小程序 wx.loadFontFace 在 3.15.x 版本对 Content-Type 严格要求为 font/ttf
const FONT_PROXY_WHITELIST = ['LXGWWenKai-Medium-Subset.ttf', 'LXGWWenKai-Subset.ttf'];
app.get('/api/font/:name', (req, res) => {
  const fontName = req.params.name;
  if (!FONT_PROXY_WHITELIST.includes(fontName)) {
    return res.status(404).json({ success: false, message: 'Font not found' });
  }
  const fontUrl = `https://claw-book.cn/tianji-media/fonts/${fontName}`;
  https.get(fontUrl, (proxyRes) => {
    if (proxyRes.statusCode !== 200) {
      return res.status(502).json({ success: false, message: 'Font source unavailable' });
    }
    // 设置正确的 Content-Type 和 CORS 头（关键修复）
    res.setHeader('Content-Type', 'font/ttf');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    proxyRes.pipe(res);
  }).on('error', (err) => {
    console.error('[font-proxy] Error:', err.message);
    res.status(500).json({ success: false, message: 'Font proxy error' });
  });
});

app.use('/admin', (req, res, next) => {
  // v10.4 管理后台禁用缓存，避免升级后浏览器仍加载旧版页面（曾导致写信历史/虚拟用户页跳空页、新图表不显示）
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
}, express.static(path.join(__dirname, 'public', 'admin')));
// SPA fallback: 所有 /admin/ 下的非API请求返回 index.html
app.get('/admin/*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// 网页版前端静态文件服务（v3.1 新增）
// [SEC-FIX] P2-6: 受限静态服务——拒绝隐藏文件、下划线前缀开发备份及非白名单扩展名，
// 防止 web/ 目录下的 index.html.bak、_*.html、_*.py、*.apk 备份等被公网直接访问
const WEB_STATIC_ALLOWED_EXT = new Set([
  '.html', '.htm', '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm', '.json', '.txt', '.pdf', '.map'
]);
function secureStatic(staticPath) {
  const staticMw = express.static(staticPath, { dotfiles: 'deny', index: 'index.html', fallthrough: true });
  return (req, res, next) => {
    let clean = req.path;
    try { clean = decodeURIComponent(req.path); } catch (e) { /* 非法编码交给后续 */ }
    const base = clean.split('/').pop() || '';
    if (base.startsWith('.') || base.startsWith('_')) return res.status(404).end();
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
    if (ext && !WEB_STATIC_ALLOWED_EXT.has(ext)) return res.status(404).end();
    return staticMw(req, res, next);
  };
}
const webPath = path.join(__dirname, '..', 'web');
app.use('/web', secureStatic(webPath));
app.get('/web/*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(webPath, 'index.html'));
});

// APK 下载服务（v15.15 新增）- 必须在 /app 静态服务之前定义
const appPath = path.join(__dirname, 'public', 'app');
app.get('/app-download/tianji.apk', (req, res) => {
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="tianji.apk"');
  res.sendFile(path.join(appPath, 'tianji.apk'));
});

// 门户首页静态文件服务（v4.0 新增）
// /app/ 路径提供原来的网页版 SPA 应用（[SEC-FIX] P2-6: 同样走受限静态服务）
app.use('/app', secureStatic(webPath));
app.get('/app/*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(webPath, 'index.html'));
});

// 用户协议和隐私政策页面
app.get('/agreement', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(webPath, 'agreement.html'));
});
app.get('/privacy', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(webPath, 'privacy.html'));
});
app.get('/agreement.en', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(webPath, 'agreement.en.html'));
});
app.get('/privacy.en', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(webPath, 'privacy.en.html'));
});

// 删除账号页（Google Play 上架要求 — 商品详情删除账号链接，2026-08-20 新增）
app.get('/delete-account', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(webPath, 'delete-account.html'));
});

// favicon 兜底：避免浏览器请求 /favicon.ico 返回 404（消除控制台噪音）
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Health check（含数据库和Redis状态）
app.get('/api/health', async (req, res) => {
  try {
    const db = require('./src/middleware/db');
    const dbStats = await db.getStats();

    // Redis 状态检查
    let redisStatus = 'unknown';
    try {
      const redisService = require('./src/services/redis');
      if (typeof redisService.ping === 'function') {
        redisStatus = (await redisService.ping()) ? 'connected' : 'disconnected';
      }
    } catch (e) {
      redisStatus = 'error';
    }

    // openid 反查统计
    let openidStats = null;
    try {
      const { getOpenidResolveStats } = require('./src/middleware/auth');
      openidStats = getOpenidResolveStats();
    } catch (e) {
      // 忽略
    }

    const healthy = dbStats.status === 'active';
    res.status(healthy ? 200 : 503).json({
      success: healthy,
      status: healthy ? 'ok' : 'degraded',
      version: '10.3',
      db: dbStats,
      redis: redisStatus,
      openidResolve: openidStats,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      status: 'error',
      version: '10.3',
      error: e.message,
      redis: 'unknown',
      timestamp: new Date().toISOString()
    });
  }
});

// 数据库连接池状态检查（管理用，需登录认证）
app.get('/api/admin/db-status', require('./src/middleware/auth').verifyToken, async (req, res) => {
  // 仅管理员可查看
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, code: 'ADMIN_AUTH_REQUIRED', message: '需要管理员权限' });
  }
  try {
    const db = require('./src/middleware/db');
    const dbStats = await db.getStats();
    res.json({ success: true, data: dbStats });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/tuiyan', tuiyanRoutes);
app.use('/api/gua', guaRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/relationship', relationshipRoutes);
app.use('/api/match', matchRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/event', eventRoutes);
app.use('/api/admin', adminRoutes);

// [NEW] 64卦卡牌收集系统
// 注意：GET /count/:openid 必须在 GET /:openid 之前，所以 mount 在 /api/user/gua-collection 下
app.use('/api/user/gua-collection', collectionRoutes);

// 易缘传书（信件）
app.use('/api/letter', letterRoutes);

// 节气养生
app.use('/api/solar-term', solarTermRoutes);

// 积分体系（签到/广告奖励/余额）
app.use('/api/points', pointsRoutes);

// App 下载版本公开读取（官网下载链接动态管理）
app.use('/api/app-download', appDownloadRoutes);

// 用户通知（匹配回应/信件到达/节气提醒）
app.use('/api/notifications', notificationRoutes);
app.use('/api/push', pushRoutes);

// 404 & error
app.use(notFoundMiddleware);
app.use(errorMiddleware);

// Start
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[天机推演] 后端服务启动成功 http://0.0.0.0:${PORT}`);
  console.log(`[天机推演] 健康检查 http://0.0.0.0:${PORT}/api/health`);
});

// 连接池饱和监控（每30秒检查，提前发现数据库瓶颈）
setInterval(async () => {
  try {
    const db = require('./src/middleware/db');
    const stats = await db.getStats();
    if (stats.pendingAcquires > 50) {
      console.error('[ALERT] DB pool near saturation:', JSON.stringify(stats));
    }
    if (stats.activeConnections >= stats.config.connectionLimit) {
      console.warn('[WARN] DB pool full:', stats.activeConnections, '/', stats.config.connectionLimit);
    }
  } catch (e) { /* silent */ }
}, 30000);

// 优雅关闭（PM2 发送 SIGTERM 时不丢请求）
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown(signal) {
  console.log(`[${signal}] Graceful shutdown...`);
  server.close(() => {
    console.log(`[${signal}] All connections closed`);
    process.exit(0);
  });
  // 10秒后强制退出，防止卡死
  setTimeout(() => {
    console.log(`[${signal}] Forced exit after 10s`);
    process.exit(0);
  }, 10000);
}

module.exports = app;
