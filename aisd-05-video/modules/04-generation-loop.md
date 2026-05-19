# Module 4: Generation Loop（唯一 video API 调用点）

> Core Question: 消费 `_cache/queue/active.jsonl`，每 iteration 1 shot：提交 → 轮询 → 下载 → QA → 决策。

## 与 aisd-03 generation-loop 的关系

逻辑骨架一致（取任务 → 调 API → 处理结果 → 写回 → 下一轮），但因 video provider 是**异步任务**，单 iteration 比 T2I 多一步"轮询任务状态"。

## 单 iteration 详细步骤

### 1. 取下一个可执行任务

```pseudo
queue = read_jsonl(./aisd/05-video/_cache/queue/active.jsonl)
done_ids = { t.task_id for t in queue if t.status == "done" }

next_task = first task in queue where:
    status in ("pending", "retry")
    AND all(dep_id in done_ids for dep_id in depends_on)

if next_task is None:
    if any t.status in ("pending", "retry") for t in queue:
        raise DeadlockError("dependencies unmet")
    return "queue_drained"
```

### 2. 标记 running

```pseudo
next_task.status = "running"
next_task.started_at = now()
write_jsonl(queue)
```

### 3. 提交视频生成任务

按 provider 调对应端点。示例 Kling：

```bash
PAYLOAD=$(jq -n \
  --arg fp "$(base64 < $first_frame_path)" \
  --arg ep "$(base64 < $end_frame_path)" \
  --arg pr "$prompt" \
  --arg np "$negative_prompt" \
  --argjson dur $duration_s \
  '{
    model: "kling-v2.1",
    image: $fp,
    image_tail: $ep,
    prompt: $pr,
    negative_prompt: $np,
    duration: $dur,
    aspect_ratio: "9:16",
    cfg_scale: 0.5,
    mode: "pro"
  }')

RESP=$(curl -fsS -X POST \
  -H "Authorization: Bearer $KLING_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$KLING_API_BASE/v1/videos/image2video")

TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')
next_task.task_id_provider = $TASK_ID
write_jsonl(queue)

# 写 api-log
append_jsonl(./aisd/05-video/_cache/api-log.jsonl, {
  ts, provider, model, shot_id, endpoint, task_id_provider, status: "submitted"
})
```

类似 Runway / Vidu / 等的提交逻辑见 `_provider_adapters.md`（若日后补充）。

### 4. 轮询任务状态

```bash
for i in $(seq 1 $POLL_MAX); do
  sleep $POLL_INTERVAL
  
  STATUS=$(curl -fsS -H "Authorization: Bearer $KLING_API_KEY" \
    "$KLING_API_BASE/v1/videos/$TASK_ID" | jq -r '.data.task_status')
  
  case "$STATUS" in
    "succeed")
      VIDEO_URL=$(curl ... | jq -r '.data.task_result.videos[0].url')
      break
      ;;
    "failed")
      next_task.status = "retry" if retry_count < max_retries else "failed"
      next_task.error = "provider task failed"
      write_jsonl(queue)
      return next_task
      ;;
    "processing"|"submitted")
      continue
      ;;
  esac
done

if (loop exhausted without succeed):
    next_task.status = "retry"
    next_task.error = "poll timeout after {POLL_MAX * POLL_INTERVAL}s"
    write_jsonl(queue)
    return next_task
```

### 5. 下载视频

```bash
mkdir -p $(dirname $output_path)
curl -fsS -o "$output_path" "$VIDEO_URL"

# 校验文件
test -s "$output_path" && file "$output_path" | grep -q "MP4\|MPEG\|matroska"
```

### 6. 跑 QA（调 modules/05-qa-check.md）

```pseudo
qa = qa_check_video(
    clip_path=output_path,
    identity_refs=qa_basis.identity_refs,
    first_frame_ref=qa_basis.first_frame_ref,
    end_frame_ref=qa_basis.end_frame_ref,
    thresholds=qa_thresholds
)
next_task.scores = qa.scores
```

### 7. 通过/重抽决策

```pseudo
if qa.pass:
    next_task.status = "done"
    next_task.completed_at = now()
else:
    if next_task.retry_count < next_task.max_retries:
        next_task.retry_count += 1
        next_task.status = "retry"
        # 调整 prompt（按 qa 失败原因）
        adjust_prompt_for_retry(next_task, qa.failure_reasons)
    else:
        next_task.status = "warning"
        next_task.completed_at = now()

write_jsonl(queue)
```

### 8. 更新统计 + 预算

```pseudo
metadata.stats.clips_generated += 1
metadata.budget.spent_usd += provider.cost_per_5s_clip_usd * ceil(duration_s / 5)

if spent_usd >= abort_at: raise BudgetExceeded
write_json(./aisd/05-video/_cache/metadata.json, metadata)
```

### 9. 简报 + 下一轮

```
[5/12] shot_005 → done (id=0.88 motion=0.79 continuity=0.82 tech=0.93)
[6/12] shot_006 → retry #1 (motion=0.62 < 0.70; reason: 主体几乎静止)
[6/12] shot_006 → done (id=0.86 motion=0.74 continuity=0.81 tech=0.92)
```

## 调度方式（推荐）

- 默认：方式 A 主会话顺序循环（视频生成耗时长，并发收益有限，且单调用更易调试）
- 升级：方式 B 子代理并发槽位 (max_parallel_calls=2-3)，因 video API 通常允许 2-5 并发
- 长批次：方式 C `/loop /aisd-05-video continue`，每 5 分钟醒一次推进队列

## adjust_prompt_for_retry 策略

- **identity 低**：在 prompt 中追加 "the character's face must match the input image exactly"
- **motion 低（静态）**：追加 "clear visible motion of the subject, camera ${movement}"
- **continuity 低（首尾不连贯）**：检查 end_frame_path 是否正确；若 mode != first_last_frame → 升级到 first_last_frame 模式（若 provider 支持）
- **tech 低（artifact / 模糊）**：在 negative 追加具体问题词，降 cfg_scale 试试

## 失败兜底

- Provider 5xx → 退避重试 3 次（不计入 max_retries）
- Provider 配额耗尽 → STOP loop，等用户加钱或换 provider
- Provider rate limit → 自动降低并发槽 + 等待
- 单 shot 连续 max_retries 仍 warning → 不强失败，继续下一个，最终在交付时高亮

## 用户中断

`pause` / `stop`：当前 shot 轮询完毕（不强 kill），不再取下一个。已完成保留 done。
