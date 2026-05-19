# Module 5: Topic Shortlist

> Core Question: 把方向变成 5-10 条具体可拍 logline，按热度 / 可拍性 / 差异化打分。

## Inputs from Module 4

- `target_audience[]`（含 emotional_triggers）
- `viewing_moments[]`
- `pattern_clusters`（Module 3）
- `rising_topics[]`（Module 2）
- `platform_quirks[]`（Module 1）
- 用户原始 `direction`

## Data Sources

无外部源 — 这是创意合成模块。但你 MUST 引用前 4 个模块的具体数据，不能凭空生成。

## Process

### Step 1: 候选生成

按 `pattern_clusters` 的每类钩子，结合 `rising_topics[]`，生成 5-10 条候选 logline。每条必须有：

- `text`（1-2 句完整 pitch，目标语言）
- `hook`（0-3s 抓人的画面 / 文字）
- `twist`（中段反转）
- `payoff`（结尾爆点 / CTA）
- `genre`（urban_drama / office_drama / romance / ... 见 schema enum）
- `borrowed_from` — 借鉴了 `competitor_cards[*].id` 中的哪个（如 `comp_002` 的"误会型"钩子）

### Step 2: 评分（3 个维度，每维 0-100）

- **热度匹配 (heat)**：命中多少条 `rising_topics[]`、`trending_hashtags[]`、`trending_audio[]` 适用度
- **可拍性 (feasibility)**：所需角色数 ≤ 4、场景数 ≤ 3、特效需求低 → 加分；多动作/外景/异国 → 减分（AI 短剧的现实约束）
- **差异化 (uniqueness)**：与 `competitor_cards[*].top_work_first_3s_visual` 完全重叠 → 减分；有独特视觉/钩子 → 加分

总分 = (heat + feasibility + uniqueness) / 3

### Step 3: 写到 `_cache/m05-shortlist.md`

```markdown
# Shortlist

## #1 score=85 (heat=88 feas=92 uniq=75)
**Text:** 升职宴上她敬酒被泼脸，转身掏出了实控人印章。
**Hook (0-3s):** 高管宴会，主角端酒，酒被泼脸特写
**Twist:** 镜头跟到她包里掏出印章
**Payoff:** "我才是实控人"  → 全场静默 → CTA "下集解谜"
**Genre:** office_drama
**Borrowed from:** comp_002 (反差型)
**Rejected risk:** 高管题材 douyin 容易被限流

## #2 ...
```

## Output

向用户展示完整 shortlist：

```
我准备了 N 条 logline，按总分排序：

[#1] 升职宴上她敬酒被泼脸，转身掏出了实控人印章  (85)
[#2] ...
[#3] ...
...

请挑一条进入剧本阶段，或说"全部不要，换批"。
```

## Decision Gate

- 若所有候选 < 60 分 → 自动回到 Module 2 重抓 trend（说明输入方向太弱）
- 否则：等用户挑选 → Module 6

## Data Passing to Next Module

传给 Module 6：

- 用户选定的那一条 logline（含 hook / twist / payoff / genre）
- 所有候选（写到 `shortlist_history[]` 作为审计轨迹）
- 来自 Module 1-4 的全部产出（用于组装最终 output.json）
