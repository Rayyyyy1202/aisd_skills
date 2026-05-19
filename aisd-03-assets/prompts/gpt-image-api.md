# GPT Image API 调用规范

本文件统一约定 T2I API 的调用方式。本 skill 默认使用 OpenAI 的 **`gpt-image-1`**（如需切换版本，在 `config.yaml` 的 `t2i.model` 字段改即可，封装层接口不变）。

**铁律：每次调用只生成 1 张图。禁止 `n > 1`。生成多张靠 Agent Loop 逐张过，不靠 batch。**

## 端点

### Text → Image（无参考图）

```
POST https://api.openai.com/v1/images/generations
Authorization: Bearer $OPENAI_API_KEY
Content-Type: application/json

{
  "model": "gpt-image-1",
  "prompt": "<已拼装好的完整 prompt，含 prefix/suffix>",
  "n": 1,                        // 永远 1
  "size": "1536x1024",           // 16:9 用此；3:4 用 1024x1536；1:1 用 1024x1024
  "quality": "high",             // low | medium | high
  "background": "auto",          // auto | transparent | opaque（道具用 transparent 便于合成）
  "output_format": "png"
}
```

返回：`{ "data": [ { "b64_json": "..." } ] }`（gpt-image-1 默认返回 base64，不返回 URL）。

### Image Edit（首图引用法的关键端点）

```
POST https://api.openai.com/v1/images/edits
Authorization: Bearer $OPENAI_API_KEY
Content-Type: multipart/form-data

model=gpt-image-1
prompt=<完整 prompt，含 prefix/suffix，并显式说明"same character/object/place as the reference image">
image=@<master.png>             # 可传 1-N 张，按数组顺序入参（image, image, image）
n=1
size=1536x1024
quality=high
```

注意：
- `image[]` 参数可多传（数组形式）来传多张参考图，按顺序生效，**最多 4 张**
- 不传 `mask` → 模型做"参考引用生成"（全图重绘但参考首图）
- 传 `mask` → 模型做"局部重绘"（只改 mask 透明区域，保留其余）
- 文件支持 PNG / WebP / JPEG，单图 ≤ 25MB

返回同上。

### Mask 用法（局部重绘）

```
POST https://api.openai.com/v1/images/edits
Content-Type: multipart/form-data

model=gpt-image-1
image[]=@<source.png>
mask=@<mask.png>              # 同尺寸 RGBA PNG，alpha=0 区域 = "改这里"，alpha=255 = "保留"
prompt=<只描述编辑区的变化，不写全图描述>
n=1
size=1024x1024
quality=medium
```

Mask 约定（与 OpenAI 一致）：
- alpha=0 (透明) → "请改这片"
- alpha=255 (不透明) → "保留原像素"
- 中间值 → 模糊边界，soft blend

模型对 mask 外的区域**偶尔会做轻微调整**（非完全冻结），调用方应跑 identity QA 校验差异 ≤ 0.10。

### Transparent BG（仅 gpt-image-1 支持）

```
model=gpt-image-1
background=transparent
prompt=<isolate subject, transparent background>
image[]=@<source.png>
n=1
size=1024x1024
```

⚠️ **gpt-image-1 不支持 `background=transparent`**，调用会返回 `Transparent background is not supported for this model.`。所以"透明几出"操作必须切到 `gpt-image-1`。详见 `prompts/cutout-prompt.md`。

## 统一调用封装（伪代码）

```python
def generate_image(
    prompt: str,
    reference_images: list[str] = None,   # 0-4 张本地路径
    size: str = "1536x1024",
    quality: str = "high",
    background: str = "auto",
    output_path: str = ...,
) -> {
    "success": bool,
    "image_path": str,
    "latency_ms": int,
    "tokens_billed": int,         # gpt-image-1 按 token 计费（input + output image tokens）
    "raw_response": dict
}:
    # 1. 决定端点
    endpoint = "/v1/images/edits" if reference_images else "/v1/images/generations"
    
    # 2. 永远 n=1
    payload = {"model": "gpt-image-1", "prompt": prompt, "n": 1, "size": size, "quality": quality}
    
    # 3. 附参考图
    if reference_images:
        payload["image"] = [open(p, "rb") for p in reference_images[:4]]
    
    # 4. 调用 + 解码 base64 → 写文件
    ...
```

封装位置：约束在 `modules/generation-loop.md` 中调用，**不要**让模块 2/3/4/5 直接调用。

## 关键差异（相对其他家）

| 维度 | gpt-image-1 | gpt-image-1 |
|---|---|---|
| 参考图（/edits） | ✅ 最多 4 张 | ✅ 最多 4 张 |
| Mask 局部重绘 | ✅ | ✅ |
| `background=transparent` | ❌ 不支持 | ✅ 支持 |
| 参考强度 | 无显式 strength（靠 prompt 措辞） | 同 |
| 中文 prompt | 可识别（英文一致性更高） | 同 |
| 计费 | token-based | token-based |
| seed | 不支持 | 不支持 |

**何时切 gpt-image-1**：仅在"透明几出"场景（`cutout-prompt.md`）。其他场景（生成 / mask 局部编辑）都用 gpt-image-1 默认。

**关键应对**：

- 没有 `strength`，靠 prompt 措辞强弱控制：弱引用用 `in the style of the reference`，强引用用 `identical character as the reference, same face same outfit`
- 没有 seed，"重抽换变体" 靠在 prompt 里加 `alternative take` / `variation #2`
- 中文 prompt 全部翻译成英文再传，确保一致性（中文角色名→英文描述特征，由 prompt-locking-rules.md 已规定）

## Reference Strength 软控制（写 prompt 时手动加）

| 期望强度 | 在 prompt 里加的措辞 |
|---|---|
| 极严（≈0.90） | `identical character as the reference image, exact same face, same hair, same outfit` |
| 标准（≈0.80） | `same character as the reference image, matching facial features and outfit` |
| 中等（≈0.70） | `consistent with the reference, similar character design` |
| 宽松（≈0.55） | `inspired by the reference's style and color palette` |

由 prompt-locking-rules.md 在拼装阶段按 `asset.ref_strength_recommended` 自动选措辞。

## 限流与并发

读 `config.yaml`：

```yaml
concurrency:
  max_parallel_calls: 1        # 默认 1（Agent Loop 模式严格串行）
  rate_limit_rpm: 50           # gpt-image-1 默认 tier 上限保守值
```

- **默认串行（max_parallel_calls = 1）**：每次只跑一张，靠 generation-loop 一张一张推进
- 用户在 config 中改为 > 1 时，启用子代理并发，但仍每个子代理调一次 API（不在单次调用里塞多张）

## 重试与降级

```
HTTP 5xx / 网络错误             → 退避 2/4/8s，最多 3 次
HTTP 429（限流）                → 退避 8/16/32s，最多 5 次，期间降并发到 1
HTTP 400 (invalid_request)      → 不重试，记录 raw_response（通常是 prompt 太长/格式错）
HTTP content_policy_violation   → 不重试，标记 "policy_rejected"，让模块走"改 prompt 后让用户决定"流程
所有 retry 用尽                 → 上报，由 qa-checker 决定是否进 warning 队列
```

降级链路（可选，在 config.yaml）：

```yaml
t2i:
  provider: gpt-image
  model: gpt-image-1
  fallback:
    enabled: false
    providers: []              # 留空表示不降级；如需多家，配 ["seedream", "nano-banana"]，但默认只用 gpt-image
```

不推荐降级，因为不同家的参考图机制差异大，混用容易破坏一致性。

## 参考图传递

`/v1/images/edits` 通过 multipart 直接传文件，**不**需要先上传 OSS。封装层直接 `open(path, "rb")`。

## Prompt 长度限制

- gpt-image-1: 上限约 **4000 chars**（比上一代宽松）
- 拼装后若超长：按 `prompt-locking-rules.md` 的压缩顺序处理（先压 asset_fragment，再截 camera_directive，绝不动 prefix/suffix）

## 内容审核应对

gpt-image-1 的内容策略偏严：

- 涉及暴力 / 武器 / 敏感场景 → 显式加 `artistic film context, no real violence depicted, stylized 3D animation`
- 涉及真实人物（明星脸）→ 强制改为 `fictional character inspired by ..., not a real person`
- 涉及未成年角色 → 加 `appears adult, ambiguous age in 20s, not child`
- 仍被拒 → 在 qa_report 中标 `policy_rejected`，HITL 时高亮，提示用户改剧本描述
- **不要**重试 policy 拒绝（浪费 token）

## 调用日志

每次调用必须记录到 `_cache/api-log.jsonl`：

```jsonl
{"ts": "...", "provider": "gpt-image", "model": "gpt-image-1", "task_id": "char_lin_qing.master", "endpoint": "/v1/images/generations", "prompt_len": 412, "n_refs": 0, "latency_ms": 12340, "status": "success", "tokens_billed": 1893, "retry": 0}
```

便于：
- 成本核算（按 token 累计）
- 失败分析
- prompt 复现（同 prompt 重跑，gpt-image 因为无 seed，复现会略有差异）

## 鉴权

API key 从环境变量读，**不**在 config.yaml 中明文：

```yaml
t2i:
  provider: gpt-image
  model: gpt-image-1
  api_key_env: OPENAI_API_KEY
  base_url_env: OPENAI_BASE_URL    # 可选，默认 https://api.openai.com/v1
```

启动时（0-init 阶段）校验 `OPENAI_API_KEY` 存在；缺则报错并阻止进入 2-style-bible。

## 计费估算（按当前公开价位，可能变化）

- `quality: high` @ 1536x1024 ≈ 1500-2000 output image tokens
- 单次调用成本约 **$0.04-0.08**（含 input prompt tokens）
- 一个标准短剧（50 张）≈ **$2-4**
- 加上 qa-checker 的 vision LLM 调用（≈ $0.25）→ 总成本约 $2.5-4.5

config 里可以加预算保护：

```yaml
budget:
  max_usd_per_project: 10
  warn_at_usd: 5
  abort_at_usd: 15
```

generation-loop 每完成一张更新当前累计花费，触发 warn / abort 时上报。
