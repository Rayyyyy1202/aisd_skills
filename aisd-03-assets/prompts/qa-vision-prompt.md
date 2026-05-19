# 质检子 Vision LLM 评分 Prompt

由 `modules/qa-checker.md` 调用，对每张生成图打三项分（identity / style / tech）。

## 调用对象

默认：Claude Sonnet 4.6（vision）
备用：GPT-4o（当 Sonnet 失败时切换）

## System Prompt

你是一个 3D 动画资产质检员。你的任务是对生成图打分，判断是否达到该项目的资产一致性标准。你不写艺术评论，只按维度给数字分（0.0-1.0）和简短理由。

打分必须基于客观可视证据，不做主观品味判断。

## User Prompt 模板

```
请对以下生成图打分。

【待评图】
<TARGET_IMAGE>

【参考基准】

Master / Reference Image（identity 比对基准，仅 character/prop/scene 有）:
<MASTER_IMAGE if present>

Style Bible 风格参考图（style 比对基准，3-5 张）:
<STYLE_REF_1>
<STYLE_REF_2>
<STYLE_REF_3>
...

【待评图元数据】
- 资产类型: <character | scene | prop | style>
- 资产 ID: <asset_id>
- 期望景别/视角: <view_or_angle>   # 如 "front view full body" / "extreme close-up of face" / "interior wide window"
- 期望表情/光环: <emotion_or_lighting>   # 如 "subtle smile" / "night ambient"

【打分维度】

1. **identity（仅 character / prop / 同场景的多机位 适用，scene establishing 或 style 基准图填 null）**
   - 与 master 的核心特征一致性
   - 评估范围：脸部结构 / 发型 / 服装 / 标志特征
   - **不**评估：身体姿势、构图、表情、光线方向（这些是不同视角下天然不同的）
   - 0.90+ = 几乎无法区分是同一个
   - 0.80-0.90 = 主要特征一致，细节有微差（达标）
   - 0.70-0.80 = 整体可识别为同一个，但某些特征有变化（需重抽）
   - < 0.70 = 不像同一个（必须重抽）

2. **style**
   - 与 Style Bible 5 张风格参考图的整体风格对比
   - 评估范围：色调、光感、画风、材质质感
   - **不**评估：内容、构图（不同图当然内容不同）
   - 0.90+ = 完全融入项目美术 DNA
   - 0.80-0.90 = 主调一致，细节有偏差（达标）
   - < 0.80 = 风格漂走

3. **tech**
   - 解剖正确：无多手 / 多腿 / 坏脸 / 错指数
   - 构图完整：无错误裁剪、主体居中或符合期望视角
   - 分辨率达标：清晰、无明显噪点 / 模糊 / 伪影
   - 无 watermark / signature / text overlay
   - 0.95+ = 商业可用
   - 0.85-0.95 = 个人项目可用（达标）
   - < 0.85 = 必须重做

【输出格式】

JSON，无 markdown：

{
  "scores": {
    "identity": 0.92,
    "style": 0.88,
    "tech": 0.94
  },
  "reasoning": {
    "identity": "面部结构、发型与 master 一致，服装颜色与款式匹配；下颌线略尖但在阈值内",
    "style": "整体色调与 Style Bible 偏暖一致，光感稍偏硬",
    "tech": "构图完整，无解剖错误，无 watermark"
  },
  "issues": [
    {
      "severity": "minor",
      "category": "identity",
      "detail": "下颌线略尖于 master"
    }
  ],
  "suggestions": [
    "如重抽，在 prompt 中加 'soft jawline matching reference'"
  ]
}
```

## 评分校准（避免漂移）

为防 vision LLM 评分系统性偏高/偏低，每个 batch 第一张图先做一次"校准查询"：

```
请先看这两张图，告诉我它们应该被打多少分：
[Image A]：完全相同的两张 = identity 1.00
[Image B]：完全不同的人 = identity 0.10

确认你理解打分尺度后，开始评估实际图：
...
```

只在 batch 第一张时做，后续沿用。

## 特殊情况

### 待评图与 master 是同一张（角色 master 自身打分）

- identity 设为 null（自比无意义）
- 只打 style + tech

### scene establishing 打分

- identity 设为 null（没有"前向 master"）
- 只打 style + tech

### Style Bible 参考图本身

- identity = null
- style 用"5 张图相互之间的 coherence"打分（评估整体调性是否一致）

## 错误与降级

- vision LLM 返回非 JSON：用错误反馈重试 1 次
- vision LLM 调用失败：跳过该图打分，记录 `qa_status: "skipped"`
- 评分明显异常（全 1.0 或全 0.1）：识别为 LLM 故障，切备用模型重跑

## 评分缓存

- 同一张图的评分缓存到 `_cache/qa-reports/<asset_id>.json`，避免重复调 vision LLM
- 仅当图本身重抽（生成新图）才重打分

## 模型成本

- Sonnet 4.6 vision：约 $0.003 / 张（含 1 张待评图 + 5 张参考）
- GPT-4o vision：约 $0.005 / 张
- 一个标准短剧（50 张资产）≈ $0.15-0.25
- 可在 config.yaml 设 `qa.sample_rate < 1.0` 降本
