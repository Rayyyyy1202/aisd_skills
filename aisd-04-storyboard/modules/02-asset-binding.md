# Module 2: Asset Binding

> Core Question: 每个 shot 绑定哪些 asset (角色 / 场景 / 道具)，作为 prompt 引用的依据。

## Inputs from Module 1

- `_cache/m01-shots.json`：shots[]（含 scene_id）

## Data Sources

- `./aisd/02-script/output.json`：scenes[s].characters_present、props_present、dialogue.speaker
- `./aisd/03-assets/output.json`：assets[]（含 source_id ←→ asset_id 映射）

## Process

### Step 1: 构建 source_id → asset_id 映射

```python
# 从 03-assets/output.json 读出所有资产
mapping = {}
for a in assets_03.assets:
    if a.source_id:
        mapping[a.source_id] = a.id   # e.g. mapping["char_001"] = "asset_001"

# 也兼容 03-assets 用 02 的 id 直接当 asset id 的情况
```

### Step 2: 每个 shot 绑 asset_refs[]

对每个 shot：

```python
scene = lookup_02_scene(shot.scene_id)
asset_refs = []

# 1. 必绑场景资产
scene_asset_id = mapping[scene.id_or_some_source]   # 通常是该 scene 的 asset
asset_refs.append(scene_asset_id)

# 2. 必绑该 shot 中露脸的角色
present_chars = scene.characters_present  # 默认所有
if shot.dialogue_ref:
    speaker = lookup_dialogue(shot.dialogue_ref).speaker
    if speaker not in present_chars: present_chars.append(speaker)

# 给镜头加优先角色：景别 close/medium 时只绑主体（说话者或动作主体）；wide 时绑所有 present
if shot.camera.shot_size in ["xclose", "close", "medium_close"]:
    # 主体 = dialogue speaker 或 composition 描述里第一个 char
    asset_refs.append(mapping[primary_char])
else:
    for c in present_chars:
        asset_refs.append(mapping[c])

# 3. 道具：如果 composition / shot_hints 里提到了 prop，绑进来
for p in scene.props_present:
    if mentioned_in(shot.composition, p) or shot.camera.shot_size in ["xclose", "close"]:
        asset_refs.append(mapping[p])

shot.asset_refs = unique(asset_refs)
```

### Step 3: 校验

- 每个 `asset_refs[*]` 必须 ∈ `03-assets.assets[*].id`（schema 强制 `^(char|scene|prop|asset)_NNN$` pattern）
- 每个 shot 至少 1 个 asset_ref（schema 强制 minItems=1）
- 角色绑定 ≤ 4 个（gpt-image-1 多人物 ref 易混淆）

### Step 4: 角色变体选择

对每个绑定的角色，决定**用哪个 view / expression 作为 ref**：

```python
view_id = "view.front"  # default
if shot.camera.angle in ["pov", "high"]: view_id = "view.front"
elif shot.camera.angle == "over_shoulder": view_id = "view.back"
elif shot.camera.shot_size in ["xclose", "close", "medium_close"]:
    # 从 dialogue.emotion 推 expression
    emotion = dialogue.emotion if shot.dialogue_ref else "neutral"
    view_id = f"expression.{map_emotion_to_expr(emotion)}"

shot.asset_ref_views[char_asset_id] = view_id
# Module 3 拼 prompt 时用这个映射查 03-assets 里对应 path 作为 ref_image
```

类似处理场景：
```python
scene_variant = f"lighting.{02.scenes[shot.scene_id].time_of_day}.angle.<最接近 shot.camera.angle 的>"
```

### Step 5: 写到 `_cache/m02-binding.json`

```json
{
  "shots": [
    {
      "id": "shot_001",
      "asset_refs": ["asset_002", "asset_001"],   // scene + char
      "asset_ref_views": {
        "asset_002": "lighting.day.angle.entry",
        "asset_001": "view.front"
      }
    }
  ]
}
```

## Decision Gate

无 gate — 校验通过即进入 Module 3。

## Data Passing to Next Module

- shots[] 现在带 `asset_refs[]` 和 `asset_ref_views{}`
- Module 3 用它们查 03-assets 拿真实图片路径，拼到 prompt 与 reference_images 数组
