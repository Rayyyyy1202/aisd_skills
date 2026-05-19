# Module 4: Audience Persona

> Core Question: 看这类内容的人是谁？什么时间刷？什么情绪触点会让他们点赞 / 转发 / 完播？

## Inputs from Module 3

- `competitor_cards[]`
- 头部账号的高赞评论关键词
- `pattern_clusters`（钩子类型分布）

## Data Sources

### A: 评论文本分析（聚合 Module 3 的评论）

**输入：** Module 3 已抓取的 50-150 条评论文本

**Extract:**
- 评论中出现的人物代称（"我妈"、"我老板"、"前夫" 等 → 暗示观众身份）
- 情绪词频（愤怒 / 委屈 / 解气 / 感动 / 共鸣）
- 转发 / 收藏 / "求续集" 类的内驱力词
- 用户自报的观看场景（"上班摸鱼看"、"睡前看"、"通勤"）

### B: 平台官方画像数据（via WebSearch + agent-reach）

**WebSearch:**
```
"{{platform}} 用户画像 2026"
"{{platform}} short drama audience demographics 2026"
```

**Extract:**
- 平台整体 demographics
- drama 品类下的用户偏离（更年轻？更下沉？地域分布？）

### C: 跨平台对比（可选）

如果 multi_platform_validated 命中 → 各平台用户画像差异（同一题材在 douyin 和 kuaishou 的受众大概率不同）

## Analysis Output

写到 `_cache/m04-audience-persona.md`：

1. **target_audience[]** — 1-3 个 `AudienceProfile`（schema 见 _common#/$defs/AudienceProfile）
   - `id` = `audience_NNN`
   - `name`（一句话画像，如 "都市职场新人女性 24-30"）
   - `size_estimate_band`
   - `demographics`：age_band、gender_skew、geo
   - `psychographics.emotional_triggers[]` — 至少 3 条（来自评论 + 对标）
   - `psychographics.interests[]`
   - `platforms[]` — 这个 audience 最活跃的平台 1-3 个
2. **viewing_moments[]** — 高频观看场景（"早通勤 7-9"、"午休 12-13"、"睡前 22-24"）— 影响 logline 节奏密度

## Decision Gate

无 gate — 总是进入 Module 5。

## Data Passing to Next Module

传给 Module 5：

- `target_audience[]` — logline 必须命中其中至少 1 个 audience 的 emotional_triggers
- `viewing_moments[]` — 决定 logline 节奏（午休观众容忍 1 分钟内反转，睡前观众接受 2 分钟铺垫）
- 来自 Module 3 的 `pattern_clusters` + Module 2 的 `rising_topics[]` 一并下传
