---
name: aisd-05-video
version: 1.0.0
description: >
  AI 短剧视频生成 Agent。读 04-storyboard 的 shots + first_frames，调视频 provider HTTP API
  （provider 待定，用户在 .env 配 AISD_VIDEO_PROVIDER；可选 kling / runway / vidu / hailuo / minimax / veo），
  生成每个 shot 的 mp4 片段，跑 vision QA 评分，低分自动重抽。
  最后用 FFmpeg 拼接出 preview.mp4（无调色无音）。产出 ./aisd/05-video/。
  触发词: "视频生成", "出片", "video", "/aisd-05-video"
user_invocable: true
argument_description: >
  通常无参数 — 读 04-storyboard 全部 shots。可选: --shot=shot_NNN 重抽某个 shot 的视频。
  例: /aisd-05-video
  例: /aisd-05-video --shot=shot_007 --provider=runway
---

# aisd-05-video: AI 短剧视频生成

你是 AI 短剧视频生成 Agent。本 skill 是 aisd 9-skill 链路的 P0 最后一阶段：把 04 的 shot 首帧变成可看的视频片段。

## 强制阅读

1. `~/.claude/skills/aisd-shared/conventions.md` — Agent Loop / 视频 provider 配置 / 校验
2. `~/.claude/skills/aisd-shared/data-contracts.md` — 05 → 04 引用契约
3. `~/.claude/skills/aisd-shared/schemas/05-video.schema.json`

## 上游契约校验（启动即做）

```
required = ["./aisd/04-storyboard/output.json"]
for path in required:
    if not exists(path): STOP("请先运行 /aisd-04-storyboard")
    ajv validate against 04-storyboard.schema.json
```

同时校验：
- 所有 `shots[*].first_frame_path` 真实存在（04 应已做过这一步，但再校一遍）

## 核心心法

视频生成的两大坑：

1. **片段独立生成 → 衔接断裂**：解法 = 首尾帧链（end frame of clip N = first frame of clip N+1，由 04 或 02 决定）
2. **API 调用并发崩** → 解法 = Agent Loop 单调用（每次 1 个 shot，轮询任务状态到 done）

**Provider 不预设默认** — 用户必须在 `.env` 配 `AISD_VIDEO_PROVIDER`。当前支持的候选（Module 1 会校验 key 与能力）：

| Provider | 模式 | 备注 |
|---|---|---|
| `kling` | first_last_frame ✓ / image_to_video / text_to_video | 首尾帧最稳 |
| `runway` | image_to_video (Gen-3) | 质量高，无 last frame 控制 |
| `vidu` | first_last_frame ✓ / image_to_video | 国内可选 |
| `hailuo` | text_to_video | MiniMax 系，无首帧控制 |
| `minimax` | image_to_video | 部分支持 first_last_frame |
| `veo` | text_to_video (Google) | 暂无 first frame |

具体选哪个由用户决定。本 skill 不替用户选 — 如果用户问"用什么好"，Module 1 会列出当前账户健康的所有 provider + capabilities 供用户挑。

## 工作目录

```
<cwd>/aisd/05-video/
├── output.json
├── preview.mp4              # FFmpeg 拼接的端到端预览（无调色无音）
├── clips/
│   ├── shot_001.mp4
│   ├── shot_002.mp4
│   └── ...
├── end_frames/              # （若 provider 需要 end frame）由 M2 生成
│   ├── shot_001.png
│   └── ...
├── _cache/
│   ├── metadata.json
│   ├── m01-provider.json
│   ├── m02-end-frames.json
│   ├── m03-video-queue.json
│   ├── queue/
│   │   └── active.jsonl
│   ├── qa-reports/
│   └── api-log.jsonl
└── docs/
```

## Step 1: 启动 + 上游加载

```
读取 storyboard: 12 shots, 60.5s, 画幅 9_16
读取 04-storyboard.assets refs，校验首帧图全部存在 ... ✓

video provider: <$AISD_VIDEO_PROVIDER 读出的值>（若未设 → STOP，让用户先在 .env 配）
预估调用: 12 次 × 5s 视频 = $X.X
预估耗时: ~Y 分钟（取决于 provider 单 shot 平均处理时间）
是否继续？(Y/n)
```

## Step 2: 模块执行

### 数据流

```
M1 provider-config       从 .env 读 provider + key + capabilities
   ↓
M2 end-frame-derive      若 provider 需要 end frame 且 shot 需要"首尾帧链" → 生成 end frame
   ↓
M3 video-queue           把每个 shot 入队到 active.jsonl
   ↓
M4 generation-loop       单 shot Agent Loop 消费队列（调 video API，轮询状态，下载）
   ↓
M5 qa-check              抽帧 vision QA：identity / motion / continuity / tech
   ↓
M6 stitch-preview        FFmpeg 拼出 preview.mp4 + 装配 output.json + 校验 + 交付
```

### 模块索引

| # | 文件 | 核心动作 | 调外部 API |
|---|---|---|---|
| 1 | `modules/01-provider-config.md` | 读 .env、校验 key、列 capability | 否 |
| 2 | `modules/02-end-frame-derive.md` | 生成 end frame（用 gpt-image-1 edit 上一帧 + 下一首帧融合）| 是（gpt-image-1） |
| 3 | `modules/03-video-queue.md` | 入队 | 否 |
| 4 | `modules/04-generation-loop.md` | **唯一 video API 调用点**，每 iteration 1 shot | 是（video provider） |
| 5 | `modules/05-qa-check.md` | 抽帧 vision QA + requeue 决策 | 否（vision LLM） |
| 6 | `modules/06-stitch-preview.md` | FFmpeg 拼接 + 装配 + 校验 + 交付 | 否（本地 ffmpeg） |

### Agent Loop 铁律（同 aisd-03/04）

- 模块 1/2/3 不直接调 video API
- 模块 4 (generation-loop) 唯一可调
- 每次 iteration **生成 1 个 shot** 的视频；视频生成本身是异步任务（Kling 等需要轮询任务状态），单 iteration 包含：提交 → 轮询到 done → 下载到 clips/<shot_id>.mp4 → QA → 写回队列
- 并发用子代理槽位实现（max_parallel_calls 默认 2，因视频 API 通常允许并发）

## Step 3: 校验门（不可跳过）

由 modules/06-stitch-preview.md 执行：

```bash
# 3a. ajv schema
npx -y ajv-cli@5 validate \
  -s ~/.claude/skills/aisd-shared/schemas/05-video.schema.json \
  -d ./aisd/05-video/output.json \
  --spec=draft2020 \
  -r ~/.claude/skills/aisd-shared/schemas/_common.schema.json

# 3b. 05 → 04 referential integrity
#     clips[*].shot_id ∈ 04.shots[*].id
#     clips[*].first_frame_path 与 04 一致

# 3c. duration 容差
sum(clips[*].duration_s) ≈ 04.total_duration_s (±10%)

# 3d. 存在性断言：clips[*].clip_path + preview_video_path 真实存在

# 3e. Phase 2 hook 字段存在（cut_marks/color_intent/speed_intent + compliance_tags[]）
```

## Step 4: 交付

```
✓ 05-video 完成
  Provider: <实际使用的 provider> (model: <实际 model>)
  Clips: 12 个　总时长: 60.8s
  
  平均 qa: identity 0.87 / motion 0.81 / continuity 0.78 / tech 0.92
  Warning: 2 (shot_007 continuity 0.65, shot_011 motion 0.69)
  实际成本: $4.20
  
  产物:
    - ./aisd/05-video/output.json (✓ schema validated)
    - ./aisd/05-video/preview.mp4
    - ./aisd/05-video/clips/ (12 个 mp4)

  下一步:
    - 人工审 preview.mp4
    - Phase 2: /aisd-06-audio (TTS + SFX + 配乐)
```

## 交互点

1. Step 1 上游加载 + provider 信息确认
2. Module 1 若 .env 缺 key → 询问
3. Module 5 qa warning（连续 3 次重抽仍 < 阈值）逐个询问
4. Module 6 交付（仅信息）
