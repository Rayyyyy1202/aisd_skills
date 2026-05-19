---
name: aisd-07-editing
version: 0.0.1-placeholder
description: >
  [Phase 2 占位] AI 短剧剪辑 Agent。读 05-video.preview.mp4 + 06-audio.audio.wav，
  做色彩分级 + 超分辨率 + 字幕烧入 + 合规标识（AI生成标记 / 平台水印 / 年龄分级）。
  输出 final.mp4。现阶段仅占位，P0 不可调用。
  触发词: "剪辑", "调色", "超分", "/aisd-07-editing"
user_invocable: false
---

# aisd-07-editing: AI 短剧剪辑（Phase 2 占位）

**当前状态：未实现（Phase 2）。**

P0 已预留 hook 字段：

| 字段 | 上游 | 描述 |
|---|---|---|
| `clips[*].cut_marks[]` | 05-video | 单 clip 内的 in/out 修剪建议 |
| `clips[*].color_intent` | 05-video | 调色 brief (cinematic / anime_warm / dramatic_cool / ...) |
| `clips[*].speed_intent` | 05-video | 时间重映射 hint（slow-mo / time-lapse） |
| `compliance_tags[]` | 05-video | ai_generated / dramatized / sponsored / age_18+ |
| `shots[*].subtitle_intent` | 04-storyboard | 字幕位置 + 风格 |

## Phase 2 计划

1. `modules/01-trim.md` — 应用 cut_marks 做精剪
2. `modules/02-color.md` — 按 color_intent 调 LUT (DaVinci Resolve CLI / FFmpeg color matrix)
3. `modules/03-upscale.md` — 视频超分 (Topaz Video AI / Real-ESRGAN)
4. `modules/04-subtitle.md` — 字幕生成 + 烧入（按 dialogue + subtitle_intent）
5. `modules/05-compliance.md` — 按 compliance_tags 烧水印 + AI 标识
6. `modules/06-export.md` — final.mp4 + 多版本（平台规格）

## 启动行为

```
STOP: aisd-07-editing 尚未实现（Phase 2）。

P0 已为你预留：cut_marks / color_intent / speed_intent / compliance_tags / subtitle_intent。

完成 05-video + 06-audio 后，你可以：
  - 手工剪辑：把 preview.mp4 + audio.wav 拉进 DaVinci / Premiere / 剪映
  - 等 Phase 2 实现
```
