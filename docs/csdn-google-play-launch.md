# 从0到1上架Google Play：一个传统文化App的出海记录

> 本文记录了我们将基于易经64卦的人格测试App"天机推演"上架Google Play的全过程，包括ASO优化、合规要求、SEO配合等实战经验。

## 为什么做这个产品

MBTI火了，九型人格火了，但有一个比它们早了3000年的人格分类系统——易经64卦——一直没有被很好地产品化。

每个卦象对应一种人格原型，64种人格类型，两两组合有4096种合盘关系。这比MBTI的16型细致得多。

## Google Play上架踩过的坑

### 1. 隐私政策和数据安全表单

Google Play要求必须有：
- 隐私政策URL（必须是可公开访问的网页）
- 数据安全表单（声明收集了哪些数据）
- 应用内容分级（IARC问卷）

我们的隐私政策页面：https://claw-book.cn/privacy.html

### 2. 应用图标和截图

Feature graphic（1024x500）是必须的，手机截图至少2张。我们用了六爻卦象作为主视觉，和品牌统一。

### 3. 描述文案的ASO技巧

标题关键词要前置：
- 标题：I Ching Insight: I Ching Personality
- 短描述：Discover your I Ching birth hexagram, 64 personality types

长描述前3行最关键，会在搜索结果中展示。

## 官网SEO配合

上架前后做的SEO工作：
- 224个静态页面的sitemap.xml提交
- hreflang双语标签配置
- Google Indexing API主动推送
- JSON-LD结构化数据（SoftwareApplication类型）
- llms.txt文件（给AI爬虫读的）

官网：https://claw-book.cn

App下载：https://play.google.com/store/apps/details?id=com.clawbook.tianji

## 冷启动经验

1. **Medium发英文文章**：在Medium发了5篇I Ching相关文章，bio里挂官网链接
2. **社交媒体矩阵**：统一品牌名I Ching Insight，在X/Instagram/Facebook/Reddit都注册了
3. **不要硬广**：Reddit和Quora上明显的推广帖会被删，要以分享经验的方式自然提及

## 总结

上架只是开始。Google Play的优化是一个持续过程：
- 持续优化截图和描述
- 争取早期用户评价
- 配合官网SEO带来外部流量
- 关注关键词排名变化

---

*本文为产品出海实战记录，欢迎交流。*
