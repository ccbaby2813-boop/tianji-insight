// src/middleware/admin.js - 管理员认证中间件
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

console.log('[admin middleware] JWT_SECRET loaded:', JWT_SECRET ? 'YES' : 'NO');

function verifyAdminToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ success: false, code: 'ADMIN_AUTH_FAILED', message: '缺少认证信息' });

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ success: false, code: 'ADMIN_IP_DENIED', message: '权限不足' });
    req.admin = decoded;
    next();
  } catch (err) {
    console.log('[admin middleware] Token verify error:', err.message);
    return res.status(401).json({ success: false, code: 'ADMIN_AUTH_FAILED', message: 'Token无效' });
  }
}

module.exports = { verifyAdminToken };
