# Module: Generation Loop（共享子模块，唯一的 T2I 调用点）

## 职责

把 `_cache/queue/active.jsonl` 里的待生成任务一张一张消费完。每次 Agent 循环只处理**一个**任务（一次 API 调用、一次 qa-checker、一次状态写回），然后进入下一轮。

**这是整个 skill 中唯一允许调 GPT Image API 的地方**。模块 2/3/4/5 只能"入队"，调 API 一律走这里。

## 调用契约

由模块 2/3/4/5 在入队后调用：

```
invoke generation-loop on queue: _cache/queue/active.jsonl
   (返回时所有 pending/retry 任务都已变为 done 或 warning)
```

调用方不传 prompt、不传 reference image 路径——这些信息全在队列文件里。

## 队列任务 Schema

`_cache/queue/active.jsonl`，每行一个 JSON 对象：

```json
{
  "task_id": "char_lin_qing.master",
  "asset_id": "char_lin_qing",
  "asset_type": "character",
  "stage": "master",                          // master | view.front | view.side | view.back | expression.smile | closeup | style.ref_01 | scene.establishing | scene.angle.kitchen_pov | scene.lighting.night.angle.kitchen_pov | prop.master | prop.view.front ...
  "status": "pending",                        // pending | running | done | retry | warning | failed | skipped
  "depends_on": [],                           // 依赖的 task_id 列表，未全 done 不能取出
  "prompt": "...",                            // 已按 prompt-locking-rules 拼装好的完整 prompt
  "negative_prompt": "...",                   // 已含 style_bible.negative + asset.negative
  "reference_images": [],                     // 0-4 张本地路径，按权重排序
  "size": "1536x1024",
  "quality": "high",
  "background": "auto",
  "output_path": "assets/characters/char_lin_qing/master.png",
  "retry_count": 0,
  "max_retries": 3,
  "qa_required": true,
  "qa_thresholds": {"identity": 0.80, "style": 0.80, "tech": 0.85},
  "qa_basis": {                               // qa-checker 需要知道拿什么对比
    "master_for_identity": null,              // master 自身打分时为 null
    "style_refs": ["assets/style/ref_01.png", "..."]
  },
  "created_at": "<ISO>",
  "started_at": null,
  "completed_at": null,
  "scores": null,
  "error": null
}
```

## Loop 单次迭代步骤（核心）

每次循环只执行一次以下流程：

### 1. 取下一个可执行任务

```pseudo
queue = read_jsonl(_cache/queue/active.jsonl)
done_ids = { t.task_id for t in queue if t.status == "done" }

next_task = first task in queue where:
    status in ("pending", "retry")
    AND all(dep_id in done_ids for dep_id in depends_on)

if next_task is None:
    if any t.status in ("pending", "retry") for t in queue:
        # 有 pending 任务但依赖未满足，且没有任何 running → 死锁，上报
        raise DeadlockError("queue has pending tasks but no executable next task")
    return "queue_drained"   # 全部 done/warning/failed/skipped，退出 loop
```

### 2. 标记 running

```pseudo
next_task.status = "running"
next_task.started_at = now()
write_jsonl(queue)
```

### 3. 调 GPT Image API（一次，n=1）

按 `prompts/gpt-image-api.md` 的封装调用：

- 有 `reference_images` → `/v1/images/edits`
- 无 → `/v1/images/generations`
- 永远 `n=1`
- 失败按 API 文档的退避重试（HTTP 5xx / 429）

```pseudo
result = generate_image(
    prompt=next_task.prompt,
    reference_images=next_task.reference_images,
    size=next_task.size,
    quality=next_task.quality,
    background=next_task.background,
    output_path=next_task.output_path,
)

# 写 API log
append_jsonl(_cache/api-log.jsonl, {
    ts, provider, model, task_id, endpoint, prompt_len, n_refs,
    latency_ms, status, tokens_billed, retry: next_task.retry_count
})
```

### 4. 失败分支

```pseudo
if result.status == "policy_rejected":
    next_task.status = "failed"
    next_task.error = "policy_rejected: <reason>"
    write_jsonl(queue)
    goto step 7

if result.status == "api_error":
    next_task.retry_count += 1
    if next_task.retry_count >= next_task.max_retries:
        next_task.status = "failed"
        next_task.error = result.error
    else:
        next_task.status = "retry"
    write_jsonl(queue)
    goto step 7
```

### 5. 调 qa-checker（若 qa_required）

```pseudo
qa = qa_check(
    image=next_task.output_path,
    asset_type=next_task.asset_type,
    asset_id=next_task.asset_id,
    references={
        master: next_task.qa_basis.master_for_identity,
        style_bible_refs: next_task.qa_basis.style_refs
    },
    thresholds=next_task.qa_thresholds
)

next_task.scores = qa.scores
```

### 6. 通过/重抽决策

```pseudo
if qa.pass:
    next_task.status = "done"
    next_task.completed_at = now()
else:
    if next_task.retry_count < next_task.max_retries:
        next_task.retry_count += 1
        next_task.status = "retry"
        # 调整 prompt 与/或参考图
        adjust_prompt_for_retry(next_task, qa.reasoning)
    else:
        next_task.status = "warning"   # 保留当前最高分版本
        next_task.completed_at = now()

write_jsonl(queue)
```

### 7. 更新统计 & 预算检查

```pseudo
metadata.stats.images_generated += 1
metadata.stats.qa_pass_count += (1 if qa.pass else 0)
metadata.stats.qa_retry_count += (1 if next_task.status == "retry" else 0)
metadata.budget.spent_usd += estimate_cost(result.tokens_billed)

if metadata.budget.spent_usd >= config.budget.abort_at_usd:
    raise BudgetExceeded("aborted at $...")
if metadata.budget.spent_usd >= config.budget.warn_at_usd:
    log_warning("budget approaching limit")

write_json(_cache/metadata.json, metadata)
```

### 8. 进入下一轮

```pseudo
# 简报当前进度（给主会话）
report = f"[{processed}/{total}] {next_task.task_id} → {next_task.status} (identity={qa.scores.identity}, style={qa.scores.style}, tech={qa.scores.tech})"
log(report)

# 不递归，return；调用方继续下一次 loop
return next_task
```

## Loop 调度方式（三选一）

主会话/调用方按 config 决定怎么"反复执行" generation-loop 单次迭代：

### 方式 A：主会话顺序循环（默认，最简单）

```pseudo
while True:
    result = invoke generation-loop (单次迭代)
    if result == "queue_drained":
        break
    # 否则继续下一次
```

主会话每完成一张就在简报里输出 `[N/M] <task_id> → done` 进度。

### 方式 B：子代理并行（config.yaml `concurrency.max_parallel_calls > 1`）

```pseudo
slots = config.concurrency.max_parallel_calls
parallel: for _ in slots:
    dispatch_subagent("generation-loop single iteration") for each slot
# 每个子代理独立读队列、原子地取一个任务、执行、写回
# 主会话只汇总进度
```

队列写回必须原子（文件锁 / atomic rename），多个子代理竞争同一个任务会失败。

### 方式 C：/loop 动态调度（长任务，session 可能中断）

```
/loop /3d-drama-assets generation-loop --queue _cache/queue/active.jsonl
```

让 `/loop` 子系统每隔 N 秒醒来跑一次单次迭代，跑完整批后自动停。

## 重抽时的 prompt 调整策略

`adjust_prompt_for_retry(task, qa_reasoning)` 根据 qa 失败原因微调：

- **identity 低**：在 prompt 中强化引用 hint（升一档强度词），如 0.80 措辞 → 改用 0.85 措辞
- **style 低**：在参考图列表前面**插入**一张 Style Bible 的代表图（让模型同时参考人和风格）；同时在 prompt 中追加 `matching the art direction of the reference style image`
- **tech 低（解剖问题）**：在 negative_prompt 中追加问题词（`malformed hands` / `extra fingers` 等具体词）
- **重抽 3 次仍不过**：标记 warning，由 HITL 在闸口决定（不再消耗 API 调用）

## 死锁与异常

- **依赖不满足且无可执行任务**：抛 `DeadlockError`，主会话上报"队列编排有 bug，请检查 depends_on"
- **某任务连续 failed**：自动 mark `skipped`，记录到 metadata.warnings；继续下一任务
- **预算超限**：立即停止 loop，已生成的资产保留，未生成的任务保留 pending 状态等待用户处理
- **session 中断**：恢复时再次调用本模块，从 `_cache/queue/active.jsonl` 中第一个非 done 任务接着跑

## 简报格式

每次单次迭代结束，向主会话输出一行：

```
[12/47] char_lin_qing.expressions.angry → done  (id=0.91 style=0.88 tech=0.94)
[13/47] char_lin_qing.expressions.surprised → retry #1  (id=0.74 < 0.80; reason: 下颌线偏离 master)
[14/47] char_lin_qing.expressions.surprised → done  (id=0.85 style=0.87 tech=0.93)
```

主会话每完成一张就把简报 echo 给用户（用户能实时看到进度，可在任意点中断）。

## 用户中断处理

用户在 loop 过程中输入 `pause` / `stop` / `abort`：

- 当前正在跑的单图 API 调用执行完（不强 kill），不再取下一张
- 已完成任务保留 done 状态
- 未完成的保留 pending/retry
- 主会话切回，让用户决定 resume / 重排队列 / 终止项目

## 不允许的事情（红线）

1. ❌ 单次 API 调用 `n > 1`
2. ❌ 主会话或模块 2-5 直接调 T2I API（绕过本模块）
3. ❌ 在本模块单次迭代内连续调 API > 1 次（重试除外）
4. ❌ Promise.all / 并发 Future 在单次会话内调多次 API（要并发，开子代理）
5. ❌ 把 N 张图的 base64 同时塞进主会话上下文（用 output_path 落盘，需要时再读）
