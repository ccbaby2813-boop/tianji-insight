/**
 * pages/result/index.js - 推演结果页 v2.0
 * 展示推演结果 + 分享功能
 */
const api = require('../../utils/api.js');
const soundManager = require('../../utils/audio.js');
const shareUtil = require('../../utils/share.js');
const i18n = require('../../utils/i18n.js'); // v19.1 双语

Page({
  data: {
    t: i18n.page('result'), // v19.1 页面文案字典（data 初始化，避免首帧空白）
    lang: i18n.getLang(),
    pageState: 'loading',
    errorMsg: '',
    needLogin: false,
    isShared: false,
    sharerNickname: '',
    record: {},
    result: {},
    qimen: null,
    nickname: '',
    posterImageUrl: '',
    isMpWeixin: true,
    shareId: '',
    // v2.0 折叠区状态（默认全部收起）
    collapseKeys: { classic: false, jiedu: false, yiji: false }
  },

  // v2.0 折叠区切换
  toggleCollapse: function(e) {
    var key = e.currentTarget.dataset.key;
    if (!key) return;
    var current = this.data.collapseKeys[key] || false;
    var patch = {};
    patch['collapseKeys.' + key] = !current;
    this.setData(patch);
    soundManager.play('click');
  },

  // 五行中文转拼音（WXSS不支持中文类名）
  wuxingToPinyin: function(wuxing) {
    var map = { '金': 'jin', '木': 'mu', '水': 'shui', '火': 'huo', '土': 'tu' };
    return map[wuxing] || 'jin';
  },

  onLoad(options) {
    soundManager.init();
    this.setData({ isMpWeixin: getApp().globalData.isMpWeixin });
    // [SEC-FIX] P1-2: 优先使用随机 share_token（不可枚举），其次兼容旧的数字 id
    var recordKey = options.share || options.id;
    var isShared = options.shared === '1' || !!options.share;
    this.setData({ isShared: isShared });
    this.loadResult(recordKey);
    // 预生成分享短码：App端分享深链 match.html?sid=，接收者点开可唤起App进入匹配
    this._preGenerateShareCode();
  },

  // 预生成分享短码（type='result'，scene 存推演记录 ID，接收者查看分享者的完整推演结果）
  async _preGenerateShareCode() {
    try {
      const app = getApp();
      if (app.globalData.loginPromise) await app.globalData.loginPromise;
      if (!app.globalData.openid) return;
      // 获取当前推演记录 ID
      const recordId = (this.data.record && this.data.record.id) || this._currentRecordId || 0;
      const codeRes = await api.requestWithAuth('/api/share/code', 'POST', { type: 'result', scene: String(recordId) });
      if (codeRes.success && codeRes.data && codeRes.data.share_id) {
        this.setData({ shareId: codeRes.data.share_id, shareRecordId: recordId });
      }
    } catch (e) {
      console.error('_preGenerateShareCode error:', e);
    }
  },

  onShow() {

    i18n.applyNavTitle('pages/result/index');
    // v19.1 双语：刷新文案字典与派生文案（标题/分享触发语）
    // v19.3：record/qimen 基于 raw 数据重建（语言切换同步生效）
    var t = i18n.page('result');
    var patch = { t: t, lang: i18n.getLang() };
    if (this.data.pageState === 'loaded' && this._rawData) {
      patch.heroTitle = this.data.nickname ? i18n.fill(t.resultOf, { n: this.data.nickname }) : t.resultTitle;
      patch.shareTriggerTagText = this.data.result.ziChaoTag ? i18n.fill(t.shareTriggerTag, { t: this.data.result.ziChaoTag }) : '';
      patch.shareTriggerHistoryText = t.shareTriggerHistory;
      var recordView = this._buildRecordView(this._rawData);
      recordView.zi_chao_biao_qian = (this._rawAi && this._rawAi.ziChaoTag) || '';
      patch.record = recordView;
      patch.qimen = this._buildQimenView((this._rawAi && this._rawAi.qimenSnapshot) || null);
    }
    this.setData(patch);
  },

  loadResult: function(recordId) {
    var that = this;
    var app = getApp(); // 函数内捕获，避免 async 转译丢失
    var t = i18n.page('result');

    // 保存当前recordId，用于重试
    that._currentRecordId = recordId;

    // 有 recordId 时通过 GET 接口获取
    if (recordId) {
      // 分享模式走公开接口（无需认证，返回脱敏数据）；recordId 可为数字 id 或随机 share_token
      var url = that.data.isShared ? '/api/tuiyan/shared/' + recordId : '/api/tuiyan/' + recordId;
      api.request(url, 'GET').then(function(res) {
        that.processResult(res, app);
      }).catch(function(e) {
        console.error('[result] loadResult error:', e);
        that.setData({ pageState: 'error', errorMsg: t.loadFail, needLogin: false });
      });
      return;
    }

    // 没有 recordId 时通过 history 获取最新
    if (!app || !app.globalData || !app.globalData.openid) {
      that.setData({ pageState: 'error', errorMsg: t.loginFirst, needLogin: true });
      return;
    }

    api.request('/api/user/history/' + encodeURIComponent(app.globalData.openid), 'GET').then(function(res) {
      that.processResult(res, app);
    }).catch(function(e) {
      console.error('[result] loadResult error:', e);
      that.setData({ pageState: 'error', errorMsg: t.loadFail, needLogin: false });
    });
  },

  processResult: function(result, app) {
    var that = this;
    if (!result || !result.success || !result.data) {
      that.setData({ pageState: 'empty' });
      return;
    }

    var data = Array.isArray(result.data) ? (result.data.length > 0 ? result.data[0] : null) : result.data;
    if (!data) {
      that.setData({ pageState: 'empty' });
      return;
    }
    var aiResult = {};

    if (typeof data.result_data === 'string') {
      try { aiResult = JSON.parse(data.result_data); } catch (e) { aiResult = {}; }
    } else if (data.result_data && typeof data.result_data === 'object') {
      aiResult = data.result_data;
    }

    // VIP超级推演结果：AI返回纯文本，后端存到 vip_decode_text 字段，result_data 主要承载 qimenSnapshot
    if (data.vip_decode_text && !aiResult.jieDu && !aiResult.panCi) {
      // 🔴 v15.3.3 修复：保留 aiResult.qimenSnapshot，避免时空变量区域丢失
      var preservedQimen = aiResult.qimenSnapshot || null;
      aiResult = { jieDu: data.vip_decode_text, panCi: '', yiList: [], jiList: [], liShiDuiBiao: '', ziChaoTag: '' };
      if (preservedQimen) aiResult.qimenSnapshot = preservedQimen;
    }

    // 离线分享保障（try-catch防止存储空间不足时崩溃）
    if (data.symbol || data.gua_name) {
      try {
        wx.setStorageSync('offline_gua', {
          symbol: data.symbol || '䷀',
          gua_name: data.gua_name || '',
          gua_ge: data.gua_ge || '',
          zi_chao_biao_qian: aiResult.ziChaoTag || '',
          panCi: aiResult.panCi || '',
          judgment: data.judgment || ''
        });
      } catch(e) { /* 存储空间不足，静默跳过 */ }
    }

    var nickname = '';
    if (app && app.globalData && app.globalData.profile && app.globalData.profile.nickname) {
      nickname = app.globalData.profile.nickname;
    }

    // v19.1 双语：派生文案（标题/分享触发语）
    var t = i18n.page('result');
    var heroTitle = nickname ? i18n.fill(t.resultOf, { n: nickname }) : t.resultTitle;
    var ziChaoTag = aiResult.ziChaoTag || '';

    // v19.3 保存原始数据（语言切换时重建视图用）
    that._rawData = data;
    that._rawAi = aiResult;

    // v19.3 构建 record 展示视图（卦名/卦格翻译）
    var recordView = that._buildRecordView(data);
    recordView.zi_chao_biao_qian = ziChaoTag;

    that.setData({
      pageState: 'loaded',
      sharerNickname: data.sharer_nickname || '',
      nickname: nickname,
      heroTitle: heroTitle,
      shareTriggerTagText: ziChaoTag ? i18n.fill(t.shareTriggerTag, { t: ziChaoTag }) : '',
      shareTriggerHistoryText: t.shareTriggerHistory,
      record: recordView,
      result: {
        panCi: aiResult.panCi || '',
        jieDu: aiResult.jieDu || '',
        yiList: Array.isArray(aiResult.yiList) ? aiResult.yiList : [],
        jiList: Array.isArray(aiResult.jiList) ? aiResult.jiList : [],
        liShiDuiBiao: aiResult.liShiDuiBiao || '',
        ziChaoTag: aiResult.ziChaoTag || ''
      },
      // v15.0 新增：奇门遁甲排盘变量（替代原"卦辞象辞"原文区）
      // v19.3：Class 类名基于中文原文派生 + 显示文本按语言翻译
      qimen: that._buildQimenView(aiResult.qimenSnapshot)
    });

    soundManager.play('success');

    // v7.1: 预生成Canvas分享海报（Android不支持异步onShareAppMessage）
    this._generatePoster();
  },

  /**
   * v19.3 通用词条翻译（映射命中返回译文，否则回退原文；中文模式映射表为 null 自然回退）
   */
  _tr(map, s) {
    if (s === undefined || s === null || s === '') return s;
    return (map && map[s]) || s;
  },

  /**
   * v19.3 四柱干支拼音化：'甲子年 丙寅月 戊申日 庚申时' → 'JiaZi Year · ...'
   */
  _trPillars(s, t) {
    if (!s) return s;
    var that = this;
    return String(s).replace(/([\u4e00-\u9fa5]{2})(年|月|日|时)/g, function(mm, gz, unit) {
      var gan = that._tr(t.tianganMap, gz.charAt(0));
      var zhi = that._tr(t.dizhiMap, gz.charAt(1));
      var unitKey = { '年': 'pillarYear', '月': 'pillarMonth', '日': 'pillarDay', '时': 'pillarHour' }[unit];
      return gan + zhi + t[unitKey];
    });
  },

  /**
   * v19.3 构建 record 展示视图（卦名/卦格翻译；wuxingClass 类名基于中文原文派生）
   */
  _buildRecordView(data) {
    var t = i18n.page('result');
    var guaGeMap = (i18n.page('jieqi') || {}).guaGeMap;
    return {
      id: data.id,
      symbol: data.symbol || '䷀',
      gua_name: this._tr(t.guaNameMap, data.gua_name) || '',
      gua_ge: this._tr(guaGeMap, data.gua_ge) || '',
      wuxing: data.wuxing || '',
      wuxingClass: this.wuxingToPinyin(data.wuxing),
      judgment: data.judgment || '',
      image: data.image || '',
      zi_chao_biao_qian: data.zi_chao_biao_qian || '',
      question: data.question || '',
      created_at: data.created_at || ''
    };
  },

  /**
   * v19.3 构建奇门排盘展示视图
   * 原则：Class 类名（luck/wuxing）基于中文原文派生（WXSS 不支持中文选择器）；
   *       显示文本按语言翻译；派生文案（落宫/宜·X）模板随语言切换
   * 大吉→daji, 吉→ji, 次吉→ciji, 中平→zhongping, 平→ping, 小凶→xiaoxiong, 凶→xiong, 大凶→daxiong
   * 金→jin, 木→mu, 水→shui, 火→huo, 土→tu
   */
  _buildQimenView(raw) {
    if (!raw) return null;
    var t = i18n.page('result');
    var luckClassMap = {
      '大吉': 'daji', '吉': 'ji', '次吉': 'ciji',
      '中平': 'zhongping', '平': 'ping',
      '小凶': 'xiaoxiong', '凶': 'xiong', '大凶': 'daxiong'
    };
    var wuxingClassMap = { '金': 'jin', '木': 'mu', '水': 'shui', '火': 'huo', '土': 'tu' };
    var view = Object.assign({}, raw);

    // ---- Class 派生（基于中文原文）----
    if (raw.zhiFuStarLuck) view.zhiFuStarLuckClass = luckClassMap[raw.zhiFuStarLuck] || '';
    if (raw.zhiShiMenLuck) view.zhiShiMenLuckClass = luckClassMap[raw.zhiShiMenLuck] || '';
    if (raw.riGanShenJiXiong) view.riGanShenJiXiongClass = luckClassMap[raw.riGanShenJiXiong] || '';
    if (raw.wuxingA) view.wuxingAClass = wuxingClassMap[raw.wuxingA] || '';
    if (raw.wuxingB) view.wuxingBClass = wuxingClassMap[raw.wuxingB] || '';

    // ---- 显示文本翻译 ----
    if (raw.tuiyanTime) view.tuiyanTime = this._trPillars(raw.tuiyanTime, t);
    if (raw.jieQi) view.jieQi = this._tr((i18n.page('jieqi') || {}).termMap, raw.jieQi);
    if (raw.qimenJuName && raw.dun !== undefined && raw.ju !== undefined) {
      view.qimenJuName = i18n.fill(raw.dun === '阳' ? t.yangJuTpl : t.yinJuTpl, { n: raw.ju });
    }
    if (raw.qimenJuDesc && raw.dun !== undefined && raw.ju !== undefined) {
      view.qimenJuDesc = this._tr(t.juDescMap, raw.dun + String(raw.ju)) || raw.qimenJuDesc;
    }
    // 旬首描述：旬首甲落坎宫(水) → 模板重建
    if (raw.xunShouDesc) {
      var xm = /^旬首(.)落(.)宫\((.)\)$/.exec(raw.xunShouDesc);
      if (xm) {
        view.xunShouDesc = i18n.fill(t.xunShouTpl, {
          tg: this._tr(t.tianganMap, xm[1]),
          g: this._tr(t.gongMap, xm[2]),
          w: this._tr(t.wuxingMap, xm[3])
        });
      }
    }
    // 九星/八门/八神/五行/关系
    if (raw.zhiFuStarName) view.zhiFuStarName = this._tr(t.starMap, raw.zhiFuStarName);
    if (raw.zhiFuStarLuck) view.zhiFuStarLuck = this._tr(t.luckMap, raw.zhiFuStarLuck);
    if (raw.zhiShiMenName) view.zhiShiMenName = this._tr(t.gateMap, raw.zhiShiMenName);
    if (raw.zhiShiMenLuck) view.zhiShiMenLuck = this._tr(t.luckMap, raw.zhiShiMenLuck);
    if (raw.riGanShenName) view.riGanShenName = this._tr(t.spiritMap, raw.riGanShenName);
    if (raw.riGanShenJiXiong) view.riGanShenJiXiong = this._tr(t.luckMap, raw.riGanShenJiXiong);
    if (raw.riGanShenRole) view.riGanShenRole = this._tr(t.spiritRoleMap, raw.riGanShenRole);
    if (raw.wuxingA) view.wuxingA = this._tr(t.wuxingMap, raw.wuxingA);
    if (raw.wuxingB) view.wuxingB = this._tr(t.wuxingMap, raw.wuxingB);
    if (raw.wuxingRelation) view.wuxingRelation = this._tr(t.relMap, raw.wuxingRelation);
    if (raw.wuxingRelationDesc) view.wuxingRelationDesc = this._tr(t.relDescMap, raw.wuxingRelationDesc);
    // 宫名/宫宜义/宫描述
    if (raw.zhiFuGongName) view.zhiFuGongName = this._tr(t.gongMap, raw.zhiFuGongName);
    if (raw.zhiShiGongName) view.zhiShiGongName = this._tr(t.gongMap, raw.zhiShiGongName);
    if (raw.zhiFuGongShiYi) view.zhiFuGongShiYi = this._tr(t.gongShiYiMap, raw.zhiFuGongShiYi);
    if (raw.zhiShiGongShiYi) view.zhiShiGongShiYi = this._tr(t.gongShiYiMap, raw.zhiShiGongShiYi);
    // 宫完整描述：方位·领域 → 模板重建
    if (raw.zhiFuGongDesc) {
      var dm = String(raw.zhiFuGongDesc).split('·');
      if (dm.length === 2) {
        view.zhiFuGongDesc = i18n.fill(t.gongDescTpl, {
          fangwei: this._tr(t.fangweiMap, dm[0]),
          lingyu: this._tr(t.lingyuMap, dm[1])
        });
      }
    }
    if (raw.zhiShiGongDesc) {
      var dm2 = String(raw.zhiShiGongDesc).split('·');
      if (dm2.length === 2) {
        view.zhiShiGongDesc = i18n.fill(t.gongDescTpl, {
          fangwei: this._tr(t.fangweiMap, dm2[0]),
          lingyu: this._tr(t.lingyuMap, dm2[1])
        });
      }
    }

    // ---- 派生展示文案（落宫/宜·X，用翻译后的宫名与宜义填充）----
    if (raw.zhiFuGongName) view.zhiFuGongInText = i18n.fill(t.inPalace, { p: view.zhiFuGongName });
    if (raw.zhiFuGongName) view.zhiFuPalaceText = view.zhiFuGongName + t.palaceSuffix;
    if (view.zhiFuGongShiYi) view.zhiFuGongBestText = i18n.fill(t.bestFor, { t: view.zhiFuGongShiYi });
    if (raw.zhiShiGongName) view.zhiShiGongInText = i18n.fill(t.inPalace, { p: view.zhiShiGongName });
    if (view.zhiShiGongShiYi) view.zhiShiGongBestText = i18n.fill(t.bestFor, { t: view.zhiShiGongShiYi });
    return view;
  },

  /**
   * v7.1: 预生成分享海报图片，缓存在 posterImageUrl 中
   * 生成失败时 posterImageUrl 保持空字符串，降级为默认截图
   */
  _generatePoster: function() {
    var that = this;
    // 延迟200ms等DOM渲染完成
    this._posterTimer = setTimeout(function() {
      if (that._unloaded) return; // 🔴 v3.4 修复：页面已销毁则放弃
      var poster = that.selectComponent('#sharePoster');
      if (!poster) return;
      poster.generatePoster().then(function(imageUrl) {
        if (that._unloaded) return;
        if (imageUrl) {
          that.setData({ posterImageUrl: imageUrl });
        }
      }).catch(function() {
        // 静默降级——不影响正常分享
      });
    }, 200);
  },

  // 🔴 v3.4 修复：增加 onUnload 清理定时器，防止页面销毁后 setData 报错
  onUnload() {
    this._unloaded = true;
    if (this._posterTimer) { clearTimeout(this._posterTimer); this._posterTimer = null; }
  },

  onShareAppMessage() {
    var record = this.data.record;
    var result = this.data.result;
    var t = i18n.page('result');
    var guaName = record.gua_name || t.shareFallbackName;
    var judgment = record.judgment ? record.judgment.substring(0, i18n.getLang() === 'en' ? 40 : 15) + '...' : t.shareJudgmentFallback;
    // v7.1: 用自嘲标签驱动分享——这才是用户想给别人看的东西
    var ziChaoTag = result.ziChaoTag || record.zi_chao_biao_qian || '';
    var title;
    if (ziChaoTag) {
      title = i18n.fill(t.shareTag, { t: ziChaoTag });
    } else {
      title = guaName + ' - ' + judgment;
    }
    return {
      title: title,
      path: record.id ? '/pages/index/index?scene=' + record.id : '/pages/index/index',
      imageUrl: this.data.posterImageUrl || ''
    };
  },

  // 🔴 v3.5 新增：分享到朋友圈（接收者通过 id=XXX&shared=1 直接查看分享的推演结果）
  onShareTimeline() {
    var record = this.data.record;
    var result = this.data.result;
    var t = i18n.page('result');
    var ziChaoTag = result.ziChaoTag || record.zi_chao_biao_qian || '';
    var title;
    if (ziChaoTag) {
      title = i18n.fill(t.shareTag, { t: ziChaoTag });
    } else {
      title = i18n.fill(t.shareDefault, { g: record.gua_name || t.shareFallbackName });
    }
    // [SEC-FIX] P1-2: 分享链接优先使用随机 share_token（不可枚举），兼容旧 id
    var shareKey = record.share_token || record.id;
    return {
      title: title,
      query: shareKey ? 'share=' + shareKey + '&shared=1' : '',
      imageUrl: this.data.posterImageUrl || ''
    };
  },

  // App端分享按钮点击：推演结果分享 → result.html?sid=xxx&rid=xxx
  // 接收者点开 → 网页展示分享者的完整推演结果 → 已装App则唤起进入只读结果页
  onShareTap() {
    const shareInfo = this.onShareAppMessage();
    const shareId = this.data.shareId;
    const recordId = this.data.shareRecordId || ((this.data.record && this.data.record.id) || this._currentRecordId || 0);
    const h5Url = shareId ? (shareUtil.H5_WEB_BASE + 'result.html?sid=' + shareId + '&rid=' + recordId + (i18n.isEn() ? '&lang=en' : '')) : shareUtil.H5_WEB_BASE;
    shareUtil.shareWebPageMessage({
      webpageUrl: h5Url,
      title: shareInfo.title,
      description: shareInfo.description || ''
    });
  },

  goBack() {
    soundManager.play('click');
    var pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
    } else {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  goToIndex() {
    soundManager.play('click');
    wx.switchTab({ url: '/pages/index/index' });
  },

  // 未登录时提供去登录入口
  goToLogin() {
    soundManager.play('click');
    const app = getApp();
    if (app && typeof app.login === 'function') {
      // App端调用 app.login() 会唤起 wx.weixinAppLogin
      app.login().catch(e => console.error('[result] login失败:', e));
    } else {
      wx.navigateTo({ url: '/pages/login/login' });
    }
  },

  retry() {
    soundManager.play('click');
    this.setData({ pageState: 'loading' });
    // 优先使用当前正在查看的记录ID，其次使用lastRecordId
    var recordId = this._currentRecordId || (getApp() && getApp().globalData && getApp().globalData.lastRecordId);
    if (recordId) {
      this.loadResult(recordId);
    } else {
      wx.switchTab({ url: '/pages/index/index' });
    }
  }
});
