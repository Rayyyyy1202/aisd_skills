# Style Bible 生成 Prompt

由 `modules/2-style-bible.md` 调用。分两阶段：先用 LLM 推断风格倾向，再用 LLM 撰写 Style Bible 草案（含 prompt prefix/suffix/negative + 镜头语言词典）。最后用图像 API 生成 5 张参考图。

## Stage 1：风格倾向推断

### System Prompt

你是一个 3D 短剧视觉总监，根据剧本内容快速判断整片应采用的视觉风格。

### User Prompt 模板

```
基于以下剧本概要（场景列表 + 道具列表 + 主角描述），推断整片应采用的视觉风格。

【剧本概要】
角色: <CHARACTERS_SUMMARY>
场景: <SCENES_SUMMARY>
道具: <PROPS_SUMMARY>
（来自 _cache/m1-extraction.json）

【推断维度】

1. genre（类型）：
   - 现代都市剧 / 古装 / 科幻 / 奇幻 / 悬疑 / 校园 / 末日 / 喜剧 / 战争 / 历史

2. tone（调性）：
   - 全写实 / 半写实（Pixar 风格） / 美式三维卡通 / 日系赛璐珞 / 国风水墨 / 黏土质感 / 像素风

3. era（时代）：
   - 现代 / 1980s / 民国 / 古代 / 未来 / 不指定

4. mood（情绪基调）：
   - 温暖明亮 / 冷峻深沉 / 浪漫梦幻 / 紧张悬疑 / 史诗壮阔 / 日常治愈

5. visual_references（2-3 个公开作品作风格锚点）：
   - 例: "Pixar 的《心灵奇旅》画风" / "王家卫的色调" / "新海诚的光感"

【输出格式】

JSON，无 markdown：
{
  "genre": "...",
  "tone": "...",
  "era": "...",
  "mood": "...",
  "visual_references": ["...", "..."],
  "reasoning": "1-2 句话解释为什么这样推"
}
```

## Stage 2：Style Bible 撰写

### System Prompt

你是一个 3D 动画视觉总监。基于已确认的风格倾向，撰写一份完整的 Style Bible：包含 prompt prefix（统一描述前缀）、prompt suffix（统一描述后缀）、negative prompt（统一负面词）、调色板（HSL 主色清单）、光感规则、镜头语言词典。

输出必须是直接可用于图像生成 API 的英文 prompt 片段。

### User Prompt 模板

```
请基于以下风格倾向，撰写完整 Style Bible：

【风格倾向】
<STYLE_DIRECTION_FROM_STAGE_1>

【撰写要求】

1. **style_description**（中文，给人看）：
   - 一段 100-200 字的整体视觉风格描述
   - 含调性、色调、光感、构图偏好

2. **prompt_prefix**（英文，给模型）：
   - 30-80 词
   - 必须含：渲染风格（如 "cinematic 3D animation, semi-realistic Pixar style"）、调性词（"low-saturation cinematic grading"）、镜头语言总向（"anamorphic lens, shallow depth of field"）
   - **不**包含：具体角色/场景描述、负面词

3. **prompt_suffix**（英文）：
   - 10-30 词
   - 含：光感词（"soft rim light"）、质感词（"film grain"）、规格词（"16:9, 8K detail"）

4. **negative_prompt**（英文）：
   - 涵盖：质量（"low quality, deformed"）、构图（"extra limbs, cropped"）、不符调性的画风（"flat 2D illustration, cartoon"，如适用）、水印（"watermark, signature"）

5. **palette**（6-8 色 HSL）：
   - 每个色块给 hex + role（如 `dominant_dark` / `skin_tone` / `accent_warm` / `cool_shadow`）
   - 必须与 tone 一致（写实场景偏低饱和、卡通偏高饱和）

6. **lighting**（中文段落）：
   - 主光、侧光、逆光的使用偏好
   - 色温区间
   - 阴影硬度

7. **camera_glossary**（中英对照，15-20 条）：
   - 必须包含基础 9 项：推镜、拉镜、摇镜、跟拍、升降、主观、特写、中景、全景
   - 推荐再加 6-10 项符合本片风格的（如悬疑可加"窥视镜""Dutch angle"）

8. **image_briefs**（5 张参考图的具体生成 prompt）：
   - brief_1: 代表性人物半身像（不指定具体角色，作风格基准）
   - brief_2: 代表性场景（用 extraction 中的 primary scene 描述）
   - brief_3: brief_2 的日景版（强光感）
   - brief_4: brief_2 的夜景版（强光感）
   - brief_5: 道具拼图（多个 secondary 道具同框）
   - 每个 brief 是直接可调 API 的英文 prompt（不含本 prefix/suffix，因为 brief 本身会被自动包裹）

【输出格式】

JSON，无 markdown：

{
  "style_description": "...",
  "prompt_prefix": "...",
  "prompt_suffix": "...",
  "negative_prompt": "...",
  "palette": [
    {"hex": "#...", "role": "..."},
    ...
  ],
  "lighting": "...",
  "camera_glossary": {
    "推镜": "slow dolly-in",
    "拉镜": "slow dolly-out",
    ...
  },
  "image_briefs": {
    "brief_1": "...",
    "brief_2": "...",
    "brief_3": "...",
    "brief_4": "...",
    "brief_5": "..."
  }
}
```

## 用户微调指令处理

用户在 HITL 闸①可能给出：

- `改 调性 = 更冷峻` → 在 stage 1 输入额外指令"用户要求 tone 更冷峻"，重跑全流程
- `改 prefix = "..."` → 直接覆盖 prompt_prefix，无需调 LLM，但重新生成参考图（确认风格还能对得上）
- `换镜头 推镜 = "smooth push-in"` → 直接改 camera_glossary，无需重做其他
- `加镜头 摇镜 = "pan shot"` → 直接补条
- `重做 brief_3` → 仅重生成 brief_3 对应参考图
- `整套重生成` → stage 1 + stage 2 全部从头

## 模型选择

- 默认：Claude Sonnet 4.6（写美术风格描述很顺）
- 复杂或抽象风格（如"赛博朋克 + 浮世绘"混搭）：Opus 4.7

## 错误处理

- LLM 输出非 JSON：用错误反馈重试 1 次
- camera_glossary 少于 9 项：自动补齐基础 9 项的英文（用内置词表）
- palette 颜色冲突（如全是灰）：警告用户"调色板单调，建议增加 accent 色"
