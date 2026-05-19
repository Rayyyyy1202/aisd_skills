# Module 1: Structure Template

> Core Question: 给这条 logline + 这个平台 + 这个时长，最合适的叙事结构是什么？

## Inputs from Upstream (01-topic)

- `logline`（含 hook / twist / payoff / genre）
- `platform_profile.target_duration_s`、`hook_window_s`
- `target_audience`（情绪触点 → 影响节奏密度）

## Data Sources

无外部源 — 这是结构选择 + 创意决策。

## Process

### 候选结构模板

| Template | 适用 | 平均时长 |
|---|---|---|
| `3_act` | 经典三幕，适合 ≥ 3 分钟内容 | 180-600s |
| `hook_twist_payoff` | douyin / TikTok 标配 | 30-90s |
| `kishōtenketsu` | 起承转合，适合慢节奏 / 情感系 | 60-180s |
| `multi_reversal` | 多次反转（爽剧 / 复仇）| 90-300s |
| `fragment_montage` | 碎片化片段，靠 BGM 串 | 30-60s |
| `loop` | 循环 / 开头即结尾 | 30-90s |

### 选择规则

- `target_duration_s ≤ 60` → `hook_twist_payoff` 或 `fragment_montage` 或 `loop`
- `target_duration_s 60-180` → `hook_twist_payoff` / `multi_reversal` / `kishōtenketsu`
- `target_duration_s > 180` → `3_act` / `multi_reversal`

按 logline.genre 微调：
- `office_drama` / `urban_drama` 偏 `multi_reversal`
- `romance` / `family` 偏 `kishōtenketsu`
- `comedy` 偏 `hook_twist_payoff` 或 `loop`
- `suspense` / `thriller` 偏 `3_act` 或 `multi_reversal`

## Analysis Output

```
我推荐的结构（按适配度排序）：

[#1] multi_reversal (适配 85%)
     - 优势：cscript.act_count=3, beat 数 6-8, 给观众 2 次"爽"
     - 风险：节奏过密容易看不清反转铺垫

[#2] hook_twist_payoff (适配 80%)
     - 优势：经典 douyin 节奏，钩子-反转-CTA
     - 风险：单反转可能不够"爽"

[#3] 3_act (适配 60%)
     - 优势：人物弧线完整
     - 风险：60s 时长撑不开三幕

请选择（或说"自定义"）：
```

## Decision Gate

- 等用户选 → proceed to Module 2 with `structure.template` / `structure.act_count`
- 用户说"自定义"→ 给出自由对话，让用户描述自己想要的节拍

## Data Passing to Next Module

传给 Module 2：

- `structure.template`（用于 M2 选 beat 模板）
- `structure.act_count`
- 来自 01-topic 的 `target_duration_s`、`hook_window_s`、`logline.hook/twist/payoff`
