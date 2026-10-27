/**
const i18n = require('./i18n.js');
 * utils/rewardAd.js - 激励视频广告封装（v17.0 积分体系）
 * 官方文档：https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/ad/rewarded-video-ad.html
 * 仅微信小程序端可用（App 端 Donut 不支持 wx.createRewardedVideoAd，调用方需先判断）
 * 用法：
 *   const rewardAd = require('../../utils/rewardAd.js');
 *   rewardAd.showAndReward(() => { ... 完整看完回调（调 /api/points/ad-reward 领积分）... });
 */
const AD_UNIT_ID = 'adunit-b1076c917f651348';

// 页面级缓存实例（官方建议同一页面复用实例）
let videoAd = null;
let adLoadFailed = false;

function createAd(onReward) {
  if (!wx.createRewardedVideoAd) return null;
  videoAd = wx.createRewardedVideoAd({ adUnitId: AD_UNIT_ID });
  videoAd.onLoad(() => { adLoadFailed = false; });
  videoAd.onError((err) => {
    adLoadFailed = true;
    console.error('[rewardAd] 激励视频广告加载失败', err);
  });
  videoAd.onClose((res) => {
    // res && res.isEnded：完整观看才发奖励；中途关闭不发
    if (res && res.isEnded) {
      if (typeof onReward === 'function') onReward();
    } else {
      wx.showToast({ title: i18n.isEn() ? 'Watch the full video to earn points' : '完整看完才能获得积分哦', icon: 'none' });
    }
  });
  return videoAd;
}

/**
 * 展示广告；看完（isEnded）后回调 onReward
 * @param {Function} onReward 完整看完回调
 */
function showAndReward(onReward) {
  // 重新绑定 onClose（保证回调指向最新闭包）
  if (!videoAd) {
    createAd(onReward);
  } else {
    videoAd.onClose((res) => {
      if (res && res.isEnded) {
        if (typeof onReward === 'function') onReward();
      } else {
        wx.showToast({ title: '完整看完才能获得积分哦', icon: 'none' });
      }
    });
  }
  if (!videoAd) {
    wx.showToast({ title: i18n.isEn() ? 'Video ads not supported in this environment' : '当前环境暂不支持视频广告', icon: 'none' });
    return;
  }
  videoAd.show().catch(() => {
    // 失败重试：先 load 再 show
    videoAd.load()
      .then(() => videoAd.show())
      .catch((err) => {
        console.error('[rewardAd] 激励视频广告显示失败', err);
        wx.showToast({ title: i18n.isEn() ? 'Ad failed to load, please retry' : '广告加载失败，请稍后再试', icon: 'none' });
      });
  });
}

module.exports = { showAndReward, createAd, AD_UNIT_ID };
