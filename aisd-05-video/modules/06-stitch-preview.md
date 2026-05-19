# Module 6: Stitch Preview + Assemble + Validate

> Core Question: 用 FFmpeg 把所有 clip 拼成 preview.mp4，装配 output.json，过校验门，交付。

## Inputs

- `_cache/queue/active.jsonl`（每条 clip 的 status / scores / output_path）
- `_cache/qa-reports/qa-log.jsonl`
- `_cache/api-log.jsonl`（成本核算）
- `./aisd/04-storyboard/output.json`（用于交叉引用 + duration）

## Process

### Step 1: 用 FFmpeg 拼接 preview.mp4

按 04-storyboard.shots[*].sequence 顺序：

```bash
# 生成 concat 列表
mkdir -p ./aisd/05-video/_cache/
CONCAT_LIST=./aisd/05-video/_cache/concat.txt
> $CONCAT_LIST

# 按 sequence 排序
jq -r '.shots | sort_by(.sequence) | .[].id' ./aisd/04-storyboard/output.json | while read shot_id; do
  clip="./aisd/05-video/clips/${shot_id}.mp4"
  if [ -f "$clip" ]; then
    # 裁切到 shot.duration_s（generation 时可能比目标长）
    target_dur=$(jq -r ".shots[] | select(.id==\"${shot_id}\") | .duration_s" ./aisd/04-storyboard/output.json)
    trimmed="./aisd/05-video/_cache/trimmed_${shot_id}.mp4"
    ffmpeg -y -v error -i "$clip" -t $target_dur -c copy "$trimmed" 2>/dev/null \
      || ffmpeg -y -v error -i "$clip" -t $target_dur -c:v libx264 -preset veryfast "$trimmed"
    echo "file '$(pwd)/$trimmed'" >> $CONCAT_LIST
  else
    echo "WARN: missing clip for $shot_id (将跳过)"
  fi
done

# 拼接
ffmpeg -y -v error -f concat -safe 0 -i $CONCAT_LIST -c copy ./aisd/05-video/preview.mp4 \
  || ffmpeg -y -v error -f concat -safe 0 -i $CONCAT_LIST -c:v libx264 -preset veryfast ./aisd/05-video/preview.mp4
```

若 -c copy 失败（不同 codec 的 clip）→ 自动 fallback 到重编码。

### Step 2: 装配 output.json

按 `templates/output.json.template` + `shared/schemas/05-video.schema.json`：

```json
{
  "clips": [
    {
      "clip_id": "clip_001",
      "shot_id": "shot_001",
      "clip_path": "./aisd/05-video/clips/shot_001.mp4",
      "provider": "kling",
      "model": "kling-v2.1",
      "mode": "first_last_frame",
      "duration_s": 5.0,
      "resolution": "1080x1920",
      "aspect": "9_16",
      "first_frame_path": "./aisd/04-storyboard/first_frames/shot_001.png",
      "end_frame_path": "./aisd/04-storyboard/first_frames/shot_002.png",
      "prompt": "<from queue>",
      "negative_prompt": "<from queue>",
      "qa_score": { "identity": 0.88, "motion": 0.79, "continuity": 0.82, "tech": 0.93 },
      "retry_count": 0,
      "cost_usd": 0.35,
      "cut_marks": [],
      "color_intent": "unspecified",
      "speed_intent": "unspecified"
    }
  ],
  "preview_video_path": "./aisd/05-video/preview.mp4",
  "total_duration_s": <sum>,
  "aspect": "9_16",
  "provider_summary": {
    "primary_provider": "kling",
    "fallback_providers": [],
    "calls_made": 14,
    "total_cost_usd": 4.20
  },
  "compliance_tags": ["ai_generated"],
  "stats": {
    "clips_generated": 12,
    "qa_pass_count": 10,
    "qa_retry_count": 4,
    "warning_count": 2
  },
  "meta": {
    "generated_at": "<ISO>",
    "skill_version": "1.0.0",
    "schema_version": "1.0.0",
    "aisd_version": "0.1.0",
    "execution_time_s": <N>,
    "user_input_summary": "...",
    "upstream_inputs": [
      { "skill": "aisd-04-storyboard", "schema_version": "1.0.0", "consumed_fields": ["shots", "total_duration_s", "aspect"] }
    ]
  }
}
```

`compliance_tags` 默认含 `ai_generated`（按 conventions §19 与多数平台规则）。

### Step 3: 校验门

```bash
# 3a. ajv schema
npx -y ajv-cli@5 validate \
  -s ~/.claude/skills/aisd-shared/schemas/05-video.schema.json \
  -d ./aisd/05-video/output.json \
  --spec=draft2020 \
  -r ~/.claude/skills/aisd-shared/schemas/_common.schema.json

# 3b. referential integrity
SHOTS_04=$(jq -r '.shots[].id' ./aisd/04-storyboard/output.json | sort -u)
SHOTS_05=$(jq -r '.clips[].shot_id' ./aisd/05-video/output.json | sort -u)
comm -23 <(echo "$SHOTS_04") <(echo "$SHOTS_05") | grep -q . && echo "WARN: 部分 shot 缺 clip（warning_count 应非零）"

# 3c. duration 容差
TOTAL_04=$(jq '.total_duration_s' ./aisd/04-storyboard/output.json)
TOTAL_05=$(jq '.total_duration_s' ./aisd/05-video/output.json)
# |TOTAL_05 - TOTAL_04| / TOTAL_04 < 0.15  (视频生成时长可能比目标多 5s)

# 3d. 存在性断言
test -f ./aisd/05-video/preview.mp4
for p in $(jq -r '.clips[].clip_path' ./aisd/05-video/output.json); do
  test -f "$p"
  test -s "$p"  # 非空
done

# 3e. preview.mp4 可播放（ffprobe）
ffprobe -v error -show_entries format=duration -of csv=p=0 ./aisd/05-video/preview.mp4

# 3f. Phase 2 hook 字段存在（cut_marks/color_intent/speed_intent + compliance_tags）
jq -e '.clips[0] | has("cut_marks") and has("color_intent") and has("speed_intent")' ./aisd/05-video/output.json
jq -e 'has("compliance_tags")' ./aisd/05-video/output.json
```

### Step 4: 交付简报

```
✓ 05-video 完成
  Provider: kling (kling-v2.1)
  Clips: 12 / 12 个 shot 全部生成成功
  时长: 60.8s (目标 60.5s, +0.5%)
  
  平均 qa: id=0.87 motion=0.81 continuity=0.78 tech=0.92
  Warning: 2 (shot_007 continuity=0.65 · shot_011 motion=0.69)
  
  实际成本: $4.20
  
  产物:
    - ./aisd/05-video/output.json (✓ schema validated)
    - ./aisd/05-video/preview.mp4   ← 拖到播放器看
    - ./aisd/05-video/clips/

  下一步:
    - 人工审 preview.mp4
    - 不满意 shot: /aisd-05-video --shot=shot_007 重抽
    - 进入 Phase 2: /aisd-06-audio (TTS+SFX+配乐)
```

## Decision Gate

- 校验失败 → 不交付，回报失败原因
- 任何 clip 缺失（warning_count > 0）→ 列出来询问"接受 / 重抽 / 中止"
