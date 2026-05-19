# Prompt 锁词与拼装规则

本文件定义所有模块拼装 prompt 时遵循的铁律。模块 2/3/4/5 在**入队**前必须按本规则拼装好 prompt 与 ref_images 字段；`modules/generation-loop.md` 拿到队列任务时直接喂给 GPT Image API（不再二次拼装）。

## 拼装公式（铁律）

```
final_prompt =
    style_bible.prompt_prefix
  + ", "
  + asset.prompt_fragment
  + ", "
  + scene_or_camera_directive   # 视模块而定
  + ", "
  + style_bible.prompt_suffix

final_negative =
    style_bible.negative_prompt
  + ", "
  + asset.negative_prompt
```

**不允许**：
- 调换 prefix / suffix 顺序
- 跳过 prefix 或 suffix
- 在 prefix 之前插入其他段
- 在 negative 中删除 style_bible.negative_prompt

## 拼装段位详解

### Slot 1: style_prefix（DNA 前缀）

固定不可变，来自 `m2-style-bible.prompt_prefix`。

例：
```
cinematic 3D animation, semi-realistic Pixar style, low-saturation cinematic grading, anamorphic lens, shallow depth of field
```

### Slot 2: asset.prompt_fragment（资产描述段）

- 角色：固定特征清单（年龄、性别、发型、服装、体型）
- 场景：环境清单（室内外、风格、关键陈设）
- 道具：物件描述（材质、形状、尺寸）

**写法约束**：
- 用名词短语 + 关键形容词，**不要**写故事或动作（动作交给 camera_directive 段）
- 不出现具体角色名（"林清"），全部用视觉描述
- 多角色镜头时，prompt_fragment 用空格 + "and" 串接多个 char 的 fragment

例：
```
20-year-old Asian woman, shoulder-length straight black hair, beige trench coat, slim build
```

### Slot 3: scene_or_camera_directive（情境段）

按模块类型注入：

- **3-character-pack**：景别 + 表情 + 视角（"front view", "extreme close-up of face", "subtle smile"）
- **4-scene-pack**：机位 + 光环（"interior view towards the window, bright daylight, no people"）
- **5-prop-pack**：视角 + 拍摄方式（"three-quarter front view, isolated on plain neutral background"）
- **下游抽卡 Agent**：完整镜头描述（"林清坐在沙发上抬头看向窗外, medium shot, dolly-in"）

### Slot 4: style_suffix（DNA 后缀）

固定不可变，来自 `m2-style-bible.prompt_suffix`。

例：
```
soft rim light, film grain, 16:9, 8K detail
```

## Negative Prompt 规则

### style_negative（统一负面词）

来自 `m2-style-bible.negative_prompt`，必须包含：

- 质量：`low quality, blurry, deformed, jpeg artifacts`
- 解剖：`extra limbs, mutated hands, malformed face`
- 风格漂移：根据 tone 加。例如 Pixar 风格加 `flat 2D illustration, anime cel-shading`
- 元信息：`watermark, signature, text, logo`

### asset_negative（资产维度负面词）

- 角色：排除错龄/错性别（如"child"用在成人角色，"masculine features"用在女性角色）
- 场景：排除错风格建筑（如现代场景排除"traditional Chinese architecture"）
- 道具：排除错材质（如"modern plastic"用在古风道具上）
- 通用：排除"people in establishing"（场景图禁人物）

## 镜头语言词翻译

中文镜头词必须查 `m2-style-bible.camera_glossary` 替换：

| 中文 | 英文（示例） |
|---|---|
| 推镜 | `slow dolly-in` |
| 拉镜 | `slow dolly-out` |
| 摇镜 | `pan shot` |
| 升降镜 | `crane shot up` / `crane shot down` |
| 跟拍 | `tracking shot` |
| 主观视角 | `POV shot, first-person view` |
| 大特写 | `extreme close-up` |
| 特写 | `close-up` |
| 中景 | `medium shot` |
| 全景 | `wide shot` |
| 俯视 | `bird's-eye view, high angle` |
| 仰视 | `low angle shot` |
| 斜角 | `Dutch angle` |
| 长镜头 | `long take, continuous shot` |
| 蒙太奇 | `montage` |

未在 glossary 中的镜头词：警告 + 用 LLM 即时翻译，并提示用户补登 glossary。

## Reference Strength 的"措辞替代"

gpt-image-1 **无显式 strength 字段**，强弱由 prompt 措辞控制。在 asset_fragment 之前插入对应 hint 句：

| `ref_strength_recommended` | 自动注入的 hint 句 |
|---|---|
| ≥ 0.85 | `identical character as the reference image, exact same face, same hair, same outfit` |
| 0.75 - 0.85 | `same character as the reference image, matching facial features and outfit` |
| 0.60 - 0.75 | `consistent with the reference, similar character design` |
| < 0.60 | `inspired by the reference's style and color palette` |

由队列任务在入队时自动按 `ref_strength_recommended` 映射并拼到 prompt 中（不需要 generation-loop 二次处理）。

## 多 Reference Image 优先级

当一个 prompt 需要多张 reference（如"林清在公寓客厅持钥匙"）：

```
references = [
    character.expressions.<emotion> or character.views.front,
    scene.lighting.<time>.angles.<angle>,
    prop.ref_images.master,
]
```

最多传 4 张（gpt-image-1 `/v1/images/edits` 上限）。超过则按优先级取前 4：

1. 角色（identity 最重要）
2. 场景（构图基础）
3. 道具（细节锁定）
4. Style Bible 风格基准图（仅在风格漂移重抽时附）

## 长度控制

gpt-image-1 上限约 4000 字符。拼装后若超过：

1. **不能压缩**：style_bible.prompt_prefix / prompt_suffix / negative_prompt
2. **可压缩**：asset.prompt_fragment（删冗余形容词、合并同义描述）
3. **可截断**：scene_or_camera_directive（保留核心动作 + 景别）

仍超长则警告，让用户在 description 阶段精简。

## 测试用例（写在单元测试里）

1. 输入空 asset.prompt_fragment → 报错"资产描述不能为空"
2. 输入未注册 char_id → 报错"未在 assets.json 注册"
3. negative_prompt 含违禁词（如 NSFW 词）→ 警告并替换
4. 中文镜头词找不到映射 → 即时翻译 + 警告
5. references 超过 3 张 → 按优先级取前 3，记录被截断的项

## 调试

每次拼装后，把 final_prompt 写入 `_cache/api-log.jsonl` 的 `prompt` 字段，便于：

- 复现失败案例（同 prompt + seed 重跑）
- 审计 prompt 是否符合本规则（写个 lint 脚本检查）
- 调优时定位是 prefix / fragment / suffix 哪段拖累质量
