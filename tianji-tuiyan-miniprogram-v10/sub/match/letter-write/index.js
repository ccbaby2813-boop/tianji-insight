/**
 * sub/match/letter-write/index.js - 写信传情（v1.1 重构）
 * 信纸视觉：四角装饰 + 信纸纹理 + 水印 + 落款 + 农历日期
 */
const api = require('../../../utils/api.js');
const soundManager = require('../../../utils/audio.js');
const router = require('../../../utils/router.js');
const i18n = require('../../../utils/i18n.js'); // v19.2
const app = getApp();
// v19.2 英文态接口查询串（卦名/关系解读双语）
const LANG_QS = () => i18n.isEn() ? '?lang=en' : '';

// v1.4-1.5 话题模板定义（按话题族分组）
// 占位符：{guaName}{ziChaoBiaoQian}{talent}{blindspot}{liShiRenWu} 来自我的卦象；
//          {termName}{termAction}{termFood} 来自当前节气；
//          {relationshipName}{matchLevel}{oneLiner} 来自"我的卦 vs 对方卦"的匹配结果。
// 取不到时 renderTemplate 回退通用文案。
const TOPIC_TEMPLATES = {
  personality: [
    {
      emoji: '☯',
      label: '我是哪一卦',
      content: '天机推演说，我是「{guaName}」卦，它说我是{ziChaoBiaoQian}。\n它讲我天赋是{talent}，但盲点也够可以——{blindspot}。\n说得还挺在点子上。你呢？你是什么卦？'
    },
    {
      emoji: '👑',
      label: '历史人物对标',
      content: '天机说我这个「{guaName}」卦，气场上有点像{liShiRenWu}。\n我当场就笑了，但仔细一想，好像真有那么点味儿。\n你被对标过谁？我想听听。'
    }
  ],
  term: [
    {
      emoji: '🍃',
      label: '应季养生',
      content: '{termName}到了。天机说这阵子宜{termAction}，推荐吃点{termFood}。\n我正准备照着试试。你平时有什么养生小习惯，或者应季的妙招吗？'
    }
  ],
  divine: [
    {
      emoji: '🎲',
      label: '奇葩问题',
      content: '我最近拿一个特别无厘头的问题去问天机推演，\n它居然一本正经地给我解了一卦，把我逗乐了。\n你往这儿问过什么奇怪问题吗？咱们交流一下。'
    }
  ],
  heart: [
    {
      emoji: '🌙',
      label: '深夜独白',
      content: '夜深了，窗外的灯火渐次熄灭。\n{termName}的夜里，我总会多出很多念头。\n翻着天机给我的解读，忽然就想找个人说说话。\n你会不会也有某个时刻，想找人聊聊、却不知从哪说起？\n如果愿意，可以从你最近的烦心事开始说给我听。'
    },
    {
      emoji: '🌙',
      label: '一个念头',
      content: '我最近老在想一件事：{guaName}卦说我{ziChaoBiaoQian}，\n这话听着像夸奖，我却总觉得是提醒。\n你觉不觉得，有些话听上去越好听，越值得多想几遍？\n你最近有什么一句就让你想通很久的话吗？'
    }
  ],
  // v1.5 聊缘分：注入"我的卦 vs 对方卦"的匹配结果（来自 /api/relationship）
  match: [
    {
      emoji: '💞',
      label: '我们的缘分',
      content: '天机推演把咱俩放一块儿算了算，说我们是「{relationshipName}」——{matchLevel}。\n「{oneLiner}」\n你说它猜得准不准？我挺好奇你第一眼觉得咱俩合不合拍。'
    },
    {
      emoji: '💞',
      label: '关系解读',
      content: '天机说咱们这段可是{matchLevel}，还给起了个名叫「{relationshipName}」。\n说得煞有介事的，我半信半疑。\n要不咱俩聊两句，看看它到底有几分成色？'
    }
  ]
};

Page({
  onShow() {
    i18n.applyNavTitle('sub/match/letter-write/index');
    this.setData({ lang: i18n.getLang() });
    this.applyI18n();
  },
  data: {
    statusBarHeight: 20,
    receiverOpenid: '',
    receiverNickname: '',
    receiverIsVip: false,
    myNickname: '',
    content: '',
    charCount: 0,
    sending: false,
    loadingProfile: true,
    lunarToday: '',
    lunarDate: '',
    envelopeFlying: false,
    activeTemplate: -1,
    activeTopic: 0,
    // v1.4-1.5 话题模板：按话题族分组，动态注入真实数据（我的卦象 + 当前节气 + 匹配结果）
    topicGroups: [
      { id: 'personality', emoji: '☯' },
      { id: 'match', emoji: '💞' },
      { id: 'term', emoji: '🍃' },
      { id: 'divine', emoji: '🎲' },
      { id: 'heart', emoji: '💌' }
    ],
    topicTemplates: [],
    guaInfo: null,
    termInfo: null,
    matchInfo: null,
    loadingTopics: false,
    // v19.2 双语字典
    t: {}
  },

  // v19.2 加载 letter 模块双语字典
  applyI18n() {
    this.setData({ t: i18n.page('letter') });
    this.refreshI18nTopics();
  },

  _tTerm(key, mapName) {
    const jieqi = i18n.page('jieqi');
    const map = jieqi[mapName];
    if (map && map[key]) return map[key];
    return key;
  },

  _translateTermData(data) {
    if (!data) return data;
    const d = { ...data };
    d.name = this._tTerm(d.name, 'termMap');
    if (d.generalYi) {
      if (d.generalYi.food && d.generalYi.food.length) {
        d.generalYi.food = d.generalYi.food.map(f => this._tTerm(f, 'foodMap'));
      }
      if (d.generalYi.activity && d.generalYi.activity.length) {
        d.generalYi.activity = d.generalYi.activity.map(a => this._tTerm(a, 'activityMap'));
      }
    }
    return d;
  },

  // 国际化刷新：动态更新 topicGroups 和当前分组的 topicTemplates 的 label 和 content
  refreshI18nTopics() {
    const t = i18n.page('letter');
    if (!t) return;

    const groups = this.data.topicGroups.map(g => {
      const i18nGroup = Array.isArray(t.topicGroups) && t.topicGroups.find(tg => tg.id === g.id);
      return {
        ...g,
        label: (i18nGroup && i18nGroup.label) || g.label
      };
    });

    const group = groups[this.data.activeTopic];
    const rawTemplates = (group && TOPIC_TEMPLATES[group.id]) || [];

    const labelMap = {
      personality: ['myGua', 'historical'],
      term: ['seasonal'],
      divine: ['weird'],
      heart: ['midnight', 'thought'],
      match: ['ourFate', 'relation']
    };

    const keys = labelMap[group ? group.id : ''] || [];
    const templates = rawTemplates.map((tpl, idx) => {
      const labelKey = keys[idx];
      const label = (labelKey && t.templateLabels && t.templateLabels[labelKey]) || tpl.label;
      const content = (labelKey && t.templateContents && t.templateContents[labelKey]) || tpl.content;
      return { ...tpl, label, content };
    });

    this.setData({ topicGroups: groups, topicTemplates: templates });
  },

  onLoad(options) {
    soundManager.init();
    // v19.2 加载 letter 模块双语字典
    this.applyI18n();
    // 获取状态栏高度（自定义导航栏需要）
    let statusBarHeight = 20;
    try {
      statusBarHeight = wx.getWindowInfo().statusBarHeight || 20;
    } catch (e) {
      statusBarHeight = (wx.getSystemInfoSync() || {}).statusBarHeight || 20;
    }
    this.setData({ statusBarHeight: statusBarHeight });

    const receiverOpenid = options.receiverOpenid || '';
    const receiverNickname = decodeURIComponent(options.receiverNickname || i18n.page('common').appName);
    const receiverIsVip = options.receiverIsVip === '1' || options.receiverIsVip === 1 || options.receiverIsVip === true;
    const lunarToday = this.getLunarToday();
    this.setData({
      receiverOpenid: receiverOpenid,
      receiverNickname: receiverNickname,
      receiverIsVip: receiverIsVip,
      lunarToday: lunarToday,
      lunarDate: lunarToday
    });
    this.loadMyInfo();
    // v1.4 加载话题模板所需数据（我的卦象 + 当前节气）
    this.loadTopicData();
  },

  // 🔴 v3.4 修复：增加 onUnload 清理定时器
  onUnload() {
    this._unloaded = true;
    if (this._envelopeTimer) { clearTimeout(this._envelopeTimer); this._envelopeTimer = null; }
  },

  // v1.3.2 生成预置信件内容（称呼 + 空正文 + 落款）
  buildPresetContent(nickname) {
    const receiver = this.data.receiverNickname || i18n.page('common').appName;
    const signer = nickname || this.data.myNickname || i18n.page('common').appName;
    const lunar = this.data.lunarToday || '';
    const t = i18n.page('letter');
    const colon = i18n.isEn() ? ': ' : '：';
    return `${t.dear} ${receiver}${colon}\n\n\n${t.salutation}\n${signer} ${t.respectfully}\n${lunar}`;
  },

  // v1.3.2 应用模板时，保留称呼和落款，只替换中间正文
  buildTemplateContent(tplContent, nickname) {
    const receiver = this.data.receiverNickname || i18n.page('common').appName;
    const signer = nickname || this.data.myNickname || i18n.page('common').appName;
    const lunar = this.data.lunarToday || '';
    const t = i18n.page('letter');
    const colon = i18n.isEn() ? ': ' : '：';
    return `${t.dear} ${receiver}${colon}\n${tplContent}\n\n${t.salutation}\n${signer} ${t.respectfully}\n${lunar}`;
  },

  // v1.4 加载话题模板所需数据：当前节气 + 我的卦象；失败时占位符回退通用文案
  async loadTopicData() {
    // 1. 当前节气（v20：英文态直接请求后端权威英文，跳过前端字典）
    try {
      const termRes = await api.request('/api/solar-term/current' + LANG_QS(), 'GET');
      if (termRes && termRes.success && termRes.data) {
        this.setData({ termInfo: i18n.isEn() ? termRes.data : this._translateTermData(termRes.data) });
      }
    } catch (e) {
      console.error('[letter-write] 节气加载失败:', e);
    }

    // 2. 我的卦象（profile 的 ming_ben_gua → 卦详情）
    let guaId = '';
    try {
      if (app && app.globalData && app.globalData.profile) {
        guaId = app.globalData.profile.ming_ben_gua || '';
      }
      if (!guaId && app.globalData.openid) {
        const p = await api.request('/api/user/profile/' + encodeURIComponent(app.globalData.openid) + LANG_QS(), 'GET');
        if (p && p.success && p.data && p.data.ming_ben_gua) {
          guaId = p.data.ming_ben_gua;
        }
      }
      if (guaId) {
        const g = await api.request('/api/gua/' + guaId + LANG_QS(), 'GET');
        if (g && g.success && g.data) {
          this.setData({ guaInfo: g.data });
        }
      }
    } catch (e) {
      console.error('[letter-write] 卦象加载失败:', e);
    }

    // 3. 匹配结果（我的卦 vs 对方卦），取不到时回退通用文案
    this.loadMatchData();

    // 4. 初始化当前话题分组模板
    this.setTopicGroup(this.data.activeTopic);
  },

  // v1.5 加载匹配结果：我的卦 vs 对方卦（经对方 openid → profile 的 ming_ben_gua 定位）
  async loadMatchData() {
    try {
      // 我的卦 ID
      let myGuaId = 0;
      if (app && app.globalData && app.globalData.profile && app.globalData.profile.ming_ben_gua) {
        myGuaId = parseInt(app.globalData.profile.ming_ben_gua);
      }
      // 对方卦 ID（收信人 receiverOpenid → profile）
      const receiverOpenid = this.data.receiverOpenid;
      let otherGuaId = 0;
      if (receiverOpenid) {
        try {
          const p = await api.request('/api/user/profile/' + encodeURIComponent(receiverOpenid) + LANG_QS(), 'GET');
          if (p && p.success && p.data && p.data.ming_ben_gua) {
            otherGuaId = parseInt(p.data.ming_ben_gua);
          }
        } catch (e) { /* 忽略，拿不到对方卦则跳过匹配话题 */ }
      }
      if (!myGuaId || !otherGuaId) return;

      const rel = await api.request('/api/relationship/' + myGuaId + '/' + otherGuaId + LANG_QS(), 'GET');
      if (rel && rel.success && rel.data) {
        this.setData({ matchInfo: rel.data });
      }
    } catch (e) {
      console.error('[letter-write] 匹配结果加载失败:', e);
    }
  },

  // v1.4 切换话题分组
  setTopicGroup(groupIdx) {
    const group = this.data.topicGroups[groupIdx];
    const rawTemplates = (group && TOPIC_TEMPLATES[group.id]) || [];
    const t = i18n.page('letter');
    const labelMap = {
      personality: ['myGua', 'historical'],
      term: ['seasonal'],
      divine: ['weird'],
      heart: ['midnight', 'thought'],
      match: ['ourFate', 'relation']
    };
    const keys = labelMap[group ? group.id : ''] || [];
    const templates = rawTemplates.map((tpl, idx) => {
      const labelKey = keys[idx];
      const label = (labelKey && t.templateLabels && t.templateLabels[labelKey]) || tpl.label;
      const content = (labelKey && t.templateContents && t.templateContents[labelKey]) || tpl.content;
      return { ...tpl, label, content };
    });
    this.setData({ topicTemplates: templates, activeTopic: groupIdx });
  },

  // v1.4 点击话题分组标签
  onTopicTap(e) {
    soundManager.play('click');
    const idx = e.currentTarget.dataset.idx;
    if (idx === this.data.activeTopic) return;
    this.setTopicGroup(idx);
    this.setData({ activeTemplate: -1 });
  },

  // v1.4-1.5 用真实数据替换模板占位符；取不到的字段回退语言包中的通用文案（不报错）
  renderTemplate(content) {
    const gua = this.data.guaInfo || {};
    const term = this.data.termInfo || {};
    const mt = this.data.matchInfo || {};
    const ga = gua.growthAdvice || {};
    const lrw = gua.li_shi_ren_wu || {};
    const t = i18n.page('letter');
    const fb = t.templateFallbacks || {};
    const lrwName = (lrw.male && lrw.male[0]) || (lrw.female && lrw.female[0]) || fb.liShiRenWu || 'A historical figure';
    const food = (term.generalYi && term.generalYi.food) || [];
    const act = (term.generalYi && term.generalYi.activity) || [];
    return (content || '')
      .replace('{guaName}', gua.full_name || gua.name || fb.guaName || 'My Hexagram')
      .replace('{ziChaoBiaoQian}', gua.zi_chao_biao_qian || fb.ziChaoBiaoQian || 'Quite unique')
      .replace('{talent}', (ga.talent || fb.talent || 'Some talent').split('——')[0])
      .replace('{blindspot}', (ga.blindspot || fb.blindspot || 'A blind spot').split('——')[0])
      .replace('{liShiRenWu}', lrwName)
      .replace('{termName}', term.name || fb.termName || 'This solar term')
      .replace('{termAction}', act[0] || fb.termAction || 'Follow the season')
      .replace('{termFood}', food.slice(0, 2).join(i18n.isEn() ? ', ' : '、') || fb.termFood || 'Seasonal ingredients')
      .replace('{relationshipName}', mt.relationship_name || fb.relationshipName || 'Destiny brings us together')
      .replace('{matchLevel}', mt.match_level || fb.matchLevel || 'Wonderful')
      .replace('{oneLiner}', mt.one_liner || fb.oneLiner || 'Fate is hard to explain');
  },

  async loadMyInfo() {
    try {
      let myNickname = '';
      if (app && app.globalData && app.globalData.profile) {
        myNickname = app.globalData.profile.nickname || '';
      }
      if (!myNickname && app.globalData.openid) {
        const res = await api.request('/api/user/profile/' + encodeURIComponent(app.globalData.openid) + LANG_QS(), 'GET');
        if (res && res.success && res.data && res.data.nickname) {
          myNickname = res.data.nickname;
        }
      }
      this.setData({ myNickname: myNickname, loadingProfile: false });
      // v1.3.2 拿到昵称后，预置完整信件内容（称呼+空正文+落款）
      const preset = this.buildPresetContent(myNickname);
      this.setData({
        content: preset,
        charCount: preset.length
      });
    } catch (e) {
      console.error('[letter-write] loadMyInfo failed:', e);
      // 降级：即使拿不到昵称也预置
      const preset = this.buildPresetContent('');
      this.setData({
        content: preset,
        charCount: preset.length,
        loadingProfile: false
      });
      wx.showToast({ title: i18n.page('letter').toastNicknameFail, icon: 'none' });
    }
  },

  // 农历日期转换（优先使用 lunar-javascript 库，降级本地推算）
  getLunarToday() {
    try {
      const d = new Date();
      // v3.4.1 L23：英文态回退公历（中文农历不适配英文用户）
      if (i18n.isEn()) {
        return (d.getMonth() + 1) + '/' + d.getDate();
      }
      const lunarMonths = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
      const lunarDays = [
        '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
        '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
        '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
      ];
      // 尝试使用 lunar-javascript 库（若已引入）
      if (typeof require === 'function') {
        try {
          const lunar = require('lunar-javascript');
          if (lunar && lunar.Solar) {
            const lunarObj = lunar.Solar.fromDate(d).getLunar();
            return lunarObj.getMonthInChinese() + '月' + lunarObj.getDayInChinese();
          }
        } catch (e2) {}
      }
      // 降级：粗略推算（仅显示用）
      const m = d.getMonth();
      const day = d.getDate() - 1;
      return lunarMonths[m] + '月' + (lunarDays[day] || ((day + 1) + '日'));
    } catch (e) {
      const d = new Date();
      return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }
  },

  onInput(e) {
    this.setData({ content: e.detail.value, charCount: e.detail.value.length });
  },

  onBack() {
    soundManager.play('click');
    if (this.data.content && this.data.content.trim().length > 0) {
      wx.showModal({
        title: i18n.page('letter').modalBackTitle,
        content: i18n.page('letter').modalBackContent,
        confirmText: i18n.page('letter').modalBackLeave,
        cancelText: i18n.page('letter').modalBackKeep,
        confirmColor: '#C8A55B',
        success: (res) => {
          if (res.confirm) {
            router.safeNavigateBack(1, '/pages/my/index');
          }
        }
      });
    } else {
      router.safeNavigateBack(1, '/pages/my/index');
    }
  },

  onTemplateTap(e) {
    soundManager.play('click');
    const idx = e.currentTarget.dataset.idx;
    const tpl = this.data.topicTemplates[idx];
    if (!tpl) return;

    // 已选中同一模板 → 取消选中（保留内容供编辑）
    if (this.data.activeTemplate === idx) {
      this.setData({ activeTemplate: -1 });
      return;
    }

    const applyTemplate = () => {
      // v1.3.2 模板替换时保留称呼+落款框架，只替换中间正文
      // v1.4 先渲染占位符（注入真实数据），再套称呼落款
      const newContent = this.buildTemplateContent(this.renderTemplate(tpl.content));
      this.setData({
        content: newContent,
        charCount: newContent.length,
        activeTemplate: idx
      });
      wx.showToast({ title: i18n.fill(i18n.page('letter').toastTemplateApplied, {label: tpl.label}), icon: 'none', duration: 1200 });
    };

    // v1.3.2 判断是否是初始预置内容（仅含称呼+落款，无正文）
    const isPreset = () => {
      const c = (this.data.content || '').trim();
      const t = i18n.page('letter');
      if (!c.startsWith(t.dear)) return false;
      const parts = c.split(t.salutation);
      if (parts.length < 2) return false;
      const middle = parts[0].replace(/^[^：]*：/, '').trim();
      return middle.length === 0;
    };

    // 内容为空、或仅是初始预置框架（无正文）→ 直接填充
    if (!this.data.content || !this.data.content.trim() || isPreset()) {
      applyTemplate();
      return;
    }

    // 内容非空 → 弹窗确认替换
    wx.showModal({
      title: i18n.page('letter').modalSwitchTitle,
      content: i18n.fill(i18n.page('letter').modalSwitchContent, { label: tpl.label }),
      confirmText: i18n.page('letter').modalSwitchConfirm,
      cancelText: i18n.page('letter').modalSwitchCancel,
      confirmColor: '#C8A55B',
      success: (res) => {
        if (res.confirm) {
          applyTemplate();
        }
      }
    });
  },

  async onSend() {
    if (this.data.sending) return;
    const content = (this.data.content || '').trim();
    const receiverOpenid = this.data.receiverOpenid;
    if (content.length < 10) {
      soundManager.play('error');
      wx.showToast({ title: i18n.page('letter').toastContentTooShort, icon: 'none' });
      return;
    }
    if (!receiverOpenid) {
      wx.showToast({ title: i18n.page('letter').toastReceiverMissing, icon: 'none' });
      return;
    }
    this.setData({ sending: true });
    try {
      const res = await api.request('/api/letter/send', 'POST', {
        receiverOpenid: receiverOpenid,
        content: content
      });
      if (res && res.success) {
        soundManager.play('success');
        // v2.0 信封飞行动效
        this.setData({ envelopeFlying: true });
        wx.showToast({ title: i18n.page('letter').toastLetterSent, icon: 'success' });
        // 🔴 v3.4 修复：保存 timer 引用，onUnload 中清理，防止页面销毁后 setData/navigateBack 报错
        this._envelopeTimer = setTimeout(() => {
          if (this._unloaded) return;
          this.setData({ envelopeFlying: false });
          wx.navigateBack();
        }, 1500);
      } else {
        const msg = (res && res.message) || i18n.page('letter').toastSendFail;
        soundManager.play('error');
        wx.showToast({ title: msg, icon: 'none' });
        this.setData({ sending: false });
      }
    } catch (e) {
      soundManager.play('error');
      wx.showToast({ title: i18n.page('letter').toastNetworkFail, icon: 'none' });
      this.setData({ sending: false });
    }
  },

  onReport() {
    soundManager.play('click');
    const reportItems = i18n.page('letter').reportItems;
    wx.showActionSheet({
      itemList: reportItems,
      success: (res) => {
        const reason = reportItems[res.tapIndex] || i18n.page('letter').reportOther;
        this.submitReport(reason);
      },
      fail: () => {}
    });
  },

  async submitReport(reason) {
    try {
      await api.request('/api/letter/report', 'POST', {
        targetOpenid: this.data.receiverOpenid,
        reason: reason
      });
      wx.showToast({ title: i18n.page('letter').toastReportSubmitted, icon: 'success' });
    } catch (e) {
      wx.showToast({ title: i18n.page('letter').toastReportFail, icon: 'none' });
    }
  }
});
