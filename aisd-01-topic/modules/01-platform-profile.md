# Module 1: Platform Profile

> Core Question: 这个目标平台的爆款时长 / 比例 / 钩子窗口 / 货币化模式是什么？有哪些硬规则？

## Inputs from Step 1

- `direction`: 用户的方向描述（中/英）
- `platform`: 目标平台（douyin / tiktok / kuaishou / bilibili / xhs / youtube_shorts / youtube / instagram_reels / weibo）
- `language`: 目标语种（BCP-47）

## Data Sources

### A: 平台已知规范（内置知识 + Web 校验）

**WebSearch / WebFetch 查询：**
```
"{{platform}} 短剧 推荐机制 2026"
"{{platform}} short drama best practices 2026"
"{{platform}} algorithm shorts duration 2026"
"{{platform}} content policy ai generated"
```

**Extract:**
- 推荐时长区间（s）
- 默认 aspect ratio
- 推荐分辨率
- 黄金钩子窗口（多少秒内用户决定是否划走）
- AI-generated content 是否需要打标
- 货币化模式（广告分成 / 打赏 / 付费剧集 / 直播跳转 / 电商挂车）

### B: agent-reach 读平台爆款榜（实时数据）

**调用：**
```
agent-reach get_trending --platform={{platform}} --category=drama --limit=20
```

**Extract:**
- 前 20 个热门短剧作品的实际时长分布（中位 / 均值）
- 实际 aspect 分布
- 实际 BGM 使用率
- 字幕样式倾向（硬字幕 / 软字幕 / 弹幕）

### C: 内容政策 / 合规要求

**WebFetch:**
```
{{platform 官方 content policy 页面}}
{{platform 官方 ai content disclosure 页面}}
```

**Extract:**
- 必须打的合规标签（如 douyin AI 内容需打 "AI 生成"）
- 禁忌题材（地区/政治/医疗/金融）
- 字数 / 时长上限

## Analysis Output

写到 `_cache/m01-platform-profile.md`：

1. **target_duration_s** — 基于实际数据中位 + 推荐区间，给一个最终值
2. **aspect** — 一个值（9_16 / 16_9 / 1_1 / 4_5）
3. **resolution_recommended** — `WxH`
4. **hook_window_s** — 钩子必须在多少秒内出现（数据驱动）
5. **monetization_modes[]** — 该平台对 drama 类目实际开放的模式
6. **platform_quirks[]** — 至少 3 条平台硬规则 / 软规则（如"douyin 前 1.5s 静帧会被算法降权"）
7. **compliance_required[]** — 必须打的标签

## Decision Gate

- 若 platform 政策禁止 AI 生成戏剧内容（如部分国家版 TikTok）→ PAUSE：`"{{platform}} 当前限制 AI 短剧，是否换平台或仅做练习？(Y/n)"`
- 否则：proceed to Module 2

## Data Passing to Next Module

传给 Module 2：

- `platform`、`target_duration_s`、`hook_window_s` — trend-scan 用来过滤无关时长的样本
- `language` + `region` — 决定 trend-scan 的地域口径
- `platform_quirks[]` — 后续模块都会用，作为约束条件
