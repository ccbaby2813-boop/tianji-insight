// 国风手绘图标组件 - 使用 image + SVG data URI（真机兼容）
Component({
  properties: {
    name: { type: String, value: '' },
    size: { type: Number, value: 48 },
    color: { type: String, value: '#C8A55B' }
  },

  data: {
    iconSrc: ''
  },

  observers: {
    'name, color': function() {
      this.setIcon();
    }
  },

  lifetimes: {
    attached() {
      this.setIcon();
    }
  },

  methods: {
    setIcon() {
      try {
        var name = this.properties.name;
        if (!name) {
          this.setData({ iconSrc: '' });
          return;
        }
        var c = this.properties.color;
        var svg = this.getSvg(name, c);
        var encoded = this.toBase64(svg);
        this.setData({ iconSrc: 'data:image/svg+xml;base64,' + encoded });
      } catch(e) {
        console.error('[icon-guo] setIcon error:', e);
      }
    },

    toBase64(str) {
      // 纯JS实现base64编码，不依赖wx.arrayBufferToBase64
      // SVG只含ASCII字符，直接按字节编码
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      var result = '';
      var i = 0;
      while (i < str.length) {
        var a = str.charCodeAt(i++) & 0xFF;
        var b = i < str.length ? str.charCodeAt(i++) & 0xFF : -1;
        var c = i < str.length ? str.charCodeAt(i++) & 0xFF : -1;
        result += chars[a >> 2];
        result += chars[((a & 3) << 4) | (b >= 0 ? (b >> 4) : 0)];
        result += b === -1 ? '=' : chars[((b & 15) << 2) | (c >= 0 ? (c >> 6) : 0)];
        result += c === -1 ? '=' : chars[c & 63];
      }
      return result;
    },

    getSvg(name, c) {
      var icons = {
        lvdou: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><ellipse cx="24" cy="28" rx="18" ry="14" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 14 Q28 20 24 28 Q20 36 24 42" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 14 Q20 18 24 22" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M14 22 Q18 26 14 30" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M34 22 Q30 26 34 30" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        xigua: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><ellipse cx="24" cy="24" rx="20" ry="16" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M4 24 Q24 10 44 24" fill="none" stroke="' + c + '" stroke-width="1.5"/><circle cx="24" cy="24" r="6" fill="' + c + '" opacity="0.3"/><circle cx="20" cy="22" r="2" fill="' + c + '"/><circle cx="28" cy="22" r="2" fill="' + c + '"/><circle cx="24" cy="28" r="2" fill="' + c + '"/></svg>',

        bohe: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 6 Q20 16 24 24 Q28 32 24 42" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 12 Q14 16 10 20" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 12 Q34 16 38 20" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 18 Q12 22 8 26" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 18 Q36 22 40 26" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        yimi: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M14 42 Q24 30 34 42" fill="none" stroke="' + c + '" stroke-width="2"/><ellipse cx="24" cy="24" rx="12" ry="16" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 8 Q22 16 24 24 Q26 32 24 40" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        suanmeitang: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M16 14 L16 38 Q16 42 20 42 L28 42 Q32 42 32 38 L32 14 Z" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M16 20 L32 20" fill="none" stroke="' + c + '" stroke-width="1.5"/><ellipse cx="20" cy="10" rx="8" ry="4" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="20" cy="24" r="2" fill="' + c + '"/><circle cx="28" cy="24" r="2" fill="' + c + '"/></svg>',

        shanyao: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M14 38 Q24 10 34 38" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M18 34 Q24 14 30 34" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M12 30 Q24 8 36 30" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        baihe: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 42 Q22 30 24 18 Q26 30 24 42" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 22 Q18 18 12 22 Q18 26 24 22" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 22 Q30 18 36 22 Q30 26 24 22" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 28 Q14 24 8 28 Q14 32 24 28" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 28 Q34 24 40 28 Q34 32 24 28" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        lianzi: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="18" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="24" cy="24" r="12" fill="none" stroke="' + c + '" stroke-width="1.5"/><circle cx="24" cy="24" r="6" fill="' + c + '" opacity="0.3"/></svg>',

        kuigua: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 6 Q20 20 24 36 Q28 20 24 6" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 10 Q16 18 12 24 Q16 30 24 32" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 10 Q32 18 36 24 Q32 30 24 32" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 36 L24 42" fill="none" stroke="' + c + '" stroke-width="2"/></svg>',

        nanguo: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M8 30 Q24 10 40 30 Q36 40 24 42 Q12 40 8 30" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M14 28 Q24 18 34 28" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 10 L24 4" fill="none" stroke="' + c + '" stroke-width="2"/></svg>',

        xueli: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 6 Q18 16 16 24 Q20 32 24 42 Q28 32 32 24 Q30 16 24 6" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 10 Q20 18 20 26 Q24 34 24 40" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        yiner: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 8 Q14 16 10 24 Q14 32 24 40 Q34 32 38 24 Q34 16 24 8" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 12 Q18 18 16 24 Q18 30 24 36" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 12 Q30 18 32 24 Q30 30 24 36" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        bailuobo: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 4 Q20 16 20 32 Q20 40 24 42 Q28 40 28 32 Q28 16 24 4" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 4 L24 0" fill="none" stroke="' + c + '" stroke-width="2"/></svg>',

        heizhima: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="16" fill="' + c + '" opacity="0.9"/><circle cx="24" cy="24" r="12" fill="none" stroke="#333" stroke-width="1.5"/><circle cx="24" cy="24" r="4" fill="#333"/></svg>',

        hetao: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 6 Q12 16 10 28 Q12 40 24 42 Q36 40 38 28 Q36 16 24 6" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 10 Q18 18 16 28 Q20 36 24 38" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 10 Q30 18 32 28 Q28 36 24 38" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        yangrou: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M10 20 Q24 8 38 20 Q36 36 24 42 Q12 36 10 20" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M14 24 Q24 14 34 24" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 42 L24 48" fill="none" stroke="' + c + '" stroke-width="2"/></svg>',

        heidou: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><ellipse cx="24" cy="28" rx="16" ry="12" fill="' + c + '" opacity="0.9"/><path d="M24 16 Q28 22 24 28 Q20 34 24 40" fill="none" stroke="#333" stroke-width="1.5"/></svg>',

        boche: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 42 Q14 20 24 8 Q34 20 24 42" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 12 Q18 20 20 32" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 12 Q30 20 28 32" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        chunsun: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 42 Q22 20 24 8 Q26 20 24 42" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 14 Q16 18 12 22" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 14 Q32 18 36 22" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        jiucai: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 42 Q20 24 24 10 Q28 24 24 42" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 14 Q16 18 12 24" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 14 Q32 18 36 24" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        meditate: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="16" r="6" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 22 Q20 26 22 34 Q24 40 26 34 Q28 26 24 22" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M16 34 Q14 42 18 42" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M32 34 Q34 42 30 42" fill="none" stroke="' + c + '" stroke-width="2"/></svg>',

        swim: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 24 Q16 20 12 24 Q16 28 24 24" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 28 Q32 24 36 28 Q32 32 24 28" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 32 Q16 28 12 32 Q16 36 24 32" fill="none" stroke="' + c + '" stroke-width="2"/></svg>',

        walk: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 16 Q20 20 22 32 L24 42" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 16 Q28 20 26 32 L24 42" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="24" cy="12" r="4" fill="none" stroke="' + c + '" stroke-width="2"/></svg>',

        baduanjin: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="18" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.3"/><path d="M24 6 L24 42" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M6 24 L42 24" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="24" cy="24" r="4" fill="' + c + '"/></svg>',

        aiqiu: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 8 Q20 20 24 32 Q28 20 24 8" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M22 12 Q24 16 26 12" fill="none" stroke="' + c + '" stroke-width="1.5"/><circle cx="24" cy="36" r="4" fill="' + c + '" opacity="0.8"/></svg>',

        massage: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M14 24 Q10 20 14 16 Q18 20 14 24" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M34 24 Q38 20 34 16 Q30 20 34 24" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="24" cy="38" r="8" fill="none" stroke="' + c + '" stroke-width="2"/></svg>',

        xin: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 8 Q14 14 8 24 Q14 30 24 38 Q34 30 40 24 Q34 14 24 8" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 12 Q20 18 22 26 Q24 34 24 36" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 12 Q28 18 26 26 Q24 34 24 36" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        gan: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 42 Q22 20 24 8 Q26 20 24 42" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 12 Q16 16 12 20" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 12 Q32 16 36 20" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        pi: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M8 20 Q24 10 40 20 Q36 36 24 40 Q12 36 8 20" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M14 24 Q24 16 34 24" fill="none" stroke="' + c + '" stroke-width="1.5"/><circle cx="24" cy="24" r="4" fill="' + c + '" opacity="0.3"/></svg>',

        fei: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 42 Q16 24 24 8 Q32 24 24 42" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 12 Q20 16 16 24 Q18 32 22 40" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 12 Q28 16 32 24 Q30 32 26 40" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        shen: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 6 Q20 20 24 36 Q28 20 24 6" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="16" cy="24" r="4" fill="none" stroke="' + c + '" stroke-width="1.5"/><circle cx="32" cy="24" r="4" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        jieqi: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 8 Q30 16 24 24 Q18 32 24 40" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M8 24 Q16 30 24 24 Q32 18 40 24" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="24" cy="24" r="4" fill="' + c + '"/></svg>',

        gua: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M8 14 L40 14" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M8 24 L40 24" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M8 34 L40 34" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M8 14 L8 34" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M40 14 L40 34" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 14 L24 34" fill="none" stroke="' + c + '" stroke-width="2"/></svg>',

        lock: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M14 20 Q14 12 24 12 Q34 12 34 20 L34 38 Q34 42 30 42 L18 42 Q14 42 14 38 Z" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M20 24 L28 24" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="24" cy="32" r="4" fill="none" stroke="' + c + '" stroke-width="2"/></svg>',

        // v2.0 UI 图标系统（替换全站 emoji）

        // 菜单箭头（替换 ›）
        'chevron-right': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M18 14 L30 24 L18 34" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

        // 返回箭头（替换 ‹）
        'chevron-left': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M30 14 L18 24 L30 34" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

        // 折叠区展开箭头（向下/向上）
        'chevron-down': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M14 18 L24 30 L34 18" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

        // 信封（未读，替换 ✉）
        envelope: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M6 14 L42 14 L42 38 L6 38 Z" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/><path d="M6 14 L24 28 L42 14" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 10 Q20 6 24 8" fill="none" stroke="' + c + '" stroke-width="1.5" stroke-linecap="round"/></svg>',

        // 信封已打开（已读状态）
        'envelope-open': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M6 20 L24 8 L42 20 L42 38 L6 38 Z" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/><path d="M6 20 L24 30 L42 20" fill="none" stroke="' + c + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/></svg>',

        // 铅笔/编辑（写信按钮）
        edit: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M32 6 L42 16 L18 40 L8 40 L8 30 Z" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/><path d="M28 10 L38 20" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/></svg>',

        // 易缘双心（替换 ❤）
        'heart-guo': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M16 18 Q10 18 10 24 Q10 30 16 34 Q22 30 24 24 Q22 18 16 18" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M32 18 Q26 18 26 24 Q26 30 32 34 Q38 30 40 24 Q38 18 32 18" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 24 Q22 28 24 32 Q26 28 24 24" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/></svg>',

        // 桃心（经典单心·姻缘寓意）
        'peach-heart': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 38 C 18 33 10 27 10 18 C 10 13 14 9 19 9 C 22 9 24 12 24 15 C 24 12 26 9 29 9 C 34 9 38 13 38 18 C 38 27 30 33 24 38 Z" fill="' + c + '" fill-opacity="0.15" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/></svg>',

        // 莲花（替换 ✿）
        lotus: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 38 Q20 28 24 18 Q28 28 24 38" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 28 Q16 26 10 28 Q16 32 24 28" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 28 Q32 26 38 28 Q32 32 24 28" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 22 Q14 22 8 24 Q14 28 24 24" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.7"/><path d="M24 22 Q34 22 40 24 Q34 28 24 24" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.7"/></svg>',

        // 千纸鹤（折纸鹤·姻缘祈愿寓意）
        'paper-crane': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M6 24 L18 18 L42 10 L34 22 L42 34 L18 30 Z" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/><path d="M18 18 L24 24 L18 30" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 24 L34 22" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><path d="M24 24 L34 22 L42 10" fill="none" stroke="' + c + '" stroke-width="1" opacity="0.4"/><path d="M6 24 L2 22" fill="none" stroke="' + c + '" stroke-width="1.5" stroke-linecap="round"/></svg>',

        // 月亮（弯月·夜思寓意）
        moon: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M30 8 Q18 12 18 24 Q18 36 30 40 Q22 38 18 30 Q14 22 18 14 Q22 10 30 8" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/></svg>',

        // 五角星（替换 ⭐）
        star: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 6 L29 18 L42 20 L32 29 L35 42 L24 36 L13 42 L16 29 L6 20 L19 18 Z" fill="' + c + '" stroke="' + c + '" stroke-width="1.5" stroke-linejoin="round"/></svg>',

        // 钥匙（替换 🔑）
        key: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="24" r="8" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 24 L42 24" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/><path d="M36 24 L36 30" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/><path d="M40 24 L40 28" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/></svg>',

        // 印章
        seal: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="32" height="32" fill="none" stroke="' + c + '" stroke-width="2"/><rect x="12" y="12" width="24" height="24" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><path d="M16 20 L32 20" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M16 28 L32 28" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        // 毛笔
        brush: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M14 8 L34 8 L34 28 Q34 32 30 32 L18 32 Q14 32 14 28 Z" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M18 32 L18 38 Q18 42 24 42 Q30 42 30 38 L30 32" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M22 14 L26 14" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        // 卷轴
        scroll: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M8 14 Q8 10 12 10 L36 10 Q40 10 40 14 L40 38 Q40 42 36 42 L12 42 Q8 42 8 38 Z" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M14 18 L34 18" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M14 24 L34 24" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M14 30 L30 30" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        // 分享
        share: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="10" r="6" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="12" cy="32" r="6" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="36" cy="32" r="6" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M22 16 L14 26" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M26 16 L34 26" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        // 面具（替换 🤡，自嘲标签）
        mask: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M8 16 Q8 8 24 8 Q40 8 40 16 L40 32 Q40 40 24 40 Q8 40 8 32 Z" fill="none" stroke="' + c + '" stroke-width="2"/><circle cx="16" cy="22" r="3" fill="' + c + '"/><circle cx="32" cy="22" r="3" fill="' + c + '"/><path d="M16 30 Q24 34 32 30" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        // 灵光（替换 ✨）
        sparkle: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 6 L26 22 L42 24 L26 26 L24 42 L22 26 L6 24 L22 22 Z" fill="' + c + '" opacity="0.9"/><circle cx="24" cy="24" r="3" fill="' + c + '"/></svg>',

        // 菱形装饰点（替换 ◇）
        diamond: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 6 L42 24 L24 42 L6 24 Z" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/><path d="M24 14 L34 24 L24 34 L14 24 Z" fill="' + c + '" opacity="0.3"/></svg>',

        // 太极（替换 ☯）
        taiji: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 4 A20 20 0 0 1 24 44 A10 10 0 0 0 24 24 A10 10 0 0 1 24 4" fill="' + c + '" opacity="0.9"/><circle cx="24" cy="14" r="3" fill="' + c + '"/><circle cx="24" cy="34" r="3" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        // 对勾（VIP权益列表用）
        check: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M10 24 L20 34 L38 14" fill="none" stroke="' + c + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',

        // 关闭
        close: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M12 12 L36 36" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/><path d="M36 12 L12 36" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/></svg>',

        // 香炉（推演仪式感）
        incense: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M12 28 Q12 36 24 36 Q36 36 36 28" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M8 28 L40 28" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/><path d="M24 12 Q22 18 24 22 Q26 18 24 12" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><path d="M20 14 Q18 20 20 24" fill="none" stroke="' + c + '" stroke-width="1" opacity="0.4"/><path d="M28 14 Q30 20 28 24" fill="none" stroke="' + c + '" stroke-width="1" opacity="0.4"/></svg>',

        // 翻转切换（深度推演入口用）
        flip: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M8 18 Q8 12 14 12 L34 12" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/><path d="M30 8 L34 12 L30 16" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M40 30 Q40 36 34 36 L14 36" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/><path d="M18 32 L14 36 L18 40" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

        // ========================================
        // v2.0 装饰SVG图标系统（bagua/wuxing-decoration/gua-pattern）
        // ========================================

        // 八卦 — 乾 ☰（三阳爻）
        'bagua-qian': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="14" width="28" height="3" fill="' + c + '"/><rect x="10" y="22" width="28" height="3" fill="' + c + '"/><rect x="10" y="30" width="28" height="3" fill="' + c + '"/></svg>',

        // 八卦 — 兑 ☱（下二阳上一阴）
        'bagua-dui': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="14" width="12" height="3" fill="' + c + '"/><rect x="26" y="14" width="12" height="3" fill="' + c + '"/><rect x="10" y="22" width="28" height="3" fill="' + c + '"/><rect x="10" y="30" width="28" height="3" fill="' + c + '"/></svg>',

        // 八卦 — 离 ☲（上下阳中阴）
        'bagua-li': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="14" width="28" height="3" fill="' + c + '"/><rect x="10" y="22" width="12" height="3" fill="' + c + '"/><rect x="26" y="22" width="12" height="3" fill="' + c + '"/><rect x="10" y="30" width="28" height="3" fill="' + c + '"/></svg>',

        // 八卦 — 震 ☳（下阳上二阴）
        'bagua-zhen': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="14" width="12" height="3" fill="' + c + '"/><rect x="26" y="14" width="12" height="3" fill="' + c + '"/><rect x="10" y="22" width="12" height="3" fill="' + c + '"/><rect x="26" y="22" width="12" height="3" fill="' + c + '"/><rect x="10" y="30" width="28" height="3" fill="' + c + '"/></svg>',

        // 八卦 — 巽 ☴（下阴上二阳）
        'bagua-xun': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="14" width="28" height="3" fill="' + c + '"/><rect x="10" y="22" width="28" height="3" fill="' + c + '"/><rect x="10" y="30" width="12" height="3" fill="' + c + '"/><rect x="26" y="30" width="12" height="3" fill="' + c + '"/></svg>',

        // 八卦 — 坎 ☵（上下阴中阳）
        'bagua-kan': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="14" width="12" height="3" fill="' + c + '"/><rect x="26" y="14" width="12" height="3" fill="' + c + '"/><rect x="10" y="22" width="28" height="3" fill="' + c + '"/><rect x="10" y="30" width="12" height="3" fill="' + c + '"/><rect x="26" y="30" width="12" height="3" fill="' + c + '"/></svg>',

        // 八卦 — 艮 ☶（上阳下二阴）
        'bagua-gen': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="14" width="28" height="3" fill="' + c + '"/><rect x="10" y="22" width="12" height="3" fill="' + c + '"/><rect x="26" y="22" width="12" height="3" fill="' + c + '"/><rect x="10" y="30" width="12" height="3" fill="' + c + '"/><rect x="26" y="30" width="12" height="3" fill="' + c + '"/></svg>',

        // 八卦 — 坤 ☷（三阴爻）
        'bagua-kun': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="14" width="12" height="3" fill="' + c + '"/><rect x="26" y="14" width="12" height="3" fill="' + c + '"/><rect x="10" y="22" width="12" height="3" fill="' + c + '"/><rect x="26" y="22" width="12" height="3" fill="' + c + '"/><rect x="10" y="30" width="12" height="3" fill="' + c + '"/><rect x="26" y="30" width="12" height="3" fill="' + c + '"/></svg>',

        // 八卦方位图（外圈八卦排列）
        'bagua-circle': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.4"/><circle cx="24" cy="24" r="14" fill="none" stroke="' + c + '" stroke-width="1" opacity="0.3"/><path d="M24 4 L24 44" fill="none" stroke="' + c + '" stroke-width="1" opacity="0.5"/><path d="M4 24 L44 24" fill="none" stroke="' + c + '" stroke-width="1" opacity="0.5"/><path d="M10 10 L38 38" fill="none" stroke="' + c + '" stroke-width="1" opacity="0.3"/><path d="M38 10 L10 38" fill="none" stroke="' + c + '" stroke-width="1" opacity="0.3"/><circle cx="24" cy="24" r="4" fill="' + c + '" opacity="0.6"/></svg>',

        // 五行装饰 — 金（金元宝轮廓）
        'wuxing-jin': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M8 32 Q8 18 24 14 Q40 18 40 32 L36 36 L12 36 Z" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/><path d="M14 28 Q24 22 34 28" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><circle cx="24" cy="22" r="2" fill="' + c + '" opacity="0.8"/></svg>',

        // 五行装饰 — 木（树叶轮廓）
        'wuxing-mu': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 8 Q12 16 12 28 Q12 38 24 42 Q36 38 36 28 Q36 16 24 8" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 14 L24 38" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><path d="M24 22 L16 24" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><path d="M24 22 L32 24" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/></svg>',

        // 五行装饰 — 水（水滴轮廓）
        'wuxing-shui': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 6 Q12 22 12 32 Q12 42 24 42 Q36 42 36 32 Q36 22 24 6" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 18 Q18 26 20 32 Q22 36 24 36" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.5"/></svg>',

        // 五行装饰 — 火（火焰轮廓）
        'wuxing-huo': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 6 Q14 16 14 28 Q14 40 24 42 Q34 40 34 28 Q34 16 24 6" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 14 Q18 22 20 30 Q22 36 24 36 Q26 36 28 30 Q30 22 24 14" fill="' + c + '" opacity="0.3"/></svg>',

        // 五行装饰 — 土（山形轮廓）
        'wuxing-tu': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M6 40 L18 18 L24 28 L30 14 L42 40 Z" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/><path d="M14 32 L20 26" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.5"/><path d="M28 26 L34 22" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.5"/></svg>',

        // 卦象装饰纹样（六爻装饰）
        'gua-pattern': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="8" width="28" height="3" fill="' + c + '" opacity="0.9"/><rect x="10" y="16" width="12" height="3" fill="' + c + '" opacity="0.7"/><rect x="26" y="16" width="12" height="3" fill="' + c + '" opacity="0.7"/><rect x="10" y="24" width="28" height="3" fill="' + c + '" opacity="0.9"/><rect x="10" y="32" width="28" height="3" fill="' + c + '" opacity="0.7"/><rect x="10" y="40" width="12" height="3" fill="' + c + '" opacity="0.9"/><rect x="26" y="40" width="12" height="3" fill="' + c + '" opacity="0.9"/></svg>',

        // 日月纹样（用于match-card装饰）
        'sun-moon': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="24" r="8" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M16 14 L16 10 M16 38 L16 34 M6 24 L10 24 M22 24 L26 24" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M32 14 Q38 14 38 24 Q38 34 32 34 Q28 34 28 24 Q28 14 32 14" fill="none" stroke="' + c + '" stroke-width="2"/></svg>',

        // 双莲纹样（并蒂莲）
        'twin-lotus': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M16 36 Q14 26 16 18 Q18 26 16 36" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M32 36 Q30 26 32 18 Q34 26 32 36" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M16 22 Q12 20 8 22 Q12 24 16 22" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M32 22 Q36 20 40 22 Q36 24 32 22" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 36 L24 42" fill="none" stroke="' + c + '" stroke-width="2"/></svg>',

        // 阴阳鱼（与 taiji 不同，更装饰性）
        'yin-yang-fish': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M24 4 A20 20 0 0 1 24 44 A10 10 0 0 0 24 24 A10 10 0 0 1 24 4" fill="' + c + '" opacity="0.85"/><circle cx="24" cy="14" r="3" fill="none" stroke="' + c + '" stroke-width="1.5"/><circle cx="24" cy="34" r="3" fill="' + c + '" opacity="0.6"/></svg>',

        // 节气装饰图（春/夏/秋/冬四季符号）
        'season-spring': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 8 Q14 14 14 24 Q14 34 24 40 Q34 34 34 24 Q34 14 24 8" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 14 Q20 18 20 24 Q20 30 24 34" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><path d="M24 14 Q28 18 28 24 Q28 30 24 34" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><circle cx="24" cy="24" r="2" fill="' + c + '"/></svg>',

        'season-summer': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="10" fill="' + c + '" opacity="0.85"/><path d="M24 6 L24 12 M24 36 L24 42 M6 24 L12 24 M36 24 L42 24 M12 12 L16 16 M32 32 L36 36 M36 12 L32 16 M16 32 L12 36" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/></svg>',

        'season-autumn': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 8 Q12 14 12 26 Q12 36 24 40 Q36 36 36 26 Q36 14 24 8" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 14 L24 36" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><path d="M24 20 L16 22" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><path d="M24 20 L32 22" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><path d="M24 28 L16 30" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><path d="M24 28 L32 30" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/></svg>',

        'season-winter': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 6 L24 42 M6 24 L42 24 M12 12 L36 36 M36 12 L12 36" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/><path d="M24 14 L20 10 M24 14 L28 10 M24 34 L20 38 M24 34 L28 38" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M14 24 L10 20 M14 24 L10 28 M34 24 L38 20 M34 24 L38 28" fill="none" stroke="' + c + '" stroke-width="1.5"/></svg>',

        // 祥云纹样
        'cloud-pattern': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M8 30 Q8 22 16 22 Q18 14 26 16 Q34 14 36 22 Q42 22 42 30 Q42 34 36 34 L12 34 Q8 34 8 30" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/><path d="M14 26 Q16 24 18 26" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/><path d="M28 26 Q30 24 32 26" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.6"/></svg>',

        // 钱币纹样（圆形方孔）
        'coin-pattern': '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="18" fill="none" stroke="' + c + '" stroke-width="2"/><rect x="18" y="18" width="12" height="12" fill="none" stroke="' + c + '" stroke-width="2"/></svg>',

        // v3.4 通知中心图标（mail/leaf/info，修复图标缺失回退圆环）
        mail: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M6 14 L42 14 L42 38 L6 38 Z" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/><path d="M6 14 L24 28 L42 14" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',

        leaf: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 42 Q8 34 10 14 Q30 6 42 10 Q40 30 24 42" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round"/><path d="M14 18 Q24 14 34 16" fill="none" stroke="' + c + '" stroke-width="1.5"/><path d="M12 26 Q22 20 32 22" fill="none" stroke="' + c + '" stroke-width="1.5" opacity="0.7"/></svg>',

        info: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="19" fill="none" stroke="' + c + '" stroke-width="2"/><path d="M24 22 L24 34" fill="none" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="15" r="2" fill="' + c + '"/></svg>'
      };
      // v2.0 修复：未知图标名时输出警告，便于排查
      if (!icons[name]) {
        console.warn('[icon-guo] 未知图标名:', name);
        return icons['lianzi'];
      }
      return icons[name];
    }
  }
});
