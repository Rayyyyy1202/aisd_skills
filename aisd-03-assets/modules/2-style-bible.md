# Module 2: Style Bible

## 职责

产出整片的"美术 DNA"——一份所有后续抽卡都强制携带的风格规范。这是防"场景跳脱"的第一道防线：每个下游 prompt 都拼接 Style Bible 的 prefix/suffix/negative，不让模型自行从文字推风格。

## 输入

- `_cache/m1-extraction.json`
- `config.yaml`
- 用户的风格倾向（可选，无则自动推断）

## 步骤

### 1. 风格倾向收集

根据 extraction 里的场景描述和道具特征，先做一次自动推断：

- 类型：现代都市剧 / 古装 / 科幻 / 奇幻 / 悬疑 / 校园 / 末日 …
- 调性：写实 / 半写实 / 美式三维 / 日系赛璐珞 / 国风水墨 …
- 时代：现代 / 80年代 / 民国 / 未来 …

呈现给用户：
```
基于剧本，我推断的风格方向：
  类型: 现代都市悬疑短剧
  调性: 电影质感 3D 渲染（半写实、低饱和、电影感光环）
  参考: Pixar 半写实 + 王家卫色调

是否调整？
  y - 按此风格继续
  改 调性 = 全写实        - 改某一项
  全部重选            - 完全重来
```

### 2. 入队 5 张风格参考图

加载 `prompts/style-bible-prompt.md`，让 LLM 撰写 5 个 image_briefs（具体生成 prompt）：

1. **brief_1**：代表性人物半身像（不锁特定角色，作"美术风格基准"用）
2. **brief_2**：代表性场景（用 extraction 里 primary scene 的描述）
3. **brief_3 / brief_4**：brief_2 的日/夜两版（强化光环风格）
4. **brief_5**：道具拼图（多个 secondary 道具同框）

每个 brief 拼装好完整 prompt 后，**入队**到 `_cache/queue/active.jsonl`（**不直接调 API**）：

```jsonl
{"task_id": "style.ref_01", "asset_type": "style", "stage": "style.ref_01", "status": "pending", "depends_on": [], "prompt": "<style_prefix + brief_1 + style_suffix>", "negative_prompt": "<style_negative>", "reference_images": [], "size": "1536x1024", "quality": "high", "output_path": "assets/style/ref_01.png", "retry_count": 0, "max_retries": 3, "qa_required": true, "qa_thresholds": {"tech": 0.85, "style": 0.0}, "qa_basis": {"master_for_identity": null, "style_refs": []}, "created_at": "..."}
{"task_id": "style.ref_02", ..., "depends_on": ["style.ref_01"]}
...
```

注：

- 5 张图之间故意串行（`depends_on: [前一个]`），是为了让用户在中途看到第 1 张后可以调整后续 brief
- style 类型的 qa 不设 style 阈值（自己就是 style 基准），只查 tech
- 入队后调用 `modules/generation-loop.md` 消费队列

### 2.5 调用 generation-loop

```
invoke generation-loop on queue: _cache/queue/active.jsonl
```

逐张生成 + qa（每张 ~10-15 秒 + ~5 秒 qa）。完成后所有 5 张图都已落盘到 `assets/style/`。

### 3. 调色板抽取

对生成的 5 张参考图跑色彩聚类，抽取 6-8 个主色（HSL），写入 `palette` 字段：

```json
"palette": [
  {"hex": "#2C3E50", "role": "dominant_dark"},
  {"hex": "#E8C39E", "role": "skin_tone"},
  {"hex": "#C0392B", "role": "accent_warm"},
  ...
]
```

### 4. 起草 Style Bible 文档

用 `templates/style-bible.md.j2` 模板渲染 `assets/style/style-bible.md`，包含：

- 风格定调描述（自然语言段落）
- 5 张风格参考图（嵌入路径）
- 调色板色块图
- 光感规则：主光/侧光/逆光的使用场合、色温区间
- **Prompt prefix**（每条下游 prompt 自动前置）
  - 例：`cinematic 3D animation, semi-realistic Pixar style, low-saturation cinematic grading, anamorphic lens, shallow depth of field`
- **Prompt suffix**（每条下游 prompt 自动后置）
  - 例：`soft rim light, film grain, 16:9, 8K detail`
- **Negative prompt**（统一负面词）
  - 例：`low quality, deformed, extra limbs, watermark, oversaturated, flat lighting, AI generated, cartoon, 2D illustration`
- **镜头语言词典**（中英对照，下游抽卡按词查表）
  - `推镜` → `slow dolly-in`
  - `拉镜` → `slow dolly-out`
  - `升降镜` → `crane up shot`
  - `跟拍` → `tracking shot`
  - `主观视角` → `POV shot`
  - `特写` → `extreme close-up`
  - `中景` → `medium shot`
  - `全景` → `wide shot`
  - `俯视` → `bird's-eye view`
  - `仰视` → `low angle shot`
  - …（覆盖 15-20 个常用镜头）

### 5. 风格内聚度复核（generation-loop 完成后的额外一步）

generation-loop 已对每张图单独打了 tech 分。**额外**做一次"5 张图之间的内聚度"打分：

- 调 vision LLM 一次（不是 5 次）：把 5 张图同时展示，让它给"集体风格一致度"打分
- 若 coherence < 0.75：标记 warning，让用户在 HITL 闸决定整套重抽 / 接受 / 手动选片
- 这一步**不**入队（只有一次调用，且对象是 5 张图的集合）

### 6. HITL 闸①

呈现给用户：

```
📋 Style Bible 草案 (style_v1)

🖼️ 5 张风格参考图: assets/style/ref_01.png … ref_05.png
🎨 调色板: 8 色（见 style-bible.md）
💡 光感规则: 电影感低饱和侧光 + 暖色 rim light
🎬 镜头语言词典: 18 条

📝 Prompt prefix:
"cinematic 3D animation, semi-realistic Pixar style, ..."

📝 Prompt suffix:
"soft rim light, film grain, 16:9, 8K detail"

🚫 Negative prompt:
"low quality, deformed, extra limbs, ..."

质检: tech avg 0.89, style coherence 0.91 ✅

请选择：
  approve              - 锁定，进入 3-character-pack
  改 调性 = 更冷峻       - 微调描述，重生成参考图
  重做 ref_03          - 仅重抽某张图
  整套重生成           - 完全重新做（你可以同时改风格倾向）
```

支持的微调指令：

- `改 prefix = "..."` 直接改 prompt 前缀文字
- `改 palette` 让 LLM 重新挑色
- `换镜头 推镜 = "smooth push-in"` 改某条镜头语言映射
- `加镜头 摇镜 = "pan shot"` 补镜头词

每次调整后从"step 2 生成参考图"开始重跑，直到用户 approve。

### 7. 锁定

用户 approve 后：

- 写 `_cache/m2-style-bible.json`（含所有字段，便于下游消费）
- 在 `_cache/metadata.json` 中标记 `hitl_gates["style-bible"] = "approved"`
- `module_status["2-style-bible"] = "completed"`
- 生成 style_v1 的不可变副本：`assets/style/style_v1.snapshot.json`（防止后续误改）

## 输出

- `assets/style/ref_01.png` … `ref_05.png`
- `assets/style/style-bible.md`（人读文档）
- `assets/style/style_v1.snapshot.json`（不可变快照）
- `_cache/m2-style-bible.json`（机器读）

## 错误与边界

- 5 张参考图风格差异过大（coherence < 0.75）：自动重抽，3 次后报警告并让用户决定是否手动选片
- 用户在 HITL 闸卡了 5 次以上仍不满意：建议切换"全部重选"模式，让用户输入更具象的风格关键词
- API 调用失败：由 `generation-loop` 按 `prompts/gpt-image-api.md` 的退避策略处理，本模块只看队列最终状态

## 下游契约

`_cache/m2-style-bible.json` 是后续所有图像生成的"DNA 源"：

- `3-character-pack` 在每条角色 prompt 中自动拼 `prompt_prefix + ... + prompt_suffix`
- `4-scene-pack` 在每条场景 prompt 中同上
- `5-prop-pack` 同上
- `6-pack-export` 把 style_bible 的 ID 写入 assets.json 的根字段，下游抽卡 Agent 据此查表
