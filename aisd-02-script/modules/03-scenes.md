# Module 3: Scenes (with characters / props declaration)

> Core Question: 把 beat_sheet 切成可拍场景。每个 scene：地点、时间、出场人物、道具、目标。

## Inputs from Module 2

- `beat_sheet[]`
- `target_duration_s`、`structure`
- `logline`

## Data Sources

无外部源。

## Process

### Step 1: Scene 切分

每个 scene 覆盖 1-N 个连续 beat。切分规则：

- **换地点 → 新 scene**
- **换时间（昼夜跳）→ 新 scene**
- **核心人物变化 → 新 scene**
- 一镜到底（一个连续动作）可以容纳多个 beat
- 60s 短片：1-3 个 scene；120s：2-5 个；180+s：4-8 个

### Step 2: 每个 scene 填字段（按 schema 02-script.scenes[]）

- `id`：`scene_001` 起递增（3 位补零）
- `sequence`：1, 2, 3, ...
- `location`：`INT./EXT. + 名称`，如 `INT. 办公室 - 工位区`
- `time_of_day`：`morning / day / noon / afternoon / evening / night / dawn / dusk`
- `characters_present[]`：`["char_001", "char_002"]` — 必须先在 Step 3 把角色登记进 `characters[]`
- `props_present[]`：`["prop_001"]`
- `duration_s`：估算（所含 beats 的时长总和）
- `summary`：一句话"这个 scene 发生了什么"

### Step 3: 角色登记（characters[]）

扫整剧所有出场人物，给每人一个 `char_NNN`：

```json
{
  "id": "char_001",
  "name": "林雪",
  "role": "lead",        // lead | co_lead | supporting | extra | voice_only
  "description": "30 岁，集团副总裁，外表柔弱内里强势。短发，黑色西装裙，气场冷峻。",
  "age_band": "28-35",
  "wardrobe": "高定西装 / 真丝衬衫 / 高跟",
  "key_traits": ["隐忍", "腹黑", "言语锋利"]
}
```

角色 description **必须包含视觉信息**（外表 / 服装 / 气质）— 03-assets 直接用它生成 character pack 的 master prompt。

### Step 4: 道具登记（props_required[]）

显式列出有戏剧功能的道具（不是背景物）：

```json
{
  "id": "prop_001",
  "name": "实控人印章",
  "description": "金色雕花，木质底座，写'集团总公司'四个字",
  "scenes_used_in": ["scene_003"]
}
```

道具的判断：「如果这个物件不出现，戏会塌」→ 必登记；纯环境装饰 → 不登记。

### Step 5: 写到 `_cache/m03-scenes.md`

每个 scene 一段，含完整字段。

## Decision Gate

- 校验：所有 `characters_present[*]` ∈ `characters[*].id`
- 校验：所有 `props_present[*]` ∈ `props_required[*].id`
- 校验：sum(scenes[*].duration_s) ∈ [target * 0.9, target * 1.1]
- 通过 → proceed to Module 4

## Data Passing to Next Module

传给 Module 4：

- `scenes[]`（含 id、duration、summary、characters_present）
- `characters[]`（包括 id 与 name → dialogue.speaker 用 id 引用）
- `props_required[]`（dialogue 中提到道具时可索引）
