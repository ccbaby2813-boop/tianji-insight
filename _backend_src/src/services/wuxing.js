// src/services/wuxing.js - 五行生克
const WUXING = {
  金: { generates: '水', overcomes: '木', overcomeBy: '火', generatedBy: '土' },
  木: { generates: '火', overcomes: '土', overcomeBy: '金', generatedBy: '水' },
  水: { generates: '木', overcomes: '火', overcomeBy: '土', generatedBy: '金' },
  火: { generates: '土', overcomes: '金', overcomeBy: '水', generatedBy: '木' },
  土: { generates: '金', overcomes: '水', overcomeBy: '木', generatedBy: '火' }
};

const WUXING_LIST = ['金','木','水','火','土'];

// 八卦五行对应
const BAGUA_WUXING = {
  '乾': '金', '兑': '金',
  '离': '火',
  '震': '木', '巽': '木',
  '坎': '水',
  '艮': '土', '坤': '土'
};

function generates(a, b) {
  return WUXING[a]?.generates === b;
}

function overcomes(a, b) {
  return WUXING[a]?.overcomes === b;
}

function getRelationship(a, b) {
  if (a === b) return '比和';
  if (generates(a, b)) return '相生';
  if (generates(b, a)) return '相生(反)';
  if (overcomes(a, b)) return '相克';
  if (overcomes(b, a)) return '相克(反)';
  return '无关';
}

function getGuaWuxing(guaName) {
  return BAGUA_WUXING[guaName] || '土';
}

function getGuaRelationship(guaA, guaB) {
  const wxA = getGuaWuxing(guaA);
  const wxB = getGuaWuxing(guaB);
  return {
    guaA, guaB,
    wuxingA: wxA, wuxingB: wxB,
    relationship: getRelationship(wxA, wxB)
  };
}

module.exports = {
  WUXING, WUXING_LIST, BAGUA_WUXING,
  generates, overcomes, getRelationship,
  getGuaWuxing, getGuaRelationship
};
