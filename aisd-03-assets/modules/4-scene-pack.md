# Module 4: Scene Pack

## 职责

为每个主场景产出"场景包"：建立镜（establishing shot）→ 4-6 关键机位/区域图 → 日夜两套光环。同一场景的所有机位都从同一 establishing shot 派生（首图引用），强制空间一致。这是防"场景跳脱"的核心模块。

## 输入

- `_cache/m1-extraction.json`（scenes 列表）
- `_cache/m2-style-bible.json`（DNA）
- `config.yaml`（asset_granularity.scene / consistency.scene_ref_strength）

## 步骤

**本模块不直接调 T2I API。**只做：拼 prompt → 入队 → 调 generation-loop → 等队列消费完 → 渲染场景卡 → HITL 闸。

按 scenes 列表入队（同一场景内部任务通过 `depends_on` 表达 establishing → 机位 → 光环变体的层级依赖）。

### 4.1 决定粒度

按 tier 决定生成内容：

- `primary`：establishing + 5 机位 + 日/夜两套光环 = `(1 + 5) × 2 = 12` 张
- `secondary`：establishing + 3 机位 + 日/夜光环（按 time_variants 决定）= 4-8 张

config.yaml 覆盖默认。

### 4.2 入队 establishing shot（每个场景一个）

无依赖、无参考图：

```jsonl
{
  "task_id": "scene_apt_living.establishing",
  "asset_id": "scene_apt_living",
  "asset_type": "scene",
  "stage": "establishing",
  "depends_on": [],
  "prompt": "<style_prefix>, establishing wide shot of <scene.description>, <default_time> lighting, no people, no characters, environment only, <style_suffix>",
  "negative_prompt": "<style_negative>, people, characters, person, figure, crowd",
  "reference_images": [],
  "size": "1536x1024",                 // 16:9
  "quality": "high",
  "output_path": "assets/scenes/scene_apt_living/establishing.png",
  "qa_thresholds": {"identity": 0.0, "style": 0.85, "tech": 0.90}
}
```

### 4.3 入队机位/区域图（依赖 establishing）

LLM 基于 scene.description 推断 N 个有意义的视角（`wide_window`、`kitchen_pov`、`sofa_close`、`door_entry`、`corner_detail` 之类）。

每个 angle 一个任务：

```jsonl
{
  "task_id": "scene_apt_living.angle.wide_window",
  "asset_id": "scene_apt_living",
  "asset_type": "scene",
  "stage": "angle.wide_window",
  "depends_on": ["scene_apt_living.establishing"],
  "prompt": "<style_prefix>, <ref_strength_hint_for_0.70>, <scene.description>, interior view towards the floor-to-ceiling window, day lighting, no people, <style_suffix>",
  "reference_images": ["assets/scenes/scene_apt_living/establishing.png"],
  "size": "1536x1024",
  "quality": "high",
  "output_path": "assets/scenes/scene_apt_living/angles/wide_window.png",
  "qa_thresholds": {"identity": 0.75, "style": 0.85, "tech": 0.85}    // identity = "同一空间感"
}
```

注：场景的 identity 维度评的是"是否同一空间"（结构、家具位置、墙体），由 qa-checker 的 vision LLM 按照"establishing 是 master"做对比。

### 4.4 入队光环变体（依赖原图）

对 establishing + 每个 angle，按 scene.time_variants 入队光环变体（默认日/夜两套）：

```jsonl
{
  "task_id": "scene_apt_living.lighting.night.establishing",
  "asset_id": "scene_apt_living",
  "asset_type": "scene",
  "stage": "lighting.night.establishing",
  "depends_on": ["scene_apt_living.establishing"],
  "prompt": "<style_prefix>, <ref_strength_hint_for_0.80>, <scene.description>, night ambient lighting, lamps on, deep blue exterior, warm interior glow, no people, <style_suffix>",
  "reference_images": ["assets/scenes/scene_apt_living/establishing.png"],
  ...
  "output_path": "assets/scenes/scene_apt_living/lighting/night/establishing.png"
}
{
  "task_id": "scene_apt_living.lighting.night.angle.wide_window",
  "depends_on": ["scene_apt_living.angle.wide_window", "scene_apt_living.lighting.night.establishing"],
  ...
  "output_path": "assets/scenes/scene_apt_living/lighting/night/angles/wide_window.png"
}
```

光环描述对照表（按 time_variants 自动拼）：

| time | prompt 段 |
|---|---|
| `day` | `bright daylight, natural sunlight through windows` |
| `night` | `night ambient lighting, lamps on, deep blue exterior, warm interior glow` |
| `dawn` | `dawn light, soft pink and blue sky, low warm sun` |
| `dusk` | `golden hour, low warm light, long shadows` |
| `+rain` | 追加 `rainy day, water on glass, overcast` |
| `+snow` | 追加 `snowfall, white snow on surfaces, cold blue ambient` |

### 4.5 调用 generation-loop

所有场景任务入队后：

```
invoke modules/generation-loop.md on _cache/queue/active.jsonl
```

预估时间：一个 2 场景项目（16 张图）≈ 3-5 分钟（串行）。

### 4.6 队列消费完后：渲染场景卡

只读已落盘的图片路径，用 `templates/scene-card.md.j2` 渲染 `docs/scenes/<scene.id>.md`，含：

- 基本信息（名/tier/出场次数/time_variants）
- establishing 大图
- 机位缩略图 N × 光环 M 矩阵
- 锁定 prompt 片段
- qa 分数表

### 4.7 场景 JSON 片段

写入 `_cache/m4-scene-pack.json` 的 `scenes[]` 数组：

```json
{
  "id": "scene_apt_living",
  "name": "公寓客厅",
  "tier": "primary",
  "ref_images": {
    "establishing": "assets/scenes/scene_apt_living/establishing.png",
    "angles": {
      "wide_window": "assets/scenes/scene_apt_living/angles/wide_window.png",
      "kitchen_pov": "...",
      "sofa_close": "...",
      "door_entry": "...",
      "corner_detail": "..."
    },
    "lighting": {
      "day": {
        "establishing": "assets/scenes/scene_apt_living/lighting/day/establishing.png",
        "angles": {"wide_window": "...", ...}
      },
      "night": {
        "establishing": "assets/scenes/scene_apt_living/lighting/night/establishing.png",
        "angles": {"wide_window": "...", ...}
      }
    }
  },
  "prompt_fragment": "minimalist Tokyo apartment living room, floor-to-ceiling window facing city skyline, gray L-shape sofa, walnut floor, indoor plants",
  "negative_prompt": "people, characters, traditional Chinese architecture",
  "ref_strength_recommended": 0.70,
  "qa_scores": {
    "style_avg": 0.91,
    "tech_avg": 0.93,
    "retry_count": 1
  }
}
```

### HITL 闸③

所有场景生成完毕后，呈现给用户：

```
🏙️ 场景包 (2 场景 / 16 张图)

[scene_apt_living] 公寓客厅 [primary]  12 张  style 0.91 ✅
  establishing.png
  angles/{wide_window,kitchen_pov,sofa_close,door_entry,corner_detail}.png
  lighting/day/{establishing + 5 angles}
  lighting/night/{establishing + 5 angles}

[scene_coffee_corner] 街角咖啡馆 [secondary]  4 张  style 0.87 ✅
  establishing.png  angles/{table_pov,counter,window}.png  lighting/night/establishing.png

请选择：
  approve all
  approve scene_apt_living
  redo scene_coffee_corner
  redo scene_coffee_corner with hint "改成更冷的色调，更工业感"
  redo scene_apt_living angle wide_window
  redo scene_apt_living lighting night    # 整套夜景重抽
  view scene_apt_living
```

操作策略同 character pack。

直到所有场景 approve，置 `hitl_gates["scene-pack"] = "approved"`。

## 输出

- `assets/scenes/<id>/`（每场景一个子目录）
- `docs/scenes/<id>.md`
- `_cache/m4-scene-pack.json`

## 错误与边界

- 场景描述过抽象（"一个房间"）：先让 LLM 基于剧情上下文补描述，仍不足则提示用户在剧本中补环境细节
- 同一场景的两个机位明显"对不上空间"（如客厅 wide_window 和 kitchen_pov 看起来是两个房间）：识别方法是让质检子用 vision LLM 判定"是否同一空间"，不过则强制重抽
- 光环变体改变了空间结构（如 night 版本桌子位置都变了）：strength 调到 0.85+ 再重抽

## 下游契约

`_cache/m4-scene-pack.json` 提供给：

- `5-prop-pack`：道具如果有 `appears_in_scenes`，可读对应场景图作为道具的环境参考（让道具看起来"属于这个场景"）
- `6-pack-export`：合并到 assets.json 的 `scenes[]`
- 下游抽卡 Agent：按 `(scene_id, time, angle)` 三维 key 取对应 reference image
