Component({
  properties: {
    item: { type: Object, value: {} }
  },
  data: { matchClass: '' },
  observers: {
    'item.match_level': function(val) {
      let cls = '';
      const v = (val || '').trim();
      // 中文等级关键词
      if (v.indexOf('天作') >= 0) cls = 'tianzuo';
      else if (v.indexOf('默契') >= 0 || v.indexOf('灵魂') >= 0) cls = 'moqi';
      else if (v.indexOf('互补') >= 0) cls = 'hubu';
      // 英文等级关键词（海外版 match_level 为英文自由文本）
      else if (/fated|heaven|perfect match|perfect bond|divine/i.test(v)) cls = 'tianzuo';
      else if (/perfect chemistr|perfect harmon|soul|resonance|intuitive|harmonious bond|deep attunement/i.test(v)) cls = 'moqi';
      else if (/complementary|complement|balance|contrast|opposite|mirror/i.test(v)) cls = 'hubu';
      this.setData({ matchClass: cls });
    }
  },
  methods: {
    onTap() { this.triggerEvent('tap', { item: this.data.item }); }
  }
});
