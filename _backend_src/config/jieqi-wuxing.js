// config/jieqi-wuxing.js - 二十四节气五行归属表 (v1.0)
// 依据：《黄帝内经·素问·四气调神大论》《素问·太阴阳明论》《素问·脏气法时论》
// 原则："脾者土也，治中央，常以四时长四藏，各十八日寄治" —— 每季末节气属土
//
// 五行归属：
//   春（木）: 立春 雨水 惊蛰 春分 清明
//   春末（土）: 谷雨
//   夏（火）: 立夏 小满 芒种 夏至 小暑
//   夏末（土）: 大暑
//   秋（金）: 立秋 处暑 白露 秋分 寒露
//   秋末（土）: 霜降
//   冬（水）: 立冬 小雪 大雪 冬至 小寒
//   冬末（土）: 大寒
//
// 五脏对应（《素问·脏气法时论》）：
//   木→肝  火→心  土→脾  金→肺  水→肾
//
// 索引说明：
//   solarTermIndex 0-23 按公历顺序（立春=0），便于前端展示与排序
//   ordinal 1-24 按阳遁顺序（冬至=1），与 qimen-config.js JIE_QI_MEANING 保持一致

module.exports = {
  // ==================== 公历顺序节气五行表 (index 0-23, 立春=0) ====================
  "JIE_QI_WUXING": [
    { index: 0,  name: "立春", wuxing: "木", organ: "肝", season: "春", seasonDesc: "春季之始，万物发陈",
      dateRange: "2月3-5日",  bagua: "艮", emotion: "怒" },
    { index: 1,  name: "雨水", wuxing: "木", organ: "肝", season: "春", seasonDesc: "冰雪消融，春雨润物",
      dateRange: "2月18-20日", bagua: "艮", emotion: "怒" },
    { index: 2,  name: "惊蛰", wuxing: "木", organ: "肝", season: "春", seasonDesc: "春雷乍动，万物苏醒",
      dateRange: "3月5-7日",   bagua: "艮", emotion: "怒" },
    { index: 3,  name: "春分", wuxing: "木", organ: "肝", season: "春", seasonDesc: "阴阳平衡，昼夜等长",
      dateRange: "3月20-22日", bagua: "震", emotion: "怒" },
    { index: 4,  name: "清明", wuxing: "木", organ: "肝", season: "春", seasonDesc: "天清地明，洁净清新",
      dateRange: "4月4-6日",   bagua: "震", emotion: "怒" },
    { index: 5,  name: "谷雨", wuxing: "土", organ: "脾", season: "春末", seasonDesc: "春末土旺，雨生百谷",
      dateRange: "4月19-21日", bagua: "震", emotion: "思" },

    { index: 6,  name: "立夏", wuxing: "火", organ: "心", season: "夏", seasonDesc: "夏季之始，万物繁茂",
      dateRange: "5月5-7日",   bagua: "巽", emotion: "喜" },
    { index: 7,  name: "小满", wuxing: "火", organ: "心", season: "夏", seasonDesc: "物致于此，小得盈满",
      dateRange: "5月20-22日", bagua: "巽", emotion: "喜" },
    { index: 8,  name: "芒种", wuxing: "火", organ: "心", season: "夏", seasonDesc: "有芒之谷，可稼可种",
      dateRange: "6月5-7日",   bagua: "巽", emotion: "喜" },
    { index: 9,  name: "夏至", wuxing: "火", organ: "心", season: "夏", seasonDesc: "阳极阴生，昼最长夜最短",
      dateRange: "6月21-22日", bagua: "离", emotion: "喜" },
    { index: 10, name: "小暑", wuxing: "火", organ: "心", season: "夏", seasonDesc: "暑热渐盛，未至于极",
      dateRange: "7月6-8日",   bagua: "离", emotion: "喜" },
    { index: 11, name: "大暑", wuxing: "土", organ: "脾", season: "夏末", seasonDesc: "夏末土旺，暑极生寒",
      dateRange: "7月22-24日", bagua: "离", emotion: "思" },

    { index: 12, name: "立秋", wuxing: "金", organ: "肺", season: "秋", seasonDesc: "秋季之始，万物收敛",
      dateRange: "8月7-9日",   bagua: "坤", emotion: "悲" },
    { index: 13, name: "处暑", wuxing: "金", organ: "肺", season: "秋", seasonDesc: "暑气止息，秋高气爽",
      dateRange: "8月22-24日", bagua: "坤", emotion: "悲" },
    { index: 14, name: "白露", wuxing: "金", organ: "肺", season: "秋", seasonDesc: "阴气渐重，露凝而白",
      dateRange: "9月7-9日",   bagua: "坤", emotion: "悲" },
    { index: 15, name: "秋分", wuxing: "金", organ: "肺", season: "秋", seasonDesc: "阴阳平衡，昼夜等长",
      dateRange: "9月22-24日", bagua: "兑", emotion: "悲" },
    { index: 16, name: "寒露", wuxing: "金", organ: "肺", season: "秋", seasonDesc: "露水寒冷，寒气渐重",
      dateRange: "10月8-9日",  bagua: "兑", emotion: "悲" },
    { index: 17, name: "霜降", wuxing: "土", organ: "脾", season: "秋末", seasonDesc: "秋末土旺，霜降临冬",
      dateRange: "10月23-24日", bagua: "兑", emotion: "思" },

    { index: 18, name: "立冬", wuxing: "水", organ: "肾", season: "冬", seasonDesc: "冬季之始，万物闭藏",
      dateRange: "11月7-8日",  bagua: "乾", emotion: "恐" },
    { index: 19, name: "小雪", wuxing: "水", organ: "肾", season: "冬", seasonDesc: "寒气渐深，初雪降",
      dateRange: "11月22-23日", bagua: "乾", emotion: "恐" },
    { index: 20, name: "大雪", wuxing: "水", organ: "肾", season: "冬", seasonDesc: "大雪纷飞，天地闭藏",
      dateRange: "12月6-8日",  bagua: "乾", emotion: "恐" },
    { index: 21, name: "冬至", wuxing: "水", organ: "肾", season: "冬", seasonDesc: "阴极阳生，一阳来复",
      dateRange: "12月21-23日", bagua: "坎", emotion: "恐" },
    { index: 22, name: "小寒", wuxing: "水", organ: "肾", season: "冬", seasonDesc: "寒气渐深，未至于极",
      dateRange: "1月5-7日",   bagua: "坎", emotion: "恐" },
    { index: 23, name: "大寒", wuxing: "土", organ: "脾", season: "冬末", seasonDesc: "冬末土旺，寒极将春",
      dateRange: "1月20-21日", bagua: "坎", emotion: "思" }
  ],

  // ==================== 五行→五脏→五志→五季对应表 ====================
  // 依据：《素问·阴阳应象大论》《素问·脏气法时论》
  "WUXING_ORGAN_MAP": {
    "木": { organ: "肝", emotion: "怒", season: "春",   flavor: "酸", direction: "东", color: "青",
            desc: "肝主疏泄，藏血，主筋。怒伤肝，悲胜怒。" },
    "火": { organ: "心", emotion: "喜", season: "夏",   flavor: "苦", direction: "南", color: "赤",
            desc: "心主血脉，藏神，主舌。喜伤心，恐胜喜。" },
    "土": { organ: "脾", emotion: "思", season: "长夏", flavor: "甘", direction: "中", color: "黄",
            desc: "脾主运化，藏意，主肌肉。思伤脾，怒胜思。" },
    "金": { organ: "肺", emotion: "悲", season: "秋",   flavor: "辛", direction: "西", color: "白",
            desc: "肺主气，藏魄，主皮毛。悲伤肺，喜胜悲。" },
    "水": { organ: "肾", emotion: "恐", season: "冬",   flavor: "咸", direction: "北", color: "黑",
            desc: "肾主水，藏精，主骨。恐伤肾，思胜恐。" }
  },

  // ==================== 按节气名快速查询映射 ====================
  "JIE_QI_BY_NAME": {
    "立春": 0, "雨水": 1, "惊蛰": 2, "春分": 3, "清明": 4, "谷雨": 5,
    "立夏": 6, "小满": 7, "芒种": 8, "夏至": 9, "小暑": 10, "大暑": 11,
    "立秋": 12, "处暑": 13, "白露": 14, "秋分": 15, "寒露": 16, "霜降": 17,
    "立冬": 18, "小雪": 19, "大雪": 20, "冬至": 21, "小寒": 22, "大寒": 23
  }
};
