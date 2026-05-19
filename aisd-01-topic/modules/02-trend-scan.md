# Module 2: Trend Scan

> Core Question: 近 30 天目标平台 + 目标方向上，有哪些题材 / 钩子 / BGM / hashtag 在上升？

## Inputs from Module 1

- `platform`、`target_duration_s`、`hook_window_s`、`language`、`platform_quirks[]`
- 用户方向描述 `direction`

## Data Sources

### A: 平台热搜 / 热门 hashtag（via agent-reach）

**调用：**
```
agent-reach get_hashtags --platform={{platform}} --window=30d --topic={{direction_keywords}}
agent-reach get_trending_audio --platform={{platform}} --window=14d
```

**Extract:**
- 与 direction 相关的热门 hashtag（含使用次数 / 视频数）
- 上升最快的 BGM（标题 / 创作者 / 使用片段数）

### B: 类目热门作品（via agent-reach）

**调用：**
```
agent-reach get_trending --platform={{platform}} --category=drama --keyword={{direction}} --limit=30
agent-reach get_trending --platform={{platform}} --window=7d --limit=10
```

**Extract:**
- 30 条相关爆款的 title / hook 文字 / 第一帧描述
- 7 天榜首作品 10 条（用于检测平台当前算法偏好）

### C: 跨平台对照（可选）

如果目标是 douyin → 同时拉一遍 kuaishou 同主题，看是否是平台特有现象。如果目标是 tiktok → 同时拉 instagram_reels。

**Extract:**
- 该题材是否在多平台都热（高置信）vs 仅在单平台热（platform-specific 红利窗口）

## Analysis Output

写到 `_cache/m02-trend-scan.md`：

1. **rising_topics[]** — 5-10 个上升题材（含上升幅度估计 + 1-2 个例证 URL）
2. **trending_hooks[]** — 5-10 条爆款用的钩子文字 / 视觉范式
3. **trending_audio[]** — 5-8 个 BGM（标题 + 使用次数级别 + url）
4. **trending_hashtags[]** — 5-10 个 hashtag（含视频数级别）
5. **multi_platform_validated[]** — 哪些题材跨平台都热（差异化窗口判定依据）
6. **claim_meta** — 每条都带 sources[] + confidence（agent-reach 计 platform, web 文章计 web）

## Decision Gate

- 若 `rising_topics[]` 与用户 `direction` 完全无交集（用户方向是冷门 + 平台没人做）→ PAUSE：`"目标方向在 {{platform}} 近 30 天无热度迹象。是否继续？(继续/换方向)"`
- 否则：proceed to Module 3

## Data Passing to Next Module

传给 Module 3：

- `rising_topics[]` 与 `direction` 的交集 — 用于锁定对标账号搜索关键词
- `trending_hooks[]`、`trending_hashtags[]` — 评估对标账号时的对照基准
- `multi_platform_validated[]` 标记
