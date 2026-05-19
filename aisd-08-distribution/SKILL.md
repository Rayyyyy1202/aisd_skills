---
name: aisd-08-distribution
version: 0.0.1-placeholder
description: >
  [Phase 2 占位] AI 短剧分发 Agent。读 07-editing.final.mp4（多版本）+ 01-topic.target_audience + topic_tags，
  发布到目标平台（Douyin / TikTok / Kuaishou / YouTube Shorts / Bilibili / XHS）+ 跑投流（可选）+
  做本地化（localization_targets 多语种版本）。需要平台 OAuth + ads 账户。
  现阶段仅占位，P0 不可调用。
  触发词: "分发", "发布", "投流", "publish", "/aisd-08-distribution"
user_invocable: false
---

# aisd-08-distribution: AI 短剧分发（Phase 2 占位）

**当前状态：未实现（Phase 2）。**

P0 已预留：

| 字段 | 上游 | 描述 |
|---|---|---|
| `01-topic.platform_profile.platform` | 01 | 默认目标平台 |
| `01-topic.target_audience[]` | 01 | 投流的人群基线（age_band / geo / interests） |
| `01-topic.topic_tags[]` | 01 | 发布 hashtag |
| `01-topic.localization_targets[]` | 01 | 多语种版本（与 06/07 配合） |
| `05-video.compliance_tags[]` | 05 | 平台合规标签 |

## Phase 2 计划

1. `modules/01-platform-config.md` — OAuth 配置（最少 2 平台，douyin + youtube_shorts）
2. `modules/02-publish-jobs.md` — 把每个 (语种, 平台) 组合做成一条 publish job
3. `modules/03-pre-publish-check.md` — 平台合规校验（时长 / 标签 / 文案 / AI 标识）
4. `modules/04-publish-loop.md` — Agent Loop 单 job 发布（不并行，平台 rate limit 严）
5. `modules/05-ads-optional.md` — 投流（可选，类似 amazon-sp-ads 风格的人群定向）
6. `modules/06-publish-report.md` — 输出 publish_log.json（含每条 post 的平台 URL）

## 启动行为

```
STOP: aisd-08-distribution 尚未实现（Phase 2）。

P0 已为你预留：target_audience / topic_tags / localization_targets / compliance_tags。

完成 07-editing 后，你可以：
  - 手工上传：把 final.mp4 上传到目标平台，hashtag 用 01-topic.topic_tags
  - 等 Phase 2 实现
```

## 安全提醒

本 skill 涉及 OAuth + 真实发布操作。Phase 2 实现时必须遵守：
- 强制人工确认每条 publish job（参照 [feedback_amazon_ads_workflow]）
- 永不投钱（投流）前未经用户明确确认
- 平台 token 走 OS keychain，不进 .env
