# Module 5: Shot Hints + Audio Cues (Phase 2 hook)

> Core Question: 每个 scene 给 2-5 条粗镜头建议；同时按场景填 phase2_hook 字段 `audio_cues[]`。

## Inputs from Module 4

- 完整 scenes / dialogue / characters / props

## Data Sources

无外部源。

## Process

### Step 1: 每 scene 写 shot_hints[]

对每个 scene，按 dialogue 节奏给 2-5 条 shot_hints。每条：

```json
{
  "sequence": 1,
  "intent": "建立场景 + 引入主角",
  "camera_hint": "wide → tracking dolly_in to medium on char_001",
  "duration_hint_s": 3.5
}
```

要点：
- `intent`：这个 shot 在戏剧上要做什么（不是技术描述）
- `camera_hint`：景别 + 运镜建议（04-storyboard 会重新细化，你不必精确）
- `duration_hint_s`：粗时长

不要给所有 shot 都堆运镜 — 静态镜头也算。

### Step 2: 每 scene 填 audio_cues[]（phase2_hook）

为 06-audio 预留信号。每 scene 给 0-N 条音频提示：

```json
[
  { "type": "music_in", "cue": "低沉弦乐淡入", "t_s_from_scene_start": 0 },
  { "type": "sfx", "cue": "高跟鞋脚步声", "t_s_from_scene_start": 2.5 },
  { "type": "music_swell", "cue": "撞击鼓点重音", "t_s_from_scene_start": 8.0 },
  { "type": "silence", "cue": "全静 1.5s（反转前）", "t_s_from_scene_start": 10.5 }
]
```

`type` enum：`sfx | ambience | music_in | music_out | music_swell | silence`

不知道写什么 → `audio_cues: []`（合法占位），不要瞎填。

### Step 3: 写到 `_cache/m05-shot-hints.md`

```markdown
# Shot Hints + Audio Cues

## scene_001
Shots:
  1. wide → dolly_in to medium on char_001  (3.5s, "建立场景 + 主角入画")
  2. close on hand picking up doc  (1.5s, "暗示道具")
  3. medium_close, over shoulder  (2s, "听 char_002 说话的反应")

Audio:
  - 0.0s music_in: 低沉弦乐
  - 2.0s sfx: 高跟鞋
  - 5.5s silence: 反转前空拍
```

## Decision Gate

无 gate — 总是 proceed to Module 6。

## Data Passing to Next Module

传给 Module 6：

- 每 scene 的 `shot_hints[]`、`audio_cues[]`
- M1-M4 的全部累计产出 → 组装 output.json
