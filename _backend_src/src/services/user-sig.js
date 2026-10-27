// src/services/user-sig.js - 腾讯云 IM UserSig v2 签名生成（TLSSigAPIv2 标准实现）
// 用途：TIMPush 服务端接口鉴权（v4/timpush/batch 等 REST API）
// 算法：HMAC-SHA256 + JSON 包装 + zlib deflate 压缩 + 腾讯云自定义 base64url
// 官方参考：https://cloud.tencent.com/document/product/269/32688
// 参数来源：IM 控制台（SDKAppID / 密钥 Key / App 管理员账号）

const crypto = require('crypto');
const zlib = require('zlib');

/**
 * 腾讯云自定义 base64url 编码
 * 规则：+ → *，/ → -，= → _（注意是下划线，不是删除）
 */
function tencentBase64Encode(data) {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '*')
    .replace(/\//g, '-')
    .replace(/=/g, '_');
}

/**
 * 生成 UserSig（v2 标准格式）
 * @param {number} sdkAppID - IM 控制台分配的 SDKAppID
 * @param {string} key - IM 控制台密钥 Key（应用配置里的密钥，不是客户端 Push Key）
 * @param {string} identifier - App 管理员账号，默认 'administrator'
 * @param {number} expire - 有效期秒数，默认 180 天
 * @returns {string} UserSig
 */
function genUserSig(sdkAppID, key, identifier, expire = 86400 * 180) {
  if (!sdkAppID || !key) {
    throw new Error('[user-sig] 缺少 sdkAppID 或 key，请检查 PUSH_* 环境变量配置');
  }
  const currTime = Math.floor(Date.now() / 1000);

  // 1. 构造签名原文
  const sigDoc =
    `TLS.identifier:${identifier}\n` +
    `TLS.sdkappid:${sdkAppID}\n` +
    `TLS.time:${currTime}\n` +
    `TLS.expire:${expire}\n`;

  // 2. HMAC-SHA256 签名，sig 用标准 base64（不做 url 替换）
  const sig = crypto.createHmac('sha256', key).update(sigDoc, 'utf8').digest('base64');

  // 3. 构造 JSON 对象
  const jsonObj = {
    'TLS.ver': '2.0',
    'TLS.identifier': identifier,
    'TLS.sdkappid': sdkAppID,
    'TLS.time': currTime,
    'TLS.expire': expire,
    'TLS.sig': sig
  };

  // 4. JSON 字符串化 + zlib deflate 压缩
  const jsonStr = JSON.stringify(jsonObj);
  const compressed = zlib.deflateSync(Buffer.from(jsonStr, 'utf8'));

  // 5. 腾讯云自定义 base64url 编码
  return tencentBase64Encode(compressed);
}

module.exports = { genUserSig };
