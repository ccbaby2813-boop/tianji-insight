// PM2 配置文件 - 天机推演后端（v10.3 日志轮转版）
// 所有关键环境变量从 .env 文件加载，不再在此明文存储
require('dotenv').config({ path: __dirname + '/.env' });

module.exports = {
  apps: [{
    name: 'tianji-tuiyan-api',
    script: 'server.js',
    cwd: '/home/admin/.openclaw/workspace/projects/tianji-tuiyan',
    instances: 4,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
    },
    // v10.3 提高内存限制（AI调用+大JSON处理可能消耗较多内存）
    max_memory_restart: '800M',
    // v10.3 日志输出路径（配合 pm2-logrotate 轮转）
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
