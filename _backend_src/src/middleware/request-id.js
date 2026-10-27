// src/middleware/request-id.js - 请求追踪中间件（v10.3）
// 为每个请求生成唯一 ID，注入 req.id 并在响应头返回，方便日志关联排查

const crypto = require('crypto');

function requestId(req, res, next) {
  // 优先使用客户端传入的 ID（如前端追踪系统），否则自动生成
  req.id = req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', req.id);
  next();
}

module.exports = requestId;
