// components/jieqi-bar/jieqi-bar.js - 节气养生条 + 全屏详情（含卦格专属建议，全免费）
// v19.2 中英双语：raw 数据保存 + JS 端预翻译（映射表），WXML 零函数调用
//   - 语言切换：页面调用 refreshI18n() → _applyLang() 基于 raw 重建展示数据
//   - 图标匹配基于中文原文（先 enrich 后翻译）
//   - wuxing 保留中文用于颜色索引，新增 wuxingText/organText 用于显示
const api = require('../../utils/api.js');
const shareUtil = require('../../utils/share.js');
const i18n = require('../../utils/i18n.js');

Component({
  properties: {
    guaGe: { type: String, value: '' },
    hasProfile: { type: Boolean, value: false }
  },

  data: {
    t: {},                    // jieqi 静态文案字典（当前语言）
    lang: 'zh',
    isEn: false,
    termData: null,
    overlayVisible: false,
    loading: false,
    adviceLoading: false,
    adviceData: null,  // 卦格专属建议数据
    statusBarHeight: 20,
    isMpWeixin: true,
    guaGeText: '',             // 卦格名（当前语言，预计算）
    loadingText: '',           // 加载中文案（预计算）
    diaryHistoryText: '',      // 已记录 N 次（预计算）
    // v15.3.5 物候日记（本地存储）
    diaryToday: '',      // 今日记录值：good/normal/tired
    diaryCount: 0,       // 当前节气累计记录次数
    wuxingColor: {
      '木': '#5B8C5A', '火': '#C45B5B', '土': '#C8A96E', '金': '#B8A48E', '水': '#4A7B9D'
    },
    wuxingColorLight: {
      '木': '#7BAF7A', '火': '#E07878', '土': '#D4BA85', '金': '#CFC0A8', '水': '#6B9EBD'
    },
    wuxingBgTint: {
      '木': 'rgba(91,140,90,0.12)', '火': 'rgba(196,91,91,0.12)',
      '土': 'rgba(200,169,110,0.12)', '金': 'rgba(184,164,142,0.12)', '水': 'rgba(74,123,157,0.12)'
    }
  },

  observers: {
    'guaGe, hasProfile': function(guaGe, hasProfile) {
      // 浮层已展开且有卦格时，自动加载专属建议
      if (this.data.overlayVisible && hasProfile && guaGe && !this.data.adviceData && !this.data.adviceLoading) {
        this.fetchAdvice(guaGe);
      }
    },
    guaGe: function(guaGe) {
      // 卦格变化时刷新预计算文案
      this.setData({
        guaGeText: this._trGuaGe(guaGe),
        loadingText: i18n.fill(this._dict().loadingAdvice, { gua: this._trGuaGe(guaGe) })
      });
    }
  },

  lifetimes: {
    attached() {
      try {
        // 🔴 v3.5 迁移：getWindowInfo 取代 getSystemInfoSync 取 statusBarHeight
        let statusBarHeight = 20;
        try {
          statusBarHeight = wx.getWindowInfo().statusBarHeight || 20;
        } catch (e) {
          statusBarHeight = (wx.getSystemInfoSync() || {}).statusBarHeight || 20;
        }
        this.setData({
          statusBarHeight: statusBarHeight,
          isMpWeixin: getApp().globalData.isMpWeixin
        });
      } catch (e) {}
      this._applyLang();
      this.fetchCurrentTerm();
    }
  },

  methods: {
    // ==================== v19.2 双语核心 ====================

    _dict() {
      return i18n.page('jieqi');
    },

    // 通用词条翻译：映射命中返回译文，否则回退原文
    _tr(map, text) {
      if (text === undefined || text === null || text === '') return text;
      return (map && map[text]) || text;
    },

    _trList(map, list) {
      if (!Array.isArray(list)) return list;
      return list.map(x => this._tr(map, x));
    },

    _trGuaGe(ge) {
      if (!ge) return ge;
      if (!i18n.isEn()) return ge;
      return this._tr(this._dict().guaGeMap, ge);
    },

    // 日期范围翻译：'2月4日-2月18日' → 'Feb 4 - Feb 18'
    _trDateRange(str) {
      if (!str || !i18n.isEn()) return str;
      const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return String(str).replace(/(\d{1,2})月(\d{1,2})日/g, function(m, mo, d) {
        return MON[parseInt(mo, 10) - 1] + ' ' + parseInt(d, 10);
      });
    },

    // 脏腑对应翻译：'肝·脾' → 'Liver · Spleen'
    _trOrgans(str) {
      if (!str) return str;
      if (!i18n.isEn()) return str;
      const t = this._dict();
      return String(str).split('·').map(s => this._tr(t.organMap, s.trim())).join(' · ');
    },

    // 应用当前语言：刷新静态文案 + 基于 raw 重建展示数据
    _applyLang() {
      const t = this._dict();
      const isEn = i18n.isEn();
      const guaGe = this.data.guaGe;
      const patch = {
        t: t,
        lang: i18n.getLang(),
        isEn: isEn,
        guaGeText: this._trGuaGe(guaGe),
        loadingText: i18n.fill(t.loadingAdvice, { gua: this._trGuaGe(guaGe) }),
        diaryHistoryText: this.data.diaryCount > 0
          ? i18n.fill(t.diaryHistory, { n: this.data.diaryCount })
          : ''
      };
      if (this._rawTermData) patch.termData = this._buildTermView(this._rawTermData, t, isEn);
      if (this._rawAdviceData) patch.adviceData = this._buildAdviceView(this._rawAdviceData, t, isEn);
      this.setData(patch);
    },

    // 供页面调用：语言切换后刷新（index.js onShow 已接入）
    refreshI18n() {
      const isEn = i18n.isEn();
      // v20：切到英文时若后端权威英文数据缺失（首次加载发生在中文态），异步补拉后重建视图
      if (isEn && this._rawTermData && !this._enTermData) {
        api.request('/api/solar-term/current?lang=en', 'GET').then(res => {
          if (res.success && res.data) {
            this._enTermData = res.data;
            this._applyLang();
          }
        }).catch(() => {});
      }
      if (isEn && this._rawAdviceData && !this._enAdviceData && this.data.guaGe) {
        api.requestWithAuth(`/api/solar-term/advice?gua_ge=${encodeURIComponent(this.data.guaGe)}&lang=en`, 'GET').then(res => {
          if (res.success && res.data) {
            this._enAdviceData = res.data;
            this.setData({ adviceData: this._buildAdviceView(this._rawAdviceData, this._dict(), true) });
          }
        }).catch(() => {});
      }
      this._applyLang();
    },

    // ==================== 数据构建（图标 enrich + 翻译） ====================

    // 节气基础数据视图：先基于中文算图标，再按语言取显示文本
    // v20：英文态优先用后端权威英文数据（this._enTermData），图标仍从中文 raw 匹配
    _buildTermView(raw, t, isEn) {
      const enData = (isEn && this._enTermData) ? this._enTermData : null;
      const data = JSON.parse(JSON.stringify(enData || raw));

      // ---- 图标（基于中文匹配，永远从中文 raw 算）----
      if (data.generalYi) {
        const rawYi = raw.generalYi || {};
        if (rawYi.food && rawYi.food.length) {
          data.generalYi.foodIcons = rawYi.food.map(name => this._foodIcon(name));
        }
        if (rawYi.activity && rawYi.activity.length) {
          data.generalYi.activityIcons = rawYi.activity.map(name => this._activityIcon(name));
        }
        if (rawYi.emotion && rawYi.emotion.length) {
          data.generalYi.emotionIcons = rawYi.emotion.map(() => 'xin');
        }
      }
      if (data.name) {
        data.termIcon = this._termIcon(raw.name);
      }

      // ---- 语言无关的预计算字段 ----
      data.daysInText = i18n.fill(t.dayN, { n: raw.daysIn });
      data.wuHouView = (data.wuHou || []).map((h, i) => ({
        text: h,
        houText: i18n.fill(t.houN, { n: i + 1 })
      }));
      // wuxing 保留中文用于颜色索引，wuxingText/organText 用于显示
      data.wuxing = raw.wuxing;
      data.wuxingText = enData ? enData.wuxing : raw.wuxing;
      data.organText = enData ? enData.organ : raw.organ;

      // ---- 英文翻译 ----
      if (isEn) {
        if (enData) {
          // v20：后端权威英文（jieqi-health-en.js 全量预翻译），无需前端字典
          data.season = enData.season;
          data.seasonDesc = enData.seasonDesc;
          data.dateRange = enData.dateRange;
          data.keywords = enData.keywords || [];
          data.neijingQuote = enData.neijingQuote;
          data.neijingSource = enData.neijingSource;
          data.neijingInterpretation = enData.neijingInterpretation;
          data.neijingPlain = enData.neijingPlain;
          data.neijingAction = enData.neijingAction || [];
          if (data.generalYi && enData.generalYi) {
            data.generalYi.food = enData.generalYi.food || [];
            data.generalYi.activity = enData.generalYi.activity || [];
            data.generalYi.emotion = enData.generalYi.emotion || [];
            data.generalYi.recipes = enData.generalYi.recipes || [];
          }
        } else {
          // 后端英文数据缺失时降级前端字典（兜底）
          data.name = this._tr(t.termMap, raw.name);
          data.wuxingText = this._tr(t.wuxingMap, raw.wuxing);
          data.organText = this._tr(t.organMap, raw.organ);
          data.season = this._tr(t.seasonMap, raw.season);
          data.seasonDesc = this._tr(t.seasonDescMap, raw.seasonDesc);
          data.dateRange = this._trDateRange(raw.dateRange);
          data.wuHouView = (raw.wuHou || []).map((h, i) => ({
            text: this._tr(t.wuhouMap, h),
            houText: i18n.fill(t.houN, { n: i + 1 })
          }));
          data.keywords = this._trList(t.keywordMap, raw.keywords);
          data.neijingQuote = this._tr(t.neijingQuoteMap, raw.neijingQuote);
          data.neijingSource = this._tr(t.neijingSourceMap, raw.neijingSource);
          data.neijingInterpretation = this._tr(t.neijingInterpretationMap, raw.neijingInterpretation);
          data.neijingPlain = this._tr(t.neijingPlainMap, raw.neijingPlain);
          data.neijingAction = this._trList(t.neijingActionMap, raw.neijingAction);
          if (data.generalYi) {
            data.generalYi.food = this._trList(t.foodMap, raw.generalYi.food);
            data.generalYi.activity = this._trList(t.activityMap, raw.generalYi.activity);
            data.generalYi.emotion = this._trList(t.emotionMap, raw.generalYi.emotion);
            data.generalYi.recipes = (raw.generalYi.recipes || []).map(r => {
              const tr = t.recipeMap && t.recipeMap[r.name];
              return tr ? { name: tr.name, main: tr.main, steps: tr.steps, effect: tr.effect } : r;
            });
          }
        }
      }
      return data;
    },

    // 卦格专属建议视图：先基于中文算图标，再按语言取显示文本
    // v20：英文态优先用后端权威英文数据（this._enAdviceData），图标仍从中文 raw 匹配
    _buildAdviceView(raw, t, isEn) {
      const enData = (isEn && this._enAdviceData) ? this._enAdviceData : null;
      const data = JSON.parse(JSON.stringify(enData || raw));

      // ---- 图标（基于中文匹配，永远从中文 raw 算，转对象数组）----
      const asName = (item) => typeof item === 'string' ? item : ((item && item.name) || item);
      if (data.detail) {
        const rawDetail = raw.detail || {};
        if (rawDetail.recommendFood && rawDetail.recommendFood.length) {
          data.detail.recommendFood = data.detail.recommendFood.map((item, i) => ({
            name: asName(item),
            icon: this._foodIcon(rawDetail.recommendFood[i])
          }));
        }
        if (rawDetail.recommendActivity && rawDetail.recommendActivity.length) {
          data.detail.recommendActivity = data.detail.recommendActivity.map((item, i) => ({
            name: asName(item),
            icon: this._activityIcon(rawDetail.recommendActivity[i])
          }));
        }
        if (rawDetail.recommendEmotion && rawDetail.recommendEmotion.length) {
          data.detail.recommendEmotion = data.detail.recommendEmotion.map(item => ({
            name: asName(item),
            icon: 'xin'
          }));
        }
      }
      if (data.relation && data.relation.correspondingOrgan && raw.relation) {
        data.relation.organIcon = this._organIcon(raw.relation.correspondingOrgan);
      }

      // ---- 语言无关的预计算字段（wuxing 保留中文用于颜色索引）----
      if (data.term) { data.term.wuxing = raw.term.wuxing; data.term.wuxingText = enData ? enData.term.wuxing : raw.term.wuxing; }
      if (data.gua) { data.gua.wuxing = raw.gua.wuxing; data.gua.wuxingText = enData ? enData.gua.wuxing : raw.gua.wuxing; }

      // ---- 英文翻译（仅后端英文数据缺失时降级前端字典）----
      if (isEn && !enData) {
        if (data.term) {
          data.term.name = this._tr(t.termMap, raw.term.name);
          data.term.wuxingText = this._tr(t.wuxingMap, raw.term.wuxing);
        }
        if (data.gua) {
          data.gua.wuxingText = this._tr(t.wuxingMap, raw.gua.wuxing);
        }
        if (data.relation) {
          data.relation.title = this._tr(t.relationTitleMap, raw.relation.title);
          data.relation.type = this._tr(t.relationTypeMap, raw.relation.type);
          data.relation.correspondingOrgan = this._trOrgans(raw.relation.correspondingOrgan);
          data.relation.warning = this._tr(t.relationWarningMap, raw.relation.warning);
        }
        if (data.detail) {
          if (data.detail.recommendFood && data.detail.recommendFood.length) {
            data.detail.recommendFood = data.detail.recommendFood.map((item, i) => ({
              name: this._tr(t.foodMap, raw.detail.recommendFood[i]),
              icon: item.icon
            }));
          }
          if (data.detail.recommendActivity && data.detail.recommendActivity.length) {
            data.detail.recommendActivity = data.detail.recommendActivity.map((item, i) => ({
              // L3 是活动名，L2 回退是策略术语，两个映射都试
              name: this._tr(t.activityMap, raw.detail.recommendActivity[i]) !== raw.detail.recommendActivity[i]
                ? this._tr(t.activityMap, raw.detail.recommendActivity[i])
                : this._tr(t.strategyMap, raw.detail.recommendActivity[i]),
              icon: item.icon
            }));
          }
          if (data.detail.recommendEmotion && data.detail.recommendEmotion.length) {
            data.detail.recommendEmotion = data.detail.recommendEmotion.map((item, i) => ({
              name: this._tr(t.emotionMap, raw.detail.recommendEmotion[i]),
              icon: item.icon
            }));
          }
          data.detail.recommendAvoid = this._trList(t.jiMap, raw.detail.recommendAvoid);
          // 经典引文/出处/解读：L2 模板与 L3 内经原文双映射
          data.detail.classicQuote = this._tr(t.l2ClassicQuoteMap, raw.detail.classicQuote) !== raw.detail.classicQuote
            ? this._tr(t.l2ClassicQuoteMap, raw.detail.classicQuote)
            : this._tr(t.neijingQuoteMap, raw.detail.classicQuote);
          data.detail.classicSource = this._tr(t.l2ClassicSourceMap, raw.detail.classicSource) !== raw.detail.classicSource
            ? this._tr(t.l2ClassicSourceMap, raw.detail.classicSource)
            : this._tr(t.neijingSourceMap, raw.detail.classicSource);
          data.detail.classicInterpretation = this._tr(t.l2ClassicDescMap, raw.detail.classicInterpretation) !== raw.detail.classicInterpretation
            ? this._tr(t.l2ClassicDescMap, raw.detail.classicInterpretation)
            : this._tr(t.neijingInterpretationMap, raw.detail.classicInterpretation);
        }
        if (data.hint) data.hint = t.l2Hint;
      }
      return data;
    },

    // ==================== 网络请求 ====================

    async fetchCurrentTerm() {
      this.setData({ loading: true });
      try {
        // v20：中文请求保留（图标匹配/物候日记分片依赖中文原始名）；英文态并行拉后端权威英文
        const reqs = [api.request('/api/solar-term/current', 'GET')];
        if (i18n.isEn()) {
          reqs.push(api.request('/api/solar-term/current?lang=en', 'GET').catch(() => null));
        }
        const [resCn, resEn] = await Promise.all(reqs);
        if (resCn.success && resCn.data) {
          this._rawTermData = resCn.data;
          this._enTermData = (resEn && resEn.success && resEn.data) ? resEn.data : null;
          this._applyLang();
          // v15.3.5 节气数据就绪后重新加载物候日记（按节气名分片，用中文原始名）
          this._loadDiary();
        }
      } catch (err) {
        console.error('[jieqi-bar] 获取节气信息失败:', err);
      } finally {
        this.setData({ loading: false });
      }
    },

    // 获取卦格专属养生建议
    async fetchAdvice(guaGe) {
      if (!guaGe) return;
      this.setData({ adviceLoading: true });
      try {
        const reqs = [api.requestWithAuth(
          `/api/solar-term/advice?gua_ge=${encodeURIComponent(guaGe)}`,
          'GET'
        )];
        // v20：英文态并行拉后端权威英文（gua_ge 始终传中文原始名，后端 findGuaByGe 按中文查）
        if (i18n.isEn()) {
          reqs.push(api.requestWithAuth(
            `/api/solar-term/advice?gua_ge=${encodeURIComponent(guaGe)}&lang=en`,
            'GET'
          ).catch(() => null));
        }
        const [resCn, resEn] = await Promise.all(reqs);
        if (resCn.success && resCn.data) {
          this._rawAdviceData = resCn.data;
          this._enAdviceData = (resEn && resEn.success && resEn.data) ? resEn.data : null;
          const t = this._dict();
          this.setData({ adviceData: this._buildAdviceView(resCn.data, t, i18n.isEn()) });
        }
      } catch (err) {
        console.error('[jieqi-bar] 获取卦格专属建议失败:', err);
      } finally {
        this.setData({ adviceLoading: false });
      }
    },

    // ==================== 图标映射（基于中文匹配） ====================

    // v2.0 24节气专属SVG图标映射
    _termIcon(name) {
      // 按节气名匹配专属图标，无匹配则按季节降级到 season-* 图标
      const map = {
        '立春': 'season-spring', '雨水': 'season-spring', '惊蛰': 'season-spring',
        '春分': 'season-spring', '清明': 'season-spring', '谷雨': 'season-spring',
        '立夏': 'season-summer', '小满': 'season-summer', '芒种': 'season-summer',
        '夏至': 'season-summer', '小暑': 'season-summer', '大暑': 'season-summer',
        '立秋': 'season-autumn', '处暑': 'season-autumn', '白露': 'season-autumn',
        '秋分': 'season-autumn', '寒露': 'season-autumn', '霜降': 'season-autumn',
        '立冬': 'season-winter', '小雪': 'season-winter', '大雪': 'season-winter',
        '冬至': 'season-winter', '小寒': 'season-winter', '大寒': 'season-winter'
      };
      return map[name] || 'jieqi';
    },

    _foodIcon(name) {
      const map = {
        '香椿': 'chunsun', '豆芽': 'lvdou', '韭菜': 'jiucai', '菠菜': 'boche',
        '春笋': 'chunsun', '大枣': 'xueli', '红枣': 'xueli', '枸杞': 'lvdou',
        '菊花': 'baihe', '绿茶': 'bohe', '山药': 'shanyao', '小米': 'yimi',
        '薏米': 'yimi', '蜂蜜': 'suanmeitang', '百合': 'baihe', '莲子': 'lianzi',
        '梨': 'xigua', '西瓜': 'xigua', '荠菜': 'jiucai', '莴笋': 'boche',
        '草莓': 'xueli', '青团': 'lianzi', '马兰头': 'bohe', '陈皮': 'bohe',
        '扁豆': 'lvdou', '绿豆': 'heidou', '苦瓜': 'kuigua', '黄瓜': 'xigua',
        '冬瓜': 'xigua', '酸梅汤': 'suanmeitang', '乌梅': 'xueli', '山楂': 'xueli',
        '面条': 'yimi', '荷叶粥': 'bohe', '薄荷': 'bohe', '藿香': 'bohe',
        '银耳': 'yiner', '莲藕': 'shanyao', '芝麻': 'heizhima', '黑芝麻': 'heizhima',
        '糯米': 'yimi', '杏仁': 'hetao', '核桃': 'hetao', '柿饼': 'xueli',
        '柿子': 'xueli', '秋梨': 'xigua', '羊肉': 'yangrou', '牛肉': 'yangrou',
        '黑豆': 'heidou', '黑米': 'heizhima', '桂圆': 'xueli', '饺子': 'yimi',
        '栗子': 'hetao', '枸杞头': 'lvdou',
        // v3.5 节气养生食材补充（对应新数据源）
        '南瓜': 'nanguo', '红薯': 'nanguo', '玉米': 'yimi', '芡实': 'yimi',
        '萝卜': 'bailuobo', '胡萝卜': 'xueli', '鸭肉': 'yangrou', '乌鸡': 'yangrou',
        '猪肝': 'yangrou', '黄鳝': 'chunsun', '丝瓜': 'chunsun', '芦笋': 'chunsun',
        '春韭': 'jiucai', '蒜薹': 'jiucai', '苋菜': 'jiucai', '苦菜': 'kuigua',
        '苦菊': 'bohe', '香菜': 'bohe', '豌豆苗': 'bohe', '荷叶': 'bohe',
        '玫瑰花茶': 'baihe', '樱桃': 'xueli', '青梅': 'xueli', '杨梅': 'xueli',
        '葡萄': 'xueli', '龙眼': 'xueli', '蚕豆': 'lvdou', '豌豆': 'lvdou',
        '赤小豆': 'heidou', '黑木耳': 'heizhima', '茯苓': 'yimi', '肉桂': 'yimi',
        '荸荠': 'lianzi', '鸡蛋': 'lianzi', '春饼': 'yimi',
        '鲫鱼': 'shanyao', '柑橘': 'xueli', '鸡肉': 'yangrou'
      };
      for (const key of Object.keys(map)) {
        if (name.includes(key)) return map[key];
      }
      return 'lianzi';
    },

    _activityIcon(name) {
      const map = {
        '散步': 'walk', '登高': 'walk', '跑步': 'walk', '户外': 'walk', '踏青': 'walk',
        '拉伸': 'baduanjin', '八段锦': 'baduanjin', '太极': 'taiji', '瑜伽': 'baduanjin',
        '冥想': 'meditate', '静坐': 'meditate', '静心': 'meditate', '游泳': 'swim',
        '午休': 'meditate', '午睡': 'meditate', '泡脚': 'aiqiu', '艾灸': 'aiqiu',
        '摩腹': 'massage', '梳头': 'massage', '深呼吸': 'meditate', '室内': 'walk',
        '读书': 'meditate', '放风筝': 'walk', '扫墓': 'walk', '秋游': 'walk',
        '赏菊': 'walk', '远眺': 'walk', '赏秋': 'walk', '晨跑': 'walk',
        '缓步': 'walk', '健身': 'walk', '早起': 'walk'
      };
      for (const key of Object.keys(map)) {
        if (name.includes(key)) return map[key];
      }
      return 'walk';
    },

    _organIcon(name) {
      const map = { '心': 'xin', '肝': 'gan', '脾': 'pi', '肺': 'fei', '肾': 'shen' };
      for (const key of Object.keys(map)) {
        if (name.includes(key)) return map[key];
      }
      return 'xin';
    },

    // ==================== 交互 ====================

    toggleOverlay() {
      const next = !this.data.overlayVisible;
      this.setData({ overlayVisible: next });
      // 展开且有卦格时自动加载专属建议
      if (next && this.data.hasProfile && this.data.guaGe && !this.data.adviceData && !this.data.adviceLoading) {
        this.fetchAdvice(this.data.guaGe);
      }
    },

    // 外部调用：直接展开浮层（用于分享进入场景）
    openOverlay() {
      if (this.data.termData && !this.data.overlayVisible) {
        this.setData({ overlayVisible: true });
        if (this.data.hasProfile && this.data.guaGe && !this.data.adviceData && !this.data.adviceLoading) {
          this.fetchAdvice(this.data.guaGe);
        }
      }
    },

    closeOverlay() {
      this.setData({ overlayVisible: false });
    },

    stopPropagation() {},

    // v15.3.5 物候日记：记录今日身心状态（本地存储，按节气名分片，key 用中文原始名）
    setDiary(e) {
      const val = e.currentTarget.dataset.val;
      if (!val) return;
      const termName = (this._rawTermData && this._rawTermData.name) || 'unknown';
      const today = new Date();
      const dateKey = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
      const storageKey = 'jieqi_diary_' + termName;
      const t = this._dict();

      try {
        let diary = wx.getStorageSync(storageKey) || {};
        // 同一天重复记录则覆盖
        if (diary[dateKey] === val) {
          // 再次点击同一个：取消
          delete diary[dateKey];
          wx.setStorageSync(storageKey, diary);
          this.setData({
            diaryToday: '',
            diaryCount: Object.keys(diary).length,
            diaryHistoryText: Object.keys(diary).length > 0 ? i18n.fill(t.diaryHistory, { n: Object.keys(diary).length }) : ''
          });
          wx.showToast({ title: t.toastCancel, icon: 'none', duration: 800 });
          return;
        }
        diary[dateKey] = val;
        wx.setStorageSync(storageKey, diary);
        const count = Object.keys(diary).length;
        const labelMap = { good: t.diaryGoodLabel, normal: t.diaryNormalLabel, tired: t.diaryTiredLabel };
        this.setData({
          diaryToday: val,
          diaryCount: count,
          diaryHistoryText: i18n.fill(t.diaryHistory, { n: count })
        });
        wx.showToast({ title: t.toastRecorded + ' · ' + (labelMap[val] || val), icon: 'none', duration: 1000 });
      } catch (err) {
        console.error('[jieqi-bar] 物候日记保存失败:', err);
        wx.showToast({ title: t.toastRecordFail, icon: 'none' });
      }
    },

    // v15.3.5 加载物候日记（按节气名分片，key 用中文原始名）
    _loadDiary() {
      const termName = (this._rawTermData && this._rawTermData.name) || '';
      if (!termName) return;
      try {
        const storageKey = 'jieqi_diary_' + termName;
        const diary = wx.getStorageSync(storageKey) || {};
        const today = new Date();
        const dateKey = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        const count = Object.keys(diary).length;
        this.setData({
          diaryToday: diary[dateKey] || '',
          diaryCount: count,
          diaryHistoryText: count > 0 ? i18n.fill(this._dict().diaryHistory, { n: count }) : ''
        });
      } catch (err) {
        console.error('[jieqi-bar] 物候日记加载失败:', err);
      }
    },

    // v15.3.5 未建档钩子：跳转到档案页
    goToProfile() {
      wx.navigateTo({ url: '/pages/profile/profile' });
    },

    // 分享按钮点击：分享 H5 官网链接（替代小程序卡片）
    onShareTap() {
      const termData = this.data.termData;
      const t = this._dict();
      const termName = termData ? termData.name : t.termFallback;
      const title = termName + t.shareSuffix;
      shareUtil.shareWebPageMessage({
        webpageUrl: shareUtil.H5_WEB_BASE,
        title: title,
        description: title
      });
    }
  }
});
