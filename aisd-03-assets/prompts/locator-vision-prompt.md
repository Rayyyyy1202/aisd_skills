# Locator Vision LLM Prompt（自然语言定位区域 → bbox）

由 `modules/edit-tools.md` 的 `locate_region` 操作调用。

## 模型选择

- 默认：`gpt-4o-mini`（多模态、便宜、足以做 region localization）
- 备用：`gpt-4o`（更准但贵 ~10×）

## System Prompt

```
You are a precise image region locator. Given an image and a natural-language region description, return a normalized bounding box that tightly contains the region described.

Output STRICTLY this JSON (no markdown fence, no explanation around it):
{
  "bbox_normalized": [x1, y1, x2, y2],
  "confidence": 0.0-1.0,
  "reasoning": "1-sentence explanation of what you saw and how you decided the bbox"
}

Coordinates are normalized 0-1. Origin (0,0) is top-left of the image. (x2,y2) > (x1,y1).
Confidence: 1.0 = you are certain the bbox is correct; 0.5 = unsure; 0.0 = the region is not present in the image.
```

## User Prompt 模板

```
Locate this region: "<region_natural_language>"

[image attached as base64]
```

## 区域描述指南

写好 region 字符串能显著提升 confidence 与精度。建议结构：

| 弱 | 强 |
|---|---|
| "eyes" | "the character's eyes, including eyelashes and inner corners" |
| "coat" | "the long beige trench coat covering the torso and lower body" |
| "watermark" | "the diagonal text watermark in the bottom-right quadrant" |
| "background" | "the entire background area excluding the human figure" |

关键技巧：
- 加颜色 / 材质 / 形状词
- 标位置（top / bottom / left / right / center）
- 标范围（"only the inner part" / "the whole region")
- 标颜色 / 材质 / 形状（"the dark navy collar" / "the embroidered logo"）

## 接受策略（调用方据 confidence 决策）

| confidence | 处理 |
|---|---|
| ≥ 0.85 | 直接用，无需用户确认 |
| 0.7 - 0.85 | 用，但记录警告，HITL 闸时高亮 |
| 0.5 - 0.7 | 停下，要求用户：(a) 确认接受、(b) 给更具体描述重定位、(c) 手动给 bbox |
| < 0.5 | 拒绝，告知"区域不可定位"，要求用户改描述或换图 |

## 常见 query 示例与典型 confidence

基于实测（gpt-4o-mini vision，人物全身图）：

| Query | 典型 bbox | typical confidence |
|---|---|---|
| "the eyes" | [0.40, 0.18, 0.60, 0.24] | 0.88-0.95 |
| "the hair on her head" | [0.40, 0.10, 0.60, 0.30] | 0.85-0.93 |
| "the long beige trench coat" | [0.25, 0.20, 0.75, 0.80] | 0.87-0.92 |
| "the brown ankle boots" | [0.40, 0.85, 0.60, 1.00] | 0.85-0.92 |
| "the entire background" | [0.00, 0.00, 1.00, 1.00] | 0.95-1.00 |
| "the watermark bottom-right" | [0.70, 0.85, 1.00, 1.00] | 0.80-0.90（若实际有 watermark） |

## 边界情况

- **区域不存在**：vision LLM 返回 `confidence: 0.0` + reasoning 说明"region not visible"，调用方应拒绝
- **多个候选区域**：LLM 默认选最大的；用户可在描述里加"only the smaller one" / "the upper one"
- **半遮挡**：LLM 返回可见部分的 bbox，标 confidence 0.6-0.75
- **抽象描述**（"the sad part"、"the angry expression"）：confidence 通常 < 0.5，应拒绝

## 输出后处理

调用方拿到 bbox 后：
1. **clamp** 到 [0, 1] 防越界
2. **min size** 检查：(x2-x1) ≥ 0.05 且 (y2-y1) ≥ 0.05，太小的 mask 编辑效果差
3. **expand** padding：可选给 bbox 加 ±0.02 边距，让 mask 边缘留点空间避免锐切

## 调试记录

每次调用 append 到 `_cache/api-log.jsonl`：

```jsonl
{"ts": "...", "op": "locate", "src": "...", "region": "...", "result": {"bbox_normalized": [...], "confidence": 0.9, "reasoning": "..."}}
```

按 region 字符串聚合，可分析哪些描述形式 confidence 更高，反哺词表。
