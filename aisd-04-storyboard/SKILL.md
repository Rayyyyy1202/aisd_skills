---
name: aisd-04-storyboard
version: 1.0.0
description: >
  AI 短剧分镜首帧 Agent。读 02-script 的 scenes + 03-assets 的 assets，
  按 scene 切分 shots，给每个 shot 拼装 prompt 并生成"首帧图"（用 gpt-image-1 引用 Style Bible + asset master），
  通过 vision QA 评分，低分自动重抽。产出 ./aisd/04-storyboard/{shots[], first_frames/, shotlist.md}。
  下游 05-video 用这些首帧 + shot prompt 调视频 API。
  触发词: "分镜", "首帧", "storyboard", "/aisd-04-storyboard"
user_invocable: true
argument_description: >
  通常无参数 — 读 02-script + 03-assets。可选: --shot=shot_NNN 重抽某个 shot 的首帧。
  例: /aisd-04-storyboard
  例: /aisd-04-storyboard --shot=shot_007
---

# aisd-04-storyboard: AI 短剧分镜首帧

你是 AI 短剧分镜师 Agent。本 skill 是 aisd 9-skill 链路的第四阶段：把剧本 + 资产变成可拍的分镜清单，每个 shot 出一张"首帧图"作为 05-video 的输入。

## 强制阅读

1. `~/.claude/skills/aisd-shared/conventions.md` — Agent Loop / gpt-image-1 强制规则
2. `~/.claude/skills/aisd-shared/data-contracts.md` — 04 → 02/03 引用契约
3. `~/.claude/skills/aisd-shared/schemas/04-storyboard.schema.json`

## 上游契约校验（启动即做）

```
required = [
  "./aisd/02-script/output.json",
  "./aisd/03-assets/output.json"
]
for path in required:
    if not exists(path): STOP("请先运行对应上游 skill")
    ajv validate against schema_for(path)
    if invalid: STOP("upstream 不符 schema")
```

## 核心心法

04-storyboard 是 03-assets 的镜像应用：用同样的"首图引用法 + Agent Loop 单图 + qa 守门"模式，把"资产"变成"分镜首帧"。

**关键差异**：
- 不再生成新身份（角色 / 场景早已锁死），而是用既定身份摆出**新姿势 / 新构图 / 新光照**
- 每个 shot 的 reference image 是 `[style_bible.refs + asset.master + (optional) asset.angle/expression variant]`
- prompt 拼装公式：`[style_prefix] + [shot composition + camera language] + [asset bindings] + [style_suffix] + [shot-specific details]`

## 工作目录

```
<cwd>/aisd/04-storyboard/
├── output.json
├── shotlist.md
├── first_frames/
│   ├── shot_001.png
│   ├── shot_002.png
│   └── ...
├── _cache/
│   ├── metadata.json
│   ├── m01-shots.json
│   ├── m02-binding.json
│   ├── m03-prompts.json
│   ├── queue/
│   │   └── active.jsonl
│   ├── qa-reports/
│   ├── api-log.jsonl
│   └── refs/                # symlinks into 03-assets，避免重复存图
└── docs/
```

## Step 1: 启动 + 上游加载

读上游：
- 02-script.scenes + dialogue + shot_hints + total_duration_s
- 03-assets.style_bible + assets[]（按 source_id 反查映射）

简报：
```
读取剧本: <total_duration_s>s · <scenes 数> 个 scene
读取资产: <N> 角色 / <N> 场景 / <N> 道具 / Style Bible v1 (<art_direction 30 字>)
预估 shots 数: <N> (按 scene 平均 3-6 shot 估算)
预估生成图数: <N> 张首帧
预估成本: ~$<USD>
是否继续？(Y/n)
```

## Step 2: 模块执行

### 数据流

```
M1 shot-breakdown      把 scenes 切成 shots[]，标景别/运镜/时长
   ↓
M2 asset-binding       每个 shot 绑定 asset_refs[]（哪个角色 + 哪个场景 + 哪个道具）
   ↓
M3 prompt-compose      为每个 shot 拼装首帧 prompt + ref_images
   ↓
M4 first-frame-queue   入队到 _cache/queue/active.jsonl
   ↓
M5 generation-loop     单图 Agent Loop 消费队列，调 gpt-image-1，跑 qa
   ↓
M6 shotlist-md         装配 output.json + 生成 shotlist.md + ajv 校验 + 交付
```

### 模块索引

| # | 文件 | 核心动作 | 调 T2I |
|---|---|---|---|
| 1 | `modules/01-shot-breakdown.md` | scenes → shots（含 camera）| 否 |
| 2 | `modules/02-asset-binding.md` | 每个 shot 绑 asset_refs | 否 |
| 3 | `modules/03-prompt-compose.md` | 拼 prompt + ref_images | 否 |
| 4 | `modules/04-first-frame-queue.md` | 入队 | 否 |
| 5 | `modules/05-generation-loop.md` | **唯一 T2I 调用点**（复用 aisd-03 同名子模块） | 是 |
| 6 | `modules/06-shotlist-md.md` | 装配 + 校验 + 交付 | 否 |

### Agent Loop 铁律（同 aisd-03）

- 模块 1-4 只入队，绝不调 T2I
- generation-loop 是唯一调 gpt-image-1 的地方，永远 `n=1`
- 并发用子代理槽位实现（默认 1）

## Step 3: 校验门（不可跳过）

由 modules/06-shotlist-md.md 执行：

```bash
# 3a. ajv 校验
npx -y ajv-cli@5 validate \
  -s ~/.claude/skills/aisd-shared/schemas/04-storyboard.schema.json \
  -d ./aisd/04-storyboard/output.json \
  --spec=draft2020 \
  -r ~/.claude/skills/aisd-shared/schemas/_common.schema.json

# 3b. 04 → 02/03 referential integrity
#     shots[*].scene_id ∈ 02.scenes[*].id
#     shots[*].asset_refs[*] ∈ 03.assets[*].id ∪ 03.characters[*].id ∪ ...
#     shots[*].dialogue_ref（若存在）∈ 02.scenes[shot.scene_id].dialogue[*].id

# 3c. 时长一致性
sum(shots[*].duration_s) ≈ 02.total_duration_s (±10%)

# 3d. 存在性断言：first_frame_path 全部真实存在

# 3e. Phase 2 hook 字段非缺失：每个 shot 必须有 sfx_marks[] / music_intent / subtitle_intent 字段（哪怕值是 [] / "TBD" / "unspecified"）
```

## Step 4: 交付

```
✓ 04-storyboard 完成
  Shots: <N> 个 (按 02-scene 切分)
  时长: <sum>s (目标 <target>s)
  
  首帧图: <N> 张　平均 qa: identity <x> / style <y> / tech <z>
  实际成本: $<USD>
  
  产物:
    - ./aisd/04-storyboard/output.json (✓ schema validated)
    - ./aisd/04-storyboard/shotlist.md
    - ./aisd/04-storyboard/first_frames/

  下一步: /aisd-05-video (生成视频片段)
```

## 交互点

1. Step 1 上游加载后确认
2. Module 1 完成后展示 shotlist 草稿，等用户 approve / 调整切分
3. Module 5 generation-loop 中的 qa warning 项（连续 3 次重抽仍 < 阈值）会逐项弹出问"接受 warning / 换 ref / skip"
4. Module 6 交付（仅信息）
