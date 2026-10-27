// src/utils/sms.js - 阿里云短信服务
// API文档: https://api.aliyun.com/document/Dysmsapi/2017-05-25/SendSms
// 使用 @alicloud/dysmsapi20170525 SDK (V3签名)

let Dysmsapi = null;
let OpenApi = null;

// 尝试加载SDK，如果未安装则降级为模拟模式
try {
  Dysmsapi = require('@alicloud/dysmsapi20170525');
  OpenApi = require('@alicloud/openapi-client');
} catch (e) {
  console.warn('[sms] @alicloud/dysmsapi20170525 未安装，短信将使用模拟模式。请运行: npm install @alicloud/dysmsapi20170525 @alicloud/openapi-client');
}

let client = null;

function getClient() {
  if (!Dysmsapi || !OpenApi) return null;
  if (client) return client;

  const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;

  if (!accessKeyId || !accessKeySecret) {
    console.warn('[sms] ALIBABA_CLOUD_ACCESS_KEY_ID/ALIBABA_CLOUD_ACCESS_KEY_SECRET 未配置，短信发送将跳过');
    return null;
  }

  try {
    const config = new OpenApi.Config({
      accessKeyId,
      accessKeySecret,
    });
    config.endpoint = 'dysmsapi.aliyuncs.com';

    client = new Dysmsapi.default(config);
    console.log('[sms] 阿里云短信客户端初始化成功');
    return client;
  } catch (e) {
    console.error('[sms] 客户端初始化失败:', e.message);
    return null;
  }
}

/**
 * 发送短信验证码
 * @param {string} phone - 手机号 (11位)
 * @param {string} code - 6位验证码
 * @returns {Promise<{sent: boolean, bizId?: string, reason?: string, message?: string}>}
 */
async function sendSms(phone, code) {
  const smsClient = getClient();

  // SDK未安装或未配置 → 降级为模拟模式（开发/测试环境）
  if (!smsClient) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[sms] 生产环境短信未配置，无法发送验证码到:', phone);
      return { sent: false, reason: 'not_configured', message: '短信服务未配置' };
    }
    // 非生产环境：打印验证码到日志，方便测试
    console.log(`[sms] 模拟发送 → 手机号:${phone} 验证码:${code}`);
    return { sent: true, bizId: 'mock_' + Date.now() };
  }

  const signName = process.env.SMS_SIGN_NAME;
  const templateCode = process.env.SMS_TEMPLATE_CODE;

  if (!signName) {
    console.error('[sms] SMS_SIGN_NAME 未配置（如：天机推演）');
    return { sent: false, reason: 'no_sign_name', message: '短信签名未配置' };
  }
  if (!templateCode) {
    console.error('[sms] SMS_TEMPLATE_CODE 未配置（如：SMS_123456789）');
    return { sent: false, reason: 'no_template', message: '短信模板未配置' };
  }

  try {
    const sendReq = new Dysmsapi.SendSmsRequest({
      phoneNumbers: phone,
      signName: signName,
      templateCode: templateCode,
      templateParam: JSON.stringify({ code }),
    });

    const result = await smsClient.sendSms(sendReq);
    const body = result.body || {};

    if (body.code === 'OK') {
      console.log(`[sms] 发送成功: ${phone} bizId=${body.bizId}`);
      return { sent: true, bizId: body.bizId };
    } else {
      console.error(`[sms] 发送失败: ${phone} code=${body.code} message=${body.message}`);
      return { sent: false, reason: body.code, message: body.message };
    }
  } catch (err) {
    // 阿里云SDK返回的异常结构
    const errData = err.data || {};
    const errCode = errData.Code || err.code || 'UNKNOWN';
    const errMsg = errData.Message || err.message || '未知错误';

    console.error(`[sms] 发送异常: ${phone} code=${errCode} message=${errMsg}`);

    // 常见错误码处理
    if (errCode === 'isv.BUSINESS_LIMIT_CONTROL') {
      return { sent: false, reason: errCode, message: '发送频率超限，请稍后再试' };
    }
    if (errCode === 'isv.MOBILE_NUMBER_ILLEGAL') {
      return { sent: false, reason: errCode, message: '手机号码格式错误' };
    }
    if (errCode === 'isv.SIGN_NAME_ILLEGAL') {
      return { sent: false, reason: errCode, message: '短信签名不合法' };
    }
    if (errCode === 'isv.TEMPLATE_ILLEGAL') {
      return { sent: false, reason: errCode, message: '短信模板不合法' };
    }

    return { sent: false, reason: errCode, message: errMsg };
  }
}

module.exports = { sendSms };