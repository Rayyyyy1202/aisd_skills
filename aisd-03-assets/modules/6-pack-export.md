# Module 6: Pack & Export

## 职责

把所有上游产物装配成最终交付物：

1. `./aisd/03-assets/output.json`（机器读，match `shared/schemas/03-assets.schema.json`）
2. `./aisd/03-assets/拍摄手册.md`（人读，含下游 prompt 拼装规则）
3. ajv 校验 + 上游覆盖率校验 + 存在性断言
4. 交付简报

## 输入

- `_cache/m1-extraction.json`
- `_cache/m2-style-bible.json`
- `_cache/m3-character-pack.json`
- `_cache/m4-scene-pack.json`
- `_cache/m5-prop-pack.json`（若有）
- `_cache/qa-reports/qa-log.jsonl`
- `_cache/queue/active.jsonl`（最终队列状态）
- `_cache/api-log.jsonl`（成本核算）
- `_cache/metadata.json`
- `./aisd/02-script/output.json`（用于上游覆盖率校验）

## 步骤

### 6.1 分配 asset_NNN id（统一编号）

把所有最终生成完成的资产按 character → scene → prop 顺序统一分配 `asset_001`、`asset_002` ... 写一张 mapping：

```
m1.characters[c].source_id (02 的 char_NNN) → asset_NNN (本 skill 给的统一 id)
```

mapping 也用于 04-storyboard 引用：它可以用 `char_001`（02 给的）或 `asset_NNN`（03 给的）来 ref，schema 都允许。

### 6.2 装配 output.json

按 `~/.claude/skills/aisd-shared/schemas/03-assets.schema.json` 装配。结构：

```json
{
  "style_bible": {
    "name": "<from m2>",
    "refs": [
      { "path": "./aisd/03-assets/assets/style/ref_01.png", "checksum_sha256": "<sha>", "bytes": <n>, "mime": "image/png" },
      ...
    ],
    "palette": ["#...", "#...", ...],
    "art_direction": "<from m2>",
    "negative_prompt": "<from m2>",
    "aspect": "<from config.yaml or upstream>"
  },
  "assets": [
    // 全部资产的扁平列表，含 character / scene / prop 三类
    { "id": "asset_001", "asset_type": "character", "name": "林清", "source_id": "char_001", "master_path": "./aisd/03-assets/assets/characters/char_001/master.png", "variants": [...], "negative_prompt": "...", "notes": "..." },
    { "id": "asset_002", "asset_type": "scene", "name": "INT. 办公室", "source_id": "scene_001", "master_path": ".../establishing.png", "variants": [...] },
    ...
  ],
  "characters": [
    // 类型化视图：仅 character 类资产 + per-character views[]
    {
      "id": "asset_001",
      "asset_type": "character",
      "name": "林清",
      "source_id": "char_001",
      "master_path": "./aisd/03-assets/assets/characters/char_001/master.png",
      "variants": [...],
      "views": [
        { "view_id": "view.front", "path": "./aisd/03-assets/assets/characters/char_001/views/front.png" },
        { "view_id": "expression.smile", "path": "..." },
        ...
      ]
    }
  ],
  "scenes": [
    {
      "id": "asset_002",
      "asset_type": "scene",
      "name": "INT. 办公室",
      "source_id": "scene_001",
      "master_path": ".../establishing.png",
      "variants": [...],
      "angles": [
        { "angle_id": "angle.entry", "path": "..." },
        { "angle_id": "lighting.night.angle.entry", "path": "..." }
      ]
    }
  ],
  "props": [
    {
      "id": "asset_007",
      "asset_type": "prop",
      "name": "钥匙",
      "source_id": "prop_001",
      "master_path": "...",
      "variants": [...]
    }
  ],
  "shouce_md_path": "./aisd/03-assets/拍摄手册.md",
  "stats": {
    "images_generated": <N>,
    "qa_pass_count": <N>,
    "qa_retry_count": <N>,
    "warning_count": <N>,
    "estimated_cost_usd": <N>
  },
  "meta": {
    "generated_at": "<ISO 8601>",
    "skill_version": "1.0.0",
    "schema_version": "1.0.0",
    "aisd_version": "0.1.0",
    "execution_time_s": <N>,
    "user_input_summary": "<...>",
    "upstream_inputs": [
      {
        "skill": "aisd-02-script",
        "schema_version": "1.0.0",
        "consumed_fields": ["scenes", "characters", "props_required", "language"]
      }
    ]
  }
}
```

### 6.3 校验门（不可跳过）

#### 6.3a ajv schema 校验

```bash
npx -y ajv-cli@5 validate \
  -s ~/.claude/skills/aisd-shared/schemas/03-assets.schema.json \
  -d ./aisd/03-assets/output.json \
  --spec=draft2020 \
  -r ~/.claude/skills/aisd-shared/schemas/_common.schema.json
```

#### 6.3b 上游覆盖率（03 → 02 referential integrity）

```bash
# 02 的每个 character.id 必须在 03 有对应 asset
UPSTREAM_CHARS=$(jq -r '.characters[].id' ./aisd/02-script/output.json | sort -u)
COVERED_CHARS=$(jq -r '.characters[].source_id' ./aisd/03-assets/output.json | sort -u)
diff <(echo "$UPSTREAM_CHARS") <(echo "$COVERED_CHARS") || echo "WARN: char 覆盖不全"

# 同理 scene 与 prop
```

`voice_only` 角色不需要资产，从校验中排除。
某 prop 被用户在 1-parse-script 主动删除时，可以缺失，但要在 stats.warning_count 计数 + 在交付简报里高亮。

#### 6.3c 存在性断言

```bash
# 所有 master_path / variants[].path / views[].path / angles[].path 必须真实存在
for path in $(jq -r '.assets[].master_path, .assets[].variants[].path, .characters[].views[].path, .scenes[].angles[].path' ./aisd/03-assets/output.json | grep -v null); do
  test -f "$path" || { echo "FAIL: $path 不存在"; exit 1; }
done
test -f ./aisd/03-assets/拍摄手册.md
test -f ./aisd/03-assets/output.json
```

#### 6.3d 占位符 / 密钥扫描

按 `shared/conventions.md §19` 的 denylist 扫 output.json + 拍摄手册.md。

任一校验失败 → 不写 output.json，回报具体失败原因。

### 6.4 渲染拍摄手册

用 `templates/shooting-manual.md.j2` 渲染 `./aisd/03-assets/拍摄手册.md`：

- 美术 DNA（Style Bible v1 + 5 张参考图缩略）
- 角色名册（每个角色一节：缩略图矩阵 + 锁定描述 + qa 分数 + 源 02 char_id）
- 场景图鉴
- 道具图鉴
- 下游 prompt 拼装规则（公式 + 引用示例）

### 6.5 写入交付状态

更新 `_cache/metadata.json`：

- `module_status["6-pack-export"] = "completed"`
- 所有 hitl_gates 标 "approved"
- `last_updated_at`

### 6.6 交付简报

```
✓ 03-assets 资产建设完成
  Style Bible: <name> (v1) · <art_direction 30 字摘要>
  
  角色 (<N>): 
    asset_001 林清 (lead) ← char_001  ｜ 13 张图 ｜ qa avg id=0.91 style=0.88 tech=0.94
    asset_002 沈淮 (co_lead) ← char_002 ｜ 10 张图
    asset_003 老板 (extra) ← char_003  ｜ 2 张图
  
  场景 (<N>):
    asset_004 INT. 办公室 ← scene_001/scene_003 ｜ day+night ｜ 10 张图
  
  道具 (<N>):
    asset_007 钥匙 ← prop_001 ｜ 3 张图
  
  合计: <N> 张图　实际成本: $<USD>
  覆盖率: 02.characters 100% · 02.scenes 100% · 02.props_required 100%
  
  产物:
    - ./aisd/03-assets/output.json (✓ schema validated)
    - ./aisd/03-assets/拍摄手册.md
    - ./aisd/03-assets/assets/
    - ./aisd/03-assets/_cache/
  
  下一步: /aisd-04-storyboard
```

## 输出

- `./aisd/03-assets/output.json`
- `./aisd/03-assets/拍摄手册.md`

## 错误与边界

- ajv 校验失败 → 报错并指出字段，不写 output.json
- 上游覆盖不全（非 voice_only 角色缺资产）→ 报错并指出缺哪个 source_id
- 文件不存在断言失败 → 报错并指出文件路径
- 拍摄手册渲染失败（模板字段缺失）→ 报错并指出字段

不允许"部分交付" — 校验通过才算 completed。
