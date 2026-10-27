/**
 * pages/index/index.js - 首页
 * 分享 + 处理来自匹配的分享入口
 */
const api = require('../../utils/api.js');
const storage = require('../../utils/storage.js');
const env = require('../../config/env.js');
const fontManager = require('../../utils/fonts.js');
const shareUtil = require('../../utils/share.js');
const i18n = require('../../utils/i18n.js'); // v19.1 双语

Page({
  data: {
    t: i18n.page('index'), // v19.1 页面文案字典（data 初始化，避免首帧空白）
    lang: i18n.getLang(),
    vipRemainingText: '',
    question: '',
    questionLength: 0,
    canDivine: true,
    isDivining: false,
    isCheckingQuota: false,
    hasProfile: false,
    quota: 3,
    points: 0, // v17.0 积分余额（普通推演10积分/次）
    showSuggestions: false,
    // 每次focus随机从200题库抽6题+12位置抽6位，组合数极大约等于无穷
    suggestions: [],
    suggestionPool: [
      // 日常纠结
      '晚上自己做饭还是点外卖？', '周末宅家还是出门社交？',
      '今天喝咖啡还是喝奶茶？', '该不该把购物车全清了？', '午休要不要睡一觉？',
      // 自我解剖
      '为什么总在最后一天才开始？', '我的精神状态适合什么卦象？',
      '测测我的班味有多浓？', '为什么总在深夜做离谱决定？',
      '为什么我总是不会拒绝别人？', '我的社交电池还剩几格？', '到底什么时候才能停止内耗？',
      // 人际关系
      '第一次约会聊什么不冷场？', '和好朋友冷战了怎么化解？',
      '为什么总被同类人吸引？', '过年怎么回答亲戚的灵魂拷问？', '为什么我总在帮别人收拾烂摊子？',
      // 脑洞大开
      '测测我适合养猫还是养狗？', '我的人生剧能打几分？',
      '测测你的摸鱼段位有多高？', '为什么周一总是来得这么快？',
      '我的松弛感是几分？', '如果我是一部电影会是什么类型？',
      // 人生决策
      '该不该接受这个offer？', '是时候换发型了吗？',
      '先存钱还是先享受？', '打工还是创业试试看？',
      '该不该换城市生活？', '今天该早起锻炼还是多睡一会？', '纠结要不要搬家的第N天',
      // 离谱脑洞
      '测测我今天的发疯指数有多高？', '测测我穿越到古代能活几集？',
      '如果把性格翻译成一道菜是什么？', '我的人生BGM是什么风格？',
      '如果我的性格是一部网文会是什么题材？', '测测我的冤种体质有多强？',
      '我的MBTI在古代等于什么官职？', '测测我的小红书人格是什么类型？',
      // 互联网生存
      '为什么crush总是不回我消息？', '为什么每次想早睡都失败？',
      '为什么我总在深夜冲动消费？', '为什么每次减肥都以反弹告终？',
      '打工三年了为什么还是月光？', '该回老家考公还是留在大城市卷？',
      '测测算法推荐把我当什么人了？', '测测我的职场人设有没有崩塌？',
      // 社交名场面
      '为什么每次自我介绍都像公开处刑？', '电梯里遇到半熟不熟的同事该聊什么？',
      '聚会到一半怎么优雅又不失礼貌地先走？', '为什么越长大越不会交朋友了？',
      // 当代数字生活
      '我的手机相册为什么存了一万张截图？', '微信收藏了八百条为什么从来不看？',
      '为什么花钱报了健身房一次都没去？', '为什么刷完短视频就开始后悔？',
      '断舍离为什么总是从买到扔再到买？', '二十多岁到底应该做什么才对？',
      // 玄学自嘲
      '测测我上辈子是不是欠了支付宝的？', '为什么每次洗车第二天就下雨？',
      '为什么排队时我选的队伍总是最慢的？', '测测我是不是天选打工人？',
      '为什么我走到哪里哪里就没信号？', '测测你的运气守恒定律是什么样的？',
      // 打工日常
      '测测我今天该摸鱼还是该努力？', '为什么每次快下班领导就来活了？',
      '钉钉消息一响心跳加速还有救吗？', '要不要做群里第一个回复收到的人？',
      '团建到底算不算变相加班？', '我的职场核心竞争力到底是什么？',
      // 饮食男女
      '为什么半夜的外卖比白天好吃十倍？', '减肥和吃火锅哪个更重要？',
      '奶茶三分糖算不算在养生？', '一个人吃饭是孤独还是自由？',
      '香菜到底能不能吃？', '要不要把所有做菜视频从收藏夹删掉？',
      // 消费主义
      '为什么花大钱不心疼小钱反而斤斤计较？', '双十一到底是在省钱还是在烧钱？',
      '为什么工资一到账就莫名其妙消失了？', '买贵的用很久还是买便宜的常换？',
      '购物车里的东西为什么永远清不完？',
      // 身体信号
      '为什么体检报告总像开盲盒一样刺激？', '不吃早饭到底对身体有多大影响？',
      '为什么我一运动就觉得自己快不行了？', '为什么熬夜一时爽第二天火葬场？',
      '每天三千步都走不到的我还有救吗？',
      // 童年回响
      '变成大人是不是一个巨大的骗局？', '如果十八岁的自己看到现在的我会说什么？',
      '长大后发现爸妈说的哪些话都是真的？', '童年没买到的玩具现在还想要吗？',
      '为什么小时候盼长大现在又想回到过去？', '你小时候最想成为的人现在还想成为吗？',
      // 睡眠宇宙
      '为什么凌晨三点总醒来思考人生？', '为什么闹钟响前十分钟睡得最香？',
      '为什么总是在梦里考试？', '失眠的夜晚该不该拿起手机？',
      '午睡半小时还是两小时这是一个问题？',
      // 情感纠葛
      '为什么明明很在意却装作无所谓？', '删掉一个人到底需要多大的勇气？',
      '为什么有些人对你越好你越想逃？', '前任的朋友圈要不要屏蔽？',
      '见面尴尬还是打字尴尬？',
      // 更多离谱脑洞
      '如果我的性格是一首歌会是什么调？', '测测我把什么情绪藏在了心里最深处？',
      '如果给我一天当隐形人我会去干什么？', '测测你现在最想听到的一句话是什么？',
      '如果把朋友圈翻译成真实的自己在说什么？',
      // 娱乐追更
      '追完一部好剧的空虚感该怎么填补？', '我磕的CP为什么总是be？',
      '该不该为了追一部剧开三个平台会员？',
      // 情感抉择
      '我应该向ta表白吗？', '我要诚实地告诉ta我的感受吗？',
      '我应该选择放弃ta吗？', '我要主动挽回ta吗？',
      '该不该再给ta一次机会？', '等一个不会有结果的人值得吗？',
      '该不该主动联系失联多年的ta？', 'ta说"做朋友吧"是真心的吗？',
      '我是不是该放下过去重新开始？', '异地恋还要继续坚持吗？',
      '我对ta是爱还是习惯？', '适合结婚和喜欢是一回事吗？',
      // 原生家庭
      '该不该跟父母坦白真实想法？', '父母的期望和我的梦想冲突怎么办？',
      '怎么开口跟父母说不想结婚？', '我是不是在用一生治愈童年？',
      '该不该原谅伤害过我的家人？', '离开家是为了逃避还是为了成长？',
      // 职场十字路口
      '该不该裸辞？', '工作三年还没找到方向正常吗？',
      '领导画的大饼要不要信？', '同事先升职了怎么调整心态？',
      '该不该为了稳定放弃喜欢的工作？', '30岁转行来得及吗？',
      '被裁员了是我的问题吗？', '该不该接受降薪去做想做的工作？',
      // 人生岔路
      '考研还是直接就业？', '回老家还是留在大城市？',
      '该不该为爱情放弃现在的生活？', '30岁还没存款正常吗？',
      '我是不是活成了自己讨厌的样子？', '该坚持一个看不到结果的事吗？',
      '选安稳还是选冒险？',
      // 自我审视
      '我是真的不行还是不够努力？', '为什么越努力越焦虑？',
      '我的自信是装出来的吗？', '为什么总觉得自己不够好？',
      '我是在成长还是在原地打转？', '什么样的生活才算成功？',
      '我是不是把别人的标准当成了自己的？',
      // 人际边界
      '该不该拒绝帮助过我的朋友？', '为什么越懂事的人越累？',
      '我是不是太在意别人的看法了？', '该不该和三观不合的朋友断联？',
      '怎么体面地退出一个圈子？', '帮别人是善良还是不会拒绝？',
      // 孤独哲学
      '一个人真的很可怕吗？', '为什么越热闹越觉得孤独？',
      '独处是享受还是逃避？', '没有朋友的人生算失败吗？',
      '我是在享受独处还是在自我封闭？',
      // 年龄焦虑
      '25岁还不知道自己想要什么正常吗？', '30岁还没结婚是不是有问题？',
      '35岁被裁员人生就完了吗？', '40岁重新开始还来得及吗？',
      '同龄人都比我成功是我太慢了吗？',
      // 选择与后悔
      '当初没选那条路会更好吗？', '后悔了还能回头吗？',
      '放弃梦想去赚钱值得吗？', '该为过去的选择后悔吗？',
      '如果重来一次我会做得更好吗？',
      // 情绪黑洞
      '为什么开心的时候反而会害怕？', '莫名其妙想哭是矫情吗？',
      '为什么总在深夜emo？', '我的焦虑是真实的还是想象的？',
      '什么时候该去看心理医生？', '为什么明明很累却睡不着？',
      // 成长阵痛
      '该不该和过去的自己和解？', '放下一个人需要多久？',
      '原谅别人是放过自己吗？', '我是在坚持还是在执念？',
      '什么时候该学会说不？', '接受平凡是认命还是成熟？',
      // 良知拷问
      '善意的谎言算不算欺骗？', '看到不公平的事该不该站出来？',
      '该不该为了合群改变自己？', '诚实和善良冲突时选哪个？',
      // 金钱观
      '钱是衡量成功的标准吗？', '该不该为了钱做不喜欢的事？',
      '花钱买快乐算不算浪费？', '攒钱和享受当下怎么平衡？',
      // 身体警报
      '该不该为了工作牺牲健康？', '身体在抗议我为什么还在硬撑？',
      '什么时候该停下来歇一歇？', '我是在生活还是在生存？',
      // 面对未知
      '面对不确定的未来，我的底气在哪里？', '该怎么面对充满不确定的人生？',
      '焦虑未来是不是在浪费现在？', '该不该为还没发生的事担心？',
      '如果明天是最后一天我会后悔吗？',
      // 教育与传承
      '该不该逼孩子走我走过的路？', '读书如何塑造了我的人生方向？',
      // === 年轻人热搜话题 ===
      '我该不该裸辞去旅居？', '社恐如何在这个世界生存？',
      '为什么我总是三分钟热度？', '我的MBTI和八字谁更准？',
      '测测我的恋爱脑有多严重？', '母单二十多年是我的问题吗？',
      '为什么每次想早睡都失败？', '测测我什么时候能财务自由？',
      '我的精神内耗什么时候能停？', '到底要不要买房？',
      '为什么我总在深夜emo？', '考研考公还是直接就业？',
      '我的副业潜力点在哪里？', '为什么越努力越焦虑？',
      '怎么才能停止过度思考？', '我该如何经营自己的贵人缘？',
      '为什么我总是吸引渣男/渣女？', '要不要和原生家庭和解？',
      '测测我适合自由职业还是上班？', '为什么朋友圈越刷越焦虑？',
      '我的拖延症还有救吗？', '为什么我总是讨好别人？',
      '测测我什么时候能遇到对的人？', '要不要换一个城市生活？',
      '为什么我总在花钱买快乐？', '测测我的松弛感有几分？',
      'AI会取代我的工作吗？', '为什么我不敢做真实的自己？',
      '测测我的社交电量还剩多少？', '要不要gap一年？',
      '我这辈子能赚到第一个一百万吗？', '到底要不要结婚？',
      '为什么我总羡慕别人的生活？', '测测我的情绪稳定指数',
      '怎么样才能不care别人的评价？', '我如何把偶然的好运变成常态？',
      '测测我更适合大城市还是小县城？', '要不要和最好的朋友绝交？',
      '我的报复性熬夜什么时候能结束？', '为什么总是在意已读不回？',
      '测测你的人生主题是什么？', '什么时候才能不焦虑地活着？',
      '为什么我总觉得自己不够好？', '怎么才能找到热爱的事业？',
      '测测你的隐藏天赋是什么？', '我该不该放弃稳定的工作？',
      '为什么越长大越难交到真朋友？', '我的吸引力特质是什么？',
      '我是不是把别人的标准当成了自己的？', '为什么总觉得时间不够用？',
      '测测你适合卷还是躺？', '为什么我总在深夜冲动消费？'
    ],
    positionPool: [
      { top: '18%', left: '5%',  delay: '0s',    duration: 2.6 },
      { top: '22%', left: '48%', delay: '0.1s',  duration: 3.0 },
      { top: '28%', left: '8%',  delay: '0.15s', duration: 2.8 },
      { top: '32%', left: '55%', delay: '0.25s', duration: 3.2 },
      { top: '38%', left: '4%',  delay: '0.05s', duration: 3.5 },
      { top: '42%', left: '52%', delay: '0.2s',  duration: 2.7 },
      { top: '48%', left: '10%', delay: '0.35s', duration: 3.1 },
      { top: '52%', left: '58%', delay: '0.3s',  duration: 2.9 },
      { top: '20%', left: '50%', delay: '0.4s',  duration: 3.3 },
      { top: '35%', left: '52%', delay: '0.45s', duration: 2.5 },
      { top: '45%', left: '6%',  delay: '0.5s',  duration: 3.4 },
      { top: '55%', left: '56%', delay: '0.55s', duration: 3.0 }
    ],
    mediaBase: env.MEDIA_BASE,
    // v16.14 推演等待动画：使用远程 URL（全屏覆盖层，video 层级不是问题）
    waitVideoSrc: env.MEDIA_BASE + '/tianji-click-wait.mp4',
    bgVideoFailed: false,
    animEnded: false,
    fromMatch: false,
    matchGuaId: 0,
    // 视频性能降级:低端设备不加载视频,使用静态海报
    showVideo: true,
    statusBarHeight: 20,
    // 推演等待体验: spinner(视频加载前) + computing(视频播完后)
    showWaitSpinner: false,
    showComputing: false,
    // 节气养生：用户卦格名
    guaGe: '',
    // v2.0 深度解读翻转入口
    divineMode: 'normal', // 'normal' | 'vip'
    vipDecodeStatus: 'locked', // 'available' | 'used' | 'locked'
    vipDecodeStatusText: '开通VIP解锁',
    vipDecodeRemaining: 0,
    // v4.0 翻牌动画状态：true时面板scaleX(0)收窄，切换内容后恢复
    flipping: false,
    // v4.1 首页内嵌VIP深度解读（原secret页合并）：'' | 'loading' | 'result' | 'error'
    vipState: '',
    vipSections: [],
    vipErrorMsg: '',
    vipRecordId: 0,
    vipShareQuestion: '',
    vipNickname: '',
    // 建档后自动继续VIP推演
    pendingVipQuestion: '',
    // 卦炉注入动效 — 68个奇门变量（八门·九星·八神·十天干·九宫·节气）
    vipVariables: (function() {
      // 8方向名（顺时针：右→右下→下→左下→左→左上→上→右上）
      var dirs = ['drift-right','drift-bottomright','drift-bottom','drift-bottomleft',
                  'drift-left','drift-topleft','drift-top','drift-topright'];
      var cx = 50, cy = 40; // 卦炉中心

      // 计算一个环上所有item的位置和延迟
      function ring(items, radius, startDelay, spacing) {
        var result = [];
        var n = items.length;
        for (var i = 0; i < n; i++) {
          var angle = i * 360 / n;
          var rad = angle * Math.PI / 180;
          var left = (cx + radius * Math.cos(rad)).toFixed(1) + '%';
          var top = (cy + radius * Math.sin(rad)).toFixed(1) + '%';
          var dirIdx = Math.round(angle / 45) % 8;
          var dir = dirs[dirIdx];
          var delay = (startDelay + i * spacing).toFixed(1) + 's';
          result.push({ name: items[i], left: left, top: top, dir: dir, delay: delay });
        }
        return result;
      }

      var vars = [];
      // 第1圈 八门（8个，0.7s间隔，0.0-4.9s）
      vars = vars.concat(ring(
        ['休门','生门','伤门','杜门','景门','死门','惊门','开门'],
        38, 0, 0.7
      ));
      // 第2圈 九星（9个，0.7s间隔，5.6-11.2s）
      vars = vars.concat(ring(
        ['天蓬','天任','天冲','天辅','天禽','天英','天芮','天柱','天心'],
        31, 5.6, 0.7
      ));
      // 第3圈 八神（8个，0.7s间隔，11.9-16.8s）
      vars = vars.concat(ring(
        ['值符','螣蛇','太阴','六合','白虎','玄武','九地','九天'],
        24, 11.9, 0.7
      ));
      // 第4圈 十天干（10个，0.6s间隔，17.5-22.9s）
      vars = vars.concat(ring(
        ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'],
        18, 17.5, 0.6
      ));
      // 第5圈 九宫（9个，0.6s间隔，23.5-28.3s）
      vars = vars.concat(ring(
        ['坎','坤','震','巽','中','乾','兑','艮','离'],
        12, 23.5, 0.6
      ));
      // 第6圈 节气（24个，0.5s间隔，28.9-40.4s）
      vars = vars.concat(ring(
        ['冬至','小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种',
         '夏至','小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪'],
        6, 28.9, 0.5
      ));
      return vars;
    })(),
    isMpWeixin: true
  },

  onLoad(options) {
    // 获取状态栏高度（自定义导航栏需要）
    // 🔴 v3.5 迁移：getWindowInfo 取代 getSystemInfoSync
    let statusBarHeight = 20;
    try {
      statusBarHeight = wx.getWindowInfo().statusBarHeight || 20;
    } catch (e) {
      statusBarHeight = (wx.getSystemInfoSync() || {}).statusBarHeight || 20;
    }
    this.setData({ statusBarHeight: statusBarHeight, isMpWeixin: getApp().globalData.isMpWeixin });

    // 设备性能检测：低端设备降级为静态海报
    this.checkDevicePerformance();
    
    this.checkLogin();
    
    // 处理来自易缘匹配分享的入口（URL参数传递）
    if (options.fromMatch === '1' && options.shareGua) {
      const guaId = parseInt(options.shareGua);
      if (guaId > 0) {
        this.setData({ fromMatch: true, matchGuaId: guaId });
        const app = getApp();
        app.globalData.pendingMatchGuaId = guaId;
        // [修复] 保存分享者的openid，建档后写记录时需要
        if (options.sharerOpenid) {
          app.globalData.pendingMatchOpenid = decodeURIComponent(options.sharerOpenid);
        }
        // [修复] 保存分享者的昵称，匹配结果页需要展示
        if (options.sharerNickname) {
          app.globalData.pendingMatchNickname = decodeURIComponent(options.sharerNickname);
        }
      }
    }
    
    // 处理建档完成后自动推演
    if (options.autoDivine === '1' && options.question) {
      this.data.fromAutoDivine = true;
      this.data.autoQuestion = decodeURIComponent(options.question);
    }

    // 处理节气分享入口：fromJieqi=1 时自动展开节气浮层
    if (options.fromJieqi === '1') {
      this.data.fromJieqi = true;
    }
    
    // 处理分享卡片入口（scene 参数）
    if (options.scene) {
      // 推演结果分享：scene=记录ID（纯数字）或随机 share_token（32位hex，[SEC-FIX] P1-2）
      const sceneVal = (options.scene || '').trim();
      if (/^\d+$/.test(sceneVal) || /^[a-f0-9]{32}$/i.test(sceneVal)) {
        this.data.fromScene = true;
        this.data.sceneRecordId = sceneVal;
      }
      // 易缘匹配分享：scene=match:短码
      else if (options.scene.indexOf('match:') === 0) {
        const shareId = options.scene.substring(6);
        if (shareId) {
          this.data.fromMatchScene = true;
          this.data.matchShareId = shareId;
        }
      }
    }
  },

  async onShow() {

    i18n.applyNavTitle('pages/index/index');
    const app = getApp();
    // v19.1 双语：刷新文案字典（语言可能在登录页被切换）
    const ti = i18n.page('index');
    this.setData({ t: ti, lang: i18n.getLang() });
    
    // v19.1 语言切换时刷新节气组件
    const jieqiBar = this.selectComponent('#jieqiBar');
    if (jieqiBar && jieqiBar.refreshI18n) {
      jieqiBar.refreshI18n();
    }
    
    if (app.globalData.loginPromise) {
      try { await app.globalData.loginPromise; } catch(e) { /* 登录失败也继续 */ }
    }

    // v2.3：首页 onShow 时检查字体加载状态，未加载则重试
    if (!fontManager.isFontLoaded()) {
      console.log('[onShow] 字体未加载完成，触发重试');
      fontManager.retryLoadFonts();
    }

    // 从后端拉取最新 profile（防止修改档案后数据未更新、跨天后 quota 未重置、购买VIP后状态未更新）
    if (app.globalData.openid) {
      try {
        const profileRes = await api.request('/api/user/profile/' + encodeURIComponent(app.globalData.openid), 'GET');
        if (profileRes.success && profileRes.data) {
          const d = profileRes.data;
          // 同步更新全局 profile（含 has_profile 验证）
          app.globalData.profile = d;
          app.globalData.hasProfile = !!(d && d.has_profile);
          const latestQuota = d.quota_remaining !== undefined ? d.quota_remaining : 3;
          const latestPlanType = d.plan_type || 'free';
          const latestPoints = d.points !== undefined ? d.points : 0;
          app.globalData.quota = latestQuota;
          app.globalData.planType = latestPlanType;
          app.globalData.points = latestPoints;
          this.setData({ quota: latestQuota, points: latestPoints, hasProfile: app.globalData.hasProfile, guaGe: d.gua_ge || '' });

          // v2.0 刷新深度解读（VIP）状态（统一读取 vipDecodeRemaining 驼峰字段；v17.0 加入签到奖励的额外次数）
          app.globalData.extraVipDecode = d.extraVipDecode || 0;
          this.refreshVipDecodeStatus(latestPlanType, d.vipDecodeRemaining, d.extraVipDecode);
        }
      } catch(e) {
        console.error('[profile] fetch failed:', e);
      }
    } else {
      console.log('[onShow] openid为空，跳过profile拉取');
    }
    
    // 重置推演状态（从结果页/建档页返回时恢复初始状态）
    this.setData({ isDivining: false, isCheckingQuota: false, animEnded: false, showWaitSpinner: false, showComputing: false });
    if (this._errorTimer) { clearTimeout(this._errorTimer); this._errorTimer = null; }

    // 启动推荐问题逐秒浮现（每次进入首页都重新开始）
    this.startRevealSequence();

    // v4.1 建档完成后自动继续VIP推演（场景B：首页VIP模式→建档→回来自动VIP推演）
    if (this.data.pendingVipQuestion) {
      var vipQ = this.data.pendingVipQuestion;
      this.data.pendingVipQuestion = '';
      if (app.globalData.hasProfile) {
        this.startVipDivine(vipQ);
        return;
      }
    }

    // 处理建档完成后自动推演（场景A：首页输入问题→建档→回来自动推演）
    if (this.data.fromAutoDivine) {
      this.data.fromAutoDivine = false;
      this.autoDivine();
      return;
    }

    // 处理推演结果分享卡片入口（scene 参数）
    if (this.data.fromScene) {
      this.data.fromScene = false;
      var sceneKey = this.data.sceneRecordId;
      var shareParam = /^[a-f0-9]{32}$/i.test(String(sceneKey)) ? ('share=' + sceneKey) : ('id=' + sceneKey);
      wx.redirectTo({ url: '/pages/result/index?' + shareParam + '&shared=1' });
      return;
    }

    // 处理易缘匹配分享入口（scene=match:短码）
    if (this.data.fromMatchScene) {
      this.data.fromMatchScene = false;
      const shareId = this.data.matchShareId;
      this.data.matchShareId = '';
      // 解析短码获取分享者信息
      try {
        const resolveRes = await api.request('/api/share/resolve/' + shareId, 'GET');
        if (resolveRes.success && resolveRes.data) {
          const sharerGuaId = resolveRes.data.sharerGuaId;
          const sharerOpenid = resolveRes.data.sharerOpenid;
          const sharerNickname = resolveRes.data.sharerNickname || '';
          if (app.globalData.hasProfile) {
            const myGuaId = app.globalData.profile.ming_ben_gua;
            var matchUrl = '/sub/match/match/index?sharerGuaId=' + sharerGuaId + '&myGuaId=' + myGuaId;
            if (sharerOpenid) matchUrl += '&sharerOpenid=' + encodeURIComponent(sharerOpenid);
            if (sharerNickname) {
              // 通过 globalData 传昵称，避免 URL 编码导致中文乱码
              app.globalData._matchSharerNickname = sharerNickname;
            }
            wx.redirectTo({ url: matchUrl });
          } else {
            // 没建档，先存起来，建档后回来处理
            app.globalData.pendingMatchGuaId = sharerGuaId;
            app.globalData.pendingMatchOpenid = sharerOpenid;
            app.globalData.pendingMatchNickname = sharerNickname;
            wx.showModal({
              title: ti.mMatchTitle,
              content: ti.mMatchContent,
              confirmText: ti.mGoProfile,
              cancelText: ti.mLater,
              success: (res) => {
                if (res.confirm) {
                  wx.navigateTo({ url: '/pages/profile/index?fromMatch=1' });
                }
              }
            });
          }
        }
      } catch (e) {
        console.error('[match scene] resolve error:', e);
      }
      return;
    }

    // 如果有待处理的匹配分享
    if (app.globalData.pendingMatchGuaId) {
      if (app.globalData.hasProfile) {
        const myGuaId = app.globalData.profile.ming_ben_gua;
        const sharerGuaId = app.globalData.pendingMatchGuaId;
        const sharerOpenid = app.globalData.pendingMatchOpenid || '';
        app.globalData.pendingMatchGuaId = 0;
        app.globalData.pendingMatchOpenid = '';
        var matchUrl = '/sub/match/match/index?sharerGuaId=' + sharerGuaId + '&myGuaId=' + myGuaId;
        if (sharerOpenid) matchUrl += '&sharerOpenid=' + encodeURIComponent(sharerOpenid);
        var sharerNickname = app.globalData.pendingMatchNickname || '';
        // 通过 globalData 传昵称，避免 URL 编码导致中文乱码
        app.globalData._matchSharerNickname = sharerNickname;
        app.globalData.pendingMatchNickname = '';
        wx.redirectTo({ url: matchUrl });
      } else {
        wx.showModal({
          title: ti.mMatchTitle,
          content: ti.mMatchContent,
          confirmText: ti.mGoProfile,
          cancelText: ti.mLater,
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/profile/index?fromMatch=1' });
            }
          }
        });
      }
    }

    // 处理节气分享入口：自动展开节气浮层（需等jieqi-bar组件attached并加载完节气数据）
    if (this.data.fromJieqi) {
      this.data.fromJieqi = false;
      this._openJieqiOverlay();
    }
  },

  onHide() {
    // 🔴 v3.4 修复：清理所有定时器，避免页面隐藏后仍触发 setData
    if (this._revealTimer) { clearInterval(this._revealTimer); this._revealTimer = null; }
    if (this._errorTimer) { clearTimeout(this._errorTimer); this._errorTimer = null; }
    if (this._blurTimer) { clearTimeout(this._blurTimer); this._blurTimer = null; }
  },

  // 节气浮层自动展开（带重试，等待组件加载完节气数据）
  _openJieqiOverlay() {
    let retry = 0;
    const tryOpen = () => {
      const jieqiBar = this.selectComponent('#jieqiBar');
      if (jieqiBar && jieqiBar.data.termData) {
        jieqiBar.openOverlay();
      } else if (retry < 10) {
        retry++;
        setTimeout(tryOpen, 300);
      }
    };
    tryOpen();
  },

  checkLogin() {
    const app = getApp();
    if (!app.globalData.openid) {
      // 🔴 修复：tryLogin是async，需catch防止unhandled rejection
      app.tryLogin(app.globalData.token || '').catch(e => console.error('[checkLogin] tryLogin失败:', e));
    }
  },

  refreshUserState() {
    const app = getApp();
    this.setData({ hasProfile: app.globalData.hasProfile || false, quota: app.globalData.quota !== undefined ? app.globalData.quota : 3 });
  },

  onQuestionInput(e) {
    const val = e.detail.value;
    this.setData({ question: val, questionLength: val.length, canDivine: true });
    if (this.data.showSuggestions && val.trim()) {
      this.setData({ showSuggestions: false });
    }
  },

  pickRandomSuggestions(sequential) {
    // v19.1 双语：英文态使用英文题库
    var enPool = i18n.page('index').suggestions;
    var pool = (i18n.isEn() && enPool && enPool.length ? enPool : this.data.suggestionPool).slice();
    var pos = this.data.positionPool.slice();
    var i, j, tmp;
    // Fisher-Yates shuffle both arrays independently
    for (i = pool.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    for (i = pos.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      tmp = pos[i]; pos[i] = pos[j]; pos[j] = tmp;
    }
    var selected = [];
    for (i = 0; i < 6; i++) {
      selected.push({
        text: pool[i],
        top: pos[i].top,
        left: pos[i].left,
        delay: sequential ? (i + 's') : pos[i].delay,
        duration: pos[i].duration
      });
    }
    this.setData({ suggestions: selected });
  },

  // 逐秒浮现：从0开始，每秒露出一个气泡
  startRevealSequence() {
    // 清除之前的定时器
    if (this._revealTimer) { clearInterval(this._revealTimer); this._revealTimer = null; }
    // 先清空，再逐个添加
    this.setData({ suggestions: [], showSuggestions: true });
    // v19.1 双语：英文态使用英文题库
    var enPool = i18n.page('index').suggestions;
    var pool = (i18n.isEn() && enPool && enPool.length ? enPool : this.data.suggestionPool).slice();
    var pos = this.data.positionPool.slice();
    var i, j, tmp;
    for (i = pool.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    for (i = pos.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      tmp = pos[i]; pos[i] = pos[j]; pos[j] = tmp;
    }
    var step = 0;
    var self = this;
    this._revealTimer = setInterval(function() {
      if (step >= 6) {
        clearInterval(self._revealTimer);
        self._revealTimer = null;
        return;
      }
      var current = self.data.suggestions.slice();
      current.push({
        text: pool[step],
        top: pos[step].top,
        left: pos[step].left,
        delay: '0s',
        duration: pos[step].duration
      });
      self.setData({ suggestions: current });
      step++;
    }, 1000);
  },

  onInputFocus() {
    if (this._blurTimer) { clearTimeout(this._blurTimer); this._blurTimer = null; }
    // 清除逐秒浮现定时器，直接换一批
    if (this._revealTimer) { clearInterval(this._revealTimer); this._revealTimer = null; }
    this.pickRandomSuggestions();
    this.setData({ showSuggestions: true });
  },

  onInputBlur() {
    // 气泡始终可见，不再关闭
  },

  onTapSuggestion(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    // 清除blur timer（气泡已被选中，不需要延迟关闭）
    if (this._blurTimer) { clearTimeout(this._blurTimer); this._blurTimer = null; }
    this.setData({ question: text, questionLength: text.length, canDivine: true, showSuggestions: false });
  },

  // v2.0 刷新深度解读（VIP）状态；v17.0 加入签到奖励的额外次数（非VIP也可用）；v19.1 双语文案
  refreshVipDecodeStatus: function(planType, vipDecodeRemaining, extraVipDecode) {
    var t = i18n.page('index');
    var status = 'locked';
    var text = t.stLocked;
    var isVip = planType && planType !== 'free';
    var daily = isVip ? ((vipDecodeRemaining !== undefined) ? vipDecodeRemaining : 1) : 0;
    var extra = extraVipDecode || 0;
    var remaining = daily + extra;
    if (remaining > 0) {
      status = 'available';
      text = extra > 0 && !isVip ? i18n.fill(t.stBonus, { n: extra }) : i18n.fill(t.stRemain, { n: remaining });
    } else if (isVip) {
      status = 'used';
      text = t.stUsed;
    } else {
      status = 'locked';
      text = t.stCheckin;
    }
    this.setData({
      vipDecodeStatus: status,
      vipDecodeStatusText: text,
      vipDecodeRemaining: remaining,
      vipRemainingText: i18n.fill(t.remainingTimes, { n: remaining })
    });
  },

  // v4.0 翻牌切换推演模式：scaleX收窄→切换内容→展开
  onFlipDivineMode: function() {
    getApp().playSound('click');
    // 防止动画过程中重复点击
    if (this.data.flipping) return;
    var newMode = this.data.divineMode === 'normal' ? 'vip' : 'normal';
    // 阶段1：面板收窄（scaleX 1→0，300ms）
    this.setData({ flipping: true });
    // 阶段2：收窄完成后切换内容，并恢复展开（scaleX 0→1，300ms）
    setTimeout(() => {
      this.setData({ divineMode: newMode, flipping: false });
    }, 300);
  },

  // v2.0 点击深度解读按钮（v4.1 改为首页内嵌推演，不再跳转secret页）
  onTapVipDivine: function() {
    getApp().playSound('button-tap');
    var t = i18n.page('index');
    var status = this.data.vipDecodeStatus;
    if (status === 'locked') {
      // 非VIP且无签到奖励次数：引导开通会员或坚持签到
      wx.showModal({
        title: t.mDeepTitle,
        content: t.mDeepContent,
        confirmText: t.mGoVip,
        cancelText: t.mKeepCheckin,
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/sub/vip/vip/index' });
          } else {
            wx.switchTab({ url: '/pages/my/index' });
          }
        }
      });
      return;
    }
    if (status === 'used') {
      wx.showToast({ title: t.toastDeepUsed, icon: 'none' });
      return;
    }
    // VIP或有签到奖励次数：校验问题、档案后直接在首页开始深度解读
    if (!this.data.question.trim()) {
      wx.showToast({ title: t.toastQuestionFirst, icon: 'none' });
      return;
    }
    const app = getApp();
    if (!app.globalData.hasProfile) {
      this.data.pendingVipQuestion = this.data.question.trim();
      wx.navigateTo({ url: '/pages/profile/index' });
      return;
    }
    this.startVipDivine(this.data.question.trim());
  },

  // v4.1 首页内嵌VIP深度解读（原secret页 onSubmit 逻辑合并）
  async startVipDivine(question) {
    const app = getApp();
    const t = i18n.page('index');
    if (!question) {
      wx.showToast({ title: t.toastEnterQuestion, icon: 'none' });
      return;
    }
    if (question.length > 200) {
      wx.showToast({ title: t.toastQuestionLong, icon: 'none' });
      return;
    }
    // v17.0 超级推演不消耗积分（VIP每日1次或签到奖励次数）；本地次数未同步时不拦截VIP用户
    if (this.data.vipDecodeRemaining <= 0 && app.globalData.planType === 'free') {
      wx.showModal({
        title: t.mNoDeepTitle,
        content: t.mNoDeepContent,
        confirmText: t.mGoCheckin,
        cancelText: t.mLater,
        success: (res) => {
          if (res.confirm) wx.switchTab({ url: '/pages/my/index' });
        }
      });
      return;
    }

    const vipNickname = (app.globalData.profile && app.globalData.profile.nickname) || '';
    this.setData({
      vipState: 'loading',
      vipSections: [],
      vipErrorMsg: '',
      vipRecordId: 0,
      vipShareQuestion: question,
      vipNickname: vipNickname
    });

    try {
      // v19.1 双语：携带 lang，后端据此输出英文解读
      const res = await api.requestWithAuth('/api/tuiyan/vip', 'POST', { question, lang: i18n.getLang() });
      if (res.success && res.data && res.data.vip_decode_text) {
        // 扣减本地深度解读剩余（服务端已扣减：优先签到奖励次数，其次VIP每日次数）
        const newRemaining = Math.max(0, (this.data.vipDecodeRemaining || 0) - 1);
        app.globalData.vipDecodeRemaining = newRemaining;
        this.refreshVipDecodeStatus(app.globalData.planType, Math.max(0, newRemaining - (app.globalData.extraVipDecode || 0)), app.globalData.extraVipDecode);
        const sections = this.parseVipSections(res.data.vip_decode_text);
        this.setData({
          vipState: 'result',
          vipSections: sections,
          vipRecordId: res.data.id || 0,
          vipShareQuestion: question
        });
      } else {
        var err = new Error(res.message || t.toastDivineFail);
        err.code = res.code; // 传播服务端错误码，保证catch中e.code可用
        throw err;
      }
    } catch (e) {
      let errMsg = i18n.t('networkError');
      if (e.message) {
        if (e.code === 'QUOTA_EXCEEDED' || e.code === 'VIP_DECODE_EXCEEDED' || e.message.indexOf('已用完') > -1) {
          errMsg = t.errQuota;
        } else if (e.code === 'VIP_DECODE_NO_QUOTA') {
          errMsg = t.mNoDeepContent;
        } else if (e.code === 'FORBIDDEN' || e.code === 'VIP_ONLY' || e.message.indexOf('VIP') > -1) {
          errMsg = t.errVipOnly;
        } else {
          errMsg = e.message;
        }
      }
      this.setData({ vipState: 'error', vipErrorMsg: errMsg });
    }
  },

  parseVipSections(text) {
    // v19.1 双语：AI 英文输出使用英文分节标题（与后端 enSuffixVip 约定一致）
    const zhNames = ['命盘底色', '天时坐标', '星门合参', '局势剖析', '行动指南', '易经箴言'];
    const enNames = ['Destiny Blueprint', 'Celestial Timing', 'Star & Gate Synthesis', 'Situation Analysis', 'Action Guide', 'I Ching Wisdom'];
    const t = i18n.page('index');
    const sectionNames = i18n.isEn() ? enNames : zhNames;
    // AI 输出使用 Markdown 粗体标题 **命盘底色**，按实际标题分割
    const titlePatterns = sectionNames.map(n => '\\*\\*' + n + '\\*\\*');
    const splitRe = new RegExp(titlePatterns.join('|'));
    const parts = text.split(splitRe);
    const sections = [];
    for (let i = 1; i < parts.length && i <= 6; i++) {
      sections.push({
        title: sectionNames[i - 1],
        content: parts[i].trim(),
        visible: false
      });
    }
    if (sections.length === 0) {
      sections.push({ title: t.fallbackSection, content: text, visible: false });
    }
    return sections;
  },

  // v4.1 折叠区切换：点击标题展开/收起对应段
  toggleVipSection: function(e) {
    var idx = e.currentTarget.dataset.idx;
    if (idx === undefined || idx === null) return;
    idx = parseInt(idx, 10);
    var sections = this.data.vipSections;
    if (!sections[idx]) return;
    var key = 'vipSections[' + idx + '].visible';
    var patch = {};
    patch[key] = !sections[idx].visible;
    this.setData(patch);
  },

  onVipRetry() {
    // 刷新全局quota状态
    const app = getApp();
    const quota = app.globalData.quota !== undefined ? app.globalData.quota : 0;
    const vipDecodeRemaining = app.globalData.vipDecodeRemaining !== undefined ? app.globalData.vipDecodeRemaining : 0;
    this.setData({ vipState: '', vipSections: [], vipErrorMsg: '', quota, vipDecodeRemaining });
  },

  onVipClose() {
    this.setData({ vipState: '', vipSections: [], vipErrorMsg: '', vipRecordId: 0, vipShareQuestion: '' });
  },

  async onTapDivine() {
    getApp().playSound('button-tap');
    const t = i18n.page('index');
    const now = Date.now();
    const lastTime = storage.get('lastDivineTime') || 0;
    if (now - lastTime < 3000) { wx.showToast({ title: t.toastWait, icon: 'none' }); return; }
    if (!this.data.question.trim()) { wx.showToast({ title: t.toastQuestionFirst, icon: 'none' }); return; }

    const app = getApp();
    if (!app.globalData.hasProfile) {
      storage.set('pendingQuestion', this.data.question);
      wx.navigateTo({ url: '/pages/profile/index' });
      return;
    }
    // v17.0 计费：免费用户扣10积分（不足引导签到/看视频）；VIP 会员走每日次数制（次数由后端校验，不做前置积分拦截）
    const isVip = (app.globalData.planType || '') !== 'free';
    if (!isVip && (app.globalData.points || 0) < 10) {
      this.showPointsInsufficientModal();
      return;
    }

    this.setData({ isDivining: true, isCheckingQuota: false, animEnded: false, showWaitSpinner: true, showComputing: false });
    storage.set('lastDivineTime', now);

    try {
      // v19.1 双语：携带 lang，后端据此输出英文推演结果
      const result = await api.requestWithAuth('/api/tuiyan', 'POST', { question: this.data.question, lang: i18n.getLang() });
      if (result.success && result.data) {
        // v17.0 计费后：免费用户刷新积分余额，VIP 用户刷新普通推演剩余次数
        if (result.data.points_remaining != null) {
          app.globalData.points = result.data.points_remaining;
          this.setData({ points: result.data.points_remaining });
        }
        if (result.data.quota_remaining != null) {
          app.globalData.quota = result.data.quota_remaining;
          this.setData({ quota: result.data.quota_remaining });
        }
        app.globalData.lastRecordId = result.data.id;
        await this.waitForAnimation();
        wx.navigateTo({ url: '/pages/result/index?id=' + result.data.id });
      } else throw new Error(result.message || t.toastDivineFail);
    } catch (e) {
      await this.waitForAnimation();
      getApp().playSound('error');
      // 清理定时器、重置状态，确保用户可以重试
      if (this._errorTimer) { clearTimeout(this._errorTimer); this._errorTimer = null; }
      this.setData({ isDivining: false });
      // v17.0 积分不足：引导签到/看广告
      if (e.code === 'POINTS_INSUFFICIENT' || (e.message || '').indexOf('积分不足') > -1) {
        this.showPointsInsufficientModal();
      } else if (e.code === 'VIP_QUOTA_EXCEEDED' || (e.message || '').indexOf('次数已用完') > -1) {
        wx.showModal({ title: t.mQuotaTitle, content: t.mQuotaContent, showCancel: false });
        return;
      }
      const msg = e.message === t.toastDivineFail ? t.toastSignal : e.message;
      wx.showModal({ title: t.toastDivineFail, content: msg, showCancel: false, confirmText: i18n.t('ok') });
    }
  },

  waitForAnimation() {
    return new Promise((resolve) => {
      var safetyTimer = setTimeout(resolve, 4000);
      const check = () => {
        if (this.data.animEnded) { clearTimeout(safetyTimer); resolve(); }
        else setTimeout(check, 100);
      };
      check();
    });
  },

  onWaitVideoPlay() { this.setData({ showWaitSpinner: false }); },
  onWaitVideoEnded() { this.setData({ animEnded: true, showComputing: true }); },
  onWaitVideoError() {
    // 视频加载失败：隐藏spinner，显示poster海报（video的poster属性自动兜底）
    this.setData({ showWaitSpinner: false });
    // 5秒后过渡到计算中等待页
    if (this._errorTimer) clearTimeout(this._errorTimer);
    this._errorTimer = setTimeout(() => {
      this._errorTimer = null;
      this.setData({ showComputing: true, animEnded: true });
    }, 5000);
  },

  /**
   * 设备性能检测 - 低端设备不加载视频背景
   * 策略:iOS 8GB+ 内存 / 安卓 6GB+ 内存 → 播放视频;否则用海报
   * v15.3.4 修复：开发者工具下无法获取 memorySize，导致误判为低端设备不显示视频
   *           改为：检测失败时默认显示视频（让 poster 兜底加载失败），而非保守隐藏
   */
  checkDevicePerformance() {
    try {
      let showVideo = true;
      // 🔴 v3.5 迁移：getDeviceInfo 取 memorySize，getAppBaseInfo 取 SDKVersion
      // 老接口 getSystemSetting 不含 memorySize；统一兼容回退到 getSystemInfoSync
      let memMB = 0, SDKVersion = '';
      try {
        const devInfo = wx.getDeviceInfo();
        memMB = devInfo.memorySize ? parseInt(devInfo.memorySize) : 0;
      } catch (e2) {}
      try {
        const baseInfo = wx.getAppBaseInfo();
        SDKVersion = baseInfo.SDKVersion || '';
      } catch (e3) {}
      if (!memMB && !SDKVersion) {
        try {
          const sysInfo = wx.getSystemInfoSync();
          memMB = sysInfo.memorySize ? parseInt(sysInfo.memorySize) : 0;
          SDKVersion = sysInfo.SDKVersion || '';
        } catch (e4) {
          // v15.3.4：getSystemInfoSync 也失败（开发者工具某些版本）
          // 不再保守隐藏视频，改为默认显示，让 poster 兜底
          console.warn('[checkDevicePerformance] 系统信息获取失败，默认显示视频');
          this.setData({ showVideo: true });
          return;
        }
      }
      // 内存 < 4GB 的设备降级为静态海报
      if (memMB > 0 && memMB < 4096) {
        showVideo = false;
      }
      // 备用方案:基础库版本 < 2.25.0 的设备也不加载视频
      const libVer = (SDKVersion || '2.0.0').split('.');
      if (parseInt(libVer[0]) < 2 || (parseInt(libVer[0]) === 2 && parseInt(libVer[1]) < 25)) {
        showVideo = false;
      }
      this.setData({ showVideo });
    } catch (e) {
      // v15.3.4：检测失败时默认显示视频（让 poster 兜底），避免开发者工具和异常环境下背景全黑
      console.warn('[checkDevicePerformance] 检测异常，默认显示视频:', (e && e.message) || e);
      this.setData({ showVideo: true });
    }
  },

  goToMy() { getApp().playSound('click'); wx.switchTab({ url: '/pages/my/index' }); },
  // 背景视频加载失败：隐藏video组件，让下层静态海报透出（防止原生播放器黑屏遮挡整页）
  onVideoError() {
    console.warn('[index] 背景视频加载失败，降级为静态海报');
    this.setData({ bgVideoFailed: true });
  },

  /**
   * v18.19 同层渲染失败降级（官方推荐方案，见原生组件文档 bindrendererror）
   * 触发场景：App端 xweb 内核未就绪（全新安装/卸载重装后首次冷启动）、
   *          iOS 页面节点树不稳定等。此时 video 退化为原生组件层级最高，
   *          会盖住节气条/气泡/玉璧/输入框/按钮，必须卸载 video 保页面可用。
   * 内核就绪后（下次冷启动）video 正常同层渲染，自动恢复视频背景。
   */
  onVideoRenderError(e) {
    console.warn('[index] 背景视频同层渲染失败，降级为静态海报:', (e && e.detail && e.detail.errMsg) || e);
    this.setData({ bgVideoFailed: true });
  },

  /**
   * 自动推演（建档完成后的场景A）
   */
  autoDivine() {
    const question = this.data.autoQuestion || '';
    if (!question) return;
    delete this.data.autoQuestion;
    this.setData({ question, questionLength: question.length });
    // 等一小下确保 hasProfile 已更新
    setTimeout(() => {
      this.onTapDivine();
    }, 500);
  },

  /**
   * 额度耗尽弹窗：引导开通易学会员
   */
  // v17.0 积分不足引导：看广告+10 / 去签到+10 / 开通会员
  showPointsInsufficientModal() {
    const app = getApp();
    const t = i18n.page('index');
    const isMp = app.globalData.isMpWeixin && wx.createRewardedVideoAd;
    wx.showModal({
      title: t.mPointsTitle,
      content: t.mPointsContent,
      confirmText: isMp ? t.mWatchAd : t.mGoCheckin,
      cancelText: t.mGoCheckin,
      success: (res) => {
        if (res.confirm) {
          if (isMp) {
            this.watchAdForPoints();
          } else {
            wx.switchTab({ url: '/pages/my/index' });
          }
        } else {
          wx.switchTab({ url: '/pages/my/index' });
        }
      }
    });
  },

  // v17.0 首页看激励视频得积分
  watchAdForPoints() {
    const app = getApp();
    const t = i18n.page('index');
    const rewardAd = require('../../utils/rewardAd.js');
    rewardAd.showAndReward(async () => {
      try {
        const res = await api.requestWithAuth('/api/points/ad-reward', 'POST', {});
        if (res.success) {
          app.globalData.points = res.data.points;
          this.setData({ points: res.data.points });
          wx.showToast({ title: t.toastPoints10, icon: 'success' });
        } else {
          wx.showToast({ title: res.message || t.toastClaimFail, icon: 'none' });
        }
      } catch (e) {
        wx.showToast({ title: e.message || t.toastClaimFail, icon: 'none' });
      }
    });
  },

  /**
   * 微信分享 - 首页
   * v4.1 若处于VIP深度解读结果态，分享深度解读内容
   */
  onShareAppMessage() {
    const t = i18n.page('index');
    // v4.1 VIP深度解读结果分享
    if (this.data.vipState === 'result' && this.data.vipRecordId) {
      return {
        title: t.shareDeep + (this.data.vipShareQuestion || t.deepTitle),
        path: '/pages/index/index?scene=' + this.data.vipRecordId,
        imageUrl: ''
      };
    }
    // 若节气浮层处于展开状态，分享带参数path，接收者点开后自动展开节气浮层
    const jieqiBar = this.selectComponent('#jieqiBar');
    const fromJieqi = (jieqiBar && jieqiBar.data.overlayVisible) ? '?fromJieqi=1' : '';
    const title = fromJieqi
      ? `${jieqiBar.data.termData ? jieqiBar.data.termData.name : t.jieqiDefault}${t.shareJieqiSuffix}`
      : t.shareTitle;
    return {
      title: title,
      path: `/pages/index/index${fromJieqi}`,
      imageUrl: ''
    };
  },

  // 🔴 v3.5 新增：分享到朋友圈
  onShareTimeline() {
    const t = i18n.page('index');
    const jieqiBar = this.selectComponent('#jieqiBar');
    const fromJieqi = (jieqiBar && jieqiBar.data.overlayVisible) ? 'fromJieqi=1' : '';
    const title = fromJieqi
      ? `${jieqiBar.data.termData ? jieqiBar.data.termData.name : t.jieqiDefault}${t.shareJieqiSuffix}`
      : t.shareTitle;
    return {
      title: title,
      query: fromJieqi,
      imageUrl: ''
    };
  },

  // APP端分享按钮点击：分享 H5 官网链接（替代小程序卡片）
  onShareTap() {
    const shareInfo = this.onShareAppMessage();
    shareUtil.shareWebPageMessage({
      webpageUrl: shareUtil.H5_WEB_BASE,
      title: shareInfo.title,
      description: shareInfo.description || ''
    });
  },

  // 节气养生条分享按钮点击（APP端）
  onJieqiShare() {
    const jieqiBar = this.selectComponent('#jieqiBar');
    const termData = jieqiBar && jieqiBar.data.termData;
    const t = i18n.page('index');
    const termName = termData ? termData.name : t.jieqiDefault;
    const title = termName + t.shareJieqiSuffix;

    shareUtil.shareWebPageMessage({
      webpageUrl: shareUtil.H5_WEB_BASE,
      title: title,
      description: title
    });
  }
});
