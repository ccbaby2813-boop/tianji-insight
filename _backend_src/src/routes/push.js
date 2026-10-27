// src/routes/push.js - 推送注册相关接口
// POST /api/push/register  前端上报/更新当前用户的推送 RegistrationID（设备级，卸载重装会变）
// 说明：RegistrationID 由 @tencentcloud/donut-push 注册成功后返回，
//       前端在登录态下上报，后端绑定到 users.push_registration_id 供定向推送使用。

const express = require('express');
const router = express.Router();
const db = require('../middleware/db');
const { verifyToken } = require('../middleware/auth');
const { isConfigured } = require('../services/push-service');

// 上报/更新推送标识
router.post('/register', verifyToken, async (req, res) => {
  try {
    const registrationId = String((req.body && req.body.registrationId) || '').trim();
    if (!registrationId || registrationId.length > 128) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_REGISTRATION_ID',
        message: 'registrationId 无效'
      });
    }
    // lang: 'en'/'zh'，用于系统推送按语言出英文/中文模板
    const lang = String((req.body && req.body.lang) || 'zh').trim();
    const safeLang = (lang === 'en') ? 'en' : 'zh';
    await db.query('UPDATE users SET push_registration_id = ?, lang = ? WHERE openid = ?', [
      registrationId,
      safeLang,
      req.user.openid
    ]);
    res.json({ success: true, data: { registered: true } });
  } catch (err) {
    console.error('[push/register]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// 推送服务配置状态（供调试/管理端查看，无需鉴权信息）
router.get('/status', verifyToken, (req, res) => {
  res.json({
    success: true,
    data: {
      pushConfigured: isConfigured(),
      sdkAppIDConfigured: !!process.env.PUSH_SDKAPPID
    }
  });
});

module.exports = router;
