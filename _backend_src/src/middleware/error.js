// src/middleware/error.js - 全局错误处理
// [SEC-FIX] P3-3: 不再直接回显 err.message（可能包含内部 SQL/路径/堆栈敏感信息），
// 对外只返回通用错误信息，完整错误详情仅写入服务端日志。
function errorMiddleware(err, req, res, next) {
  console.error('[ERROR]', err);
  // 允许业务主动抛出的、面向用户的安全错误（须带 safe=true 标记，否则一律隐藏细节）
  const code = err.code || 'INTERNAL_ERROR';
  const status = err.status || 500;
  let message = '服务器内部错误';
  if (err && err.safe === true && typeof err.message === 'string' && err.message.length <= 200) {
    message = err.message;
  } else if (err && err.expose === true && typeof err.message === 'string' && err.message.length <= 200) {
    message = err.message;
  }
  res.status(status).json({ success: false, code, message });
}

function notFoundMiddleware(req, res) {
  res.status(404).json({ success: false, code: 'NOT_FOUND', message: '接口不存在' });
}

module.exports = { errorMiddleware, notFoundMiddleware };
