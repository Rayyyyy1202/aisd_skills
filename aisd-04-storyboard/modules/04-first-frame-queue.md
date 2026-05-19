# Module 4: First-Frame Queue

> Core Question: 把每个 shot 的 prompt 入队到 generation-loop 的队列文件，**绝不调 T2I**。

## Inputs from Module 3

- `_cache/m03-prompts.json`：每个 shot 的完整 prompt + refs + 输出路径

## Data Sources

无外部源。

## Process

### Step 1: 准备队列文件

```bash
mkdir -p ./aisd/04-storyboard/_cache/queue/
QUEUE=./aisd/04-storyboard/_cache/queue/active.jsonl
# 若已存在 → 检查是否同批次（同 m03 hash）；不同 → 备份 + 重建
```

### Step 2: 入队（jsonl）

每个 shot 一行 JSON 对象，符合 generation-loop 的任务 schema（继承自 aisd-03 的 generation-loop.md）：

```json
{
  "task_id": "shot_001",
  "asset_id": "shot_001",
  "asset_type": "storyboard_first_frame",
  "stage": "first_frame",
  "status": "pending",
  "depends_on": [],
  "prompt": "<from m03>",
  "negative_prompt": "<from m03>",
  "reference_images": ["./aisd/03-assets/..."],
  "size": "1024x1536",
  "quality": "high",
  "background": "auto",
  "output_path": "./aisd/04-storyboard/first_frames/shot_001.png",
  "retry_count": 0,
  "max_retries": 3,
  "qa_required": true,
  "qa_thresholds": {
    "identity": 0.80,
    "style": 0.80,
    "tech": 0.85,
    "composition_match": 0.75
  },
  "qa_basis": {
    "master_for_identity": "<asset_001 的 master_path>",
    "style_refs": ["<style ref 1>", "<style ref 2>"],
    "composition_brief": "<shot.composition 文字，用于 vision 比对>"
  },
  "created_at": "<ISO 8601>",
  "started_at": null,
  "completed_at": null,
  "scores": null,
  "error": null
}
```

无依赖（shots 之间互相独立），可并行 — 但仍受 generation-loop 串行调用约束（除非启用 sub-agent 并发槽）。

### Step 3: 调起 generation-loop

```
invoke modules/05-generation-loop.md on queue: ./aisd/04-storyboard/_cache/queue/active.jsonl
```

调用方不传 prompt（队列里有）；只负责 while-loop 直到 queue_drained。

### Step 4: 写到 `_cache/m04-enqueue.json`

```json
{
  "module": "04-first-frame-queue",
  "completed_at": "<ISO>",
  "enqueued_count": 12,
  "queue_path": "./aisd/04-storyboard/_cache/queue/active.jsonl"
}
```

## Decision Gate

- 入队前再次校验：所有 reference_images 路径在 fs 真实存在
- 路径缺失 → 报错并要求用户重跑上游（03-assets）

## Data Passing to Next Module

- 队列文件路径
- Module 5 (generation-loop) 会原地修改队列（status / scores / completed_at）
