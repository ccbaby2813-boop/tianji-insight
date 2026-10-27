/**
 * utils/fonts.js - 字体分层管理器
 * v2.4 字体加载保障版（后端代理 + 多重保障）
 *
 * v2.4 核心修复：
 *   改用后端 /api/font/:name 代理路由加载字体，解决 CDN nginx 返回
 *   application/octet-stream 导致 wx.loadFontFace 报 "A network error occurred" 的问题。
 *   后端代理路由设置正确的 Content-Type: font/ttf 和 CORS 头。
 *
 * 策略：后端代理字体 + 多重保障
 * - L0 展示字：霞鹜文楷 Medium（用于"天機推演"等装饰性标题，原篆书位置）
 * - L1 灵魂字：霞鹜文楷 Medium（卦名、核心符号，更粗更有力度）
 * - L2 标题字：霞鹜文楷 Regular（页面标题、卦格名）
 * - L3 正文字：系统默认
 * - L4 点缀字：系统宋体/仿宋
 */

const FONT_API_BASE = 'https://claw-book.cn/tianji/api/font';

const FONT_FAMILIES = {
  // L0 展示字：霞鹜文楷 Medium（替代原篆书，用于"天機推演"装饰性标题）
  display: {
    family: 'LXGWWenKaiMedium',
    source: `${FONT_API_BASE}/LXGWWenKai-Medium-Subset.ttf`,
    fallback: '"STXingkai", "KaiTi", "楷体", "Noto Serif CJK SC", serif'
  },
  // L1 灵魂字：霞鹜文楷 Medium（卦名、核心符号，更粗更有力度）
  soul: {
    family: 'LXGWWenKaiMedium',
    source: `${FONT_API_BASE}/LXGWWenKai-Medium-Subset.ttf`,
    fallback: '"STXingkai", "KaiTi", "楷体", "Noto Serif CJK SC", serif'
  },
  // L2 标题字：霞鹜文楷 Regular（页面标题、卦格名）
  title: {
    family: 'LXGWWenKai',
    source: `${FONT_API_BASE}/LXGWWenKai-Subset.ttf`,
    fallback: '"STKaiti", "KaiTi", "楷体", "Noto Serif CJK SC", serif'
  },
  // L3 正文字：系统默认
  body: {
    family: 'BodyText',
    source: '',
    fallback: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  },
  // L4 点缀字：宋体/仿宋
  quote: {
    family: 'QuoteSong',
    source: '',
    fallback: '"STSong", "SimSun", "宋体", "Noto Serif CJK SC", serif'
  }
};

// CSS class 映射（降级链与 FONT_FAMILIES 严格对齐）
const FONT_CLASSES = {
  'font-display': `font-family: "LXGWWenKaiMedium", ${FONT_FAMILIES.display.fallback}; font-weight: 800;`,
  'font-soul': `font-family: "LXGWWenKaiMedium", ${FONT_FAMILIES.soul.fallback};`,
  'font-title': `font-family: "LXGWWenKai", ${FONT_FAMILIES.title.fallback};`,
  'font-body': `font-family: ${FONT_FAMILIES.body.fallback};`,
  'font-quote': `font-family: ${FONT_FAMILIES.quote.fallback}; font-style: italic;`
};

let _fontLoaded = { l1: false, l2: false };
let _loadingPromise = null;

/**
 * 加载单个字体（封装 wx.loadFontFace，global:true 全局生效）
 * v2.3：10秒超时 + 自动重试机制
 */
function _loadFontFace(family, source, retryCount = 0) {
  return new Promise((resolve) => {
    if (!wx || !wx.loadFontFace) {
      resolve(false);
      return;
    }

    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn('[Font] ' + family + ' 加载超时(10s)' + (retryCount > 0 ? '，重试后仍失败' : '') + '，使用系统字体降级');
        resolve(false);
      }
    }, 10000);

    wx.loadFontFace({
      global: true,
      family: family,
      source: source,
      success: () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          console.log('[Font] ' + family + ' 加载成功' + (retryCount > 0 ? '(重试第' + retryCount + '次)' : ''));
          resolve(true);
        }
      },
      fail: (err) => {
        if (!resolved) {
          clearTimeout(timer);
          // v2.5：字体加载失败后不再立即重试（避免消耗API限流配额）
          // 后端字体代理路由部署后会自动加载成功
          resolved = true;
          const errMsg = (err && err.errMsg) || 'unknown';
          console.warn('[Font] ' + family + ' 加载失败，使用系统字体降级:', errMsg);
          resolve(false);
        }
      }
    });
  });
}

/**
 * 初始化字体加载
 * 在 app.js onLaunch 中调用
 * v2.3：并行加载 L1 + L2，失败自动重试
 */
function initFonts() {
  if (_fontLoaded.l1 && _fontLoaded.l2) return Promise.resolve();
  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = new Promise(async (resolve) => {
    console.log('[Font] 开始加载字体（后端代理: ' + FONT_API_BASE + '）');

    const tasks = [];
    if (!_fontLoaded.l1) {
      tasks.push(
        _loadFontFace('LXGWWenKaiMedium', `url("${FONT_API_BASE}/LXGWWenKai-Medium-Subset.ttf")`)
          .then(ok => { _fontLoaded.l1 = ok; })
      );
    }
    if (!_fontLoaded.l2) {
      tasks.push(
        _loadFontFace('LXGWWenKai', `url("${FONT_API_BASE}/LXGWWenKai-Subset.ttf")`)
          .then(ok => { _fontLoaded.l2 = ok; })
      );
    }

    await Promise.all(tasks);

    console.log('[Font] 加载完成: L1(Medium)=' + _fontLoaded.l1 + ', L2(Regular)=' + _fontLoaded.l2);

    // v2.5：移除自动重试（避免消耗API限流配额），后端部署后会自动加载成功
    if (!_fontLoaded.l1 || !_fontLoaded.l2) {
      console.log('[Font] 部分字体未加载，使用系统字体降级。后端字体代理部署后将自动生效');
    }

    resolve();
  });

  return _loadingPromise;
}

/**
 * v2.3 新增：重试加载字体（供页面 onShow 调用）
 * 如果字体未加载成功，在页面 onShow 时重试
 */
function retryLoadFonts() {
  if (_fontLoaded.l1 && _fontLoaded.l2) return Promise.resolve();
  _loadingPromise = null;
  return initFonts();
}

/**
 * 检查字体是否已加载
 */
function isFontLoaded() {
  return _fontLoaded.l1 && _fontLoaded.l2;
}

/**
 * 检查指定层级字体是否已加载
 */
function isFontLevelLoaded(level) {
  if (level === 'l1' || level === 'display' || level === 'soul') return _fontLoaded.l1;
  if (level === 'l2' || level === 'title') return _fontLoaded.l2;
  return false;
}

module.exports = { FONT_FAMILIES, FONT_CLASSES, initFonts, retryLoadFonts, isFontLoaded, isFontLevelLoaded };
