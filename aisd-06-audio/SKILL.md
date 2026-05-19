---
name: aisd-06-audio
version: 0.0.1-placeholder
description: >
  [Phase 2 占位] AI 短剧音频 Agent。从 02-script 读 dialogue + audio_cues，
  从 04-storyboard 读 sfx_marks + music_intent，调 TTS (ElevenLabs/MiniMax/Fish Audio) +
  音乐 (Suno/Udio) + SFX (Freesound API) 生成 audio.wav 轨道，与 05-video.preview.mp4 同步对齐。
  现阶段仅占位，P0 不可调用。
  触发词: "音频", "TTS", "配乐", "/aisd-06-audio"
user_invocable: false
---

# aisd-06-audio: AI 短剧音频（Phase 2 占位）

**当前状态：未实现（Phase 2）。**

P0 阶段（aisd-01 ~ aisd-05）已经在 output.json 中预留了本 skill 需要的全部 hook 字段：

| 字段 | 上游 skill | 描述 |
|---|---|---|
| `scenes[*].audio_cues[]` | 02-script | SFX / ambience / music_in/out 提示，含场内秒 |
| `scenes[*].dialogue[*].variants{lang: text}` | 02-script | 多语种台词（本地化时用） |
| `shots[*].sfx_marks[]` | 04-storyboard | 镜头级 SFX 时间码 |
| `shots[*].music_intent` | 04-storyboard | 音乐情绪 / 节奏 / 乐器 hint |

## Phase 2 计划

1. `modules/01-tts-provider.md` — TTS provider 选择（ElevenLabs / MiniMax / Fish Audio），voice cloning 可选
2. `modules/02-dialogue-render.md` — 对每条 dialogue 调 TTS（Agent Loop 单条），输出 wav
3. `modules/03-sfx-render.md` — 按 audio_cues + sfx_marks 拉 SFX（Freesound API / ElevenLabs SFX gen）
4. `modules/04-music-render.md` — 按 music_intent 段落生成 BGM（Suno / Udio）
5. `modules/05-mix.md` — DAW-style 混音（pydub / sox）：dialogue → SFX → music 三层叠加 + ducking
6. `modules/06-align-export.md` — 与 05-video.preview.mp4 严格对齐，输出 audio.wav

## 启动行为（现状）

```
STOP: aisd-06-audio 尚未实现（Phase 2）。

P0 已为你预留所有需要的字段：
  - 02-script.scenes[*].audio_cues[]
  - 02-script.scenes[*].dialogue[] (含 emotion / pause_before_ms / variants{})
  - 04-storyboard.shots[*].sfx_marks[] / .music_intent

完成 05-video 后，你可以：
  - 手工添加音轨：把 preview.mp4 + 自录 / 自配的 audio.wav 用 ffmpeg 合成
  - 等 Phase 2 实现：本 skill 会在 phase2/audio-spec.md 完成后开发
```

## 设计原则（写给 Phase 2 开发）

- Agent Loop 单 dialogue：每次 TTS 调用 1 条 dialogue，单文件落盘，QA（人声相似度 + 情绪匹配 + 时长）
- 对齐严格度：所有 audio events 按时间码对齐到 video frame；不允许漂移
- ducking：dialogue 出现时 BGM 自动降 -8dB
- 端到端验证：最终 `audio.wav` 时长必须等于 `preview.mp4` 时长（±0.05s）
