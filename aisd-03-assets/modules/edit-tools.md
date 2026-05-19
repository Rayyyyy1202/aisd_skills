# Module: Edit Tools（5 个原子操作的契约）

由 `modules/asset-edit.md` 调用。所有 user-facing edit 工作流都拼装这 5 个原子操作。**generation-loop 不调用本模块**——edit 是 ad-hoc 操作，无队列。

## 原子操作 1：`chroma_key_cutout`

```
chroma_key_cutout(
  src: Path,
  output_transparent: Path,
  bg_color: tuple = None,        # (r,g,b), None = auto-detect from 4 corners
  tolerance: int = 35,           # per-channel difference threshold (0-255)
  feather_px: int = 2,           # edge anti-aliasing radius
) -> bg_color_used: tuple
```

本地 PIL 实现，零 API 调用，零成本。

**适用**：源图 BG 是相对均匀的纯色（≥ 90% 像素同色，色差 < tolerance）。例：Style Bible v1 的 `#1B2230` 暗 teal BG。

**算法**：
1. 如未传 bg_color，从 4 角各采样 8×8 像素，取中位数作 BG 色
2. 对每个像素计算与 BG 色的欧氏距离
3. 距离 < tolerance → alpha = 距离/tolerance（平滑过渡）
4. 距离 ≥ tolerance → alpha = 255
5. 对 alpha 通道做高斯模糊 feather_px → 边缘抗锯齿

**限制**：当源 BG 颜色与前景某部分（例：暗背景 vs 黑发）相近时会误删。这种情况切到 `cutout_api`。

## 原子操作 2：`cutout_api`

```
cutout_api(
  api_key: str,
  src_image: Path,
  output_transparent: Path,
  size: str = '1024x1024',
  quality: str = 'medium',
) -> {success, tokens_billed, latency_ms, error}
```

调 OpenAI `/v1/images/edits`，**必须用 `model=gpt-image-1`**（gpt-image-1 不支持 `background=transparent`）。

prompt 用 `prompts/cutout-prompt.md` 标准模板。

**适用**：源图 BG 复杂（光影、渐变、含杂物），chroma key 无能为力。

**成本**：~$0.08-0.12 per call（gpt-image-1 token-based 计费）。

**限制**：模型仍会做轻微 re-render，前景像素并非 100% 复刻。typical drift ≤ 5%。

## 原子操作 3：`composite_over_bg`

```
composite_over_bg(
  transparent_png: Path,
  bg_spec: str,                  # hex / file path / scene_id
  output_path: Path,
) -> None
```

本地 PIL alpha composite，零 API。

`bg_spec` 解析顺序：
1. 以 `#` 开头且长度 4/7 → hex 颜色，生成同尺寸纯色 BG
2. 否则按文件路径解（相对路径基于项目根）
3. 仍不存在则按 `scene_id` 在 `assets/scenes/<id>/establishing.png` 找
4. 仍不存在 → 抛 `ValueError`

输出为 RGB（不带 alpha），PNG 格式。

## 原子操作 4：`locate_region`（vision LLM）

```
locate_region(
  api_key: str,
  image_path: Path,
  region_natural_language: str,
) -> {bbox_normalized: [x1,y1,x2,y2], confidence: 0-1, reasoning: str, _tokens: int}
```

调 OpenAI `/v1/chat/completions` `model=gpt-4o-mini` (vision)，用 `prompts/locator-vision-prompt.md` 的 system prompt。

输入：图像 (base64) + 区域自然语言描述。
输出：normalized bbox + confidence + 简短说明。

**成本**：~$0.005-0.01 per call（gpt-4o-mini vision 接受 base64 图）。

**性能**：单次 ~5-10s。

**接受策略**：
- confidence ≥ 0.85 → 自动用
- 0.7 ≤ confidence < 0.85 → 用但警告
- confidence < 0.7 → 停下，让用户确认 / 手动给 bbox / 换更具体的描述

## 原子操作 5：`local_edit_with_mask`

```
local_edit_with_mask(
  api_key: str,
  src_image: Path,
  mask: Path,                    # RGBA PNG: alpha=0 → 编辑区域，alpha=255 → 保留
  prompt: str,                   # 已含 Style Bible prefix/suffix，描述编辑区的变化
  output_path: Path,
  size: str = '1024x1024',
  quality: str = 'medium',
) -> {success, tokens_billed, latency_ms, error}
```

调 `/v1/images/edits` `model=gpt-image-1`，multipart 字段：
- `image[]=@<src>` — 源图
- `mask=@<mask>` — 同尺寸 RGBA mask
- `prompt=<change description>`
- `n=1`，`size=...`，`quality=...`

gpt-image-1 只重绘 mask 透明区域，mask 不透明区域**保留原像素**（理论上）。

**成本**：~$0.10-0.15 per call。

**限制**：模型对 mask 外的区域偶尔会做轻微调整（很弱的全图微调）；QA 应跑 identity vs source，> 0.10 漂移则警告。

## 辅助：`make_rect_mask`

```
make_rect_mask(
  image_size: tuple,             # (W, H)
  bbox_normalized: list,         # [x1, y1, x2, y2] in 0-1
  output_path: Path,
) -> Path
```

PIL 画一个 RGBA PNG：bbox 内 alpha=0，bbox 外 alpha=255。Convention 与 OpenAI 一致。

复杂 mask（多边形、不规则）由用户手绘，跳过本函数。

## 工作流拼装

`modules/asset-edit.md` 的两个工作流用这 5 个原子操作拼装：

```
# 精确换底（chroma 方法）
chroma_key_cutout(src, _cache/cutouts/x.png, tolerance, feather)
composite_over_bg(_cache/cutouts/x.png, bg_spec, output)

# 精确换底（api 方法）
cutout_api(api_key, src, _cache/cutouts/x.png)
composite_over_bg(_cache/cutouts/x.png, bg_spec, output)

# 局部微调
loc = locate_region(api_key, src, region)
make_rect_mask(src.size, loc.bbox_normalized, _cache/masks/m.png)
local_edit_with_mask(api_key, src, _cache/masks/m.png, change_prompt, output)
```

## 日志

每个原子操作都 append 到 `_cache/api-log.jsonl`，字段含：
- `ts` ISO 时间戳
- `op`: chroma | cutout_api | composite | locate | local_edit
- `src`, `output` 相对路径
- `tokens`, `latency_ms`, `cost_usd`
- `status`, `error`

便于成本核算与 debug。

## 用户配置兜底

`config.yaml.edit` 节（可选）覆盖默认值：

```yaml
edit:
  chroma_tolerance_default: 35
  chroma_feather_default: 2
  cutout_api_fallback: true      # chroma 失败自动切 api
  locator_min_confidence: 0.7    # 低于此值停下
  cutout_model: gpt-image-1      # transparent BG 只此模型支持
  edit_model: gpt-image-1        # 局部编辑用主模型
```
