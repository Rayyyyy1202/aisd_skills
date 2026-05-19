# Module 3: Prompt Compose

> Core Question: 为每个 shot 拼装 gpt-image-1 调用所需的完整 prompt + reference_images。

## Inputs from Module 2

- `_cache/m02-binding.json`：shots[] + asset_refs + asset_ref_views
- `./aisd/03-assets/output.json`：style_bible + 每个 asset 的 master_path / views / angles

## Data Sources

无外部源。

## Process

### Step 1: 解析 Style Bible 的注入片段

```python
style_prefix = style_bible.art_direction     # 一段美术 DNA 描述
style_negative = style_bible.negative_prompt
style_refs = [r.path for r in style_bible.refs]   # 1-3 张 style ref 路径
```

### Step 2: 为每个 shot 拼 prompt

```python
def compose_prompt(shot):
    # 解 camera 描述成自然语言
    camera_phrase = (
        f"{shot.camera.shot_size.replace('_', ' ')} shot, "
        f"{shot.camera.angle} angle, "
        f"{shot.camera.movement.replace('_', ' ')}, "
        f"{shot.camera.lens_mm_equiv}mm lens"
    )
    
    # 解 asset refs 为人物描述（避免文字描述漂移，主要靠 image refs；这里只补主体定位）
    subject_phrase = "showing " + ", ".join([
        f"{lookup_asset(aid).name} as the reference"
        for aid in shot.asset_refs
        if lookup_asset(aid).asset_type == "character"
    ])
    
    composition_phrase = shot.composition
    
    # 拼装（顺序固定，禁止改）
    prompt = (
        f"{style_prefix}. "
        f"{camera_phrase}. "
        f"{subject_phrase}. "
        f"{composition_phrase}. "
        f"identical visual style to the style reference images. "
        f"high quality, cinematic still frame."
    )
    
    # 强度词（按 conventions §5 四档）
    if any(r.asset_type == "character" for r in shot.asset_refs):
        prompt += " The character must look the same as the reference image."  # 0.85 档
    if any(r.asset_type == "scene" for r in shot.asset_refs):
        prompt += " The scene is consistent with the reference."  # 0.80 档
    
    return prompt

def resolve_reference_images(shot):
    refs = []
    # 1. 加 style refs（永远）
    refs.extend(style_refs[:2])   # 前 2 张，留位置给 asset
    
    # 2. 加场景 asset
    for aid in shot.asset_refs:
        asset = lookup_asset(aid)
        if asset.asset_type == "scene":
            view = shot.asset_ref_views.get(aid)
            path = resolve_variant_path(asset, view) or asset.master_path
            refs.append(path)
    
    # 3. 加角色 asset（最多保留 2 个；超过 → 只保留主体）
    chars_added = 0
    for aid in shot.asset_refs:
        asset = lookup_asset(aid)
        if asset.asset_type == "character":
            if chars_added >= 2: break
            view = shot.asset_ref_views.get(aid)
            path = resolve_variant_path(asset, view) or asset.master_path
            refs.append(path)
            chars_added += 1
    
    # 4. 加道具（如果还有 ref 槽位；gpt-image-1 edits 接 ≤ 4）
    for aid in shot.asset_refs:
        if len(refs) >= 4: break
        asset = lookup_asset(aid)
        if asset.asset_type == "prop":
            refs.append(asset.master_path)
    
    return refs[:4]   # gpt-image-1 上限
```

### Step 3: 拼 negative_prompt

```python
shot_negative = (
    style_negative
    + ", text, watermark, logo"
    + ", multiple identical characters, mirror, frame"
    + (", extra fingers, malformed hands" if any_close_or_med(shot) else "")
)
```

### Step 4: 决定输出路径

```python
output_path = f"./aisd/04-storyboard/first_frames/{shot.id}.png"
```

### Step 5: 写到 `_cache/m03-prompts.json`

```json
{
  "shots": [
    {
      "id": "shot_001",
      "prompt": "<final prompt>",
      "negative_prompt": "<...>",
      "reference_images": ["./aisd/03-assets/assets/style/ref_01.png", "./aisd/03-assets/assets/scenes/asset_002/lighting.day.angle.entry.png", "./aisd/03-assets/assets/characters/asset_001/views/front.png"],
      "size": "1024x1536",
      "quality": "high",
      "output_path": "./aisd/04-storyboard/first_frames/shot_001.png"
    }
  ]
}
```

## Decision Gate

- 每个 shot 必须有 ≥ 1 ref（gpt-image-1 不带 ref 不会保持身份）
- 任何 ref 路径不存在 → 报错并指出哪个 shot 的哪个 asset_id

## Data Passing to Next Module

- `m03-prompts.json` 完整可入队
- Module 4 把它转为队列文件格式（同 3d-drama-assets generation-loop schema）
