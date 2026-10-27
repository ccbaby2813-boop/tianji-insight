/**
 * 环境配置
 * 开发环境：API_BASE 指向本地后端
 * 生产环境：API_BASE 指向线上 Nginx 反代
 *
 * v2.9 渠道(默认语言)配置：
 *   CHANNEL = 'google'  上架 Google Play 海外版，App 默认英文
 *   CHANNEL = 'cn'      上架国内(华为/应用宝等)，App 默认中文
 *   （小程序端固定默认中文，不受 CHANNEL 影响；App 端通过 i18n 默认语言读取）
 *   构建前按目标市场改 CHANNEL 即可，用户仍可在「我的」页自行切换语言（已选语言持久化优先）。
 */
const ENV = 'production'; // development | production

// v2.9 上架渠道：'google'（海外 Google Play，默认英文）| 'cn'（国内，默认中文）
// ⚠️ 构建 Google 版前保持 'google'；构建国内版前改为 'cn'
const CHANNEL = 'google';

const config = {
  development: {
    API_BASE: 'http://localhost:3003',
    MEDIA_BASE: 'https://claw-book.cn/tianji-media',
    DEFAULT_LANG: CHANNEL === 'google' ? 'en' : 'zh',
    CHANNEL: CHANNEL
  },
  production: {
    API_BASE: 'https://claw-book.cn/tianji',
    MEDIA_BASE: 'https://claw-book.cn/tianji-media',
    DEFAULT_LANG: CHANNEL === 'google' ? 'en' : 'zh',
    CHANNEL: CHANNEL
  }
};

module.exports = config[ENV] || config.development;
