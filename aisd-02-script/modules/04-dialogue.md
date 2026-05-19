# Module 4: Dialogue

> Core Question: 写每个 scene 的台词，带情绪、停顿、潜台词。

## Inputs from Module 3

- `scenes[]`
- `characters[]`（用 id 当 speaker）
- `props_required[]`
- 来自 01-topic 的 `language` + `localization_targets`

## Data Sources

无外部源。

## Process

### Step 1: 每个 scene 写 dialogue[]

对每个 scene，逐行写台词。每条对白：

```json
{
  "id": "dlg_001",
  "speaker": "char_001",        // 或 "NARRATOR" / "OFF" (画外音)
  "text": "我才是实控人。",
  "language": "zh-CN",
  "emotion": "冷峻 · 不动声色",
  "pause_before_ms": 800,
  "subtext": "她已经准备好了这一刻三年",
  "variants": {}                // phase2_hook
}
```

字段说明：
- `id`：`dlg_001` 起，全剧累加（不按 scene 重置）
- `speaker`：必须 ∈ `characters[*].id` ∪ {`NARRATOR`, `OFF`}
- `emotion`：1-3 个词，给后续 TTS（Phase 2）和真人演员看
- `pause_before_ms`：开口前的停顿（戏剧张力），0 表示紧接上一句
- `subtext`：潜台词 — 表面意思下的真实意图，作品深度的关键
- `variants{}`：phase2_hook → 若 `localization_targets` 非空，填 `{"en-US": "I'm the actual controller.", ...}`；否则 `{}`

### Step 2: 字数 / 时长约束

- 每条对白默认讲完用 `len(text) / 字数节奏(中文 ~ 4 字/秒，英文 ~ 2 词/秒)`
- 整 scene 的对白总时长（含 pause）≤ scene.duration_s × 0.7（剩下 30% 给画面 / 反应 / 沉默）
- 60s 短片整剧对白条数 ≤ 8 条；120s ≤ 15 条

### Step 3: 钩子 scene 特殊处理

`scene[0]` 的第一句对白（或一个动作 + 一句对白）必须在 `01-topic.hook_window_s` 内说完，且要"反常 / 高密度信息 / 冲突感"：

- 烂例："今天天气不错。"
- 好例："你昨晚去他家了？" / "把字签了。" / "你是不是疯了？"

### Step 4: 写到 `_cache/m04-dialogue.md`

```markdown
# Dialogue

## scene_001 (办公室 · day, 12s)

[0.0s, pause=0ms] char_002 (惊愕): "你怎么会出现在这？"
[2.5s, pause=300ms] char_001 (冷峻): "我等你三年。"
...
```

### Step 5: Localization（若需要）

若 `01-topic.localization_targets[]` 包含多个语种，对每条 dialogue 多写一份目标语种翻译，放到 `variants{lang: text}`。翻译要保留 emotion 与 subtext，不做字面直译。

## Decision Gate

- 校验：每条 dialogue.speaker ∈ characters[*].id ∪ {NARRATOR, OFF}
- 校验：每 scene 对白时长 ≤ duration_s * 0.7
- 校验：第一个 scene 第一句在 hook_window_s 内
- 通过 → proceed to Module 5

## Data Passing to Next Module

传给 Module 5：

- 完整 `scenes[*].dialogue[]`
- 每条 dialogue 的 emotion / subtext（决定镜头表情 / 反应镜头需求）
