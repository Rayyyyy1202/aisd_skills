# Module 2: Beat Sheet

> Core Question: 按秒切节拍，每个 beat 在哪一秒发生、要传递什么信息？

## Inputs from Module 1

- `structure.template` / `structure.act_count`
- `target_duration_s`、`hook_window_s`
- `logline.hook / twist / payoff`

## Data Sources

无外部源。

## Process

### 按模板填默认 beat

**hook_twist_payoff（60s 模板）：**
```
t=0     hook        — 高度刺激的开场画面 / 反常规问句
t=3     setup       — 铺垫情境与悬念
t=15    escalation  — 矛盾升级
t=30    twist       — 反转
t=45    revelation  — 揭示反转的"为什么"
t=55    payoff/cta  — 爆点 + 引导追更
```

**multi_reversal（120s 模板）：**
```
t=0      hook
t=3      setup
t=20     reversal_1
t=40     escalation
t=70     reversal_2
t=95     climax
t=110    payoff/cta
```

**3_act（180s 模板）：**
```
t=0      hook
t=5      setup
t=15     inciting
t=45     act2_start (lock in)
t=90     midpoint
t=135    crisis
t=160    climax
t=175    resolution
```

**kishōtenketsu（90s 模板）：**
```
t=0      ki (引入)
t=20     shō (发展)
t=45     ten (转折)
t=75     ketsu (合)
```

按 `target_duration_s` 等比缩放每个 t 值。

### 硬约束

- **第一个 beat `t_s == 0`**（不留空白）
- **第一个有强信息 beat `t_s ≤ hook_window_s`**（否则用户划走）
- 最后一个 beat `t_s ≤ target_duration_s - 2`（留 2s 给 CTA 收尾）
- beats 数量：60s 短片 ≤ 6 beats，180s ≥ 6 beats

### 填充内容

每个 beat 写：
- `t_s`：发生时间
- `name`：beat 类型（hook / setup / escalation / reversal / climax / payoff / CTA）
- `description`：1 句话说这一拍要传达什么信息或情绪

## Analysis Output

写到 `_cache/m02-beat-sheet.md`：

```markdown
# Beat Sheet (template={{template}}, total={{target_duration_s}}s)

| t_s | name | description |
|---|---|---|
| 0  | hook | <一句话> |
| 3  | setup | <...> |
| ...
```

## Decision Gate

- 校验：第一个 strong-info beat ≤ hook_window_s（不满足 → 重排）
- 校验：beats 数量在合理区间
- 通过 → proceed to Module 3

## Data Passing to Next Module

传给 Module 3：

- `beat_sheet[]`（完整节拍）
- 用于把 beats 映射成 scenes：每 1-2 个 beat 对应 1 个 scene；同一 scene 内可包含多个 beats（一镜到底）
