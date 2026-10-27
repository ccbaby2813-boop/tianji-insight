// src/routes/payment.js - 额度与支付相关接口
const express = require('express');
const router = express.Router();
const { verifyToken, verifyOpenidMatch } = require('../middleware/auth');
const db = require('../middleware/db');
const crypto = require('crypto');
const xml2js = require('xml2js');
const axios = require('axios');
const { resolveOpenid } = require('../utils/openid-resolver');
const { downgradeExpiredVip } = require('../utils/vip'); // v2.3.5 抽取VIP降级公共函数
const googlePlay = require('../utils/googleplay'); // v20.2 Google Play Billing 服务端验签


// 内存存储 session_key（PM2单进程模式可用）
// key: openid, value: { sessionKey, timestamp }
const sessionKeyStore = require('../store');
// 内存存储 session_key（供虚拟支付签名使用）
const redisService = require('../services/redis');

// 导出供 auth.js 使用

// GET /api/payment/status - 支付状态（公开，无需认证）
// v3.5 前端购买前检查：支付未配置时提示“即将开通”，避免真实扣款后验签失败
router.get('/status', async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        googlePlayConfigured: !!(process.env.GOOGLE_PLAY_PACKAGE && (process.env.GOOGLE_PLAY_CREDENTIALS_JSON || process.env.GOOGLE_PLAY_CREDENTIALS_PATH)),
        wxpayConfigured: !!process.env.XPAY_APP_KEY
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// GET /api/payment/quota/:openid - 查询额度（需认证，只能查自己）
router.get('/quota/:openid', verifyToken, verifyOpenidMatch, async (req, res) => {
  try {
    const conn = await db.get();
    try {
      const [rows] = await conn.query(
        'SELECT quota_remaining, plan_type FROM users WHERE openid = ?',
        [req.openid]
      );
      if (rows.length === 0) {
        return res.json({ success: false, code: 'USER_NOT_FOUND', message: '用户不存在' });
      }
      res.json({ success: true, data: rows[0] });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[payment/quota]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// GET /api/payment/vip-info/:openid - 获取VIP信息（需认证）
router.get('/vip-info/:openid', verifyToken, verifyOpenidMatch, async (req, res) => {
  try {
    const conn = await db.get();
    try {
      const [rows] = await conn.query(
        'SELECT plan_type, quota_remaining, expire_time, last_quota_reset_date, points, total_points, last_points_grant_date FROM users WHERE openid = ?',
        [req.openid]
      );
      if (rows.length === 0) {
        return res.json({ success: false, code: 'USER_NOT_FOUND', message: '用户不存在' });
      }

      const user = rows[0];
      const now = new Date();
      const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const today = beijingTime.toISOString().split('T')[0];

      // v2.3.5 VIP过期自动降级（公共函数）；未降级才做每日配额重置
      const downgraded = await downgradeExpiredVip(conn, req.openid, user);
      if (!downgraded) {
        // 每日配额重置
        const lastReset = user.last_quota_reset_date;
        const lastResetDate = lastReset ? new Date(new Date(lastReset).getTime() + 8 * 60 * 60 * 1000).toISOString().split('T')[0] : null;
        if (!lastResetDate || lastResetDate !== today) {
          if (user.plan_type === 'monthly' || user.plan_type === 'yearly') {
            // VIP用户：每日重置为20
            await conn.query('UPDATE users SET quota_remaining=20, last_quota_reset_date=? WHERE openid=?', [today, req.openid]);
            user.quota_remaining = 20;
          } else {
            // 免费用户：每日重置为3
            await conn.query('UPDATE users SET quota_remaining=3, last_quota_reset_date=? WHERE openid=?', [today, req.openid]);
            user.quota_remaining = 3;
          }
        }
      }

      // 查询VIP超级推演剩余次数（Redis只读查询）
      let vipDecodeRemaining = 0;
      // 🔴 修复：改为白名单判断，与tuiyan.js:148保持一致，防止脏数据误查VIP额度
      if (user.plan_type === 'monthly' || user.plan_type === 'yearly') {
        try {
          vipDecodeRemaining = await redisService.getVipDecodeRemaining(req.openid);
        } catch (redisErr) {
          console.error('[vip-info] Redis查询失败:', redisErr.message);
          vipDecodeRemaining = 1; // fail open
        }
      }

      // v17.0 签到奖励的额外超级推演次数（连续签到7天+1次，90天有效）
      let extraVipDecode = 0;
      try { extraVipDecode = await redisService.getExtraVipDecode(req.openid); } catch (e) { /* 忽略 */ }

      res.json({
        success: true,
        data: {
          plan_type: user.plan_type,
          quota_remaining: user.quota_remaining,
          expire_at: user.expire_time,
          last_quota_reset_date: user.last_quota_reset_date,
          vipDecodeRemaining,
          extraVipDecode,
          points: user.points || 0
        }
      });
    } finally { conn.release(); }
  } catch (err) {
    console.error('[payment/vip-info]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  }
});

// ========== 微信小程序虚拟支付 ==========

// POST /api/payment/store-session-key - 登录时存储 session_key（供签名用）
router.post('/store-session-key', verifyToken, async (req, res) => {
  try {
    const { sessionKey } = req.body;
    if (!sessionKey) {
      return res.status(400).json({ success: false, message: 'sessionKey必填' });
    }
    // 使用JWT中的openid，防止伪造
    await sessionKeyStore.set(req.openid, sessionKey);
    res.json({ success: true });
  } catch (err) {
    console.error('[payment/store-session-key]', err);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// POST /api/payment/create-order - 创建虚拟支付订单（返回签名参数）
router.post('/create-order', verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    const { productId, code } = req.body;
    if (!productId || !['vip_monthly', 'vip_yearly'].includes(productId)) {
      return res.status(400).json({ success: false, message: 'productId必须是vip_monthly或vip_yearly' });
    }

    // 商品价格（单位：分）
    const priceMap = { vip_monthly: 1990, vip_yearly: 16800 };
    const goodsPrice = priceMap[productId];

    // 生成唯一订单号（8-32字符，数字+字母，不能以_开头）
    const outTradeNo = 'TJ' + Date.now() + Math.random().toString(36).substr(2, 6);

    // 取 session_key（优先用前端传来的code实时换取，解决PM2集群模式跨进程内存不共享问题）
    let sessionKey = null;

    if (code) {
      // 每次支付前小程序端wx.login()获取最新code，服务端实时code2Session换取session_key
      // 不依赖跨进程共享的sessionKeyStore内存Map
      const appId = process.env.WX_APPID;
      const appSecret = process.env.WX_APPSECRET;
      if (!appId || !appSecret) {
        return res.status(500).json({ success: false, message: '支付服务配置错误' });
      }
      try {
        const wxUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${encodeURIComponent(appSecret)}&js_code=${code}&grant_type=authorization_code`;
        const wxRes = await axios.get(wxUrl, { timeout: 10000 });
        if (wxRes.data.errcode) {
          console.error('[create-order] code2Session failed:', JSON.stringify(wxRes.data));
          return res.status(400).json({ success: false, message: '登录凭证已过期，请重新进入小程序', code: 'SESSION_KEY_MISSING' });
        }
        const wxOpenid = wxRes.data.openid;
        // 安全校验：code换来的微信openid必须和JWT中的openid一致，或通过user_bindings表关联到同一个主账号
        if (wxOpenid !== openid) {
          const db = require('../middleware/db');
          const conn = await db.get();
          try {
            const [bindRows] = await conn.query(
              'SELECT unified_openid FROM user_bindings WHERE platform = ? AND platform_openid = ? LIMIT 1',
              ['wechat', wxOpenid]
            );
            if (bindRows.length === 0 || bindRows[0].unified_openid !== openid) {
              console.error(`[create-order] 安全警告: code openid(${wxOpenid}) 与 JWT openid(${openid}) 无绑定关系`);
              return res.status(400).json({ success: false, message: '用户身份校验失败', code: 'SESSION_KEY_MISSING' });
            }
          } finally {
            conn.release();
          }
        }
        sessionKey = wxRes.data.session_key;
      } catch (wxErr) {
        console.error('[create-order] WeChat API error:', wxErr.message);
        return res.status(500).json({ success: false, message: '支付服务异常，请重试' });
      }
    } else {
      // 兼容旧版（未传code时走内存，PM2单进程时可用）
      const sessionKeyEntry = await sessionKeyStore.get(openid);
      if (!sessionKeyEntry || !sessionKeyEntry.sessionKey) {
        return res.status(400).json({ success: false, message: '请先重新登录', code: 'SESSION_KEY_MISSING' });
      }
      sessionKey = sessionKeyEntry.sessionKey;
    }
    

    // 组装 signData（按微信文档字段顺序）
    const signDataObj = {
      offerId: process.env.XPAY_OFFER_ID,
      productId: productId,
      outTradeNo: outTradeNo,
      buyQuantity: 1,
      goodsPrice: goodsPrice,
      env: parseInt(process.env.XPAY_ENV || '0'),
      currencyType: 'CNY',
      attach: productId
    };
    const signDataStr = JSON.stringify(signDataObj);


    // 支付签名: paySig = HMAC-SHA256(appKey, uri + '&' + signData)
    // 根据微信官方文档，wx.requestVirtualPayment 的 uri 固定为 "requestVirtualPayment"
    const appKey = process.env.XPAY_APP_KEY;
    if (!appKey) {
      return res.status(500).json({ success: false, message: 'XPAY_APP_KEY未配置' });
    }
    const uri = 'requestVirtualPayment';
    const needSignMsg = uri + '&' + signDataStr;
    const paySig = crypto.createHmac('sha256', appKey).update(needSignMsg).digest('hex');

    // 用户态签名: signature = HMAC-SHA256(session_key, signData)
    const signature = crypto.createHmac('sha256', sessionKey).update(signDataStr).digest('hex');

    // 记录订单到数据库（P1修复：幂等防重）
    // 同一用户10秒内只能创建1个pending订单，防止重复提交
    try {
      const conn = await db.get();
      try {
        // P1防重：检查10秒内是否已有pending订单
        const [recentOrders] = await conn.query(
          "SELECT id, out_trade_no FROM vip_orders WHERE openid=? AND status='pending' AND created_at > DATE_SUB(NOW(), INTERVAL 10 SECOND) ORDER BY created_at DESC LIMIT 1",
          [openid]
        );
        if (recentOrders.length > 0) {
          console.log(`[create-order] 防重拦截: openid=${openid}, recent=${recentOrders[0].out_trade_no}`);
          return res.status(429).json({ success: false, code: 'DUPLICATE_ORDER', message: '请勿重复提交，请稍后再试' });
        }

        await conn.query(
          'INSERT INTO vip_orders (openid, out_trade_no, product_id, goods_price, env, status) VALUES (?,?,?,?,?,?)',
          [openid, outTradeNo, productId, goodsPrice, parseInt(process.env.XPAY_ENV || '0'), 'pending']
        );
        console.log(`[create-order] 订单已记录: openid=${openid}, outTradeNo=${outTradeNo}, productId=${productId}`);
      } finally { conn.release(); }
    } catch (dbErr) {
      console.error('[create-order] 订单记录失败，拒绝支付:', dbErr.message);
      return res.status(500).json({ success: false, code: 'ORDER_CREATE_FAILED', message: '订单创建失败，请稍后重试' });
    }

    console.log(`[create-order] openid=${openid}, productId=${productId}, outTradeNo=${outTradeNo}, goodsPrice=${goodsPrice}`);

    res.json({
      success: true,
      data: {
        signData: signDataStr,  // 必须返回字符串，不是对象
        paySig: paySig,
        signature: signature,
        mode: 'short_series_goods'
      }
    });
  } catch (err) {
    console.error('[create-order]', err);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// GET /api/payment/virtual-notify - 微信服务器验证（签名验证）
// Token: tianji2026（来自小程序后台消息推送配置）
router.get('/virtual-notify', (req, res) => {
  const { signature, msg_signature, timestamp, nonce, echostr } = req.query;
  
  // 兼容模式：验证 signature 或 msg_signature
  // 🔴 v3.4 安全加固：移除硬编码默认值，必须通过环境变量配置
  const token = process.env.WX_MSG_TOKEN || '';

  // 计算签名验证
  const calcSignature = (tok, ts, nc) => {
    const sorted = [tok, ts, nc].sort().join('');
    return crypto.createHash('sha1').update(sorted).digest('hex');
  };
  
  const computedSig = calcSignature(token, timestamp, nonce);
  
  // 兼容模式：signature 或 msg_signature 匹配即可
  const isValid = (signature === computedSig) || (msg_signature === computedSig);
  
  if (!isValid) {
    console.warn('[virtual-notify GET] 签名验证失败:', { signature, msg_signature, computedSig, timestamp, nonce });
    return res.status(401).send('fail');
  }
  
  console.log('[virtual-notify GET] 签名验证通过, echostr:', echostr);
  res.send(echostr);
});

// POST /api/payment/virtual-notify - 虚拟支付发货回调
// 兼容明文XML和加密XML（微信后台"兼容模式"配置）
// 腾讯官方文档：道具发货推送 xpay_goods_deliver_notify
router.post('/virtual-notify', async (req, res) => {
  const { msg_signature, timestamp, nonce } = req.query;
  // 🔴 v3.4 安全加固：移除硬编码默认值，必须通过环境变量配置
  const token = process.env.WX_MSG_TOKEN || '';

  try {
    // 兼容 XML (express-xml-bodyparser) 和 JSON (express.json) 两种格式
    const xmlData = req.body.xml || req.body;

    // 记录回调来源数据格式
    const rawKeys = Object.keys(xmlData || {}).join(',');
    const encryptRaw = xmlData.encrypt || xmlData.Encrypt;
    const encryptStr = Array.isArray(encryptRaw) ? encryptRaw[0] : encryptRaw;

    console.log('[virtual-notify] 收到回调, keys:', rawKeys, ', encrypted:', !!encryptStr);

    // === 加密模式：解密 Encrypt 字段 ===
    let bodyData = xmlData;
    if (encryptStr) {
      // 加密消息签名验证（需要包含 encrypt 字符串）
      const { verifySignature, decrypt } = require('../utils/wechat-crypto');
      if (!verifySignature(msg_signature, timestamp, nonce, encryptStr)) {
        console.warn('[virtual-notify] 加密消息签名验证失败');
        return res.status(401).send('fail');
      }

      try {
        const decryptedXml = decrypt(encryptStr);
        console.log('[virtual-notify] 解密成功, 长度:', decryptedXml.length);
        // 解密后是XML，用xml2js手动解析
        const parser = new xml2js.Parser({ explicitArray: true, normalizeTags: true });
        const parsed = await parser.parseStringPromise(decryptedXml);
        bodyData = parsed.xml || parsed; // xml2js包裹在根元素名中
      } catch (cryptoErr) {
        console.error('[virtual-notify] 解密失败:', cryptoErr.message);
        return res.send('fail');
      }
    } else {
      // 明文消息签名验证
      const sorted = [token, timestamp, nonce].sort().join('');
      const computedSig = require('crypto').createHash('sha1').update(sorted).digest('hex');
      if (!msg_signature || msg_signature !== computedSig) {
        console.warn('[virtual-notify] 明文签名验证失败');
        return res.status(401).send('fail');
      }
    }

    // === 提取字段（兼容 xmlParser 小写+数组 和 解密后xml2js小写+数组） ===
    const getField = (obj, ...names) => {
      for (const name of names) {
        const raw = obj[name] || obj[name.charAt(0).toUpperCase() + name.slice(1)];
        if (raw !== undefined) {
          if (Array.isArray(raw) && raw.length === 1 && typeof raw[0] === 'string') return raw[0];
          if (Array.isArray(raw)) return raw[0];
          if (typeof raw === 'string') return raw;
        }
      }
      return undefined;
    };

    const openid = getField(bodyData, 'openid');
    const outTradeNo = getField(bodyData, 'outtradeno');
    const envVal = getField(bodyData, 'env');
    const attach = getField(bodyData, 'attach') || '';

    // GoodsInfo 可能是嵌套对象
    let productId;
    const goodsInfoRaw = bodyData.goodsinfo || bodyData.GoodsInfo;
    const goodsInfo = Array.isArray(goodsInfoRaw) ? goodsInfoRaw[0] : (goodsInfoRaw || {});
    if (goodsInfo && typeof goodsInfo === 'object') {
      const pid = goodsInfo.productid || goodsInfo.ProductId;
      productId = Array.isArray(pid) ? pid[0] : pid;
    }

    // WeChatPayInfo（数组解包）
    let wechatPayInfo = bodyData.wechatpayinfo || bodyData.WeChatPayInfo;
    if (Array.isArray(wechatPayInfo)) wechatPayInfo = wechatPayInfo[0];
    const unwrap = (val) => Array.isArray(val) ? val[0] : val;
    const mchOrderNo = wechatPayInfo && unwrap(wechatPayInfo.mchorderno || wechatPayInfo.MchOrderNo);
    const transactionId = wechatPayInfo && unwrap(wechatPayInfo.transactionid || wechatPayInfo.TransactionId);
    const paidTime = wechatPayInfo && unwrap(wechatPayInfo.paidtime || wechatPayInfo.PaidTime);

    if (!openid || !productId) {
      console.error('[virtual-notify] 缺少必要字段, openid=', openid, ', productId=', productId);
      return res.send('fail');
    }
    
    // 环境验证：沙箱(1)或现网(0)，仅记录日志，不拒绝回调
    const expectedEnv = parseInt(process.env.XPAY_ENV || '0');
    const callbackEnv = parseInt(envVal) || 0;
    if (callbackEnv !== expectedEnv) {
      console.warn(`[virtual-notify] ⚠️ 环境不匹配: 回调env=${callbackEnv}, 服务端XPAY_ENV=${expectedEnv}，允许处理`);
    }

    const planType = productId === 'vip_monthly' ? 'monthly' : productId === 'vip_yearly' ? 'yearly' : null;
    if (!planType) {
      console.error('[virtual-notify] 未知商品:', productId);
      return res.send('fail');
    }

    // 先查当前用户状态，决定叠加还是从头计算（使用事务防止并发重复激活）
    const conn = await db.get();
    try {
      await conn.beginTransaction();

      // 锁定订单行，防止并发处理
      // 幂等性检查：同一个outTradeNo只能处理一次（用订单openid查，而非回调openid）
      const [existingEvents] = await conn.query(
        "SELECT id FROM events WHERE event_type='vip_purchase' AND JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.outTradeNo'))=?",
        [outTradeNo]
      );
      if (existingEvents.length > 0) {
        await conn.rollback();
        console.log(`[virtual-notify] 重复回调，跳过: outTradeNo=${outTradeNo}`);
        res.send('success');
        return;
      }

      // 🔴 订单验证：检查 vip_orders 表中是否存在该订单，且 openid 一致
      const [orderRows] = await conn.query(
        'SELECT id, openid, product_id, status FROM vip_orders WHERE out_trade_no=? FOR UPDATE',
        [outTradeNo]
      );
      if (orderRows.length === 0) {
        await conn.rollback();
        console.error(`[virtual-notify] ❌ 订单不存在: outTradeNo=${outTradeNo}`);
        return res.send('fail');
      }
      const order = orderRows[0];
      if (order.openid !== openid) {
        // 绑定手机号场景：回调openid是微信openid，订单openid是主账号phone_xxx
        // 通过 user_bindings 表确认关联关系
        const [bindRows] = await conn.query(
          'SELECT unified_openid FROM user_bindings WHERE (platform = ? AND platform_openid = ?) OR unified_openid = ? LIMIT 1',
          ['wechat', openid, openid]
        );
        const isRelated = bindRows.length > 0 && (
          bindRows[0].unified_openid === order.openid ||  // 微信openid绑定到了订单的主账号
          bindRows[0].unified_openid === openid           // 回调openid本身就是主账号
        );
        if (!isRelated) {
          await conn.rollback();
          console.error(`[virtual-notify] ❌ openid不一致且无绑定关系: 回调=${openid}, 订单=${order.openid}`);
          return res.send('fail');
        }
        console.log(`[virtual-notify] ✅ openid绑定关联通过: 回调=${openid}, 订单=${order.openid}`);
        // 用订单中的主账号openid继续处理（而非回调中的微信openid）
      }
      if (order.status === 'completed') {
        await conn.rollback();
        console.log(`[virtual-notify] 订单已完成，跳过: outTradeNo=${outTradeNo}`);
        res.send('success');
        return;
      }

      // 使用订单中的主账号openid（绑定手机号后可能不同于回调openid）
      const userOpenid = order.openid;

      const [userRows] = await conn.query(
        'SELECT plan_type, expire_time FROM users WHERE openid = ?',
        [userOpenid]
      );
      const currentPlan = userRows[0] || { plan_type: 'free', expire_time: null };

      const now = new Date();
      const isStacking = currentPlan.plan_type !== 'free' && currentPlan.expire_time && new Date(currentPlan.expire_time) > now;
      const baseTime = isStacking ? new Date(currentPlan.expire_time) : now;
      const expireAt = new Date(baseTime);
      if (planType === 'monthly') {
        expireAt.setMonth(expireAt.getMonth() + 1);
      } else {
        expireAt.setFullYear(expireAt.getFullYear() + 1);
      }

      await conn.query(
        'UPDATE users SET plan_type=?, quota_remaining=20, expire_time=? WHERE openid=?',
        [planType, expireAt, userOpenid]
      );

      await conn.query(
        'INSERT INTO subscriptions (openid, plan_type, expire_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE plan_type=VALUES(plan_type), expire_at=VALUES(expire_at), updated_at=NOW()',
        [userOpenid, planType, expireAt]
      );

      // 更新订单状态
      // v2.3.4 修复：paidTime 可能是字符串，先 parseInt 防止 NaN
      const paidTimeNum = typeof paidTime === 'string' ? parseInt(paidTime, 10) : paidTime;
      const paidTimeDate = (paidTimeNum && !isNaN(paidTimeNum)) ? new Date(paidTimeNum * 1000) : null;
      await conn.query(
        'UPDATE vip_orders SET status=?, mch_order_no=?, transaction_id=?, paid_time=?, callback_time=NOW() WHERE out_trade_no=?',
        ['completed', mchOrderNo || null, transactionId || null, paidTimeDate, outTradeNo]
      );

      // 记录完整支付信息到 events 表（使用 extra_data 字段）
      await conn.query(
        "INSERT INTO events (openid, event_type, extra_data) VALUES (?, 'vip_purchase', ?)",
        [userOpenid, JSON.stringify({
          outTradeNo,
          productId,
          planType,
          previousPlan: currentPlan.plan_type,
          previousExpire: currentPlan.expire_time,
          newExpire: expireAt.toISOString(),
          isStacking,
          env: callbackEnv,
          attach,
          mchOrderNo: mchOrderNo || null,
          transactionId: transactionId || null,
          paidTime: paidTimeDate ? paidTimeDate.toISOString() : null
        })]
      );

      console.log(`[virtual-notify] ✅ 发货成功: openid=${userOpenid}, productId=${productId}, planType=${planType}, env=${callbackEnv}, mchOrderNo=${mchOrderNo||'无'}, transactionId=${transactionId||'无'}, isStacking=${isStacking}, previousPlan=${currentPlan.plan_type}, expireAt=${expireAt.toISOString()}`);

      await conn.commit();

      // 清空VIP超级推演今日计数，让用户购买后立即使用
      try {
        await redisService.clearVipDecodeLimit(userOpenid);
      } catch (redisErr) {
        console.error('[virtual-notify] Redis清空失败（非致命）:', redisErr.message);
      }

      res.send('success');
    } catch (err) {
      await conn.rollback().catch(e => console.error('[virtual-notify] rollback failed:', e.message));
      throw err;
    } finally { conn.release(); }
  } catch (err) {
    console.error('[virtual-notify] 解析或处理失败:', err.message, err.stack);
    res.send('fail');
  }
});


// ========== H5 WeChat Pay (APP) ==========
const wxpay = require("../utils/wxpay");

// POST /api/payment/create-app-order - APP支付下单
router.post("/create-app-order", verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    const { productId } = req.body;
    if (!productId || !["vip_monthly", "vip_yearly"].includes(productId)) {
      return res.status(400).json({ success: false, code: "INVALID_PARAM", message: "productId invalid" });
    }
    const priceMap = { vip_monthly: 1990, vip_yearly: 16800 };
    const descMap = { vip_monthly: "易学会员-月度", vip_yearly: "易学会员-年度" };
    const goodsPrice = priceMap[productId];
    const outTradeNo = "TJ" + Date.now() + Math.random().toString(36).substr(2, 6);

    const conn = await db.get();
    try {
      // 防重：10秒内同用户同商品只允许一个pending订单
      const [recentOrders] = await conn.query(
        "SELECT id, out_trade_no FROM vip_orders WHERE openid=? AND status='pending' AND created_at > DATE_SUB(NOW(), INTERVAL 10 SECOND) ORDER BY created_at DESC LIMIT 1",
        [openid]
      );
      if (recentOrders.length > 0) {
        return res.status(429).json({ success: false, code: "DUPLICATE_ORDER", message: "请勿重复提交" });
      }
      await conn.query(
        "INSERT INTO vip_orders (openid, out_trade_no, product_id, goods_price, env, status) VALUES (?,?,?,?,?,?)",
        [openid, outTradeNo, productId, goodsPrice, 1, "pending"]
      );
    } finally { conn.release(); }

    if (!wxpay.isConfigured()) {
      return res.status(503).json({ success: false, code: "PAYMENT_UNAVAILABLE", message: "支付服务未配置" });
    }

    const result = await wxpay.createAppOrder({
      outTradeNo,
      totalAmount: goodsPrice,
      description: descMap[productId]
    });

    if (result.success) {
      console.log("[create-app-order] openid=" + openid + ", outTradeNo=" + outTradeNo);
      res.json({ success: true, data: { outTradeNo, payParams: result.payParams } });
    } else {
      res.status(500).json({ success: false, code: "ORDER_FAILED", message: result.error || "创建订单失败" });
    }
  } catch (err) {
    console.error("[create-app-order]", err);
    res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "服务器内部错误" });
  }
});

router.post("/create-h5-order", verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    const { productId } = req.body;
    if (!productId || !["vip_monthly", "vip_yearly"].includes(productId)) {
      return res.status(400).json({ success: false, code: "INVALID_PARAM", message: "productId invalid" });
    }
    const priceMap = { vip_monthly: 1990, vip_yearly: 16800 };
    const goodsPrice = priceMap[productId];

    const conn = await db.get();
    try {
      // v2.3.3 防重检查：10 秒内已有 pending 订单则直接返回
      const [recentOrders] = await conn.query(
        "SELECT out_trade_no FROM vip_orders WHERE openid=? AND product_id=? AND status='pending' AND created_at > DATE_SUB(NOW(), INTERVAL 10 SECOND)",
        [openid, productId]
      );
      if (recentOrders.length > 0) {
        return res.json({ success: true, data: { outTradeNo: recentOrders[0].out_trade_no, h5Url: null, testMode: false, duplicate: true } });
      }

      const outTradeNo = "TJ" + Date.now() + Math.random().toString(36).substr(2, 6);
      await conn.query(
        "INSERT INTO vip_orders (openid, out_trade_no, product_id, goods_price, env, status) VALUES (?,?,?,?,?,?)",
        [openid, outTradeNo, productId, goodsPrice, 0, "pending"]
      );
    } finally { conn.release(); }

    let h5Url = null;
    let testMode = false;
    try {
      if (wxpay.isConfigured()) {
        const clientIp = req.ip || "127.0.0.1";
        const result = await wxpay.createH5Order({
          outTradeNo, totalAmount: goodsPrice,
          description: productId === "vip_monthly" ? "Monthly VIP" : "Yearly VIP",
          clientIp: String(clientIp).split(",")[0].trim()
        });
        if (result.success) h5Url = result.h5_url;
      }
    } catch (e) {
      if (e.message !== "WXPAY_NOT_CONFIGURED") console.error("[create-h5-order]", e.message);
    }

    if (!h5Url) {
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ success: false, code: "PAYMENT_UNAVAILABLE", message: "H5支付未配置，请使用小程序内支付" });
      }
      testMode = true;
      h5Url = "https://claw-book.cn/tianji/api/payment/test-pay?outTradeNo=" + outTradeNo;
    }

    console.log("[create-h5-order] openid=" + openid + ", productId=" + productId + ", outTradeNo=" + outTradeNo + ", testMode=" + testMode);
    res.json({ success: true, data: { outTradeNo, h5Url, testMode } });
  } catch (err) {
    console.error("[create-h5-order]", err);
    res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Create order failed" });
  }
});

router.get("/test-pay", async (req, res) => {
  // [SEC-FIX] P2-3: 独立开关 TEST_PAY_ENABLED（默认关闭），不再依赖 NODE_ENV 推断。
  // 即使 NODE_ENV=development，也必须显式设置 TEST_PAY_ENABLED=1 才可用，防止环境变量误配导致生产环境可免费激活 VIP。
  if (process.env.TEST_PAY_ENABLED !== '1') {
    return res.status(404).send("Not Found");
  }
  const outTradeNo = req.query.outTradeNo;
  if (!outTradeNo) return res.status(400).send("missing outTradeNo");
  try {
    await activateVipByOutTradeNo(outTradeNo);
    res.send("<html><head><meta charset=utf-8><title>OK</title><meta name=viewport content=width=device-width,initial-scale=1><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0A0A1A;color:#D4A574;flex-direction:column;text-align:center}h1{font-size:48px;margin-bottom:16px}p{color:#8B8BA0}</style></head><body><h1>OK</h1><p>VIP Activated (Test Mode)</p><p style=margin-top:24px>Return to APP</p></body></html>");
  } catch (e) {
    console.error("[test-pay]", e);
    res.status(500).send("Error: " + e.message);
  }
});

router.post("/h5-notify", async (req, res) => {
  try {
    const resource = req.body.resource;
    if (!resource) return res.status(400).json({ code: "FAIL", message: "missing resource" });
    const decrypted = wxpay.decryptNotify(resource.ciphertext, resource.associated_data, resource.nonce);
    console.log("[h5-notify] Decrypted:", JSON.stringify(decrypted));
    if (decrypted.trade_state === "SUCCESS") {
      // v2.3.4 安全增强：验证解密数据与订单记录一致，防止伪造回调
      const conn = await db.get();
      try {
        const [orderCheck] = await conn.query(
          'SELECT id, openid, product_id, goods_price, status FROM vip_orders WHERE out_trade_no = ?',
          [decrypted.out_trade_no]
        );
        if (orderCheck.length === 0) {
          console.error('[h5-notify] 订单不存在:', decrypted.out_trade_no);
          return res.status(200).json({ code: "FAIL", message: "order not found" });
        }
        const order = orderCheck[0];
        // 验证金额匹配（微信回调金额单位为分）
        if (decrypted.amount && decrypted.amount.total !== order.goods_price) {
          console.error('[h5-notify] 金额不匹配: 回调=' + decrypted.amount.total + ', 订单=' + order.goods_price);
          return res.status(200).json({ code: "FAIL", message: "amount mismatch" });
        }
        // 验证商户号匹配
        if (decrypted.mchid && decrypted.mchid !== require('../utils/wxpay').getMchid()) {
          console.error('[h5-notify] 商户号不匹配');
          return res.status(200).json({ code: "FAIL", message: "mchid mismatch" });
        }
      } finally { conn.release(); }

      await activateVipByOutTradeNo(decrypted.out_trade_no, {
        transactionId: decrypted.transaction_id,
        paidTime: decrypted.success_time
      });
    }
    res.status(200).json({ code: "SUCCESS", message: "OK" });
  } catch (err) {
    console.error("[h5-notify]", err.message);
    res.status(200).json({ code: "FAIL", message: err.message });
  }
});

router.get("/check-order/:outTradeNo", verifyToken, async (req, res) => {
  try {
    const conn = await db.get();
    try {
      const [rows] = await conn.query(
        "SELECT status, product_id FROM vip_orders WHERE out_trade_no=? AND openid=?",
        [req.params.outTradeNo, req.openid]
      );
      if (rows.length === 0) return res.json({ success: false, message: "not found" });
      // v2.3.3 返回 product_id 作为 plan_type（monthly/yearly）
      res.json({ success: true, data: { status: rows[0].status, plan_type: rows[0].product_id } });
    } finally { conn.release(); }
  } catch (err) {
    console.error("[check-order]", err);
    res.status(500).json({ success: false, code: "INTERNAL_ERROR" });
  }
});

// POST /api/payment/sync-order/:outTradeNo - 查询微信支付状态并补发货
// 当推送回调未到达时，前端轮询此接口作为兜底
router.post("/sync-order/:outTradeNo", verifyToken, async (req, res) => {
  try {
    const outTradeNo = req.params.outTradeNo;
    const openid = req.openid;

    // 先查本地订单状态
    const conn = await db.get();
    let orderOpenid = openid; // 订单中存的 openid（可能为 phone_xxx 主账号）
    let wxOpenidForQuery = openid; // 调用微信 API 时需要用 wxOpenid
    try {
      const [rows] = await conn.query(
        "SELECT id, openid, product_id, status FROM vip_orders WHERE out_trade_no=? AND openid=?",
        [outTradeNo, openid]
      );
      if (rows.length === 0) {
        // 🔴 兼容旧 token 创建的订单：订单 openid 可能是绑定前的旧 openid
        // 通过 user_bindings 反查可能的旧 openid 再查一次
        const [legacyRows] = await conn.query(
          `SELECT v.id, v.openid, v.product_id, v.status FROM vip_orders v
           INNER JOIN user_bindings b ON v.openid = b.platform_openid
           WHERE v.out_trade_no = ? AND b.unified_openid = ?`,
          [outTradeNo, openid]
        );
        if (legacyRows.length === 0) {
          return res.json({ success: false, code: "ORDER_NOT_FOUND", message: "订单不存在" });
        }
        // 命中旧订单
        orderOpenid = legacyRows[0].openid;
        // 查 user_bindings 拿到对应的 wxOpenid（platform='wechat'）
        const [wxBind] = await conn.query(
          'SELECT platform_openid FROM user_bindings WHERE unified_openid = ? AND platform = ? LIMIT 1',
          [openid, 'wechat']
        );
        if (wxBind.length > 0) {
          wxOpenidForQuery = wxBind[0].platform_openid;
        }
        // 已完成则直接返回
        if (legacyRows[0].status === "completed") {
          return res.json({ success: true, data: { status: "completed", synced: false } });
        }
      } else {
        orderOpenid = rows[0].openid;
        // 已完成则直接返回
        if (rows[0].status === "completed") {
          return res.json({ success: true, data: { status: "completed", synced: false } });
        }
        // 🔴 关键修复：微信侧订单关联的是 wxOpenid，本地订单 openid 是 phone_xxx（主账号）
        // 调用 queryVirtualOrder 时必须传 wxOpenid，否则微信 API 返回订单不存在
        if (openid.startsWith('phone_')) {
          const [wxBind] = await conn.query(
            'SELECT platform_openid FROM user_bindings WHERE unified_openid = ? AND platform = ? LIMIT 1',
            [openid, 'wechat']
          );
          if (wxBind.length > 0) {
            wxOpenidForQuery = wxBind[0].platform_openid;
          }
        }
      }
    } finally { conn.release(); }

    // 调用微信API查询订单状态（用 wxOpenid 而非 phone_xxx）
    const { queryVirtualOrder } = require("../utils/wechat");
    let wxResult;
    try {
      wxResult = await queryVirtualOrder(wxOpenidForQuery, outTradeNo);
    } catch (wxErr) {
      console.error("[sync-order] 微信查单失败:", wxErr.message);
      return res.json({ success: true, data: { status: "pending", synced: false, reason: wxErr.message } });
    }

    // 检查微信侧订单状态
    const wxOrder = wxResult.order || {};
    // status: 1=已支付, 0=未支付
    if (wxOrder.status !== 1) {
      console.log(`[sync-order] 微信侧未支付: outTradeNo=${outTradeNo}, wxStatus=${wxOrder.status}`);
      return res.json({ success: true, data: { status: "pending", synced: false, wxStatus: wxOrder.status } });
    }

    // 微信侧确认已支付 → 触发补发货
    console.log(`[sync-order] 微信侧已支付，触发补发货: outTradeNo=${outTradeNo}`);
    try {
      const payInfo = {
        transactionId: wxOrder.transaction_id || null,
        paidTime: wxOrder.paid_time || null,
        mchOrderNo: wxOrder.mch_order_no || null
      };
      await activateVipByOutTradeNo(outTradeNo, payInfo);
      res.json({ success: true, data: { status: "completed", synced: true } });
    } catch (activateErr) {
      console.error("[sync-order] 补发货失败:", activateErr.message);
      res.status(500).json({ success: false, code: "SYNC_FAILED", message: "补发货失败: " + activateErr.message });
    }
  } catch (err) {
    console.error("[sync-order]", err);
    res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "服务器内部错误" });
  }
});

// ========== Google Play Billing（海外版，v20.2）==========
// 流程：App 端 wx.miniapp.GooglePlayBilling.launchBillingFlow → 支付成功回调拿到 purchaseToken
//       → POST /api/payment/google-verify（本接口）→ 服务端调 Play Developer API 验签 → 开通 VIP → 前端 consumeAsync
// 商品：vip_monthly / vip_yearly，均按一次性商品（INAPP）建模，权益由服务端按到期时间叠加。
router.post("/google-verify", verifyToken, async (req, res) => {
  try {
    const openid = req.openid;
    const { productId, purchaseToken, productType } = req.body;
    if (!productId || !purchaseToken) {
      return res.status(400).json({ success: false, code: "INVALID_PARAM", message: "productId和purchaseToken必填" });
    }
    if (!["vip_monthly", "vip_yearly"].includes(productId)) {
      return res.status(400).json({ success: false, code: "INVALID_PARAM", message: "productId必须是vip_monthly或vip_yearly" });
    }
    const planType = productId === "vip_monthly" ? "monthly" : "yearly";
    const type = productType === "SUBS" ? "SUBS" : "INAPP";

    // 幂等：同一 purchaseToken 已处理过则直接返回成功（防重复发货）
    const conn0 = await db.get();
    try {
      const [dup] = await conn0.query(
        "SELECT id FROM events WHERE event_type='vip_purchase' AND JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.purchaseToken'))=?",
        [purchaseToken]
      );
      if (dup.length > 0) {
        console.log("[google-verify] 重复purchaseToken，已处理过:", String(purchaseToken).slice(0, 24));
        return res.json({ success: true, data: { activated: true, duplicate: true } });
      }
    } finally { conn0.release(); }

    // 服务端验签（Google Play Developer API）
    let purchaseInfo = null;
    if (googlePlay.isConfigured()) {
      try {
        purchaseInfo = type === "SUBS"
          ? await googlePlay.verifySubscriptionPurchase(productId, purchaseToken)
          : await googlePlay.verifyProductPurchase(productId, purchaseToken);
      } catch (verifyErr) {
        console.error("[google-verify] Google验签异常:", verifyErr.message);
        return res.status(502).json({ success: false, code: "VERIFY_FAILED", message: "购买凭证校验失败，请稍后重试" });
      }
      // purchaseState: 0=已购买 1=已取消 2=已退款
      if (purchaseInfo.purchaseState !== 0) {
        console.error("[google-verify] 购买状态异常:", JSON.stringify(purchaseInfo));
        return res.status(400).json({ success: false, code: "NOT_PURCHASED", message: "购买状态异常，请重新购买" });
      }
      // INAPP 一次性商品：已消耗的 token 不应再重复开通（consumptionState: 0=未消耗 1=已消耗）
      if (type === "INAPP" && purchaseInfo.consumptionState === 1) {
        console.warn("[google-verify] token已消耗，跳过:", String(purchaseToken).slice(0, 24));
        return res.json({ success: true, data: { activated: true, duplicate: true } });
      }
    } else if (process.env.GOOGLE_PLAY_TEST_MODE === "1") {
      // 联调测试模式：跳过真实验签（生产严禁开启）
      console.warn("[google-verify] ⚠️ GOOGLE_PLAY_TEST_MODE 生效，跳过服务端验签（仅测试联调）");
    } else {
      return res.status(503).json({ success: false, code: "PAYMENT_UNAVAILABLE", message: "Google Play 支付服务未配置" });
    }

    // 开通 VIP
    const outTradeNo = "TJGP" + Date.now() + Math.random().toString(36).substr(2, 6).toUpperCase();
    const priceMap = { vip_monthly: 1990, vip_yearly: 16800 };
    await activateGoogleVip(openid, {
      outTradeNo,
      productId,
      planType,
      purchaseToken,
      goodsPrice: priceMap[productId],
      orderId: (purchaseInfo && purchaseInfo.orderId) || null
    });
    console.log("[google-verify] ✅ openid=" + openid + ", productId=" + productId + ", type=" + type + ", outTradeNo=" + outTradeNo);
    res.json({ success: true, data: { activated: true } });
  } catch (err) {
    console.error("[google-verify]", err);
    res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "服务器内部错误" });
  }
});

// Google Play 内购开通 VIP（幂等：purchaseToken 唯一）
async function activateGoogleVip(openid, info) {
  const conn = await db.get();
  try {
    await conn.beginTransaction();
    // 幂等：purchaseToken 已存在则跳过
    const [existing] = await conn.query(
      "SELECT id FROM events WHERE event_type='vip_purchase' AND JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.purchaseToken'))=?",
      [info.purchaseToken]
    );
    if (existing.length > 0) { await conn.rollback(); return; }

    // 记录订单（env=2 标识 Google 渠道）
    await conn.query(
      "INSERT INTO vip_orders (openid, out_trade_no, product_id, goods_price, env, status, transaction_id, callback_time) VALUES (?,?,?,?,?,?,?,NOW())",
      [openid, info.outTradeNo, info.productId, info.goodsPrice, 2, "completed", info.orderId || null]
    );

    const [userRows] = await conn.query("SELECT plan_type, expire_time FROM users WHERE openid=?", [openid]);
    const currentPlan = userRows[0] || { plan_type: "free", expire_time: null };
    const now = new Date();
    const isStacking = currentPlan.plan_type !== "free" && currentPlan.expire_time && new Date(currentPlan.expire_time) > now;
    const baseTime = isStacking ? new Date(currentPlan.expire_time) : now;
    const expireAt = new Date(baseTime);
    if (info.planType === "monthly") expireAt.setMonth(expireAt.getMonth() + 1);
    else expireAt.setFullYear(expireAt.getFullYear() + 1);

    await conn.query("UPDATE users SET plan_type=?, quota_remaining=20, expire_time=? WHERE openid=?", [info.planType, expireAt, openid]);
    await conn.query("INSERT INTO subscriptions (openid, plan_type, expire_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE plan_type=VALUES(plan_type), expire_at=VALUES(expire_at), updated_at=NOW()", [openid, info.planType, expireAt]);
    await conn.query("INSERT INTO events (openid, event_type, extra_data) VALUES (?, 'vip_purchase', ?)", [openid, JSON.stringify({
      outTradeNo: info.outTradeNo,
      productId: info.productId,
      planType: info.planType,
      purchaseToken: info.purchaseToken,
      orderId: info.orderId || null,
      isStacking
    })]);

    await conn.commit();
    try { const rs = require("../services/redis"); await rs.clearVipDecodeLimit(openid); } catch (e) { /* non-fatal */ }
    console.log("[activateGoogleVip] ✅ openid=" + openid + ", planType=" + info.planType + ", expireAt=" + expireAt.toISOString() + ", outTradeNo=" + info.outTradeNo);
  } catch (err) {
    await conn.rollback().catch(function (e) { console.error("[activateGoogleVip] rollback:", e.message); });
    throw err;
  } finally { conn.release(); }
}

async function activateVipByOutTradeNo(outTradeNo, payInfo) {
  payInfo = payInfo || {};
  const conn = await db.get();
  try {
    await conn.beginTransaction();
    const [orderRows] = await conn.query(
      "SELECT id, openid, product_id, status FROM vip_orders WHERE out_trade_no=? FOR UPDATE",
      [outTradeNo]
    );
    if (orderRows.length === 0) { await conn.rollback(); throw new Error("Order not found"); }
    const order = orderRows[0];
    if (order.status === "completed") { await conn.rollback(); return; }

    const [events] = await conn.query(
      "SELECT id FROM events WHERE openid=? AND event_type='vip_purchase' AND JSON_UNQUOTE(JSON_EXTRACT(extra_data, '$.outTradeNo'))=?",
      [order.openid, outTradeNo]
    );
    if (events.length > 0) { await conn.rollback(); return; }

    const openid = order.openid;
    // 🔴 修复：增加 null 兜底，防止脏数据导致错误开通年度会员（与同文件387行、admin.js:1051保持一致）
    const planType = order.product_id === "vip_monthly" ? "monthly" : order.product_id === "vip_yearly" ? "yearly" : null;
    if (!planType) {
      await conn.rollback();
      console.error('[activateVip] 未知 product_id:', order.product_id, 'outTradeNo:', outTradeNo);
      return;
    }

    const [userRows] = await conn.query("SELECT plan_type, expire_time FROM users WHERE openid=?", [openid]);
    const currentPlan = userRows[0] || { plan_type: "free", expire_time: null };
    const now = new Date();
    const isStacking = currentPlan.plan_type !== "free" && currentPlan.expire_time && new Date(currentPlan.expire_time) > now;
    const baseTime = isStacking ? new Date(currentPlan.expire_time) : now;
    const expireAt = new Date(baseTime);
    if (planType === "monthly") expireAt.setMonth(expireAt.getMonth() + 1);
    else expireAt.setFullYear(expireAt.getFullYear() + 1);

    await conn.query("UPDATE users SET plan_type=?, quota_remaining=20, expire_time=? WHERE openid=?", [planType, expireAt, openid]);
    await conn.query("INSERT INTO subscriptions (openid, plan_type, expire_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE plan_type=VALUES(plan_type), expire_at=VALUES(expire_at), updated_at=NOW()", [openid, planType, expireAt]);
    await conn.query("UPDATE vip_orders SET status=?, transaction_id=?, callback_time=NOW() WHERE out_trade_no=?", ["completed", (payInfo && payInfo.transactionId) || null, outTradeNo]);
    await conn.query("INSERT INTO events (openid, event_type, extra_data) VALUES (?, 'vip_purchase', ?)", [openid, JSON.stringify({ outTradeNo, productId: order.product_id, planType, isStacking })]);
    await conn.commit();

    try { const rs = require("../services/redis"); await rs.clearVipDecodeLimit(openid); } catch (e) { /* non-fatal */ }
    console.log("[activateVip] OK: openid=" + openid + ", planType=" + planType + ", expireAt=" + expireAt.toISOString());
  } catch (err) {
    await conn.rollback().catch(function(e) { console.error("[activateVip] rollback:", e.message); });
    throw err;
  } finally { conn.release(); }
}


module.exports = router;
