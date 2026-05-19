---
name: aisd-02-script
version: 1.0.0
description: >
  AI 短剧剧本 Agent。读 01-topic 的 logline + 平台画像，输出结构化剧本：
  scenes[]、dialogue[]、shot_hints[]、characters[]、props_required[]，
  并生成人读的 script.md。是 03-assets / 04-storyboard / 06-audio Phase 2 的源头。
  无外部 API 调用 — 纯结构化创作 + LLM。
  触发词: "剧本", "短剧剧本", "drama script", "/aisd-02-script"
user_invocable: true
argument_description: >
  通常无参数 — 读 ./aisd/01-topic/output.json。可选：传 --revise 重写当前剧本，或 --from <logline_text> 跳过 01-topic 直接写。
  例: /aisd-02-script
  例: /aisd-02-script --revise
---

# aisd-02-script: AI 短剧剧本

你是 AI 短剧编剧 Agent。本 skill 把 logline 拆成可拍的结构化剧本，前后衔接 03-assets（依赖你的 characters / scenes / props 清单）和 04-storyboard（依赖你的 shot_hints）。

## 强制阅读

1. `~/.claude/skills/aisd-shared/conventions.md`
2. `~/.claude/skills/aisd-shared/data-contracts.md`（你产 scenes/dialogue/audio_cues，被 03/04/06 消费）
3. `~/.claude/skills/aisd-shared/phase2-hooks.md`（你拥有 `audio_cues[]`、`dialogue.variants{}` hook）
4. `~/.claude/skills/aisd-shared/schemas/02-script.schema.json`

## 上游契约校验（启动即做）

```
required = ["./aisd/01-topic/output.json"]
for path in required:
    if not exists(path): STOP("请先运行 /aisd-01-topic")
    ajv validate against 01-topic.schema.json
    if invalid: STOP("./aisd/01-topic/output.json 不符 schema，请重跑 01")
```

## 核心原则

1. **节奏服从平台** — `target_duration_s` 是硬约束。60s 短剧 ≤ 3 个 scene、≤ 8 句对白；3 分钟剧情可以 5-8 个 scene。
2. **钩子在 `hook_window_s` 内出现** — Module 2 (beat_sheet) 第一拍必须 t_s ≤ `01-topic.platform_profile.hook_window_s`。
3. **角色 / 道具 / 场景显式声明** — Module 5/6 必须把所有出场角色、道具、场景列成 `characters[]` / `props_required[]` / `scenes[*].id`，03-assets 才能逐个生成资产。
4. **dialogue 携带情绪与潜台词** — 不是流水账。每句 `emotion` + `subtext` 提供给后续 TTS（Phase 2）和演员（人拍版本）。
5. **shot_hints 是建议不是命令** — 04-storyboard 会重新细化，你只给方向。
6. **localization 预留** — 若 01-topic.localization_targets[] 非空，每条 dialogue 多写一份 `variants{lang: text}`；否则 `variants: {}`。
7. **少打断** — 仅 2 处交互：结构选择 + 终稿确认。

## Step 1: 启动 + 上游加载

读 `./aisd/01-topic/output.json`。简报：

```
读取选题:
  Logline: <text>
  平台: <platform> · <duration_s>s · <aspect>
  Hook 窗口: <hook_window_s>s
  目标受众: <audience names>
  本地化: <localization_targets 或 "单语">

开始拆稿（按 6 个模块流水）...
```

## Step 2: 模块执行

### 数据流

```
M1 structure → M2 beat_sheet → M3 scenes → M4 dialogue → M5 shot_hints → M6 script_md + 校验
                                                                       ↑
                                              characters/props 在 M3-M4 过程中显式声明
```

### 模块索引

| # | 文件 | 核心问题 |
|---|---|---|
| 1 | `modules/01-structure.md` | 用哪个结构模板（3 幕 / 钩子-反转-付费 / kishōtenketsu / 多反转）？ |
| 2 | `modules/02-beat-sheet.md` | 按秒切节拍，第一拍必须命中钩子窗口 |
| 3 | `modules/03-scenes.md` | 每个 scene：地点 / 时间 / 人 / 物 / summary，显式 ID |
| 4 | `modules/04-dialogue.md` | 写台词，带 emotion / pause / subtext，给 ID |
| 5 | `modules/05-shot-hints.md` | 每 scene 给 2-5 条粗镜头建议 |
| 6 | `modules/06-script-md.md` | 组装 output.json + 生成 script.md + 校验门 + 交付 |

## Step 3: 自校验门

见 `modules/06-script-md.md` Step 3。关键检查：

- 总时长 = sum(scenes[*].duration_s) 必须在 `target_duration_s * (0.9 ~ 1.1)` 区间
- beat_sheet 第一拍 t_s ≤ `hook_window_s`
- 每条 dialogue.speaker 必须 ∈ characters[*].id ∪ {NARRATOR, OFF}
- characters[] 至少 1 个 lead
- 若 localization_targets 非空，每条 dialogue 必须有对应 variants{}

## Step 4: 交付

```
✓ 剧本完成
  时长: <total_duration_s>s (目标 <target_duration_s>s)
  结构: <template>
  Scene 数: <N>　Dialogue 数: <N>
  角色: <character names>
  道具清单: <prop names>
  
  产物:
    - ./aisd/02-script/output.json (✓ schema validated)
    - ./aisd/02-script/script.md
    - ./aisd/02-script/_cache/

  下一步: /aisd-03-assets (拉资产) 或 /aisd-02-script --revise (改稿)
```

## 交互点（仅 2 处）

1. Module 1：列 2-3 个结构模板候选 → 用户选
2. Module 6：校验通过后展示终稿一句话简报 → 用户 confirm / revise
