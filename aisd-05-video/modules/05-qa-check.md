# Module 5: QA Check (Video)

> Core Question: 对生成的 mp4 clip 抽帧打分：identity / motion / continuity / tech。

## 输入

- 单条 clip 的 mp4 路径
- identity_refs（角色 master 路径）
- first_frame_ref / end_frame_ref（应与 clip 首尾对齐）
- thresholds

## Process

### Step 1: 抽帧

用 ffmpeg 抽 3 帧：开头(0.1s) / 中间(duration/2) / 结尾(duration-0.1s)：

```bash
mkdir -p ./aisd/05-video/_cache/qa-frames/<shot_id>/
ffmpeg -y -v error -i $clip_path -vf "select='eq(n,5)+eq(n,N/2)+eq(n,N-5)'" \
  -vsync vfr ./aisd/05-video/_cache/qa-frames/<shot_id>/frame_%03d.png
```

得到 frame_001.png（首）/ frame_002.png（中）/ frame_003.png（末）。

### Step 2: 调 vision LLM 打分

用 Claude Sonnet 4.6 或 GPT-4o 看图打分。Prompt 模板：

```
You are a video QA evaluator. Score the following:

CLIP frames:
- start: frame_001.png
- mid: frame_002.png
- end: frame_003.png

References:
- identity_refs (character master): <paths>
- first_frame_ref (should match start): <path>
- end_frame_ref (should match end): <path or "none">

Score 0-1 for each:

1. identity: Does the main character in the clip match the identity_refs? (face / body / wardrobe)
2. motion: Is there clear, intentional motion? (vs frozen / vs warping / vs mush)
3. continuity: 
   - start frame ≈ first_frame_ref (similar composition + identity)
   - if end_frame_ref provided: end frame ≈ end_frame_ref
   - mid-frame plausibly between start and end (no teleport / no identity flip)
4. tech: 
   - no warping / no smearing / no flicker
   - no extra limbs / no malformed faces
   - resolution + sharpness OK

Output JSON:
{
  "identity": 0.85,
  "motion": 0.72,
  "continuity": 0.80,
  "tech": 0.92,
  "failure_reasons": ["motion: subject is nearly static"],
  "pass_overall": true   // all scores >= thresholds
}
```

### Step 3: 通过/重抽决策

返回给 generation-loop。`pass_overall = false` → loop 决定 retry 或 mark warning。

## Output

写到 `_cache/qa-reports/<shot_id>-qa.json`，并 append 到 `_cache/qa-reports/qa-log.jsonl`：

```json
{
  "shot_id": "shot_006",
  "clip_path": "./aisd/05-video/clips/shot_006.mp4",
  "scores": { "identity": 0.86, "motion": 0.74, "continuity": 0.81, "tech": 0.92 },
  "failure_reasons": [],
  "pass_overall": true,
  "retry_count_at_qa": 1,
  "evaluated_at": "<ISO>"
}
```

## 失败兜底

- vision LLM API 失败 → 标记 `qa_status: "skipped"` + warning + 由 generation-loop 决定是否仍 mark done（默认是：跳过 qa 仍 mark done，但 stats.qa_skipped++ 并在交付简报里高亮）
- ffmpeg 抽帧失败（clip 损坏）→ 直接 mark task `failed`（不重试，回报"clip 文件无法解析"）
