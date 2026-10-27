/**
 * utils/audio.js - 音效播放
 * 音频文件存放在 assets/audio/ 本地目录
 */
// 🔴 v3.4 修复：key 改为 kebab-case，与所有调用方 soundManager.play('button-tap') 等保持一致
const SOUNDS = {
  'button-tap': '/assets/audio/button-tap.wav',
  'click': '/assets/audio/click.wav',
  'error': '/assets/audio/error.wav',
  'profile-save': '/assets/audio/profile-save.wav',
  'success': '/assets/audio/success.wav'
};

class SoundManager {
  constructor() {
    this.enabled = true;
  }

  init() {
    // 初始化检查
    try {
      if (wx.canIUse('getDeviceInfo')) {
        wx.getDeviceInfo();
      }
    } catch (e) {
      this.enabled = false;
    }
  }

  play(name) {
    if (!this.enabled) return;
    const src = SOUNDS[name];
    if (!src) return;

    try {
      const audio = wx.createInnerAudioContext();
      audio.src = src;
      audio.volume = 0.5;
      audio.play();
      audio.onEnded(() => audio.destroy());
      audio.onError(() => audio.destroy());
    } catch (e) {
      console.error('Audio play failed:', name, e);
    }
  }
}

module.exports = new SoundManager();
