---
name: aisd-09-feedback
version: 0.0.1-placeholder
description: >
  [Phase 2 占位] AI 短剧数据回流 Agent。读 08-distribution 已发布的 post URLs，
  通过 agent-reach 拉播放/点赞/评论/转发/完播数据，做归因分析，反馈给 01-topic（下次选题）
  和 02-script（节拍优化建议）。
  现阶段仅占位，P0 不可调用。
  触发词: "数据回流", "feedback", "analytics", "/aisd-09-feedback"
user_invocable: false
---

# aisd-09-feedback: AI 短剧数据回流（Phase 2 占位）

**当前状态：未实现（Phase 2）。**

P0 已经在 01/02/04/05 留下完整的"创作意图"轨迹：

- 01-topic: hook / twist / payoff 的设计意图 + audience_profile + reference_works
- 02-script: beat_sheet 节拍点
- 04-storyboard: shot 节奏 + camera 选择
- 05-video: qa_score 与 retry_count（生成质量基线）

09-feedback 把这些"意图"与实际"播放数据"做归因。

## Phase 2 计划

1. `modules/01-fetch-metrics.md` — 用 agent-reach 拉 08 发布的每条 post 的指标（views / likes / comments / completion_rate / shares）
2. `modules/02-attribution.md` — 把指标归因到 beat / shot / hook 设计
   - 完播率断点 → 哪一拍流失最多
   - 高赞评论关键词 → 命中了哪个 emotional_trigger
   - 互动型评论 → CTA 起效
3. `modules/03-cross-version-compare.md` — 多语种 / 多平台对照（同一剧本不同地区表现差异）
4. `modules/04-feedback-to-01.md` — 给 01-topic 写一份"下次选题建议"（哪些钩子有效）
5. `modules/05-feedback-to-02.md` — 给 02-script 写"节拍优化建议"（这次 beat_sheet 哪段流失最多）

## 启动行为

```
STOP: aisd-09-feedback 尚未实现（Phase 2）。

完成 08-distribution + 等待 48-72h 后，你可以：
  - 手工查指标：用 agent-reach 读你发布的 post
  - 等 Phase 2 实现
```

## 数据闭环

09 → 01 / 02 形成闭环。建议长期跟踪：

- 同一 audience_profile 在不同 logline 下的完播率
- 同一 beat_sheet 模板在不同 logline 下的留存曲线
- 同一 hook 模板在不同 platform 下的差异
