# Module 6: Assemble output.json + script.md + Validate

> Core Question: 组装 `output.json`，生成人读 `script.md`，过校验门，交付。

## Inputs from Modules 1-5

- `structure`、`beat_sheet[]`、`scenes[]`、`characters[]`、`props_required[]`
- 每 scene 的 `dialogue[]`、`shot_hints[]`、`audio_cues[]`
- 来自 01-topic 的 `language`、`localization_targets[]`

## Process

### Step 1: 组装 `output.json`

按 `templates/output.json.template` 填充。注意：

- `total_duration_s = sum(scenes[*].duration_s)`
- `language` = 01-topic 的 logline.language
- `localization_targets` 原样从 01-topic 透传（phase2_hook 透传规则）
- `script_md_path = "./aisd/02-script/script.md"`（用于存在性断言）
- `meta.upstream_inputs[0]` = `{ skill: "aisd-01-topic", schema_version: "1.0.0", consumed_fields: ["logline", "platform_profile", "target_audience", "localization_targets"] }`

写到 `./aisd/02-script/output.json`。

### Step 2: 生成 `script.md`

按 `templates/script.md.template` 填充。这是给人看的剧本格式：

```markdown
# {{logline.text}}

> 时长 {{total_duration_s}}s · 平台 {{platform}} · 结构 {{structure.template}}

## 角色

| ID | 名 | 角色 | 简介 |
|---|---|---|---|
| char_001 | 林雪 | lead | 30 岁集团副总裁... |
| ...

## 道具

- `prop_001` 实控人印章 — 金色雕花...

---

## scene_001 — INT. 办公室 - 工位区 (day, 12s)

> 林雪走入办公室，桌上摆着一份合同。

[0.0s] **char_002** (惊愕) [pause 0ms]: "你怎么会出现在这？"
    > 潜：他以为林雪已经被开除

[2.5s] **char_001** (冷峻) [pause 300ms]: "我等你三年。"
    > 潜：她早已布局

**Shots:**
1. wide → dolly_in to medium on char_001  (3.5s)
2. close on hand picking up doc  (1.5s)

**Audio:**
- 0.0s 🎵 music_in: 低沉弦乐
- 2.0s 🔊 sfx: 高跟鞋

---
```

写到 `./aisd/02-script/script.md`。

### Step 3: 校验门（不可跳过）

```bash
# 3a. ajv schema 校验
npx -y ajv-cli@5 validate \
  -s ~/.claude/skills/aisd-shared/schemas/02-script.schema.json \
  -d ./aisd/02-script/output.json \
  --spec=draft2020 \
  -r ~/.claude/skills/aisd-shared/schemas/_common.schema.json

# 3b. 时长校验
TOTAL=$(jq '[.scenes[].duration_s] | add' ./aisd/02-script/output.json)
TARGET=$(jq '.meta.user_input_summary' ./aisd/02-script/output.json)  # or read from upstream
# 应在 target * 0.9 ~ target * 1.1 内

# 3c. dialogue speaker 引用完整性
CHARS=$(jq -r '.characters[].id' ./aisd/02-script/output.json | sort -u)
SPEAKERS=$(jq -r '.scenes[].dialogue[].speaker' ./aisd/02-script/output.json | grep -v -E '^(NARRATOR|OFF)$' | sort -u)
# SPEAKERS ⊆ CHARS ∪ {NARRATOR, OFF}

# 3d. scenes.characters_present ⊆ characters[].id
# scenes.props_present ⊆ props_required[].id

# 3e. 存在性断言
test -f ./aisd/02-script/script.md

# 3f. 钩子 beat 校验
FIRST_BEAT=$(jq '.beat_sheet[0].t_s' ./aisd/02-script/output.json)
HOOK_WIN=$(jq '.platform_profile.hook_window_s' ./aisd/01-topic/output.json)
# FIRST_BEAT 应 == 0；第一个 strong-info beat（非纯空白）应 ≤ HOOK_WIN
```

校验失败 → 修复，不交付。

### Step 4: 写 `_cache/metadata.json`

```json
{
  "completed_modules": ["01", "02", "03", "04", "05", "06"],
  "scene_count": <N>,
  "dialogue_count": <N>,
  "character_count": <N>,
  "total_duration_s": <N>,
  "ai_provider_calls": 0
}
```

### Step 5: 交付简报

```
✓ 剧本完成
  时长: <total_duration_s>s (目标 <target>s)
  结构: <template>
  
  Scene 数: <N>　Dialogue 数: <N>
  角色: <name 1>, <name 2>, ...
  道具: <name 1>, <name 2>, ...
  
  钩子: "<scene_001 第一句对白>"
  反转: "<某句潜台词或转场>"
  
  产物:
    - ./aisd/02-script/output.json (✓ schema validated)
    - ./aisd/02-script/script.md
    - ./aisd/02-script/_cache/

  下一步:
    /aisd-03-assets  — 生成角色/场景/道具资产
    /aisd-02-script --revise  — 改稿
```

## Decision Gate

- 校验失败 → 回到失败处对应模块修复
- 校验通过 → 交付，等用户继续 / revise

## Data Passing to Next Module

本 skill 完成。下游：

- 03-assets 读 characters[]、scenes[]、props_required[] 生成资产
- 04-storyboard 读 scenes[]、dialogue[]、shot_hints[] 生成 storyboard
- 06-audio Phase 2 读 dialogue[]、audio_cues[]、dialogue.variants[]
