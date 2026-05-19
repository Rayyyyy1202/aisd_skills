# Module 1: Shot Breakdown

> Core Question: 把每个 02-scene 切成 N 个 shot，标定景别 / 角度 / 运镜 / 时长 / 镜头内容。

## Inputs from Upstream

- `./aisd/02-script/output.json`：scenes[]（含 duration_s、dialogue[]、shot_hints[]）
- `./aisd/02-script/output.json`：total_duration_s（用于一致性校验）

## Data Sources

无外部源。

## Process

### Step 1: 每个 02-scene 拆 shot

对每个 `02.scenes[s]`：

- 参考 `02.scenes[s].shot_hints[]` 作为起点（02 给的粗建议，你要细化）
- 一个 scene 通常 2-6 个 shot
- 切 shot 的触发点：
  - 视角变化（POV 切换、人物切换）
  - 时间跳（"一会儿之后"）
  - 重要 dialogue 起句（hold 在说话者）
  - 重要 reaction（hold 在听者）
  - 关键 prop 出现（close）

### Step 2: 每个 shot 填字段（按 schema _common#/$defs/Shot）

```json
{
  "id": "shot_001",                      // 全剧累计编号，3 位补零
  "scene_id": "scene_001",
  "sequence": 1,                          // 在整剧中的播放顺序
  "duration_s": 3.5,
  "camera": {
    "shot_size": "medium",                // xclose | close | medium_close | medium | medium_wide | wide | extreme_wide
    "angle": "eye",                       // eye | high | low | dutch | bird | worm | over_shoulder | pov
    "movement": "dolly_in",               // static | pan | tilt | dolly_in | dolly_out | tracking | handheld | crane | zoom_in | zoom_out
    "lens_mm_equiv": 50                   // 35mm 等效焦段
  },
  "composition": "char_001 居画面右 1/3，背景失焦办公环境",
  "dialogue_ref": "dlg_001",              // 若该 shot 覆盖某条对白
  "on_screen_text": "三年后"               // 字幕 / 屏上文字（可选）
}
```

- 还不填 `first_frame_path` / `asset_refs` / `sfx_marks` 等 — 后续模块补
- `lens_mm_equiv` 默认 50；wide → 24-35；close → 85-135

### Step 3: 时长一致性

```python
# sum(this scene's shots) == 02.scenes[s].duration_s （±10%）
# 全剧 sum(shots[*].duration_s) == 02.total_duration_s （±10%）
```

不一致 → 重切分（调整某 shot 的 duration）。

### Step 4: 写到 `_cache/m01-shots.json`

```json
{
  "module": "01-shot-breakdown",
  "completed_at": "<ISO>",
  "stats": {
    "shots_count": 12,
    "total_duration_s": 60.5,
    "target_duration_s": 60
  },
  "shots": [...]
}
```

### Step 5: 简报 + HITL

```
shot 草稿（12 个 shot, 60.5s ≈ 目标 60s）：

scene_001 (12s) → 3 个 shot:
  shot_001  wide → dolly_in to medium on char_001     (3.5s)
  shot_002  close on hand picking up prop_001         (1.5s)
  shot_003  medium_close OTS char_002, char_001 in BG (7s)

scene_002 (...)
...

是否继续？(y / 调整 shot_xxx / 加 shot / 减 shot)
```

## Decision Gate

- 等用户 approve → proceed to Module 2
- 用户调整 → 重写 m01-shots.json 后再次简报，直到 approve

## Data Passing to Next Module

- `shots[]`（含 camera / composition / dialogue_ref）
- Module 2 将给每个 shot 绑定 `asset_refs[]`
