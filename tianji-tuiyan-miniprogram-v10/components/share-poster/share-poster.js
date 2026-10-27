/**
 * v7.1 share-poster 组件 —— Canvas 2D 生成微信分享海报
 *
 * 前置条件：基础库 >= 2.9.0（Canvas 2D）；本项目 3.15.2
 *
 * Props —— 接收推演结果数据：
 *   mode        'single'(默认) | 'match'(双卦关系海报)
 *
 * single 模式 Props：
 *   guaSymbol   卦符号 Unicode (䷀等)
 *   guaName     卦名（乾为天等）
 *   guaGe       卦格（飞龙格等）
 *   ziChaoTag   自嘲标签（停不下来的永动机本尊等）
 *   liShiDuiBiao 历史对标（与曹操像在...等）
 *   socialTag   社交身份标签（创造者等）
 *
 * match 模式 Props（v3.5 新增）：
 *   guaSymbolA  A 卦符号
 *   guaNameA    A 卦名
 *   guaSymbolB  B 卦符号
 *   guaNameB    B 卦名
 *   relationName 关系名称（天生一对等）
 *   matchLevel  匹配等级（天作之合等）
 *
 * 方法：generatePoster() → Promise<string|null>
 *       返回临时图片路径，失败返回 null（调用方降级为无图分享）
 */
const i18n = require('../../utils/i18n.js');

Component({
  properties: {
    mode:         { type: String, value: 'single' },
    // single 模式
    guaSymbol:    { type: String, value: '䷀' },
    guaName:      { type: String, value: '' },
    guaGe:        { type: String, value: '' },
    ziChaoTag:    { type: String, value: '' },
    liShiDuiBiao: { type: String, value: '' },
    socialTag:    { type: String, value: '' },
    // match 模式（v3.5 新增）
    guaSymbolA:   { type: String, value: '䷀' },
    guaNameA:     { type: String, value: '' },
    guaSymbolB:   { type: String, value: '䷀' },
    guaNameB:     { type: String, value: '' },
    relationName: { type: String, value: '' },
    matchLevel:   { type: String, value: '' }
  },

  data: {
    canvasWidth: 500,
    canvasHeight: 400
  },

  methods: {
    /** 当前是否英文版 */
    _isEn: function() {
      try { return i18n.getLang() === 'en'; } catch (e) { return false; }
    },
    /**
     * 生成分享海报 → 返回临时图片路径
     * @returns {Promise<string|null>}
     */
    generatePoster() {
      var that = this;
      return new Promise(function(resolve) {
        var query = wx.createSelectorQuery().in(that);
        query.select('#posterCanvas')
          .fields({ node: true, size: true })
          .exec(function(res) {
            if (!res || !res[0] || !res[0].node) {
              console.error('[share-poster] Canvas node not found');
              resolve(null);
              return;
            }

            var canvas = res[0].node;
            var ctx = canvas.getContext('2d');
            // 🔴 v3.5 迁移：getWindowInfo 取代 getSystemInfoSync 取 pixelRatio
            var dpr = 2;
            try {
              dpr = wx.getWindowInfo().pixelRatio || 2;
            } catch (e) {
              dpr = (wx.getSystemInfoSync() || {}).pixelRatio || 2;
            }
            var w = that.data.canvasWidth;
            var h = that.data.canvasHeight;

            // 物理像素 = 逻辑像素 × dpr
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.scale(dpr, dpr);

            try {
              // 🔴 v3.5 新增：根据 mode 分发到对应绘制方法
              if (that.data.mode === 'match') {
                that._drawMatch(ctx, w, h);
              } else {
                that._draw(ctx, w, h);
              }
            } catch (e) {
              console.error('[share-poster] draw error:', e);
              resolve(null);
              return;
            }

            wx.canvasToTempFilePath({
              canvas: canvas,
              x: 0, y: 0,
              width: w, height: h,
              destWidth: w, destHeight: h,
              fileType: 'jpg',
              quality: 0.9,
              success: function(fileRes) {
                resolve(fileRes.tempFilePath);
              },
              fail: function(e) {
                console.error('[share-poster] canvasToTempFilePath error:', e);
                resolve(null);
              }
            });
          });
      });
    },

    /**
     * 按像素宽度截断文本（修复英文 i/M 宽度差导致的估算错误与超画布）
     * @param {Object} ctx - canvas 上下文（须已设置 font）
     * @param {string} text - 原文本
     * @param {number} maxWidth - 最大像素宽度
     * @returns {string}
     */
    _ellipsis: function(ctx, text, maxWidth) {
      if (!text) return '';
      var t = String(text);
      if (ctx.measureText(t).width <= maxWidth) return t;
      var cut = t;
      while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) {
        cut = cut.substring(0, cut.length - 1);
      }
      return cut + '…';
    },

    /**
     * 绘制海报内容（v2.0 视觉升级：卷轴边框 + 印章 SVG + 毛笔字标题）
     * 布局：卷轴边框 → 卦符号(大) → 自嘲标签(最突出) → 卦名·卦格 → #社交标签 → 历史对标 → 印章 → 品牌+行动号召
     */
    _draw: function(ctx, w, h) {
      this.__en = this._isEn();
      // ── 背景：墨韵黑 ──
      var bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#0A0A0A');
      bgGrad.addColorStop(0.5, '#14142B');
      bgGrad.addColorStop(1, '#0A0A0A');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // ── 卷轴边框（顶部+底部金线 + 中心金点） ──
      ctx.strokeStyle = 'rgba(200, 165, 91, 0.6)';
      ctx.lineWidth = 1.5;
      // 顶部金线
      ctx.beginPath();
      ctx.moveTo(20, 24);
      ctx.lineTo(w - 20, 24);
      ctx.stroke();
      // 底部金线
      ctx.beginPath();
      ctx.moveTo(20, h - 24);
      ctx.lineTo(w - 20, h - 24);
      ctx.stroke();
      // 顶部中心金点
      ctx.beginPath();
      ctx.arc(w / 2, 24, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#C8A55B';
      ctx.shadowColor = 'rgba(200, 165, 91, 0.6)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      // 底部中心金点
      ctx.beginPath();
      ctx.arc(w / 2, h - 24, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#C8A55B';
      ctx.shadowColor = 'rgba(200, 165, 91, 0.6)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      // 顶部装饰环（虚线圆，保留作为卦符号光晕底）
      ctx.beginPath();
      ctx.arc(w / 2, 90, 56, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(200, 165, 91, 0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // ── 卦符号（大字，金色发光）──
      var symbol = this.data.guaSymbol || '䷀';
      ctx.font = '72px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.shadowColor = 'rgba(200, 165, 91, 0.6)';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#C8A55B';
      ctx.fillText(symbol, w / 2, 90);

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      // ── 自嘲标签（最大最显眼，毛笔字风格用 serif 模拟）──
      var tag = this.data.ziChaoTag || '';
      if (tag) {
        ctx.font = 'bold 28px "STKaiti", "KaiTi", serif';
        ctx.fillStyle = '#E8C896';
        var tagMaxW = w - 120;
        tag = this._ellipsis(ctx, tag, tagMaxW);
        var q = this.__en ? '"' : '「';
        ctx.fillText(q + tag + q, w / 2, 158);
      }

      // ── 卦名 · 卦格（毛笔字标题）──
      var nameGe = (this.data.guaName || '') + (this.data.guaGe ? ' · ' + this.data.guaGe : '');
      ctx.font = '20px "STKaiti", "KaiTi", serif';
      ctx.fillStyle = '#C8A55B';
      ctx.fillText(nameGe, w / 2, 196);

      // ── #社交标签 ──
      var social = this.data.socialTag || '';
      if (social) {
        ctx.font = '18px sans-serif';
        ctx.fillStyle = '#E8C896';

        var socialText = '#' + social;
        socialText = this._ellipsis(ctx, socialText, w - 120);
        var socialWidth = ctx.measureText(socialText).width;
        var socialX = w / 2 - socialWidth / 2 - 12;
        var socialY = 222;

        ctx.fillStyle = 'rgba(200, 165, 91, 0.12)';
        ctx.beginPath();
        var r = 8;
        var sw = socialWidth + 24;
        var sh = 32;
        ctx.moveTo(socialX + r, socialY);
        ctx.lineTo(socialX + sw - r, socialY);
        ctx.arcTo(socialX + sw, socialY, socialX + sw, socialY + r, r);
        ctx.lineTo(socialX + sw, socialY + sh - r);
        ctx.arcTo(socialX + sw, socialY + sh, socialX + sw - r, socialY + sh, r);
        ctx.lineTo(socialX + r, socialY + sh);
        ctx.arcTo(socialX, socialY + sh, socialX, socialY + sh - r, r);
        ctx.lineTo(socialX, socialY + r);
        ctx.arcTo(socialX, socialY, socialX + r, socialY, r);
        ctx.fill();

        ctx.fillStyle = '#E8C896';
        ctx.fillText(socialText, w / 2, socialY + 16);
      }

      // ── 历史对标（一句话）──
      var lishi = this.data.liShiDuiBiao || '';
      if (lishi) {
        ctx.font = '15px "STSong", "SimSun", serif';
        ctx.fillStyle = 'rgba(232, 232, 240, 0.7)';
        lishi = this._ellipsis(ctx, lishi, w - 120);
        ctx.fillText(lishi, w / 2, 278);
      }

      // ── 印章 SVG（手绘方形印章 "天機"） ──
      this._drawSealStamp(ctx, w / 2 - 21, 300, 42, 42);

      // ── 品牌+口号（毛笔字风格）──
      ctx.font = 'bold 18px "STKaiti", "KaiTi", serif';
      ctx.fillStyle = '#C8A55B';
      ctx.fillText(this.__en ? 'I Ching Insight' : '天機推演', w / 2, 350);

      ctx.font = '12px "STSong", "SimSun", serif';
      ctx.fillStyle = 'rgba(232, 232, 240, 0.5)';
      ctx.fillText(this.__en ? 'Scan to reveal your Life Hexagram' : '扫码测你的本命卦', w / 2, 374);

      // ── 底部分隔线（卷轴风格，渐变）──
      var lineGrad = ctx.createLinearGradient(w / 2 - 100, 0, w / 2 + 100, 0);
      lineGrad.addColorStop(0, 'rgba(200, 165, 91, 0)');
      lineGrad.addColorStop(0.5, 'rgba(200, 165, 91, 0.4)');
      lineGrad.addColorStop(1, 'rgba(200, 165, 91, 0)');
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 100, 386);
      ctx.lineTo(w / 2 + 100, 386);
      ctx.stroke();
    },

    /**
     * 绘制印章 SVG（方形朱文印章风格）
     * @param {Object} ctx - canvas 上下文
     * @param {number} x - 左上角 x
     * @param {number} y - 左上角 y
     * @param {number} w - 宽度
     * @param {number} h - 高度
     */
    _drawSealStamp: function(ctx, x, y, w, h) {
      ctx.save();

      // 印章背景（朱红半透明）
      ctx.fillStyle = 'rgba(180, 50, 42, 0.85)';
      ctx.fillRect(x, y, w, h);

      // 印章边框（深朱红）
      ctx.strokeStyle = '#A0322B';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);

      // 印章文字 "天機"（白色，毛笔字风格）
      ctx.fillStyle = '#FFF8F0';
      ctx.font = 'bold 16px "STKaiti", "KaiTi", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('天', x + w / 2, y + h / 4 + 2);
      ctx.fillText('機', x + w / 2, y + (h * 3) / 4 - 2);

      // 印章微旋转效果（轻微倾斜）
      ctx.restore();
    },

    /**
     * 🔴 v3.5 新增：绘制双卦关系海报
     * 布局：卷轴边框 → A卦符号(左) + 太极符号(中) + B卦符号(右) → 关系名称(大字) → 匹配等级 → 印章 → 品牌
     */
    _drawMatch: function(ctx, w, h) {
      this.__en = this._isEn();
      // ── 背景：墨韵黑 ──
      var bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#0A0A0A');
      bgGrad.addColorStop(0.5, '#14142B');
      bgGrad.addColorStop(1, '#0A0A0A');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // ── 卷轴边框 ──
      ctx.strokeStyle = 'rgba(200, 165, 91, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(20, 24);
      ctx.lineTo(w - 20, 24);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(20, h - 24);
      ctx.lineTo(w - 20, h - 24);
      ctx.stroke();
      // 中心金点
      ctx.beginPath();
      ctx.arc(w / 2, 24, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#C8A55B';
      ctx.shadowColor = 'rgba(200, 165, 91, 0.6)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(w / 2, h - 24, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // ── 双卦符号（左A + 中太极 + 右B）──
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var symbolY = 100;
      var symbolA_X = w * 0.28;
      var symbolB_X = w * 0.72;
      var centerX = w / 2;

      // A 卦符号
      var symbolA = this.data.guaSymbolA || '䷀';
      ctx.font = '56px serif';
      ctx.shadowColor = 'rgba(200, 165, 91, 0.5)';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#C8A55B';
      ctx.fillText(symbolA, symbolA_X, symbolY);
      ctx.shadowBlur = 0;

      // A 卦名
      var nameA = this.data.guaNameA || '';
      ctx.font = '16px "STKaiti", "KaiTi", serif';
      nameA = this._ellipsis(ctx, nameA, w * 0.36);
      ctx.fillStyle = 'rgba(200, 165, 91, 0.85)';
      ctx.fillText(nameA, symbolA_X, symbolY + 48);

      // B 卦符号
      var symbolB = this.data.guaSymbolB || '䷀';
      ctx.font = '56px serif';
      ctx.shadowColor = 'rgba(200, 165, 91, 0.5)';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#C8A55B';
      ctx.fillText(symbolB, symbolB_X, symbolY);
      ctx.shadowBlur = 0;

      // B 卦名
      var nameB = this.data.guaNameB || '';
      ctx.font = '16px "STKaiti", "KaiTi", serif';
      nameB = this._ellipsis(ctx, nameB, w * 0.36);
      ctx.fillStyle = 'rgba(200, 165, 91, 0.85)';
      ctx.fillText(nameB, symbolB_X, symbolY + 48);

      // 中心太极符号（☯）
      ctx.font = '36px serif';
      ctx.fillStyle = 'rgba(200, 165, 91, 0.7)';
      ctx.fillText('☯', centerX, symbolY);

      // ── 极细金线分隔 ──
      var lineGrad = ctx.createLinearGradient(40, 0, w - 40, 0);
      lineGrad.addColorStop(0, 'rgba(200, 165, 91, 0)');
      lineGrad.addColorStop(0.5, 'rgba(200, 165, 91, 0.5)');
      lineGrad.addColorStop(1, 'rgba(200, 165, 91, 0)');
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(40, 190);
      ctx.lineTo(w - 40, 190);
      ctx.stroke();

      // ── 关系名称（最突出，毛笔字大字）──
      var relName = this.data.relationName || (this.__en ? 'Affinity Match' : '易缘匹配');
      ctx.font = 'bold 36px "STKaiti", "KaiTi", serif';
      ctx.shadowColor = 'rgba(200, 165, 91, 0.4)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#E8C896';
      relName = this._ellipsis(ctx, relName, w - 100);
      ctx.fillText(relName, centerX, 230);
      ctx.shadowBlur = 0;

      // ── 匹配等级 ──
      var level = this.data.matchLevel || '';
      if (level) {
        ctx.font = '18px "STKaiti", "KaiTi", serif';
        ctx.fillStyle = 'rgba(200, 165, 91, 0.8)';
        level = this._ellipsis(ctx, level, w - 120);
        ctx.fillText(level, centerX, 272);
      }

      // ── 印章 ──
      this._drawSealStamp(ctx, centerX - 24, 300, 48, 48);

      // ── 品牌+口号 ──
      ctx.font = 'bold 18px "STKaiti", "KaiTi", serif';
      ctx.fillStyle = '#C8A55B';
      ctx.fillText(this.__en ? 'I Ching Insight' : '天機推演', centerX, 370);

      ctx.font = '12px "STSong", "SimSun", serif';
      ctx.fillStyle = 'rgba(232, 232, 240, 0.5)';
      ctx.fillText(this.__en ? 'Scan to test your affinity' : '扫码测你们的易缘', centerX, 388);
    }
  }
});
