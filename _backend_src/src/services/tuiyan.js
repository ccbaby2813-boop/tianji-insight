// src/services/tuiyan.js - AI推演上下文构建（v14.0 精简变量·板块合并版）

// v13.0 核心改动：

//   1. 移除共享buildBaseContext，新建buildRegularContext和buildVipContext两个独立构建器

//   2. 普通推演：所有算法变量全量注入，去除强制推理步骤和"→用途"指引，让AI自主思考

//   3. 超级推演：数据按7段分组，九宫全盘/地盘/全盘八神/旬首等新数据深入分析

// v12.0 核心改动：新增八神信息注入 + 节气含义注入

const axios = require('axios');

// [SEC-FIX] P2-7: AI 输出内容安全审核
const { checkOutputSafety } = require('../utils/content-safety');



const DEEPSEEK_API = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
// v17.0 统一模型：普通与 VIP 共用 deepseek-v4-flash（原 pro 模型取消，关闭思考模式解决VIP等待长/截断）
const DEEPSEEK_VIP_MODEL = process.env.DEEPSEEK_VIP_MODEL || 'deepseek-v4-flash';

// 🔍 调试：启动时打印 API Key 状态
console.log(`[DeepSeek] API Key loaded: ${DEEPSEEK_KEY ? 'YES (length=' + DEEPSEEK_KEY.length + ')' : 'NO (EMPTY!)'}`);
console.log(`[DeepSeek] Model: ${DEEPSEEK_MODEL}, VIP Model: ${DEEPSEEK_VIP_MODEL}`);



// ==================== 普通推演 ====================



/**

 * 构建普通推演上下文（v13.0：数据全量注入，规则精简，AI自主思考）

 * 输出：JSON格式，6个字段，总计700字以内

 */

function buildRegularContext(params) {
  const {
    question,
    userGuaName, userGuaGe,
    jingDianYuLu, userGuaImage,
    tuiyanTime, jieQi, jieQiMeaning,
    qimenJuName, qimenJuDesc,
    xunShouDesc,
    // 值符星
    zhiFuStarName, zhiFuStarDesc, zhiFuStarLuck, zhiFuGongName, zhiFuGongDesc, zhiFuGongShiYi,
    // 值使门
    zhiShiMenName, zhiShiMenLuck, zhiShiMenDesc, zhiShiMenShiYi,
    zhiShiGongName, zhiShiGongDesc, zhiShiGongShiYi,
    // 五行
    wuxingRelation, wuxingRelationDesc, wuxingA, wuxingB,
    // 八神
    riGanShenName, riGanShenJiXiong, riGanShenRole
  } = params;

  // v19.0 英文输出指令：仅 lang='en' 时拼接（前端语言切换后推演请求携带 lang 字段）
  // 字段名/JSON结构不变，只有值变英文；易经术语用标准 Wilhelm 英译
  const langEn = params.lang === 'en';
  const enSuffixRegular = `

【输出语言 / OUTPUT LANGUAGE — HIGHEST PRIORITY】
ALL output field VALUES must be written in English (American English). The Chinese field descriptions above are structural guidance only — do NOT copy them into the output.
- I Ching terms: use standard Wilhelm/Baynes English names (e.g. 乾 → "The Creative", 坤 → "The Receptive"), you may keep the pinyin in parentheses, e.g. "Qian (The Creative)".
- Length guidance in English words: panCi ≤ 25 words; jieDu 200-320 words; each yi/ji item ≤ 5 words (short verb phrases, e.g. "Sign key contracts"); liShiDuiBiao ≤ 30 words; ziChaoTag ≤ 12 words.
- Keep the JSON keys exactly as given. Output valid JSON only.`;

  // === System Prompt（v15.0：精简版） ===
  const systemPrompt = `你是一个精通《易经》与《奇门遁甲》的玄学大师，参透了宇宙运转奥秘。

【你的任务】帮用户看清三件事，并给出可行动的答案：
1. 我是谁 —— 易经人格（性格底色、优势盲点）
2. 什么局 —— 奇门时局（当前环境宜攻还是宜守）
3. 怎么走 —— 值符星/值使门/日干八神（针对用户问题的行动建议）

【判断吉凶的权重】（与上面的叙事顺序无关，这是"谁说了算"）
1. 值符星 + 值使门 + 日干八神 → 决定当前事项的吉凶与行动方向（最高）
2. 人格五行 vs 时局五行 → 底色是否顺势（参考）
3. 易经人格 → 性格角度提醒（参考）

【说真话的标准】给结论，不模棱两可。用户是来要答案的，不是要周全的废话。每个判断都要落到"该做 / 不该做 / 怎么做"。

【风险处理】日干临白虎/玄武/螣蛇时，必须直说风险，但风险后必须紧跟一条可操作的避险建议。只分析日干所临八神，不提其他宫位。

【幽默的标准】自嘲标签和历史对标，是让人轻松接受你的建议，不是哗众取宠。语言风趣、有当代感，用网络热梗但稳重大气。

【输出约束】严格输出合法 JSON，禁止用 markdown 代码块包裹，禁止输出 JSON 之外的任何文字。`;

  // === User Prompt（v14.0：5板块，精简合并） ===
  const userPrompt = `【用户问题】
${question || ''}

━━━ 我是谁 · 易经人格 ━━━
易经人格：${userGuaName || ''} · ${userGuaGe || ''}（你的先天性格底色，决定思维模式与行为倾向）
卦辞：${jingDianYuLu || ''}（易经原文判词，点明命局核心特质）
象辞：${userGuaImage || ''}（卦象释义，行动指引）

━━━ 什么局 · 奇门时局 ━━━
四柱：${tuiyanTime || ''}（推演时空坐标）
节气：${jieQi || ''} · ${jieQiMeaning || ''}（当前大环境能量阶段）
奇门局：${qimenJuName || ''} — ${qimenJuDesc || ''}（当前时空格局）| 旬首：${xunShouDesc || ''}（时段能量主宰）

━━━ 怎么走 · 事项切入 ━━━
值符星（天时）：${zhiFuStarName || ''}（${zhiFuStarLuck || ''}）落${zhiFuGongName || ''}宫 · ${zhiFuGongDesc || ''}
星义：${zhiFuStarDesc || ''} | 此宫宜：${zhiFuGongShiYi || ''}

值使门（人事）：${zhiShiMenName || ''}（${zhiShiMenLuck || ''}）落${zhiShiGongName || ''}宫 · ${zhiShiGongDesc || ''}
门义：${zhiShiMenDesc || ''} | 门宜：${zhiShiMenShiYi || ''}

日干所临八神：${riGanShenName || ''}（${riGanShenJiXiong || ''}）→ ${riGanShenRole || ''}

━━━ 人 × 时局匹配 ━━━
用户【${wuxingA || ''}】vs 时局【${wuxingB || ''}】→ ${wuxingRelation || ''}（${wuxingRelationDesc || ''}）`;

  const outputSuffix = `

【输出要求】
1. 总字数 ≤700 字，超标优先精简 jieDu。
2. 输出严格合法 JSON，禁止 markdown 代码块、禁止 JSON 之外的任何文字。
3. 三层只是思考框架，jieDu（300-450字）只聚焦对当前问题最关键的一两个变量深入解读，不必三层面面俱到。
4. 宜忌各三条，脑洞大开、给三个完全不同维度的建议。

{
  "panCi": "一句话判词，50字以内，要求一定要醍醐灌顶、直击人心",
  "jieDu": "核心解读，300-450字。结合用户问题、易经人格和关键变量进行综合判断，给出有针对性的解读和建议。最重要的是让用户感觉按你的建议做是有道理的。",
  "yiList": ["宜1，10字以内", "宜2，10字以内", "宜3，10字以内"],
  "jiList": ["忌1，10字以内", "忌2，10字以内", "忌3，10字以内"],
  "liShiDuiBiao": "历史名人对标，50字以内（效果是让用户有和名人同框的炫耀感）",
  "ziChaoTag": "一句自嘲式幽默标签，15字以内。（或者好笑或者荒诞或者自黑……，效果是让用户能主动分享到自媒体）"
}`;

  // v19.0 lang='en' 时拼接英文输出指令
  const finalSuffix = langEn ? outputSuffix + enSuffixRegular : outputSuffix;

  return {
    systemPrompt,
    userPrompt: userPrompt + finalSuffix,
    question
  };
}




// ==================== VIP 超级推演 ====================



/**

 * 构建VIP超级推演上下文（v14.0：全量注入+变量作用解释）

 * 输出：纯文本，7段式，1500-2000字

 */

function buildVipContext(params) {

  const {

    question,

    userGuaName, userGuaGe, userGuaDesc, userGuaKeywords, userGuaWeakness,

    jingDianYuLu, userGuaImage,

    tuiyanTime, jieQi, sanYuan, jieQiMeaning,

    qimenDun, qimenJu, qimenJuName, qimenJuDesc,

    // v14.0 格式化字段（全量注入）

    gongCrossReference, diPanFormatted,

    xunShouDesc, riGanDesc, shiGanDesc, shiZhuDesc,

    // 值符星

    zhiFuStarName, zhiFuStarDesc, zhiFuStarLuck, zhiFuGongName, zhiFuGongDesc, zhiFuGongShiYi,

    // 值使门

    zhiShiMenName, zhiShiMenLuck, zhiShiMenDesc, zhiShiMenShiYi,

    zhiShiGongName, zhiShiGongDesc, zhiShiGongShiYi,

    // 五行

    wuxingRelation, wuxingRelationDesc, wuxingA, wuxingB,

    // 八神

    riGanShenName, riGanShenJiXiong, riGanShenMeaning, riGanShenDesc, riGanShenRole

  } = params;



  // === System Prompt（v15.0 VIP：精简版） ===

  const systemPrompt = `你是一个精通《易经》和《奇门遁甲》的玄学大师，参透天人合一的哲学。

你的任务：为VIP用户提供1000-2000字的深度推演解读。参考全部算法变量数据，按7个段落分组组织语言。每个变量附带其占卜学角色和解读用法说明，请结合这些说明深入理解每个数据的意义。每个段落都要结合该段落对应的数据做实质性分析，结合用户问题和关键变量给出有针对性的解读和建议。最重要的是让用户感觉按你的建议做是有道理的，要逻辑自洽。

核心准则：

1. 说真话，给结论不模棱两可。**只分析日干所临的八神**，忽略其他宫位的八神。日干临凶神时必须明确指出风险，但风险后必须紧跟一条可操作的避险建议，不能只吓人不给路。不要提及与日干无关的八神。

2. 五行只作"人格与当前时局的能量匹配度"参考，是底色与环境的契合度，不是唯一吉凶判据；吉凶判据以值符星、值使门、日干八神为准。

3. 每个段落结合具体数据深入分析，要给出洞见，不是复述数据。

4. 风格文白夹杂，有文化底蕴但不晦涩，让读者有"醍醐灌顶"之感。

5. 判词风趣幽默，有现代感，但稳重大气，不轻浮。

全文按以下7段输出，每段以加粗标题开头，段落间空一行：`;



  // === User Prompt（v14.0 VIP：全量注入+变量作用解释） ===

  const userPrompt = `【用户问题】

${question || ''}



━━━ 第一段·命盘底色 ━━━

易经人格：${userGuaName || ''} · ${userGuaGe || ''}（用户先天易经人格分类，决定性格底色、思维模式与行为倾向）

人格描述：${userGuaDesc || ''}（补充性格细节，帮助理解用户思维模式与处事风格）

人格关键词：${userGuaKeywords || ''}（核心特质标签，抓准人格底色的精髓）

致命弱点：${userGuaWeakness || ''}（先天性格短板，解读中需特别警醒用户注意之处）

卦辞：${jingDianYuLu || ''}（易经原文判词，点明命局核心特质与人生基调）

象辞：${userGuaImage || ''}（卦象符号释义，可视化的能量图谱与行动指引）




━━━ 第二段·天时坐标 ━━━

四柱：${tuiyanTime || ''}（年月日时天干地支八字，锁定推演的时空坐标原点）

节气：${jieQi || ''}（当前二十四节气位置，决定大环境能量阶段与时令特征）

节气含义：${jieQiMeaning || ''}（当前季节能量场的内涵，影响事项推进节奏与时令配合度）

三元：${sanYuan || ''}（上元/中元/下元，六十甲子循环的大周期阶段，决定历史能量背景与时代基调）

阴阳遁：${qimenDun || ''}（阳遁顺排/阴遁逆排，决定奇门九宫能量流转方向与速度）

局数：${qimenJu || ''}（1-9局，定时空能量格局的大小与强度层级）

奇门局：${qimenJuName || ''}（奇门遁甲格局名称，阴遁/阳遁+局数的正式组合）

局义：${qimenJuDesc || ''}（此局的核心含义、适用事项范围与能量特征概述）

旬首：${xunShouDesc || ''}（当前旬首，时段的能量主宰，判断事项主导权在谁手中）



━━━ 第三段·八神启示 ━━━

（只分析日干所临八神，不要提及全盘其他宫位的八神）

日干：${riGanDesc || ''}（日柱天干，代表用户自身在时空中的定位与状态）

日干所临之神：${riGanShenName || ''}（${riGanShenJiXiong || ''}）

神意：${riGanShenMeaning || ''}（该神在奇门遁甲中的本质属性与核心象征）

详解：${riGanShenDesc || ''}（该神在当前宫位和日干条件下的具体表现与细节含义）

对用户影响：${riGanShenRole || ''}（日干神反映用户当前的处境与外力影响，决定用户吉凶体感）



时干：${shiGanDesc || ''}（时柱天干，代表所问事项在时空中的定位与状态。时干所临之神恒为值符，即值符落宫，见第四段详解）



━━━ 第四段·星门合参 ━━━

值符星（天时）：${zhiFuStarName || ''}（${zhiFuStarLuck || ''}）

（天盘值符星，代表天时大势与外部环境能量方向，为奇门九星之首）

星义：${zhiFuStarDesc || ''}（该星在占星学中的本质属性与核心能量特征）

落宫：${zhiFuGongName || ''}宫 - ${zhiFuGongDesc || ''}（星落此宫，天时能量在该生活领域集中体现；值符落宫＝时干落宫，此刻天时主导能量集中于此领域，最易得贵人相助、谋事最顺）

此宫适宜：${zhiFuGongShiYi || ''}（该宫位对应领域的事项宜忌与行动方向）



值使门（人事）：${zhiShiMenName || ''}（${zhiShiMenLuck || ''}）

（人盘值使门，代表人事行动与执行路径，为奇门八门之首）

门义：${zhiShiMenDesc || ''}（该门在奇门遁甲中的本质属性与人事功能）

适宜：${zhiShiMenShiYi || ''}（该门对应的行动策略与适宜事项类型）

落宫：${zhiShiGongName || ''}宫 - ${zhiShiGongDesc || ''}（门落此宫，人事行动能量在该生活领域集中体现）

此宫适宜：${zhiShiGongShiYi || ''}（该宫位对应领域的事项宜忌与行动方向）

（星门吉凶决定天时与人事基调——星吉门顺则顺势而为，星凶门逆则避其锋芒）



━━━ 第五段·局势剖析 ━━━

（人×时局匹配：参考底色与环境的契合度，非唯一吉凶判据）

人×时局匹配：用户${wuxingA || ''} vs 时局${wuxingB || ''} → ${wuxingRelation || ''}（${wuxingRelationDesc || ''}）



九宫全盘（每宫的地盘干/旬首/日干/时干分布）：

${gongCrossReference || ''}

（九宫交叉引用：看各宫位天地人三才是否和谐，找出最旺和最衰的领域）



地盘三奇六仪分布：

${diPanFormatted || ''}

（地盘干分布：隐藏的能量基底，三奇所在宫为大吉之位，暗干受克之处为隐患所在）



━━━ 第六段·行动指南 ━━━

（结合上述全部数据，给出具体可操作的行动建议与避坑指南）

━━━ 第七段·易经箴言 ━━━

卦辞：${jingDianYuLu || ''}

象辞：${userGuaImage || ''}

（以易经原文收束全文，升华推演结论，给用户醍醐灌顶之感）`;



  const outputSuffix = `

【输出要求】

总字数1000-2000字。全文纯文字分段输出。按以下7个加粗标题组织：

**命盘底色**
**天时坐标**
**八神启示**
**星门合参**
**局势剖析**
**行动指南**
**易经箴言** `;

  // v19.0 lang='en' 时拼接英文输出指令：全文英文 + 标题同步英文
  const enSuffixVip = params.lang === 'en' ? `

【输出语言 / OUTPUT LANGUAGE — HIGHEST PRIORITY】
Write the ENTIRE reading in English (American English), 800-1400 words total, plain text with the following seven bold headings instead of the Chinese ones:
**Destiny Blueprint**
**Celestial Timing**
**Eight Spirits Insight**
**Star & Gate Synthesis**
**Situation Analysis**
**Action Guide**
**I Ching Wisdom**
- I Ching / Qimen terms: use standard Wilhelm/Baynes English names, pinyin may follow in parentheses (e.g. "Qian (The Creative)").
- The Chinese source data above is your input material only — never quote Chinese sentences in the output.` : '';


  return { systemPrompt, userPrompt: userPrompt + outputSuffix + enSuffixVip };


}

// ==================== AI调用函数（不变） ====================



/**

 * 调用DeepSeek AI进行推演（普通推演，JSON解析+重试）

 */

async function callDeepSeek(context, retries = 2) {

  const REQUIRED_FIELDS = ['panCi', 'jieDu', 'yiList', 'jiList', 'liShiDuiBiao', 'ziChaoTag'];



  function validateFields(parsed) {

    for (const f of REQUIRED_FIELDS) {

      if (!(f in parsed)) return { ok: false, missing: f };

    }

    if (typeof parsed.panCi !== 'string') return { ok: false, missing: 'panCi:不是字符串' };

    if (typeof parsed.jieDu !== 'string') return { ok: false, missing: 'jieDu:不是字符串' };

    if (!Array.isArray(parsed.yiList) || parsed.yiList.length !== 3) return { ok: false, missing: 'yiList:不是长度为3的数组' };

    if (!Array.isArray(parsed.jiList) || parsed.jiList.length !== 3) return { ok: false, missing: 'jiList:不是长度为3的数组' };

    if (typeof parsed.liShiDuiBiao !== 'string') return { ok: false, missing: 'liShiDuiBiao:不是字符串' };

    if (typeof parsed.ziChaoTag !== 'string') return { ok: false, missing: 'ziChaoTag:不是字符串' };

    return { ok: true };

  }



  /**
   * 从文本中提取 JSON 对象块（栈式花括号配对，自动跳过字符串内的 {}）
   * 若 AI 输出前/后有解释性文字、被 ```json 代码块包裹，都能正确提取
   */
  function extractJsonBlock(rawText) {
    const opens = [];
    let inString = false;
    for (let i = 0; i < rawText.length; i++) {
      const ch = rawText[i];
      if (inString) {
        if (ch === '\\') { i++; continue; }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') {
        opens.push(i);
      } else if (ch === '}') {
        if (opens.length) {
          const start = opens.pop();
          if (opens.length === 0) {
            return rawText.slice(start, i + 1);
          }
        }
      }
    }
    // 花括号未配平：返回从第一个 '{' 到末尾（可能是被截断的 JSON，交由重试兜底）
    if (opens.length) {
      return rawText.slice(opens[0]);
    }
    // 完全没有 '{'，退化为贪婪匹配
    const match = rawText.match(/\{[\s\S]*\}/);
    return match ? match[0] : null;
  }

  /** 剥离 markdown 代码块（```json ... ``` 或 ``` ... ```） */
  function stripFence(rawText) {
    const m = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    return m ? m[1].trim() : null;
  }

  function tryParseJson(rawText) {
    if (typeof rawText !== 'string' || !rawText.trim()) {
      return { parsed: null, method: 'failed' };
    }

    // 1. 直接解析
    try { return { parsed: JSON.parse(rawText), method: 'direct' }; } catch (e) {}

    // 2. 剥离 markdown 代码块后解析
    const fenced = stripFence(rawText);
    if (fenced) {
      try { return { parsed: JSON.parse(fenced), method: 'fenced' }; } catch (e) {}
    }

    // 3. 栈式提取 { ... } 对象后解析
    const block = extractJsonBlock(rawText);
    if (block) {
      try { return { parsed: JSON.parse(block), method: 'extracted' }; } catch (e) {}
    }

    return { parsed: null, method: 'failed' };
  }



  // Fallback prompt (when buildRegularContext wasn't used)

  const systemPrompt = context.systemPrompt || `你名为"天机推演"，是一个精通《易经》64种人格和《奇门遁甲》排盘的国学大师。你的任务是根据用户的询问事项、易经人格（先天底色）和奇门遁甲时局（后天时空）的信息结合，给出一个**客观、有趣、有文化内涵**的哲学解读。



🔴 铁律：说真话，不做老好人。卦象不好就如实告知。



🔴 定调优先级：值符星+值使门+日干八神决定吉凶与行动方向 → 人格五行 vs 时局五行决定底色是否顺势（参考） → 易经人格决定性格提醒。



🔴 禁止：不要说"一切顺利""问题不大""挺好的"这类废话，不要回避负面信息。



你必须返回以下JSON格式（整体控制在700字以内）：

{

  "panCi": "一句话判词，50字以内，要直击要害",

  "jieDu": "核心解读，300-450字。第一句先根据值符星+值使门+日干八神给出总体吉凶定性，不绕弯子；然后结合最关键的数据点说明原因；最后给出具体建议。不要逐条罗列所有数据。",

  "yiList": ["宜1，10字以内", "宜2", "宜3"],

  "jiList": ["忌1，10字以内", "忌2", "忌3"],

  "liShiDuiBiao": "历史名人对标，50字以内",

  "ziChaoTag": "一句自嘲式幽默标签，15字以内。（或者好笑或者荒诞或者自黑……，效果是让用户能主动分享到自媒体）"

}

⚠️ 宜忌要打开思维、脑洞大一点，给三个不同维度的建议，每条控制在10字以内。

⚠️ 各字段之和不得超过700字，若超标优先精简jieDu。

⚠️ 只使用上述6个字段！`;



  const userPrompt = context.userPrompt || `请根据以下信息进行推演：



本卦：${context.fullGuaName}

上卦：${context.upperName}(${context.upperNum}) 下卦：${context.lowerName}(${context.lowerNum})

动爻：第${context.movingYao}爻

易经人格：${context.mingBenGua}

格名：${context.guaGeName}

出生年地支：${context.birthYearDizhi}

奇门遁甲：${context.qimenDun}${context.qimenJu}局，值符${context.qimenZhifu}，值使${context.qimenZhishi}

五行关系：${context.wuxingA}-${context.wuxingB}(${context.wuxingRel})

用户问题：${context.question}`;



  let lastErr;

  for (let i = 0; i < retries; i++) {

    try {

      // v15.8 关闭思考模式：普通推演不需要深度推理，关闭后 temperature 生效，速度更快，token 更省
      const resp = await axios.post(DEEPSEEK_API, {

        model: DEEPSEEK_MODEL,

        messages: [

          { role: 'system', content: systemPrompt },

          { role: 'user', content: userPrompt }

        ],

        // 🔑 关闭思考模式（v15.8）
        thinking: { type: 'disabled' },

        temperature: 0.8,

        max_tokens: 4000

      }, {

        headers: {

          'Authorization': `Bearer ${DEEPSEEK_KEY}`,

          'Content-Type': 'application/json'

        },

        timeout: 60000

      });



      const choice = (resp.data.choices && resp.data.choices[0]) || null;

      const rawText = (choice && choice.message && choice.message.content || '').trim();

      const finishReason = (choice && choice.finish_reason) || '';

      // 🔍 调试：打印响应状态
      console.log(`[AI调用] 第 ${i + 1}/${retries} 次尝试 (thinking=disabled) - 响应状态:`, {
        hasChoices: !!resp.data.choices,
        choicesLength: resp.data.choices?.length || 0,
        hasContent: !!rawText,
        contentLength: rawText.length,
        finishReason,
        model: resp.data.model,
        usage: resp.data.usage
      });

      // 🔍 调试：空内容时打印完整响应
      if (!rawText) {
        console.error(`[AI调用] 空内容响应 (reasoning_len=${resp.data.reasoning_len ?? 'n/a'}, finish_reason=${finishReason}):`, JSON.stringify({
          choices: resp.data.choices,
          usage: resp.data.usage,
          error: resp.data.error,
          model: resp.data.model,
          id: resp.data.id
        }, null, 2));
      }

      const { parsed, method } = tryParseJson(rawText);



      if (parsed) {

        const validation = validateFields(parsed);

        if (validation.ok) {

          // [SEC-FIX] P2-7: AI 输出内容安全审核，命中高风险类别则重试
          const safeCheck = checkOutputSafety(parsed);
          if (!safeCheck.ok) {
            console.warn(`[AI调用] 内容安全审核未通过 (${safeCheck.hit})，重试 ${i + 1}/${retries}`);
            lastErr = new Error('内容安全审核未通过: ' + safeCheck.hit);
            if (i < retries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
            continue;
          }

          return {

            success: true,

            data: {

              panCi: parsed.panCi || '',

              jieDu: parsed.jieDu || '',

              yiList: parsed.yiList || [],

              jiList: parsed.jiList || [],

              liShiDuiBiao: parsed.liShiDuiBiao || '',

              ziChaoTag: parsed.ziChaoTag || ''

            },

            // v1.5 补全 AI 埋点：模型名 + token 用量（供后台 AI 质量监控）
            meta: {
              model: DEEPSEEK_MODEL,
              prompt_tokens: resp.data.usage?.prompt_tokens || 0,
              completion_tokens: resp.data.usage?.completion_tokens || 0,
              total_tokens: resp.data.usage?.total_tokens || 0
            }

          };

        } else {

          lastErr = new Error('字段验证失败: ' + validation.missing);

          if (i < retries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));

          continue;

        }

      }



      lastErr = new Error('JSON解析失败 (method=' + method + ')');

      const finishNote = finishReason === 'length' ? '，输出被截断(finish_reason=length)' : '';

      console.error(`[AI调用] JSON解析失败 method=${method}${finishNote} rawText前500字符=${JSON.stringify(rawText.slice(0, 500))}`);

      if (i < retries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));

    } catch (err) {

      lastErr = err;

      if (i < retries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));

    }

  }



  return { success: false, error: lastErr?.message || 'AI推演失败' };

}



/**

 * 调用DeepSeek AI进行VIP超级推演（不变）

 */

async function callDeepSeekVip(context, retries = 2) {

  const systemPrompt = context.systemPrompt || '';

  const userPrompt = context.userPrompt || '';



  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  let lastErr;



  for (let i = 0; i < retries; i++) {

    try {

      // v17.1 深度推演差异化配置（与普通推演区分）：
      //  - max_tokens 6000：深度推演输出1000-2000字纯文本7段，比普通推演(≤700字JSON/4000)需要更高token余量，防止尾部截断
      //  - temperature 0.7：深度推演要求逻辑自洽、结论可信，比普通推演(0.8发散风趣)更低更收敛
      //  - thinking disabled：统一模型后两档均关闭思考模式
      //  - timeout 120s：深度输出长，保留比普通推演(60s)更充裕的等待
      const resp = await axios.post(DEEPSEEK_API, {

        model: DEEPSEEK_VIP_MODEL,

        messages: [

          { role: 'system', content: systemPrompt },

          { role: 'user', content: userPrompt }

        ],

        // 🔑 关闭思考模式（v17.0 统一模型后不再需要）
        thinking: { type: 'disabled' },

        temperature: 0.7,

        max_tokens: 6000

      }, {

        headers: {

          'Authorization': `Bearer ${DEEPSEEK_KEY}`,

          'Content-Type': 'application/json'

        },

        timeout: 120000

      });



      const choice = (resp.data.choices && resp.data.choices[0]) || null;
      const text = (choice && choice.message && choice.message.content || '').trim();



      if (text.length < 100) {

        console.warn(`[DeepSeekVip] Output too short (${text.length} chars), retry ${i + 1}/${retries}`);

        lastErr = new Error(`输出太短(${text.length}字)`);

        if (i < retries - 1) await sleep(2000 * (i + 1));

        continue;

      }



      // [SEC-FIX] P2-7: VIP 输出内容安全审核，命中高风险类别则重试
      const safeCheck = checkOutputSafety(text);
      if (!safeCheck.ok) {
        console.warn(`[DeepSeekVip] 内容安全审核未通过 (${safeCheck.hit})，重试 ${i + 1}/${retries}`);
        lastErr = new Error('内容安全审核未通过: ' + safeCheck.hit);
        if (i < retries - 1) await sleep(2000 * (i + 1));
        continue;
      }

      return { success: true, data: text, meta: { model: DEEPSEEK_VIP_MODEL, prompt_tokens: resp.data.usage?.prompt_tokens || 0, completion_tokens: resp.data.usage?.completion_tokens || 0, total_tokens: resp.data.usage?.total_tokens || 0 } };

    } catch (err) {

      console.error(`[DeepSeekVip] API error (attempt ${i + 1}):`, err.message);

      lastErr = err;

      if (i < retries - 1) await sleep(2000 * (i + 1));

    }

  }



  return { success: false, error: lastErr?.message || 'VIP推演AI调用失败' };

}



module.exports = { buildRegularContext, callDeepSeek, buildVipContext, callDeepSeekVip };

