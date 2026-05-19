# Module QA-Checker（共享子模块）

## 职责

对**单张**生成图跑 vision LLM 一致性打分（identity / style / tech 三项），返回是否通过。重抽决策由 `generation-loop` 据此做出。

**单图入参、单图返回**：本模块不接受 batch，由 generation-loop 在 loop 单次迭代中按图调用。

## 调用契约

由 `modules/generation-loop.md` 在每次单图生成后调用：

```
qa_check(
  image: image_path,                    # 单张
  context: {
    asset_type: "character" | "scene" | "prop" | "style",
    asset_id: str,
    references: {
      master: image_path | None,        # 角色/场景/道具的 master（identity 比对基准）
      style_bible_refs: list[image_path] # Style Bible 的风格基准
    },
    thresholds: {identity, style, tech}
  }
) -> qa_result   # 单张结果，不含 batch 汇总
```

返回的 qa_result 包含：

```json
{
  "image": "...",
  "scores": {"identity": 0.91, "style": 0.88, "tech": 0.94},
  "reasoning": {"identity": "...", "style": "...", "tech": "..."},
  "issues": [],
  "pass": true
}
```

重抽不是本模块负责——generation-loop 拿到 `pass: false` 后按自己的策略调 prompt 重抽，再次调本模块打分。

## 步骤

### 1. 三项打分

对入参的**单张图**，加载 `prompts/qa-vision-prompt.md` 调 vision LLM（默认 Claude Sonnet 4.6，可在 config.yaml 切 GPT-4o），输入：

- 当前图
- master 参考图（仅 character / scene / prop 类型）
- Style Bible 风格基准图（3-5 张）
- 评分要求（详见 prompts/qa-vision-prompt.md）

输出：

```json
{
  "image": "assets/characters/char_lin_qing/expressions/angry.png",
  "scores": {
    "identity": 0.91,
    "style": 0.88,
    "tech": 0.94
  },
  "reasoning": {
    "identity": "面部特征、发型、服装与 master 一致；眉骨结构匹配",
    "style": "色调略偏暖，与 Style Bible 的低饱和有偏差但在阈值内",
    "tech": "构图完整，无肢体异常，分辨率达标"
  },
  "issues": [],
  "pass": true
}
```

### 2. 通过判定

- `identity ≥ thresholds.identity`（仅 character/prop 强校验）
- `style ≥ thresholds.style`（所有类型）
- `tech ≥ thresholds.tech`（所有类型）

三项全过 → `pass: true`
任一不过 → `pass: false` + 进重抽队列

### 3. 返回给调用方

返回单图 qa_result。**重抽决策不在本模块**，由 generation-loop 据 `pass: false` + `reasoning` 自行决定：

- 重抽策略归 generation-loop（见 `modules/generation-loop.md` "重抽时的 prompt 调整策略"小节）
- 重抽次数计数也在 generation-loop 维护，本模块只打分

### 4. 顺带写 qa 日志

每次打分都 append 一行到 `_cache/qa-reports/qa-log.jsonl`：

```jsonl
{"ts": "...", "task_id": "char_lin_qing.master", "image": "...", "scores": {...}, "pass": true, "reasoning_brief": "..."}
```

用于后续 6-pack-export 汇总 qa-summary.json。

更新 `metadata.json` 的 `stats.qa_pass_count` += (1 if pass else 0)。

## 评分细则（提示词中体现）

### identity（角色/道具一致性）
- 5 分制（小数到 0.05），>= 0.80 算过
- 5.0 = 几乎无法区分是不是同一个角色/物体
- 4.0 = 主要特征一致，细节有微差
- 3.0 = 整体可识别为同一个，但某些特征有变化
- 2.0 = 有相似但不像同一个
- 1.0 = 明显不是同一个

注：身体姿势、构图、表情**不计入** identity 打分，只看脸/发/服装/标志特征。

### style（风格一致性）
- 与 Style Bible 5 张参考图的整体风格对比
- 考察维度：色调、光感、画风、材质质感
- 5.0 = 完全一致，肉眼区分不出来自不同生成批次
- 3.0 = 主调一致，细节有偏差
- 1.0 = 风格漂走

### tech（技术质量）
- 考察：解剖正确（无多手/多腿/坏脸）、构图完整（无错误裁剪）、分辨率达标、无明显伪影/watermark
- 5.0 = 商业可用
- 3.0 = 个人项目可用
- 1.0 = 必须重做

## 错误与边界

- vision LLM 调用失败：跳过该图的打分，标记 `qa_status: "skipped"`，不计入 retry，但在 HITL 时高亮提示用户人工目检
- 评分明显异常（如所有图都 5.0 或所有图都 1.0）：识别为评分 LLM 故障，切备用模型（如 Sonnet 失败切 GPT-4o）重跑一次
- 重抽 3 次仍 < 0.50：识别为 prompt/描述本身有问题，标记 `qa_status: "broken"`，建议用户在 HITL 时手动重写 description

## 何时不调用 qa-checker

- 用户在 config.yaml 关闭 qa（`qa.enabled: false`）
- 极速预览模式（未来扩展，1 张图速看）
- 用户在 HITL 闸明确指示"我自己看，跳过质检"

## 性能与成本

- 每张图打分约 1 次 vision LLM 调用，约 5-10 秒
- 一个标准短剧（50 张资产图）约 5-10 分钟 qa
- 成本：按当前定价约 $0.5-1.0 / 短剧
- 可在 config.yaml 设 `qa.sample_rate = 0.5` 降到 50% 抽检，进一步降本
