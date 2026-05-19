# aisd_skills — AI 短剧生产 Agent

贯穿"选题 → 剧本 → 资产 → 分镜 → 视频 → 音频 → 剪辑 → 分发 → 回流"全流程的 Claude Code 技能包 + Web 编排端。

参照 [`eec_skills`](https://github.com/Rayyyyy1202/eec_skills) 的"垂直域技能包"架构 fork 而来：

- **9 个 skill** 每阶段一个，模块化、契约化（JSON Schema 强校验）
- **shared 层**统一 conventions / data-contracts / phase2-hooks / schemas
- **Web Agent** 把 9 skill 串成可对话、可批准、可回放的 pipeline（Hono :3001 + Next.js :4000，OpenAI SDK 直驱）
- **两种使用方式**：CLI（Claude Code 里 `/aisd-NN-*` 触发）或 Web（在浏览器里对话编排）

---

## 整体架构

```
┌────────────────────────────────────────────────────────────────────────┐
│  ./aisd_skills/                                                        │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Skill Pack（CLI 入口）                                            │  │
│  │ ─ shared/                  契约层（conventions / data-contracts) │  │
│  │ ─ aisd-01-topic ~ 09       9 个独立 skill，每个含 SKILL.md +     │  │
│  │                            modules/ + templates/                  │  │
│  │ ─ install.sh               复制到 ~/.claude/skills/aisd-*         │  │
│  └────────────────┬─────────────────────────────────────────────────┘  │
│                   │                                                    │
│                   │ Web Agent 读取 SKILL.md frontmatter + 模块文件，   │
│                   │ 自驱执行（gray-matter 解析）                        │
│                   ▼                                                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Web Agent（agent/，可选）                                         │  │
│  │                                                                  │  │
│  │  浏览器 :4000  ─ Next.js 15 App Router                            │  │
│  │   ├ /              项目列表                                       │  │
│  │   ├ /chat/[conv]   对话面板（SSE 实时进度）                       │  │
│  │   ├ /pipeline      9 节点 DAG（6-9 灰色 Phase 2）                 │  │
│  │   ├ /assets/[id]   素材库                                         │  │
│  │   ├ /memory        L2 项目记忆 CRUD                                │  │
│  │   └ /integrations  API key 健康检查                                │  │
│  │                          │                                       │  │
│  │                          ▼ fetch (proxy → :3001)                 │  │
│  │  Hono :3001  ─ tsx watch                                          │  │
│  │   ├ api/           chat orchestrator + skill exec + assets +     │  │
│  │   │                distill + integrations                        │  │
│  │   ├ skills/        SkillRegistry + loader（^aisd-NN-slug regex） │  │
│  │   ├ executor/      runSkill 编排（LLM 自驱、tool 调用、SSE 推送）│  │
│  │   ├ llm/           OpenAI 封装（chat / image / compact / distill）│  │
│  │   ├ db/            SQLite WAL: projects / conversations /        │  │
│  │   │                messages / memories / approvals               │  │
│  │   └ workspace/     路径解析（./aisd/<NN>-<slug>/output.json）    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                          │                                              │
│                          ▼  OpenAI HTTPS                                │
│                  chat/completions（gpt-4o / gpt-5.4）                   │
│                  images.generate（gpt-image-1）                         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
              │
              ▼  写到用户当前工作目录
┌──────────────────────────────────────────────┐
│ <cwd>/aisd/                                  │
│ ├─ 01-topic/      output.json + report.md    │
│ ├─ 02-script/     output.json + script.md    │
│ ├─ 03-assets/     output.json + assets/ +    │
│ │                 拍摄手册.md                 │
│ ├─ 04-storyboard/ output.json + first_frames/│
│ │                 + shotlist.md              │
│ └─ 05-video/      output.json + clips/ +     │
│                   preview.mp4                │
└──────────────────────────────────────────────┘
```

---

## P0 范围（已交付，可跑通端到端）

| # | Skill | 阶段 | 输入 | 关键产出 |
|---|---|---|---|---|
| 01 | `aisd-01-topic` | 选题 | 方向 + 平台 + 语种 | logline、平台/时长画像、对标账号、受众画像 |
| 02 | `aisd-02-script` | 剧本 | `01/output.json` | scenes[]、dialogue、shot_hints、`script.md` |
| 03 | `aisd-03-assets` | 资产 | `02/output.json` | 角色/场景/道具锁定包、`assets.json`、`拍摄手册.md` |
| 04 | `aisd-04-storyboard` | 分镜首帧 | `02 + 03` | shots[]、每个 shot 的首帧图、`shotlist.md` |
| 05 | `aisd-05-video` | 视频生成 | `04/output.json` | 每个 shot 的 mp4、`preview.mp4`、QA 评分 |

## Phase 2 占位（仅 SKILL.md 骨架，已预留 hook 字段）

| # | Skill | 阶段 |
|---|---|---|
| 06 | `aisd-06-audio` | 对白 TTS + SFX + 配乐 |
| 07 | `aisd-07-editing` | 调色 + 超分 + 合规标识 |
| 08 | `aisd-08-distribution` | 发布 + 投流 + 本地化 |
| 09 | `aisd-09-feedback` | 数据回流回到 01/02 |

P0 已经在 `output.json` 里预留 Phase 2 需要的 hook 字段（`audio_cues[]`、`sfx_marks[]`、`cut_marks[]`、`compliance_tags[]` 等），详见 `shared/phase2-hooks.md`。Web Agent 端在 pipeline DAG 把 06-09 渲染为灰色"Coming Phase 2"，executor 调到时直接返回 `reason: 'phase2_not_implemented'`。

---

## 仓库结构

```
aisd_skills/
├── shared/                         单一事实源 — 所有 skill 启动时必读
│   ├── conventions.md              路径/命名/语言/Agent Loop/gpt-image-1 规则
│   ├── data-contracts.md           9 阶段数据流图 + 字段归属
│   ├── phase2-hooks.md             06-09 预留字段
│   └── schemas/                    JSON Schema Draft 2020-12
│       ├── _common.schema.json
│       └── 01..05-*.schema.json
├── aisd-01-topic/                  SKILL.md + modules/ + templates/
├── aisd-02-script/
├── aisd-03-assets/                 含 prompts/（gpt-image-1 API 封装）+
│                                   asset-edit / generation-loop 子模块
├── aisd-04-storyboard/
├── aisd-05-video/
├── aisd-06-audio/                  Phase 2 占位 SKILL.md
├── aisd-07-editing/                Phase 2 占位
├── aisd-08-distribution/           Phase 2 占位
├── aisd-09-feedback/               Phase 2 占位
├── agent/                          Web Agent（可选）
│   ├── server/                     Hono :3001
│   ├── web/                        Next.js :4000
│   ├── ARCHITECTURE.md
│   ├── README.md                   Web 端详细启动 / 配置
│   └── bin/start.sh
├── examples/sample-drama/          端到端样例（5 个 output.json 全过 schema）
├── install.sh                      安装 skills 到 ~/.claude/skills/aisd-*
├── LICENSE                         MIT
└── README.md
```

---

## 使用方式 A：纯 CLI（Claude Code）

```bash
# 安装 skills 到 Claude Code
./install.sh

# 在任意项目目录运行，逐个触发
cd ~/my-drama-project
/aisd-01-topic 都市职场反转, douyin, zh-CN
/aisd-02-script
/aisd-03-assets
/aisd-04-storyboard
/aisd-05-video
```

每步会读上一阶段的 `output.json`，ajv 校验通过后再开始；缺上游会停下来告诉你先跑哪个 skill。最终在 `./aisd/05-video/preview.mp4` 拿到拼接好的预览片。

## 使用方式 B：Web Agent（浏览器对话）

```bash
cd agent
./bin/start.sh                              # 同时拉起 server :3001 + web :4000
# 必填: agent/server/.env.local 里配 OPENAI_API_KEY
open http://localhost:4000
```

在浏览器里跟 orchestrator 自然语言对话，它会判断该跑哪个 skill、自动准备好上游，SSE 实时推送 generation-loop 进度。详见 [`agent/README.md`](agent/README.md)。

---

## 关键设计原则

1. **契约优先** — 每个 skill 产出的 `output.json` 必过 ajv 校验，下游消费前再校验一次上游
2. **Agent Loop 单产物** — 图像/视频生成永远 `n=1`，走 enqueue → loop → qa → requeue 模式；禁止批量并发
3. **gpt-image-1 锁定** — 所有 T2I 走 `/v1/images/edits` 引用真实参考图，prompt 强度分四档（`identical / same / consistent / inspired by`）
4. **视频 provider 不预设** — 用户在 `.env` 配 `AISD_VIDEO_PROVIDER`（kling / runway / vidu / hailuo / minimax / veo），05-video 启动时校验
5. **可恢复** — 每个 skill 有 `_cache/` 断点续作，重跑不重生成
6. **存在性断言** — `_path` / `_url` 字段写出前必须 stat / HEAD 验证存在

---

## 关键技术决定（与 eec_skills 的差异）

| 项 | eec_skills | aisd_skills |
|---|---|---|
| 域 | 独立站 e-commerce 全流程 | AI 短剧生产全流程 |
| Skill 数量 | 14（含子序号 03b / 04b / 05b / 11b / 13） | 9（无子序号） |
| T2I model | gpt-image-1 | gpt-image-1 |
| T2V | 无 | 用户选（kling / runway / vidu / hailuo / minimax / veo） |
| Web Agent 抽象 | brand（品牌） | project（项目） |
| L3 distill 维度 | 品牌定位/audience/SKU/调性 | 题材/平台/锁定资产/美术 DNA |
| site-spec / voice-askme | 有 | 删除（不适用） |

---

## 安装环境要求

| 工具 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 22 | Web Agent（推荐 22 LTS；24 也行但 `better-sqlite3` 需 rebuild） |
| pnpm | ≥ 9 | Web Agent 包管理 |
| Claude Code | 最新 | 跑 skills 的 CLI |
| ffmpeg | ≥ 6 | 05-video 拼接 preview.mp4 |
| OpenAI API Key | — | gpt-4o（对话）+ gpt-image-1（T2I） |
| 视频 provider API Key | 至少一个 | 由 `AISD_VIDEO_PROVIDER` 决定 |

可选：
- `ajv-cli` （通过 `npx -y ajv-cli@5` 调用，无需预装）
- `jq` （sample-drama 引用完整性脚本用）

---

## 许可

MIT — 见 [LICENSE](LICENSE)
