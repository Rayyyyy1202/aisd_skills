# Module 3: Video Queue

> Core Question: 把每个 shot 转成一条 video 生成任务，入队到 active.jsonl。

## Inputs

- `_cache/m01-provider.json`
- `_cache/m02-end-frames.json`
- `./aisd/04-storyboard/output.json`（shots[]）
- `./aisd/03-assets/output.json`（style_bible.art_direction 用于增强 prompt）
- `./aisd/02-script/output.json`（dialogue 用于决定 prompt 的"动作"描述）

## Process

### Step 1: 为每个 shot 拼 video prompt

video prompt 与图像 prompt 不同 —— 它要描述**运动 / 时间演进 / 情绪流变**，不是静态构图：

```python
def compose_video_prompt(shot):
    parts = []
    
    # 1. style 注入（轻量；视频模型对 style 敏感度低，但写一句锚定）
    parts.append(style_bible.art_direction.split('.')[0])  # 第一句即可
    
    # 2. 主体 + 动作（关键）
    # 从 04 的 composition + 02 的 dialogue + 02 的 audio_cues 推动作
    parts.append(shot.composition)
    
    # 如果有对白 → 描述说话动作 + 情绪
    if shot.dialogue_ref:
        d = lookup_dialogue(shot.dialogue_ref)
        parts.append(f"the character is speaking, emotion: {d.emotion}")
    
    # 3. 运镜（与 04 的 camera 一致，video 模型很依赖这个）
    cam = shot.camera
    movement_phrase = {
        "static": "static camera",
        "pan": f"camera pans across",
        "dolly_in": "camera slowly dollies in",
        "dolly_out": "camera dollies out",
        "tracking": "camera tracks the subject",
        "handheld": "handheld camera with subtle shake",
        "zoom_in": "slow zoom in",
        "zoom_out": "slow zoom out",
    }.get(cam.movement, "natural camera motion")
    parts.append(movement_phrase)
    
    # 4. 时长 hint
    parts.append(f"duration: {shot.duration_s}s")
    
    # 5. 质量锚
    parts.append("smooth motion, no warping, no flicker, cinematic")
    
    return ". ".join(parts) + "."

def compose_negative(shot):
    return "still frame, no motion, identity drift, warping, flicker, watermark, text overlay, low resolution, jpeg artifacts"
```

### Step 2: 选 mode

```python
if shot.end_frame_path and provider.first_last_frame_supported:
    mode = "first_last_frame"
elif shot.first_frame_path:
    mode = "image_to_video"
else:
    mode = "text_to_video"   # 罕见
```

### Step 3: 选 duration（钳制到 provider 范围）

```python
duration = clamp(shot.duration_s, provider.min_duration_s, provider.max_duration_s)
# Kling: 5-10s
# 如果 shot.duration_s < 5 → 强制生成 5s，Module 6 用 ffmpeg 截前 N 秒
# 如果 shot.duration_s > max → 分段生成 + 拼接（一般不需要，本 skill 范围内不做）
```

### Step 4: 写队列文件

```bash
QUEUE=./aisd/05-video/_cache/queue/active.jsonl
mkdir -p $(dirname $QUEUE)
```

每个 shot 一行：

```json
{
  "task_id": "shot_001",
  "shot_id": "shot_001",
  "asset_type": "video_clip",
  "stage": "video",
  "status": "pending",
  "depends_on": [],
  "provider": "kling",
  "model": "kling-v2.1",
  "mode": "first_last_frame",
  "prompt": "<from Step 1>",
  "negative_prompt": "<from Step 1>",
  "first_frame_path": "./aisd/04-storyboard/first_frames/shot_001.png",
  "end_frame_path": "./aisd/04-storyboard/first_frames/shot_002.png",
  "duration_s": 5,
  "actual_target_duration_s": 3.5,
  "aspect": "9_16",
  "resolution": "1080p",
  "output_path": "./aisd/05-video/clips/shot_001.mp4",
  "retry_count": 0,
  "max_retries": 2,
  "qa_required": true,
  "qa_thresholds": {
    "identity": 0.80,
    "motion": 0.70,
    "continuity": 0.70,
    "tech": 0.85
  },
  "qa_basis": {
    "identity_refs": ["<03 char master paths>"],
    "first_frame_ref": "<04 first_frame_path>",
    "end_frame_ref": "<end_frame_path or null>"
  },
  "created_at": "<ISO>",
  "started_at": null,
  "completed_at": null,
  "task_id_provider": null,
  "scores": null,
  "error": null
}
```

### Step 5: 写到 `_cache/m03-video-queue.json`

```json
{
  "module": "03-video-queue",
  "completed_at": "<ISO>",
  "enqueued_count": 12,
  "queue_path": "./aisd/05-video/_cache/queue/active.jsonl"
}
```

## Decision Gate

- 所有 first_frame_path / end_frame_path（若非 null）必须存在
- 任何 shot.duration_s > provider.max_duration_s 且无分段策略 → 警告并询问

## Data Passing to Next Module

- 队列文件路径
- Module 4 (generation-loop) 会原地修改队列
