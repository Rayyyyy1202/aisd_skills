# Module 0: Init

## 职责

在用户 cwd 下创建 `./aisd/03-assets/` 工作目录骨架，写入配置和元信息。

## 输入

- 上下文 cwd
- `./aisd/02-script/output.json`（用于 script_hash 与 script_id）

## 步骤

### 1. 工作目录

在 cwd 下创建：

```
aisd/03-assets/
├── _cache/
│   ├── queue/
│   └── qa-reports/
├── assets/
│   ├── style/
│   ├── characters/
│   ├── scenes/
│   └── props/
├── docs/
└── config.yaml
```

**所有后续模块的相对路径都以 `./aisd/03-assets/` 为根**。

### 2. 配置文件

写 `./aisd/03-assets/config.yaml`：

```yaml
created_at: <ISO 8601>

# T2I 模型配置（gpt-image-1 锁定，见 shared/conventions.md §5）
t2i:
  provider: gpt-image
  model: gpt-image-1
  api_key_env: OPENAI_API_KEY
  base_url_env: OPENAI_BASE_URL   # 可选，默认 https://api.openai.com/v1
  default_size: "1536x1024"       # 02-script 是 9:16 时改为 "1024x1536"
  default_quality: "high"
  default_background: "auto"

# 一致性配置（gpt-image-1 没有 strength 字段，用 prompt 措辞档位代替）
consistency:
  character_ref_strength: 0.85    # → "the same character as the reference"
  scene_ref_strength: 0.80        # → "consistent with the reference"
  prop_ref_strength: 0.80
  style_ref_strength: 0.90        # → "identical to the reference"

# 并发与限流（铁律：n=1，多张靠 generation-loop 逐张过）
concurrency:
  max_parallel_calls: 1
  rate_limit_rpm: 50
  use_subagents_when_parallel: true

# 质检
qa:
  enabled: true
  vision_model: claude-sonnet-4-6
  thresholds:
    identity: 0.80
    style: 0.80
    tech: 0.85
  max_retries: 3

# 预算保护
budget:
  max_usd_per_project: 10
  warn_at_usd: 5
  abort_at_usd: 15

# 资产粒度（按 02-script 角色 role 自动选档，1-parse-script 可覆盖）
asset_granularity:
  lead:
    views: [front, side, back]
    expressions: [neutral, smile, angry, surprised, sad, focused]
    face_details: [front, side, three_quarter]
  co_lead:
    views: [front, side, back]
    expressions: [neutral, smile, angry, sad]
    face_details: [front, three_quarter]
  supporting:
    views: [front, side]
    expressions: [neutral, smile]
    face_details: [front]
  extra:
    face_details: [front]
  scene:
    angles_per_scene: 5         # 1 establishing + 4 机位
    lighting_variants: [day, night]
  prop:
    primary_views: [front, side, back]
    secondary_views: [front]
```

### 3. 元信息文件

写 `./aisd/03-assets/_cache/metadata.json`：

```json
{
  "script_hash": "<sha256 of ./aisd/02-script/output.json>",
  "script_skill_version": "<02-script meta.skill_version>",
  "started_at": "<ISO 8601>",
  "last_updated_at": "<ISO 8601>",
  "module_status": {
    "0-init": "completed",
    "1-parse-script": "pending",
    "2-style-bible": "pending",
    "3-character-pack": "pending",
    "4-scene-pack": "pending",
    "5-prop-pack": "pending",
    "6-pack-export": "pending"
  },
  "hitl_gates": {
    "style-bible": "not-reached",
    "character-pack": "not-reached",
    "scene-pack": "not-reached"
  },
  "stats": {
    "characters_count": 0,
    "scenes_count": 0,
    "props_count": 0,
    "images_generated": 0,
    "qa_pass_count": 0,
    "qa_retry_count": 0,
    "estimated_cost_usd": 0
  },
  "budget": {
    "spent_usd": 0,
    "warn_at_usd": 5,
    "abort_at_usd": 15
  }
}
```

### 4. 断点检查

启动时检查 `./aisd/03-assets/_cache/metadata.json` 是否存在：

- **不存在**：按上述步骤创建
- **存在 + script_hash 一致**：跳过 0-init，从 `module_status` 中第一个非 completed 模块继续
- **存在 + script_hash 不一致**：
  ```
  ⚠️ 检测到已有 ./aisd/03-assets/，但 02-script 已变更。
  原 hash: <old> → 新 hash: <new>
  
  请选择：
  1. 新建（备份原目录到 aisd/03-assets.bak.YYYYMMDD/，全新开始）
  2. 增量更新（保留已锁定的资产，只重做新增/修改的）
  3. 重置（删除所有缓存与资产，重新开始）
  ```

### 5. aspect 自动适配

从 02-script 透传或从 01-topic 读：
- `aspect = "9_16"` → `default_size = "1024x1536"`
- `aspect = "16_9"` → `default_size = "1536x1024"`
- `aspect = "1_1"` → `default_size = "1024x1024"`

写到 config.yaml 的 `t2i.default_size`。

## 输出

- `./aisd/03-assets/` 目录骨架
- `./aisd/03-assets/config.yaml`
- `./aisd/03-assets/_cache/metadata.json`

写完后更新 metadata 的 `module_status["0-init"] = "completed"`，简报：

```
✓ 工作目录已初始化: ./aisd/03-assets/
  配置: gpt-image-1 · 串行并发 1 · qa 阈值 0.80 · 预算上限 $10
  画幅: <aspect> ({{default_size}})
下一步: 1-parse-script 抽取角色/场景/道具
```

## 错误与边界

- cwd 不可写：报错并提示用户切换工作目录
- ./aisd/02-script/output.json 缺失：上层 SKILL.md 应该已经 STOP，这里再次校验
- ./aisd/02-script/output.json 不符 02-script.schema：报错并要求重跑 02
