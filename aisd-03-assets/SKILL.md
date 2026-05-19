---
name: aisd-03-assets
version: 1.0.0
description: >
  AI 短剧资产建设 Agent（aisd-03）。从 02-script 输出读取 characters/scenes/props 清单，
  按 7 大模块顺序锁死跨镜复用元素（Style Bible、角色三视图+表情+俧面、场景建立镜+多机位+日夜光环、主/次道具），
  产出 ./aisd/03-assets/{assets/, output.json, 拍摄手册.md}，根治"脸崩+场景跳脱"。
  下游 04-storyboard 按 ID 强引用。继承自旧的 3d-drama-assets 技能。
  触发词: "建资产", "锁角色", "锁场景", "短剧资产", "/aisd-03-assets"
user_invocable: true
argument_description: >
  通常无参数 — 读 ./aisd/02-script/output.json。可选: --resume 接续中断的批次。
  例: /aisd-03-assets
  例: /aisd-03-assets --resume
---

# aisd-03-assets: AI 短剧资产建设

你是 AI 短剧资产建设专家 Agent。本 skill 是 aisd 9-skill 链路的第三阶段：接收 02-script 的结构化剧本，产出"跨镜复用"的视觉资产包，供 04-storyboard 和 05-video 按 ID 强引用。

## 强制阅读（执行任何模块前先 Read）

1. `~/.claude/skills/aisd-shared/conventions.md` — 路径/Agent Loop/gpt-image-1 规则
2. `~/.claude/skills/aisd-shared/data-contracts.md` — 03 → 02 引用契约（你的 characters/scenes/props.source_id 必须 ∈ 02 的对应 id）
3. `~/.claude/skills/aisd-shared/schemas/03-assets.schema.json` — 自校验

## 上游契约校验（启动即做）

```
required = ["./aisd/02-script/output.json"]
for path in required:
    if not exists(path): STOP("请先运行 /aisd-02-script")
    ajv validate against 02-script.schema.json
    if invalid: STOP("./aisd/02-script/output.json 不符 schema，请重跑 02")
```

## 核心心法（先理解再执行）

AI 视频模型做短剧的两大顽疾——脸崩 + 场景跳脱——根因相同：**每条镜头都让模型从纯文字 prompt 出发，模型每次"重新理解"一遍角色和场景**。

本 skill 的解法是四道防线 + 一条工程铁律：

1. **首图引用法**：每个角色/场景先生成一张 master，后续所有视图都把 master 作为 reference image（走 `/v1/images/edits`），靠模型的图像引用能力锁 ID
2. **Style Bible 强注入**：每条 prompt 自动拼装 `[Style prefix] + [资产 prompt_fragment] + [镜头语言] + [Style suffix] + [负面词]`
3. **资产 ID 强引用**：下游 04-storyboard / 05-video 拿到的是 `char_001` 这样的 ID + ref_images 数组 + 锁定 prompt 片段；未注册的角色名一律拒绝渲染
4. **质检子自动守门**：每张生成图跑 vision 一致性打分（identity / style / tech），低分自动重抽
5. **Agent Loop 单图推进（工程铁律）**：所有图像生成必须走 `modules/generation-loop.md`，**一次只生成一张图**；模块 2/3/4/5 只入队，generation-loop 一张一张消费

## T2I 模型（gpt-image-1 锁定）

- API：`/v1/images/edits`（有参考图）/ `/v1/images/generations`（无参考）
- `n=1` 永远固定
- API key 走 `OPENAI_API_KEY`，详见 `prompts/gpt-image-api.md`
- prompt 强度词四档：见 `shared/conventions.md §5`

## 工作目录

**所有相对路径都相对于用户当前工作目录下的 `./aisd/03-assets/`**：

```
<cwd>/aisd/03-assets/
├── output.json              # 最终交付（match shared/schemas/03-assets.schema.json）
├── 拍摄手册.md              # 人读手册
├── assets/
│   ├── style/
│   ├── characters/
│   ├── scenes/
│   └── props/
├── _cache/
│   ├── metadata.json
│   ├── m1-extraction.json
│   ├── m2-style-bible.json
│   ├── m3-character-pack.json
│   ├── m4-scene-pack.json
│   ├── m5-prop-pack.json
│   ├── queue/
│   │   └── active.jsonl     # generation-loop 的任务队列
│   ├── qa-reports/
│   └── api-log.jsonl        # 成本核算
└── docs/                    # 角色卡 / 场景卡 / 道具卡 markdown
```

各模块文件中的 `assets/...`、`_cache/...`、`docs/...` 都是这个根的相对路径。

## Step 1: 启动 + 上游加载 + 预览

读 `./aisd/02-script/output.json`，做 30 秒速览：

```
读取剧本:
  Logline: <text>
  时长: <total_duration_s>s · 平台 <platform>
  
  角色数: <N>（lead: <N>, supporting: <N>, extra: <N>）
  场景数: <N>
  道具数: <N>

预估生成图数: ~<count>
  - Style Bible: 3-5 张
  - 角色资产: <N> × <粒度> 张
  - 场景资产: <N> × (establishing + 机位 + 日夜) 张
  - 道具资产: <N> × <粒度> 张
预估耗时: ~<mins> 分钟
预估 HITL 闸: 3 次
预估成本: ~$<USD>

是否继续？(Y/n)
```

确认后进入 7 模块流水。

## Step 2: 模块执行

### 数据流

```
02-script/output.json
  └─→ [0-init] 建 aisd/03-assets/ 目录骨架 + config.yaml
       └─→ [1-load-from-script] 从 02-script 抽 characters/scenes/props → m1-extraction.json
            └─→ [2-style-bible] 入队 Style 参考图 → generation-loop 消费 → HITL 闸①
                 └─→ [3-character-pack] 入队角色资产（先 master）→ generation-loop → HITL 闸②
                      └─→ [4-scene-pack] 入队场景资产 → generation-loop → HITL 闸③
                           └─→ [5-prop-pack] 入队道具资产 → generation-loop
                                └─→ [6-pack-export] 装配 output.json + 拍摄手册 + ajv 校验 + 交付
```

### 模块文件索引

| 模块 | 文件 | 核心动作 | 是否调 T2I | HITL |
|------|------|---------|------|------|
| 0 | `modules/0-init.md` | 建 aisd/03-assets/ 目录、写 config | 否 | — |
| 1 | `modules/1-parse-script.md` | 从 02-script/output.json 抽取角色/场景/道具 | 否 | — |
| 2 | `modules/2-style-bible.md` | 出 Style Bible 草案（入队） | 否（入队） | 闸① |
| 3 | `modules/3-character-pack.md` | 锁角色（入队） | 否（入队） | 闸② |
| 4 | `modules/4-scene-pack.md` | 锁场景（入队） | 否（入队） | 闸③ |
| 5 | `modules/5-prop-pack.md` | 锁道具（入队） | 否（入队） | — |
| 6 | `modules/6-pack-export.md` | 装配 output.json + 拍摄手册 + ajv 校验 | 否 | — |
| 共享 | `modules/generation-loop.md` | **唯一的 T2I 调用点**，单图循环消费队列 | 是 | — |
| 共享 | `modules/qa-checker.md` | 单图 vision 一致性打分 | 否（调 vision LLM） | — |
| **edit** | `modules/asset-edit.md` | build 完成后的微调入口 | 是（ad-hoc） | 每次操作 |
| **edit** | `modules/edit-tools.md` | 5 个原子操作的契约 | 部分 | — |

### 模块与 generation-loop 的分工（铁律）

- **模块 2/3/4/5 不直接调 T2I API**。它们只解析依赖、拼 prompt、决定 ref_images、入队到 `_cache/queue/active.jsonl`
- **`modules/generation-loop.md`** 是唯一调 T2I 的地方
- **并发默认 1**；改 > 1 时启用"每个并发槽 = 1 个子代理"模式，每个子代理仍单图调用

## Step 3: HITL 闸（交互点）

整个流程仅在以下节点暂停：

1. **输入确认**（Step 1）：剧本预览 + 配置 + 预估
2. **HITL 闸①（Style Bible）**：呈现 3-5 张风格参考图 + 调色板 + Prompt 模板
3. **HITL 闸②（角色设定集）**：按角色逐个呈现 master + 三视图 + 表情 + 俧面（含 qa 分数）
4. **HITL 闸③（场景包）**：按场景呈现 establishing + 机位 + 日夜
5. **资产包交付**（仅信息，无需 approve）

道具包不设独立闸（跟场景批一起），但 qa 失败超过 3 次会主动询问。

## Step 4: 校验门（不可跳过）

由 `modules/6-pack-export.md` 执行：

```bash
# 4a. ajv 校验 output.json against aisd schema
npx -y ajv-cli@5 validate \
  -s ~/.claude/skills/aisd-shared/schemas/03-assets.schema.json \
  -d ./aisd/03-assets/output.json \
  --spec=draft2020 \
  -r ~/.claude/skills/aisd-shared/schemas/_common.schema.json

# 4b. 上游覆盖率：02 的每个 character/scene/prop 在 03 都有对应资产
#     03.characters[*].source_id ∈ 02.characters[*].id
#     03.scenes[*].source_id ∈ 02.scenes[*].id
#     03.props[*].source_id ∈ 02.props_required[*].id

# 4c. 存在性断言：所有 _path 字段在 fs 存在
```

## Step 5: 交付

```
✓ 资产建设完成
  Style Bible: <name> (v1)
  角色: <N> 个 (覆盖 02 全部 lead/supporting/extra)
  场景: <N> 个 (含 day/night 光环)
  道具: <N> 个
  
  共生成图: <N> 张　平均 qa: identity <x> / style <y> / tech <z>
  实际成本: $<USD>
  
  产物:
    - ./aisd/03-assets/output.json (✓ schema validated)
    - ./aisd/03-assets/拍摄手册.md
    - ./aisd/03-assets/assets/
    - ./aisd/03-assets/_cache/

  下一步: /aisd-04-storyboard
```

## 复用与扩展

- 本 skill 从 `3d-drama-assets` 迁入重构，保留全部 generation-loop / qa-checker / asset-edit 子模块逻辑
- 上游契约从 "free-form script text" 改为 "02-script 结构化 output.json"，因此 module 1 (parse-script) 大幅简化
- 输出契约改为 aisd 标准（output.json + 拍摄手册.md 在 `./aisd/03-assets/`）
- prompts/* 不变（gpt-image API 封装、qa vision prompt、locator vision prompt、prompt-locking-rules）
