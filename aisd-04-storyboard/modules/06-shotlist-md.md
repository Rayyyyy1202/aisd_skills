# Module 6: Assemble output.json + shotlist.md + Validate

> Core Question: 装配 output.json，渲染 shotlist.md，过校验门，交付。

## Inputs

- `_cache/m01-shots.json`、`m02-binding.json`、`m03-prompts.json`
- `_cache/queue/active.jsonl`（含每个 shot 的最终 status / scores / output_path）
- `_cache/qa-reports/qa-log.jsonl`
- `_cache/api-log.jsonl`（成本）
- `./aisd/02-script/output.json`、`./aisd/03-assets/output.json`（校验上游引用）

## Process

### Step 1: 合并 shots[] 最终数据

对每个 shot：
- 基础字段从 m01-shots.json 来（id / scene_id / sequence / duration_s / camera / composition / dialogue_ref / on_screen_text）
- `asset_refs[]` 从 m02-binding.json 来
- `first_frame_path` 从队列 done 状态来（`{output_path}` 已落盘）
- `end_frame_path` 留空（05-video 决定是否需要）
- Phase 2 hook 字段填默认占位：
  - `sfx_marks: []`（若 02.scenes[shot.scene_id].audio_cues 包含 t_s_from_scene_start 落在本 shot 时段内的 cue，提取过来）
  - `music_intent: "TBD"`（02 没明确写 → "TBD"；写了 → 抽过来）
  - `subtitle_intent: "unspecified"`

### Step 2: 组装 output.json

按 `templates/output.json.template` + `shared/schemas/04-storyboard.schema.json`：

```json
{
  "shots": [...],
  "first_frames_dir": "./aisd/04-storyboard/first_frames/",
  "shotlist_md_path": "./aisd/04-storyboard/shotlist.md",
  "total_duration_s": <sum>,
  "aspect": "<from 02 or 03>",
  "stats": {
    "first_frames_generated": <N>,
    "qa_pass_count": <N>,
    "qa_retry_count": <N>,
    "warning_count": <N>,
    "estimated_cost_usd": <N>
  },
  "meta": {
    "generated_at": "<ISO>",
    "skill_version": "1.0.0",
    "schema_version": "1.0.0",
    "aisd_version": "0.1.0",
    "execution_time_s": <N>,
    "user_input_summary": "...",
    "upstream_inputs": [
      { "skill": "aisd-02-script", "schema_version": "1.0.0", "consumed_fields": ["scenes", "total_duration_s"] },
      { "skill": "aisd-03-assets", "schema_version": "1.0.0", "consumed_fields": ["style_bible", "assets", "characters", "scenes", "props"] }
    ]
  }
}
```

### Step 3: 校验门（不可跳过）

```bash
# 3a. ajv schema
npx -y ajv-cli@5 validate \
  -s ~/.claude/skills/aisd-shared/schemas/04-storyboard.schema.json \
  -d ./aisd/04-storyboard/output.json \
  --spec=draft2020 \
  -r ~/.claude/skills/aisd-shared/schemas/_common.schema.json

# 3b. referential integrity
# shots[*].scene_id ∈ 02.scenes[*].id
SCENES_02=$(jq -r '.scenes[].id' ./aisd/02-script/output.json | sort -u)
SHOTS_SCENES=$(jq -r '.shots[].scene_id' ./aisd/04-storyboard/output.json | sort -u)
comm -23 <(echo "$SHOTS_SCENES") <(echo "$SCENES_02") | grep -q . && { echo "FAIL: shots ref to unknown scene"; exit 1; }

# shots[*].asset_refs[*] ∈ 03.assets[*].id
ASSETS_03=$(jq -r '.assets[].id' ./aisd/03-assets/output.json | sort -u)
SHOT_REFS=$(jq -r '.shots[].asset_refs[]' ./aisd/04-storyboard/output.json | sort -u)
comm -23 <(echo "$SHOT_REFS") <(echo "$ASSETS_03") | grep -q . && { echo "FAIL: shot refs to unknown asset"; exit 1; }

# shots[*].dialogue_ref ∈ 02.scenes[scene_id].dialogue[*].id  (按 scene 逐项)
# (略 — 见 modules/06-shotlist-md/check-dialogue-refs.py 或 jq pipeline)

# 3c. duration 一致性
TOTAL_04=$(jq '[.shots[].duration_s] | add' ./aisd/04-storyboard/output.json)
TOTAL_02=$(jq '.total_duration_s' ./aisd/02-script/output.json)
# |TOTAL_04 - TOTAL_02| / TOTAL_02 < 0.1

# 3d. 存在性断言
for p in $(jq -r '.shots[].first_frame_path' ./aisd/04-storyboard/output.json); do
  test -f "$p" || { echo "FAIL: $p missing"; exit 1; }
done
test -f ./aisd/04-storyboard/shotlist.md

# 3e. Phase 2 hook 字段存在（不是值，是字段本身）
jq -e '.shots[0] | has("sfx_marks") and has("music_intent") and has("subtitle_intent")' ./aisd/04-storyboard/output.json
```

### Step 4: 渲染 shotlist.md

用 `templates/shotlist.md.template`：

```markdown
# Shotlist — {{logline.text}}

> {{shots | length}} shots · 总时长 {{total_duration_s}}s · 画幅 {{aspect}}

## Scene 索引

{{#scenes_grouped}}
- {{scene_id}} ({{location}}, {{time_of_day}}): {{shots_count}} shots, {{scene_duration_s}}s
{{/scenes_grouped}}

---

{{#shots}}

## {{id}} (scene {{scene_id}}, seq {{sequence}}, {{duration_s}}s)

![{{id}}]({{first_frame_path}})

| 字段 | 值 |
|---|---|
| 景别 | {{camera.shot_size}} |
| 角度 | {{camera.angle}} |
| 运镜 | {{camera.movement}} |
| 焦段 | {{camera.lens_mm_equiv}}mm |
| 构图 | {{composition}} |
| 引用资产 | {{asset_refs | join ", "}} |
{{#dialogue_ref}}
| 对白 | `{{dialogue_ref}}` |
{{/dialogue_ref}}
{{#on_screen_text}}
| 字幕 | {{on_screen_text}} |
{{/on_screen_text}}

{{#sfx_marks.length}}
**SFX:**
{{#sfx_marks}}
- {{t_s}}s — {{cue}}
{{/sfx_marks}}
{{/sfx_marks.length}}

**Music intent:** {{music_intent}}　**Subtitle intent:** {{subtitle_intent}}

---

{{/shots}}
```

### Step 5: 交付简报

```
✓ 04-storyboard 完成
  Shots: 12 个 (4 个 scene)
  时长: 60.5s (目标 60s, 偏差 0.8%)
  
  首帧图: 12 张　平均 qa: id=0.89 style=0.91 tech=0.94 comp=0.87
  Warning 项: 1 (shot_007, composition_match 0.74)
  实际成本: $1.32
  
  产物:
    - ./aisd/04-storyboard/output.json (✓ schema validated)
    - ./aisd/04-storyboard/shotlist.md
    - ./aisd/04-storyboard/first_frames/ (12 张图)

  下一步: /aisd-05-video
```

## Decision Gate

- 校验失败 → 修复，不交付
- warning 项数 > 0 → 列出并询问用户："接受 warning / 重抽 / 中止"
