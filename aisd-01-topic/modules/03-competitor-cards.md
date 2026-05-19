# Module 3: Competitor Cards

> Core Question: 跟我方向相近的 3-8 个对标账号是谁？他们用什么钩子、什么节奏、什么货币化？

## Inputs from Module 2

- `rising_topics[]ranked` ∩ `direction`
- `trending_hooks[]`、`trending_hashtags[]`
- `platform`

## Data Sources

### A: 平台账号搜索（via agent-reach）

**调用：**
```
agent-reach search_accounts --platform={{platform}} --keyword="{{rising_topic_i}} 短剧" --limit=5
（对每个 rising_topic 并行 sub-agent）
```

**Extract per account:**
- account_name、url、粉丝量级（10k-100k / 100k-1m / 1m-10m / 10m+）
- 近 30 天发布量 / 平均播放量级
- 是否开通直播 / 挂车 / 付费剧集

### B: 头部作品拆解（via agent-reach）

对每个对标账号，拉 1-2 条爆款作品：

**调用：**
```
agent-reach get_account_top --platform={{platform}} --account={{account_id}} --window=90d --limit=3
```

**Extract per top work:**
- 完整 title
- 第一帧 0-3s 描述（视频截帧 + 文字 hook）
- 节奏：每多少秒一次反转 / 信息量
- BGM 是否套用热门
- 字幕 / 文案风格

### C: 评论挖掘（选做，仅对头部 1-2 个账号）

**调用：**
```
agent-reach get_comments --platform={{platform}} --video_url={{top_work_url}} --limit=50
```

**Extract:**
- 高赞评论关键词（用户为什么被打动 / 不爽）— 给 Module 4 用

## Analysis Output

写到 `_cache/m03-competitor-cards.md`：

1. **competitor_cards[]** — 3-8 条卡片，每张含：
   - `id` = `comp_NNN`
   - `account_name`、`platform`、`url`、`follower_band`、`avg_views_band`
   - `key_insight` — 一句话：他为什么这么火
   - `hooks_used[]` — 该账号反复使用的钩子模板
   - `top_work_url`、`top_work_first_3s_visual`
   - `claim_meta.sources[]`（含 account url + top work url）+ `confidence`
2. **pattern_clusters** — 把对标账号按"钩子类型"聚类（如：误会型 / 装弱型 / 反差型 / 悬念型），每类给 2-3 个案例

## Decision Gate

- 若找到的对标账号 < 3 → 拓展：放宽关键词或换 rising_topic。仍 < 3 → PAUSE：`"找不到足够对标，方向可能太冷门或太新。继续/重选方向？"`
- 否则：proceed to Module 4

## Data Passing to Next Module

传给 Module 4：

- `competitor_cards[]`（用于受众画像反推）
- 头部评论关键词（高赞评论的情绪触发词，是受众画像的最强信号）
- `pattern_clusters`（钩子类型分布 — 决定 logline 候选的方向）
