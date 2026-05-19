# Module 1: Load From 02-Script

## 职责

从 `./aisd/02-script/output.json` 抽取「会跨镜复用」的元素：角色、场景、道具。**与旧版本 3d-drama-assets 的区别**：不再解析自由文本剧本，直接消费 02-script 的结构化输出（IDs 已经存在，无需重新分配）。

## 输入

- `./aisd/02-script/output.json`
- `./aisd/03-assets/config.yaml`（asset_granularity 默认 + role → 粒度档位映射）

## 步骤

### 1. 读取上游

```
script = read_json("./aisd/02-script/output.json")
# 取得: scenes[], characters[], props_required[], total_duration_s, language
```

### 2. 抽取 characters[]（从 02.characters[]）

对每个 `02.characters[c]` 生成一条 `extraction.characters[c]`：

```json
{
  "source_id": "<02.characters[c].id>",   // 必填，用于 03 → 02 引用完整性
  "id": "<03-assets 本地 asset id, e.g. asset_001>",  // 由 6-pack-export 时统一分配
  "name": "<02.characters[c].name>",
  "role": "<02.characters[c].role>",      // lead | co_lead | supporting | extra | voice_only
  "description": "<02.characters[c].description>",
  "age_band": "<02.characters[c].age_band>",
  "wardrobe": "<02.characters[c].wardrobe>",
  "key_traits": [...],
  "appearance_count": <统计该 char 出现在多少个 scene 中>,
  "appearance_scenes": ["<scene_id 列表>"],
  "key_emotions": [<从 02.scenes[*].dialogue[*].emotion 收集 unique，只取该 speaker 的>],
  "granularity_tier": "<lead → lead 档；co_lead → co_lead 档；supporting → supporting 档；extra/voice_only → extra 档>"
}
```

`voice_only` 角色不出图，跳过资产生成（但仍登记，便于 06 时校验）。

### 3. 抽取 scenes[]（从 02.scenes[]）

按 location 去重 — 同一个 location 在剧本中出现多次只产一个 scene 资产（节省成本）：

```python
unique_locations = {}
for scene in script.scenes:
    key = scene.location  # "INT. 办公室 - 工位区"
    if key not in unique_locations:
        unique_locations[key] = {
            "source_id": scene.id,             # 取第一次出现的 02 scene id
            "all_source_ids": [scene.id],
            "name": key,
            "description": "<从 scene.summary + characters_present + dialogue 综合归纳环境>",
            "time_variants": [scene.time_of_day],
            "appearance_count": 1
        }
    else:
        unique_locations[key].all_source_ids.append(scene.id)
        unique_locations[key].time_variants = list(set(unique_locations[key].time_variants + [scene.time_of_day]))
        unique_locations[key].appearance_count += 1
```

每个 unique_location 生成一条 extraction.scenes 项：

```json
{
  "source_id": "<取第一次出现的 02 scene id>",
  "all_source_ids": ["scene_001", "scene_003"],
  "name": "INT. 办公室 - 工位区",
  "description": "<...>",
  "time_variants": ["day", "night"],
  "weather_variants": [],
  "appearance_count": 2,
  "granularity_tier": "<≥ 2 个 02-scenes 复用 → primary，否则 secondary>"
}
```

### 4. 抽取 props[]（从 02.props_required[]）

直接 1:1 映射：

```json
{
  "source_id": "<02.props_required[p].id>",
  "name": "<02.props_required[p].name>",
  "description": "<02.props_required[p].description>",
  "appears_in_scenes": "<02.props_required[p].scenes_used_in>",
  "held_by": "<从 02.scenes[*].dialogue 中推断；若无明显持有者则 null>",
  "granularity_tier": "<出现在 ≥ 2 个 scene → primary，否则 secondary>"
}
```

### 5. 计算预估生成图数

```python
total = 0
total += 5  # Style Bible
for char in extraction.characters:
    if char.granularity_tier == "lead": total += 1 + 3 + 6 + 3  # = 13
    elif char.granularity_tier == "co_lead": total += 1 + 3 + 4 + 2  # = 10
    elif char.granularity_tier == "supporting": total += 1 + 2 + 2 + 1  # = 6
    elif char.granularity_tier == "extra": total += 1 + 1  # = 2
for scene in extraction.scenes:
    total += (1 + 4) * len(scene.time_variants)  # establishing + 4 angles × N lights
for prop in extraction.props:
    total += 3 if prop.granularity_tier == "primary" else 1
```

### 6. 写入缓存

写 `./aisd/03-assets/_cache/m1-extraction.json`：

```json
{
  "module": "1-parse-script",
  "completed_at": "<ISO 8601>",
  "source": {
    "script_path": "./aisd/02-script/output.json",
    "script_hash": "<sha256>"
  },
  "stats": {
    "characters_count": 3,
    "scenes_count": 2,
    "props_count": 4,
    "estimated_images": 47,
    "estimated_cost_usd": 4.7
  },
  "characters": [...],
  "scenes": [...],
  "props": [...]
}
```

### 7. 更新 metadata

- `module_status["1-parse-script"] = "completed"`
- `stats.characters_count` / `scenes_count` / `props_count` 同步

### 8. 向用户简报

```
✓ 上游解析完成（从 02-script 抽取）
  角色 (3): char_001 林清[lead, 18次] · char_002 沈淮[co_lead, 14次] · char_003 老板[extra, 1次]
  场景 (2): scene_001 公寓客厅[primary, 2 个 02-scene 复用, day/night] · scene_005 街角咖啡馆[secondary]
  道具 (4): prop_001 钥匙[primary] · prop_002 雪夜外套[secondary] · prop_003 手机[secondary] · prop_004 咖啡杯[secondary]
  
  预估生成: ~47 张图　成本 ~$4.7

是否按此粒度继续？（y / 升级 char_003 至 supporting / 加 ... / 减 ...）
```

### 9. 粒度微调（可选）

用户可调整：
- **y / 直接回车**：按当前粒度进入 2-style-bible
- **"char_003 升 supporting"**：调整角色 granularity_tier，重算预估
- **"删 prop_004"**：去掉某道具（但要警告 02-script 仍引用了它，会引发 06 时的覆盖率告警）
- **"全部加强"**：所有 primary 升一档

每次调整后重写 `m1-extraction.json` 并重新简报，直到用户确认。

## 输出

- `./aisd/03-assets/_cache/m1-extraction.json`
- 用户确认的最终资产清单

## 错误与边界

- 02-script.characters 为空：报错"02-script 未声明任何角色，请检查 02 输出"
- 02-script.scenes 为空：同上
- 02-script.props_required 为空：合法（不是所有剧本都有戏剧道具），跳过 5-prop-pack 即可

## 下游契约

`m1-extraction.json` 是后续所有模块的"权威清单"：

- `2-style-bible` 读取场景描述 + 道具描述，推断整体类型与美术倾向
- `3-character-pack` 按 characters 列表逐个生成，粒度由 granularity_tier 决定
- `4-scene-pack` 按 scenes 列表逐个生成，按 time_variants 决定光环数
- `5-prop-pack` 按 props 列表生成，粒度由 granularity_tier 决定
- `6-pack-export` 校验：每个 extraction.characters[*].source_id 都对应一个生成完成的资产；上游 02 引用的全部 id 都已覆盖
