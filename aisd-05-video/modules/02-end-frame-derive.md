# Module 2: End-Frame Derive

> Core Question: 对需要末帧的 shot 生成 end_frame.png（前提：provider 支持 first_last_frame）。

## Inputs

- `_cache/m01-provider.json`（first_last_frame_supported / max_duration_s）
- `./aisd/04-storyboard/output.json`（shots[]，含 first_frame_path 和 dialogue_ref）

## Skip 条件

```python
if not provider.first_last_frame_supported:
    skip module 2 entirely
    # 这种情况只用 first frame + prompt 给 provider，让模型自由生成 end
```

## 何时需要生成 end_frame

不是每个 shot 都需要末帧。**优先用下一 shot 的 first_frame 作为本 shot 的 end_frame**（保证首尾帧链）：

```python
for i, shot in enumerate(shots):
    next_shot = shots[i+1] if i+1 < len(shots) else None
    if next_shot and same_scene_continuous(shot, next_shot):
        # 同一 scene 内连续 shot → 用下一 shot 的 first_frame 作为本 shot 的 end_frame
        shot.end_frame_path = next_shot.first_frame_path
    elif shot.duration_s >= 6 and has_strong_action(shot):
        # 长镜头 + 有明显运动 → 生成专门的 end_frame
        # 用 gpt-image-1 在 first_frame 基础上做"运动结束态" edit
        enqueue_end_frame_generation(shot)
    else:
        # 短镜头 / 静态镜头 → 不给 end frame，让 video model 自由发挥
        shot.end_frame_path = None
```

## 生成 end_frame 的入队（仅当需要）

```bash
mkdir -p ./aisd/05-video/end_frames/
```

每个需要末帧的 shot 入队到 **新的本地队列文件**（不污染 video 主队列）：

```jsonl
{
  "task_id": "shot_007.end_frame",
  "asset_type": "video_end_frame",
  "stage": "end_frame",
  "status": "pending",
  "prompt": "<shot.composition + 描述运动结束态，如'手已握住印章, 手腕略前倾'>",
  "negative_prompt": "<style_negative + 'mid-motion blur'>",
  "reference_images": ["<shot.first_frame_path>", "<style refs from 03>"],
  "size": "1024x1536",
  "quality": "high",
  "output_path": "./aisd/05-video/end_frames/shot_007.png",
  "max_retries": 2,
  "qa_required": false   // end frame 不做严苛 qa，作为辅助参考即可
}
```

调用 **aisd-03 的 generation-loop**（或本 skill 的，因复用）来消费这个 end_frame 队列：

```
invoke ~/.claude/skills/aisd-03-assets/modules/generation-loop.md on queue: ./aisd/05-video/_cache/queue/end-frames.jsonl
```

（注意：这里复用 aisd-03 的 generation-loop 是合法的，因为它的逻辑跟 T2I provider 解耦，只是消费 queue 文件。）

## Output

- 部分 shot 拿到 `end_frame_path`
- 写到 `_cache/m02-end-frames.json`：

```json
{
  "completed_at": "<ISO>",
  "end_frames_generated": 3,
  "shots_using_next_first_frame": 8,
  "shots_no_end_frame": 1,
  "details": [
    { "shot_id": "shot_001", "end_frame_source": "next_first_frame", "end_frame_path": "./aisd/04-storyboard/first_frames/shot_002.png" },
    { "shot_id": "shot_007", "end_frame_source": "generated", "end_frame_path": "./aisd/05-video/end_frames/shot_007.png" },
    { "shot_id": "shot_012", "end_frame_source": "none", "end_frame_path": null }
  ]
}
```

## Decision Gate

- 若 provider 不支持 first_last_frame → 整个 module 2 skip
- 若 gpt-image-1 失败（需要生成 end frame 的 shot 都生成不出来）→ 降级为 "no end frame"，提示用户首尾连贯性可能下降

## Data Passing to Next Module

- 每个 shot 现在带 `end_frame_path`（可能为 null）
- Module 3 入队时把它放进队列任务的 `end_frame_path` 字段
