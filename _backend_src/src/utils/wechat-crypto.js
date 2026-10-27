// src/utils/wechat-crypto.js - 微信消息加解密（兼容模式）
// 参考: https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Message_encryption_and_decryption_instructions.html
const crypto = require('crypto');

// [SEC-FIX] P0-2: 移除硬编码默认密钥。生产环境必须显式配置 WX_MSG_TOKEN / WX_MSG_AES_KEY / WX_APPID，
// 缺失时 fail-closed（抛错拒绝），绝不允许回退到公开已知的默认值（否则可伪造微信回调免费刷VIP）。
const TOKEN = process.env.WX_MSG_TOKEN;
const ENCODING_AES_KEY = process.env.WX_MSG_AES_KEY;
const APPID = process.env.WX_APPID;

/**
 * 检查微信消息加解密所需配置是否齐全（fail-closed 前置检查）
 */
function isConfigured() {
  return !!(TOKEN && ENCODING_AES_KEY && APPID);
}

function assertConfigured() {
  if (!isConfigured()) {
    const missing = [];
    if (!TOKEN) missing.push('WX_MSG_TOKEN');
    if (!ENCODING_AES_KEY) missing.push('WX_MSG_AES_KEY');
    if (!APPID) missing.push('WX_APPID');
    const err = new Error('微信消息加解密配置缺失: ' + missing.join(', '));
    err.code = 'WX_CRYPTO_NOT_CONFIGURED';
    err.status = 500;
    throw err;
  }
}

/**
 * 解码 EncodingAESKey → 32字节 AES 密钥
 */
function decodeAESKey() {
  // EncodingAESKey 是43字符的base64编码，末尾有一个'='补位
  const key = ENCODING_AES_KEY + '=';
  return Buffer.from(key, 'base64'); // 32 bytes
}

/**
 * PKCS7 去除补位
 */
function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) return buf;
  return buf.slice(0, buf.length - pad);
}

/**
 * 解密微信加密消息
 * @param {string} encryptStr - Base64编码的加密内容
 * @returns {string} 解密后的明文XML或JSON
 */
function decrypt(encryptStr) {
  assertConfigured();
  const aesKey = decodeAESKey();

  // Base64解码加密内容
  const encrypted = Buffer.from(encryptStr, 'base64');

  // AES-256-CBC 解密，IV 为 AESKey 的前16字节
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesKey.slice(0, 16));
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  // 去除PKCS7补位
  decrypted = pkcs7Unpad(decrypted);

  // 去掉前16字节随机数
  const content = decrypted.slice(16);

  // 读取4字节网络字节序的消息长度
  const msgLen = content.readUInt32BE(0);

  // 提取消息内容
  const msg = content.slice(4, 4 + msgLen).toString('utf8');

  // 验证尾部 appId（剩余字节）
  const appId = content.slice(4 + msgLen).toString('utf8');
  if (appId !== APPID) {
    console.warn('[wechat-crypto] appId不匹配: 期望=' + APPID + ', 实际=' + appId + ' (非致命，继续处理)');
  }

  return msg;
}

/**
 * 验证消息签名
 * @param {string} signature - 微信传来的签名
 * @param {string} timestamp - 时间戳
 * @param {string} nonce - 随机数
 * @param {string} encryptStr - 加密字符串（可选）
 * @returns {boolean}
 */
function verifySignature(signature, timestamp, nonce, encryptStr) {
  assertConfigured();
  const sorted = [TOKEN, timestamp, nonce];
  if (encryptStr) sorted.push(encryptStr);
  sorted.sort();
  const computed = crypto.createHash('sha1').update(sorted.join('')).digest('hex');
  return signature === computed;
}

module.exports = { decrypt, verifySignature, decodeAESKey, isConfigured, assertConfigured };
