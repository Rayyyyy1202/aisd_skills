# Cutout Prompt（透明几出主体）

由 `modules/edit-tools.md` 的 `cutout_api` 操作调用。

## 调用对象

**必须用 `gpt-image-1`**（gpt-image-1 不支持 `background=transparent`，会返回 `Transparent background is not supported for this model.`）。

端点：`POST /v1/images/edits`
参数：
- `model=gpt-image-1`
- `image[]=@<src>`
- `prompt=<以下模板>`
- `background=transparent`
- `n=1`, `size=...`, `quality=medium|high`

## Prompt 模板

```
Isolate the subject (human character) from the original image. Output the subject only with a fully transparent background. Preserve every detail of the subject — face, hair, clothing, body, pose, accessories — EXACTLY as in the input. Do not redraw, do not stylize differently, do not change facial features or outfit. Only the background pixels should change to fully transparent. Keep edges clean and natural.
```

## 变体（按用例可裁剪）

### 仅前景为单一物体（道具）

```
Isolate the foreground object from the original image. Output the object only with a fully transparent background. Preserve every material detail — surface texture, color, shape, scale — EXACTLY as in the input. Keep edges clean. Background must be fully transparent.
```

### 前景含动作 / 道具持有

```
Isolate the human character AND any objects they are holding or wearing. Output them on a fully transparent background. Preserve every detail. Background pixels must all be transparent.
```

### 严苛"零像素改动"（极保守）

```
Convert ONLY the background pixels of this image to fully transparent. Do not alter any pixel of the foreground subject. Do not redraw, do not blur, do not anti-alias the subject. The subject must be byte-for-byte identical to the input.
```

注：实际 LLM 仍会做轻微 re-render，"byte-for-byte" 是 aspirational。

## 输入图像要求

- 单主体（人 / 物）置于画面中央
- 主体与 BG 有足够对比（颜色 / 亮度 / 边缘）
- BG 越简单越好（纯色 / 简单渐变 > 复杂场景）
- 分辨率与 size 参数匹配（1024×1024, 1024×1536, 1536×1024）

## 输出验证

切完后做：

1. **alpha 通道检查**：PIL 读 PNG，确认 alpha 通道存在且非全 255（说明有透明像素）
2. **BG 完全透明**：4 个角的像素 alpha = 0
3. **前景 alpha = 255**：主体中心区域采样，alpha 应 ≥ 200
4. **边缘羽化**：alpha 在边缘有平滑过渡（避免锯齿）

不满足则视为切失败，retry 1 次或上报。

## 已知限制

| 现象 | 原因 | 应对 |
|---|---|---|
| 主体内部出现透明斑 | 主体某部分颜色接近 BG | 改用 chroma key 失败时回退 api；或 user 给 mask 框住主体 |
| 边缘锯齿明显 | 模型未做 anti-alias | composite 后再过一次 PIL gaussian blur 边缘 |
| 主体局部被裁掉 | 模型误判前景边界 | 改 prompt 加 "include all parts of the subject including limbs" |
| BG 部分未变透明 | 模型抗拒 | 加 prompt "ALL background pixels MUST be transparent" + retry |

## 成本估算

- `gpt-image-1` quality=medium @ 1024×1024：~1000-2000 tokens，约 $0.06-0.10
- quality=high：~3000-5000 tokens，约 $0.18-0.30
- 默认用 medium；high 用于产线级最终交付
