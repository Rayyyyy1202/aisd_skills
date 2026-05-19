# Module 5: Generation Loop（共享子模块，唯一的 T2I 调用点）

> Core Question: 把 `_cache/queue/active.jsonl` 里的待生成任务一张一张消费完。

## 复用声明

**本模块的核心逻辑与 `~/.claude/skills/aisd-03-assets/modules/generation-loop.md` 完全一致**。当本 skill 加载本模块时，直接遵守 aisd-03 generation-loop 的全部规则：

- 单图迭代（n=1，禁止 batch）
- 取任务 → 调 API → 落盘 → qa → done/retry/warning → 写回队列
- 三种调度方式（A 主会话顺序循环 / B 子代理并发槽 / C `/loop` 动态）
- 死锁、预算超限、用户中断处理
- 简报格式 `[N/M] task_id → status (scores)`

唯一差异：

| 项 | aisd-03 (asset 生成) | 本模块 (首帧生成) |
|---|---|---|
| 任务的 `asset_type` | character / scene / prop / style | `storyboard_first_frame` |
| qa 关注点 | identity / style / tech | identity / style / tech + **composition_match** |
| qa_basis | master_for_identity + style_refs | + composition_brief (vision 比对 shot composition 描述) |
| 重抽策略 | identity 低 → 升 prompt 强度词 | identity 低 → 同上；composition 低 → 在 prompt 末尾追加 "framed as: <composition>" 强化 |

## qa-checker 调用差异（本 skill 的 qa-checker prompt）

本 skill 复用 `~/.claude/skills/aisd-03-assets/modules/qa-checker.md`，但 vision prompt 增加一项 `composition_match`：

```
Given:
  - generated image: <path>
  - identity master ref: <path>
  - style refs: [<path>, ...]
  - composition brief (text): "<shot.composition>"

Score 0-1:
  identity: 角色在生成图中是否与 master 一致（脸 / 身材 / 服装）
  style: 风格是否与 style refs 一致
  tech: 技术质量（无 artifact / 解剖正确 / 无文字水印）
  composition_match: 构图是否符合 brief 描述

Also output: failure_reasons[] for any score < threshold
```

## 调度推荐

- 12-30 个 shot → 用方式 A（主会话顺序，最简单可靠）
- 30+ shot → 用方式 B（开 3-4 个子代理并发槽）

## 完成条件

队列里所有任务的 status ∈ {done, warning, skipped} → generation-loop 退出，控制权交回主会话进入 Module 6。

## 失败兜底

- gpt-image-1 鉴权失败：暂停 loop，等用户检查 `OPENAI_API_KEY`
- 所有 ref 路径都不可读：标记任务 `failed` + 上报"请检查 03-assets 是否仍存在"
- composition_match 连续 3 次 < 0.6：标记 warning + 询问用户"接受最高分版本 / 自己写 prompt 重试 / skip"
