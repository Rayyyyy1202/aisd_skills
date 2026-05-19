# aisd Agent — 系统总架构

> 本文档描述 `~/Desktop/aisd_skills/` 仓库下整个 agent 系统的设计：进程拓扑、agent 之间如何协作、三层记忆架构、上下文管理策略，以及关键的硬约束。

---

## 0. 一句话定位

**一个把 9+5 个 EEC 独立站 SKILL.md 串成可对话、可批准、可回放的 pipeline 的本地协作系统。** 用户在 Web UI 里跟一个 orchestrator agent 对话；orchestrator 按需调度独立的 skill executor agents 执行单个 skill；每个 skill 输出落到 workspace 的 `output.json`；用户在每一步之间可批准 / 修改重跑；系统通过三层记忆让 agent 跨会话记住已确立的共识。

---

## 1. 进程与目录拓扑

```
┌────────────────────────────────────────────────────────────────────────┐
│  浏览器 (localhost:4000)                                                │
│  ─ Next.js 15 App Router (React 19)                                    │
│  ─ /chat/[conv]   ChatPanel + Sidebar + Inspector                      │
│  ─ /assets/[bid]  素材库                                               │
│  ─ /pipeline      ReactFlow 可视化                                     │
│  ─ /build-plan    Site spec 编辑                                       │
│  ─ /memory        L2 memories CRUD                                     │
└──────────────────────────┬─────────────────────────────────────────────┘
                           │  fetch  (multipart 走 arrayBuffer 透传)
                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Next.js Route /app/api/proxy/[...path]                                │
│  ─ 唯一目的: 把同源请求转给 :3001 (跨域 + cookie 简化)                 │
└──────────────────────────┬─────────────────────────────────────────────┘
                           │  HTTP / SSE
                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Hono server (localhost:3001)  ── tsx 运行 server/src/api/server.ts    │
│                                                                        │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │  chat.ts     │  │  assets.ts    │  │  spec.ts     │  │ distill.ts│ │
│  │  Orchestrator│  │  04 素材库 CRUD│  │ build-plan   │  │ L3 蒸馏   │ │
│  │  + SSE       │  │  + 上传 + 透传 │  │  site-spec   │  │ POST/GET  │ │
│  └──────┬───────┘  └───────┬───────┘  └──────┬───────┘  └─────┬─────┘ │
│         │                  │                  │                 │     │
│         └─── 共享依赖 ─────┴──────────────────┴─────────────────┘     │
│                                                                        │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ executor/    │  │ skills/       │  │ db/          │  │ llm/      │ │
│  │  node.ts     │  │  registry.ts  │  │  schema.ts   │  │  openai.ts│ │
│  │  preflight   │  │  loader.ts    │  │  repo.ts     │  │  compact  │ │
│  │  stub.ts     │  │  (gray-matter)│  │  (better-sql3│  │  distill  │ │
│  │  (Skill agent│  │               │  │   WAL)       │  │  image    │ │
│  │  内嵌 LLM 环) │  │               │  │              │  │           │ │
│  └──────────────┘  └───────────────┘  └──────────────┘  └───────────┘ │
└────────┬─────────────────────────┬──────────────┬────────────┬────────┘
         │                         │              │            │
         ▼                         ▼              ▼            ▼
   OpenAI HTTPS              文件系统         SQLite       OpenAI Image
   chat/completions          workspace/         WAL        gpt-image-1
   (gpt-4o / gpt-5.4)        aisd/<id>/output.json
                             aisd/<id>/uploads/
                             public/og/*.png
```

**进程数**：浏览器 1 + Next dev 1 + Hono server 1。OpenAI 是 HTTPS 调用，不算独立进程。

**仓库目录**：

```
aisd_skills/
├── agent/
│   ├── server/           # Hono + executor + db
│   │   └── src/{api,executor,db,llm,skills,tools,workspace}/
│   ├── web/              # Next.js 15 前端
│   │   └── app/{chat,assets,pipeline,build-plan,memory,api/proxy}/
│   └── bin/start.sh      # 一键起 server + web
├── shared/               # SKILL.md 的"宪法"
│   ├── conventions.md    # 路径/命名/语言/货币
│   ├── data-contracts.md # 端到端字段流
│   ├── phase2-hooks.md   # 字段预留
│   └── schemas/          # 17 份 JSON Schema (Draft 2020-12)
├── 'aisd'-01-research/      # 9 个主链 skill
├── 'aisd'-02-product-selection/
├── 'aisd'-03-project-identity/
├── aisd-03-assets/
├── 'aisd'-05-site-build/
├── 'aisd'-06-tracking/
├── 'aisd'-07a-tech-seo/
├── 'aisd'-07b-content-marketing/
├── 'aisd'-08-paid-ads/
├── 'aisd'-09-optimization/
├── 'aisd'-03b-legal-pack/   # 5 个 side skill
├── 'aisd'-04b-social-proof/
├── 'aisd'-05b-merchant-console/
├── 'aisd'-11b-customer-service/
├── 'aisd'-13-data-model/
└── petropolitian/        # 默认 project workspace 示例 (aisd/<id>/output.json 落在这里)
```

---

## 2. Agent 拓扑 — 两层 + 一个 distiller

系统里只有 **三种** LLM 调用形态。理解了这三种，就理解了所有 agent 协作。

### 2.1 Orchestrator Agent（用户对话面）

- **入口**：`server/src/api/chat.ts → POST /conversations/:id/messages`（流式 SSE）
- **角色**：跟用户对话的"项目经理"。不亲自做 skill，只决定**调度顺序、向用户解释、追踪 todo**。
- **System prompt**：`SYSTEM_PROMPT` (chat.ts:244)
- **工具集**（11 个，定义在 `orchestratorTools()` chat.ts:47）：

| 工具 | 用途 | 是否 compactable |
|---|---|---|
| `list_skills` | 列出全部 14 个 skill | ✓ |
| `get_workspace_state` | 读 workspace 下每个 skill 的 output.json 状态 (exists / valid / synthetic) | ✓ |
| `preflight_skill` | 检查某 skill 上游是否就绪 | ✗ |
| `run_skill` | **嵌套调用 Skill Executor**（见下） | ✓（结果体大，旧轮 stub） |
| `read_output` | 读某 skill 的 output.json | ✓ |
| `add_task` / `update_task` / `list_tasks` | 维护 conversation 级任务树 | ✗ |
| `save_memory` / `query_memory` | L2 project-level memory 存取 | ✗ |
| `distill_project_profile` | 强制刷新 L3 project profile（一般不用——approval 后自动） | ✓ |

- **关键交互门**：`run_skill` 成功后必须停下等用户批准，**不允许同一个 turn 内连续调下一个 skill**。这条规则写在 system prompt 的 "Approval gate (CRITICAL)" 段，并由 UI 的 awaiting_approval 卡片配合落地。
- **Turn cap**：12 轮（普通对话）/ 4 轮（kickoff 首问）

### 2.2 Skill Executor Agent（每个 SKILL.md 一个临时 agent）

- **入口**：`server/src/executor/node.ts → runSkill()`
- **触发**：被 orchestrator 的 `run_skill` 工具调起；也可以被 server 的 `POST /skills/:id/run` 直接调起（旁路）。
- **角色**：拿到一个 skill 的 SKILL.md + modules + JSON Schema + 上游 output.json，**自闭环**地写出本 skill 的 `output.json`。
- **System prompt 拼装**（`buildSystemPrompt` node.ts:201）：

  ```
  workspace 路径 + 输出路径
  ── L3 Project profile（如果已蒸馏）   ← 长期记忆注入点
  ── Project brief（用户/默认）
  ── Upstream output.json 索引
  ── SKILL.md 全文（去除 frontmatter）
  ── modules/*.md 全部内联
  ── JSON Schema 全文
  ── shared/conventions.md
  ── shared/data-contracts.md
  ```

  **关键：上述内容已经全部内联进 system prompt**，所以 prompt 里硬性禁止 LLM 再去 `read_file` SKILL.md / 模块 / schema —— 节省 turn。

- **工具集**（7 个，executor 私有，跟 orchestrator 完全不重叠）：

| 工具 | 用途 | compactable |
|---|---|---|
| `read_file` | 读 workspace 内任意文件（主要用来读上游 output.json） | ✓ |
| `write_file` | 写 workspace 内任意路径 | ✗ |
| `list_dir` | 列 workspace 目录 | ✓ |
| `validate_schema` | 自检 JSON 是否过 schema | ✓ |
| `generate_image` | 调 gpt-image-1 出 PNG 写盘 | ✗ |
| `run_shell` | 白名单命令（npx/pnpm/node/tsx） | ✓ |
| `finish` | 终止信号 + 输出路径 | ✗ |

- **Turn cap**：30 轮。Turn 用尽 / `finish` 调用 / 出现 `<<DONE>>` 哨兵 都会终止循环。
- **后置自检**：循环结束后再用 ajv 校验一次 output.json，不过就再追一轮 "schema 失败，自己修" 的 prompt（自动修复一次）。
- **进程模型**：**不 spawn 子进程**，纯在 server 进程里跑 LLM 循环。所有事件通过 `EventEmitter` 回调流回 chat SSE，以 `nested_run` 事件包裹。

### 2.3 Stub Generator（隐藏的第三种 agent）

- **入口**：`server/src/executor/stub.ts → generateStub()`
- **触发**：`run_skill` 调用时若上游缺失且 `auto_stub_upstream:true`
- **角色**：用 LLM 直接喷一个**最小可过 schema 的 synthetic upstream output.json**，让下游能继续跑（每条记录会带 `synthetic:true` 标记）。
- **特殊**：这个调用**不带 tools**，纯 JSON-only 文本生成，最多 4 次重试做 schema-fix。
- **目的**：让用户不用按 1→2→3...严格顺序，可以先 demo "我跳到 04 看看素材"。

### 2.4 Distiller（L3 长期记忆生成器，见 §4.3）

- **入口**：`server/src/llm/distill.ts`
- **触发**：approval 落库后 `queueMicrotask` fire-and-forget；或 `POST /projects/:id/distill-profile` 手动；或 orchestrator 通过 `distill_project_profile` 工具
- **角色**：把 project brief + 最近 50 条 approval + 全部 memories + 全部 output.json 头部，蒸馏成 ≤600 token 的 markdown profile。

---

## 3. 协作时序：用户输入到 output.json 的完整路径

```
用户在 ChatPanel 输入 "跑个 02 看看选品"
        │
        ▼
POST /conversations/:id/messages (SSE)
        │
        │  1) 持久化 user message → SQLite messages
        │  2) 第一次发言时把 SYSTEM_PROMPT seed 进去（含 project 信息 + 默认 brief）
        │
        ▼
Orchestrator loop (cap=12):
  ┌──────────────────────────────────────────────────────────────┐
  │ 1. buildHistory(conv)                                        │
  │ 2. 注入 projectProfilePrefix(project) ← L3                       │
  │ 3. microcompact(messages, ORCHESTRATOR_COMPACTABLE_TOOLS) ← L1│
  │ 4. llm.chat(messages, orchestratorTools, model)              │
  │ 5. 持久化 assistant message (text + tool_calls JSON)         │
  │ 6. 对每个 tool_call:                                         │
  │    - SSE 推 tool_call 事件                                   │
  │    - dispatch tool                                           │
  │    - SSE 推 tool_result 事件                                 │
  │    - 持久化 tool message                                     │
  │ 7. 若无 tool_call → 退出循环                                 │
  └──────────────────────────────────────────────────────────────┘
        │  (LLM 决定先 preflight_skill('02'))
        ▼
preflight('02') → 上游 01 不存在? blockers=['upstream 01 missing']
        │
        ▼  (LLM 决定 run_skill('02', auto_stub_upstream:true))
        │
        ▼  ───────  嵌套进入 Skill Executor  ───────────
        runSkill('02', ..., emit→SSE 'nested_run')
          │
          │  preflight 不过 → ensureStubsForUpstream('02')
          │    └ generateStub('01') → 写 ./aisd/01-research/output.json (synthetic)
          │
          │  buildSystemPrompt(node=02, projectProfile, projectBrief, upstream索引...)
          │
          │  Executor loop (cap=30):
          │    1. microcompact(messages, EXECUTOR_COMPACTABLE_TOOLS)
          │    2. llm.chat(messages, [read_file, write_file, ...], model)
          │    3. dispatch(tool_call) — 在 WorkspaceFs / ShellRunner / ImageGen / Validator 沙箱里
          │    4. tool_call=='finish' → break
          │
          │  后置 ajv 校验 → 不过则追一轮自动修复
          │
          ▼  返回 RunResult { ok, outputPath, schemaErrors }
        │
        │  outputPath 存在 → emit awaiting_approval 事件
        ▼
SSE awaiting_approval → 浏览器 ChatPanel 渲染"批准 / 修改重跑"卡片
        │
        ▼  (用户点批准)
        │
POST /projects/:id/approvals { skill_id:'02', decision:'approved', note }
        │
        │  1. 写 approvals 行（含 output.json 快照前 200KB）
        │  2. queueMicrotask → distillAndSaveDedup(projectId)
        │     └ distillProjectProfile(brief, approvals, memories, workspace outputs)
        │     └ setProjectProfile() — 下一次对话就能看见
        │
        ▼
继续下一个 skill...
```

**核心特性**：

1. **嵌套 SSE 流**：Skill Executor 的每个事件都包在 `nested_run` 事件里走同一条 chat SSE 通道，UI 一条流就能拿到所有进度。
2. **批准门是约束而非工具**：UI 显示批准卡片，但 system prompt 同时强制 LLM 在 run 完后停下；两端冗余防止跑飞。
3. **Stub 是为了让"跳着跑"不爆"上游缺失"**：但 stub 数据带 `synthetic:true`，下游 / 用户都能识别。

---

## 4. 三层记忆架构（Karpathy OS 类比）

借用 Karpathy 把 LLM 上下文当 OS RAM 的隐喻，这个系统有 L1/L2/L3 三层：

```
┌────────────────────────────────────────────────────────────────┐
│  L1 — 上下文窗口 (RAM, 易失)                                    │
│  ─ 当前 LLM 调用拿到的 messages[]                               │
│  ─ 由 microcompact() 在 send-time 即时压缩                      │
└────────────────────────────────────────────────────────────────┘
                            ▲
                            │ 每次 LLM 调用前从 L2 重新拼装
                            │
┌────────────────────────────────────────────────────────────────┐
│  L2 — 持久化 (Disk, 不易失)                                    │
│  ─ SQLite WAL: projects / conversations / messages / attachments │
│                tasks / memories / approvals                    │
│  ─ 文件系统:    workspace/aisd/<NN>-<slug>/output.json          │
│                workspace/aisd/03-assets/uploads/*     │
│                workspace/public/og/*.png                       │
└────────────────────────────────────────────────────────────────┘
                            ▲
                            │ Distiller 周期性把 L2 凝缩
                            │
┌────────────────────────────────────────────────────────────────┐
│  L3 — Project Profile (Weights / 长期固化共识, 不易失)            │
│  ─ projects.project_profile (TEXT, ≤600 token markdown)            │
│  ─ approval 后 fire-and-forget 自动刷新, 全 project 维度去重      │
│  ─ 自动注入到所有 LLM 调用（orchestrator + executor）的 prompt 顶部 │
└────────────────────────────────────────────────────────────────┘
```

### 4.1 L1 — 上下文窗口管理

**问题**：长对话里早期的 `read_output / get_workspace_state / run_skill` 工具结果体特别大（一个 output.json 可能 50KB+），全部塞回 LLM 浪费 token。

**方案**：`microcompactMessages()` (`server/src/llm/compact.ts`)

```
策略：
1. 保留最末 N=3 个 assistant 轮的所有上下文（含 tool 结果）
2. 早于 N 轮的 tool message，若它对应的 tool_call_name ∈ COMPACTABLE 集合：
   把 content 替换成 '[Old tool result content cleared]'
3. 其余消息（user/assistant text、未列入 compactable 的工具结果）一字不动
```

**两套 compactable 集合**（语义不同，故分开）：

| Set | 含义 | 成员 |
|---|---|---|
| `ORCHESTRATOR_COMPACTABLE_TOOLS` | 调用一次后再看历史回放无意义的"读类"工具 | read_output, run_skill, get_workspace_state, list_skills, distill_project_profile |
| `EXECUTOR_COMPACTABLE_TOOLS` | skill 内部读类工具 | read_file, list_dir, run_shell, validate_schema |

**保留不动的**：mutation/state 工具（add_task / save_memory / write_file / finish）—— 因为它们的"结果"包含语义状态（"任务 X 已创建"），不能丢。

**关键：纯函数**。`microcompact` 只改 in-memory 的 messages 数组，**不动 SQLite**。SQLite 永远是完整 ground truth，方便回放、调试。

**未做**：token-budget 触发的 autocompact / 拼成"故事"的 LLM-summarize。等 `prompt_too_long` 真出现再做。

### 4.2 L2 — 持久化

**SQLite (better-sqlite3, WAL, foreign_keys=ON)** — `agent/server/data/aisd.sqlite`

```
projects
  ├── conversations (FK)
  │     ├── messages (role, content, tool_call_id?, tool_calls_json?, attachments_json?)
  │     ├── attachments (kind, mime, data_base64 — 内联 ≤4MB)
  │     └── tasks (parent_id 自引用 → 任务树)
  ├── memories (key/content, project 级 unique)
  └── approvals (skill_id, decision, output_snapshot, note)
```

**File system** — `<workspace>/`

```
<workspace>/
├── aisd/
│   ├── 01-research/output.json
│   ├── 02-product-selection/output.json
│   ├── ...
│   └── 03-assets/
│       ├── output.json
│       ├── uploads/      ← 用户上传的图（POST /projects/:id/assets/upload）
│       └── assets/img/   ← gpt-image-1 生成的图
└── public/
    └── og/*.png          ← delivered_file_path 渲染目标（"/og/x.png"）
```

**两边的关系**：

- SQLite 装"对话状态 + 用户决策"（messages / approvals / memories / tasks）
- 文件系统装"skill 产出 + 资产"（output.json / 图）
- 两者通过 `projects.workspace` 路径关联起来；一个 project = 一份 workspace + 一组 SQLite 行
- output.json 永远从文件读，不进 SQLite（除了 approval 时打快照前 200KB）

**为什么不全进 SQLite**：output.json 是 skill 之间约定好的"硬接口"，必须能直接被 `read_file` / 用户手编 / git diff 看见，进数据库会破坏这个性质。

### 4.3 L3 — Project Profile（长期共识）

**问题**：用户开第 5 个会话时，orchestrator 只看见 project_brief（一段静态描述）+ 当前输入。它不知道：
- 用户在 03 已经批准过 audience 是"宠物达人 + 户外极客"
- 用户在 02 拒过"宠物保暖背心"，理由"利润太薄"
- 用户在 04 要求文案 tone "去严肃化"

LLM 要知道，得每次都 `query_memory` / `read_output`，每次都花 token。

**方案**：`distillProjectProfile()` (`server/src/llm/distill.ts`)

输入：
- `project_brief`
- 最近 50 条 approvals（含 decision + note）
- 全部 memories（key/content）
- 每个 `<workspace>/aisd/*/output.json` 的前 1500 字

输出：≤600 token 的 markdown，结构固定 6 节：
```
# Project Profile (auto-distilled)
## 1. 品牌定位
## 2. 已确立的 audience
## 3. 当前 SKU/产品线
## 4. 创意方向 / tone of voice
## 5. 硬约束
## 6. 已踩坑
```

**注入点**（两处都要加）：

1. Orchestrator：`chat.ts → projectProfilePrefix(project) → 一条 system message 拼到 messages[] 头部`
2. Executor：`node.ts → buildSystemPrompt({projectProfile})` 拼进 system prompt 的 "Project profile" 段

**触发策略**（三选一）：

| 触发 | 实现 | 何时用 |
|---|---|---|
| 自动（默认） | approval 落库后 `queueMicrotask` fire-and-forget | 99% 场景，用户不感知 |
| 手动 API | `POST /projects/:id/distill-profile` | 调试 / 强制刷新 |
| LLM 工具 | orchestrator 调 `distill_project_profile` | 重大节点（03 完成后）想立刻反映到下一个 skill 的 prompt |

**去重**：`distillAndSaveDedup()` 用 `Map<projectId, Promise>` 实现"同 project 同时只跑一个 distill"，连续多个 approval 触发不会并发雪崩。

**为什么是 approval 后**：approval 是用户最强的信号——"这个状态我认账"。把"认账过的"凝缩成共识，比凝缩"all messages"准确得多。

---

## 5. 上下文管理总览

把所有"塞进 LLM context 的东西"列一遍，看清楚每条数据从哪来、怎么进来：

### 5.1 Orchestrator 的 LLM 上下文构成

每次 `llm.chat()` 调用，messages[] 大致结构：

```
[
  // ─── 0. L3 long-term (来自 projects.project_profile，可能空) ───
  { role: 'system', content: '[Project Profile (auto-distilled @ ts)]\n\n# Project Profile...' },

  // ─── 1. SYSTEM_PROMPT seed (首次发言时落进 SQLite) ───
  { role: 'system', content: 'You are the aisd Agent...\n\nProject: <name>\nWorkspace: <path>\nDefault project brief: ...' },

  // ─── 2. 完整对话回放（从 SQLite messages 表 buildHistory）───
  { role: 'user', content: '...' },
  { role: 'assistant', content: '...', tool_calls: [...] },
  { role: 'tool', tool_call_id: 'call_xxx', content: '<json result>' },  // 早轮的"读类"工具结果会被 stub 替换
  // ... 重复 ...
]
```

**走的过滤管线**：`buildHistory()` → `[projectProfilePrefix, ...history]` → `microcompactMessages(_, ORCHESTRATOR_COMPACTABLE_TOOLS, keepLastRounds=3)`

**Image attachments**：用户上传到 `attachments` 表（base64），`buildHistory` 渲染时把 image 拼成 `image_url: data:<mime>;base64,...` 的 multimodal content part，跟 text 一起走。

### 5.2 Skill Executor 的 LLM 上下文构成

每次 `llm.chat()` 调用，messages[] 大致结构：

```
[
  // 全部静态、跨轮不变的 system prompt（buildSystemPrompt 拼出来的几 K-几十 K 文本）：
  {
    role: 'system',
    content: `You are an autonomous executor for ${node.fullName}...
              # Workspace
              # Project profile (← L3)
              # Project brief
              # Upstream output.json files
              # Required output
              # Skill specification (SKILL.md)
              # Skill modules
              # JSON Schema for output.json
              # Conventions
              # Cross-skill data contracts
              # Termination`
  },

  // 触发用户消息：
  { role: 'user', content: 'Run the 'aisd'-02-product-selection skill...' },

  // 之后是 LLM 的 tool 循环（assistant tool_calls + tool results）
  // 早轮的 read_file / list_dir / run_shell / validate_schema 结果会被 stub
]
```

**Executor 跟 Orchestrator 的 messages 完全独立**：executor 是临时 in-memory 的 `messages: ChatCompletionMessageParam[]`，**不进 SQLite**。原因：executor 的中间过程对 UI 而言只需要事件流（tool_call/tool_result/turn），不需要回放。

### 5.3 三种"上下文洁净度"策略

| 哪里 | 策略 | 理由 |
|---|---|---|
| Orchestrator 全量 messages | SQLite 完整存，发送时 microcompact | 用户切设备 / 重连要能完整回放 |
| Executor messages | 内存里跑完即丢，UI 只看事件流 | 中间过程对用户无价值，省 SQLite 体积 |
| L3 project profile | 蒸馏后落 projects 表，注入两处 prompt 头 | 跨会话 / 跨 skill 共享共识 |

### 5.4 Token budget 现状

- 暂未做硬性 token 计数 / `prompt_too_long` 触发的 autocompact —— 当前规模（一个 project pipeline 一般 ≤200 messages）下 microcompact 已经够用
- 触发 autocompact 的临界点：当用户单 conversation 走完整个 9 skill pipeline + 多次 modify_rerun 时，预计 200KB+ messages。届时再做 token budget gate。
- 模型可选：`gpt-4o`（默认）/ `gpt-5.4`（per-conversation override，UI ModelPicker）

---

## 6. 数据契约（Skills 之间怎么"协作"）

不通过共享内存，而通过**文件 + JSON Schema** 协作。

### 6.1 上游依赖图（registry.ts:11）

```
01 ──┬─→ 02 ──┬─→ 03 ──┬─→ 04 ──┬─→ 05 ──→ 06 ──┬─→ 07a
     │        │        │        │                │
     │        │        │        │                └─→ 07b (also: 01,02,03; opt 07a)
     │        │        │        │
     │        │        │        └────→ 08 (req: 02,03,04,06; opt: 01,05)
     │        │        │                │
     │        │        │                └─→ 09 (req: 06,08; opt: 01,02,03,04,05)
     │        │        │
     │        │        ├─→ 03b (legal pack)
     │        │        └─→ 11b (customer service)
     │        │
     │        └─→ 04b (social proof, req: 04)
     │
     └─→ 05b (merchant console, req: 05)
              13 (data model, req: 06)
```

### 6.2 协作机制

每个 skill **只能**通过以下三条通道跟其它 skill 协作：

1. **读上游 `output.json`**（`read_file` 工具）
2. **写自己的 `output.json`**（`write_file` 工具，schema 强制）
3. **共享 `shared/conventions.md` + `shared/data-contracts.md`** 里定义的字段名/ID 命名/枚举值

**禁止**：
- 跨 skill 直接函数调用 / IPC
- 跳过 schema 编 ID
- 引用未声明的上游

**Preflight 拦截**：`preflight()` 在 `runSkill` 入口就把"上游 missing / invalid"翻译成 blockers，要么 stop 要么 stub。

---

## 7. 安全与硬约束

- **路径沙箱**：`assets.ts:ensureWithin()` 用 `realpathSync` 解析符号链接，防止 `<workspace>/uploads/escape-symlink → /etc/` 这类越界。`WorkspaceFs / ShellRunner` 同理只允许 workspace 内路径。
- **Shell 白名单**：`run_shell` 只放 `npx ajv-cli / npx prisma / pnpm --dir / node / tsx`。
- **上传扩展名白名单**：`ALLOWED_UPLOAD_EXT` = jpg/jpeg/png/webp/avif/svg/mp4/webm/mov。
- **Atomic write**：`PATCH /projects/:id/assets/:asset_id` 写 output.json 用 `tmp+rename` 避免半截文件。
- **PII**：data-contracts 强制 customer_email 等用 SHA-256；distillation/L3 prompt 里不放原始 email。
- **API 凭证**：08 / 09 这类需外部 API 的 skill，凭证在**运行到那一步时**显式向用户索要（写在 SKILL.md 里），从不预存。
- **Approval gate**：UI + system prompt 双保险，任何 `run_skill` 后都强制停。

---

## 8. 一些故意没做的事（边界声明）

- **没有跨 project 的全局共识**：每个 project 的 L3 profile 互相独立。
- **没有 embedding / RAG**：L3 是 prompt-distillation，靠 LLM 直接读 6 节 markdown。
- **没有 fine-tune**：成本与漂移管控不划算，宁可 distill。
- **L1 没做 token-budget autocompact**：等 prompt_too_long 真触发再加。
- **Profile 没做 diff / 历史快照**：覆盖式更新，靠 `project_profile_updated_at` 一个时间戳。
- **Executor 不进 SQLite**：执行过程是事件流，重放需求很弱。
- **没有 multi-tenant / auth**：单用户本地工具，3001/4000 端口都没认证。
- **08 不直连 Meta/Google Ads API**：只产出 launch_checklist，由用户手动到平台执行；09 才会真的索要 API token。

---

## 9. 想改这个系统时该改哪里（速查）

| 想加 / 改 | 改这里 |
|---|---|
| 给 orchestrator 加新工具 | `chat.ts:orchestratorTools()` + `dispatchOrchestratorTool()` switch |
| 给 executor 加新工具 | `node.ts:tools()` + `dispatch()` switch |
| 把某工具结果纳入 microcompact | `compact.ts:ORCHESTRATOR_COMPACTABLE_TOOLS` 或 `EXECUTOR_COMPACTABLE_TOOLS` |
| 加新 skill | 建 `'aisd'-XX-slug/SKILL.md` + `shared/schemas/XX-slug.schema.json` + 在 `registry.ts:UPSTREAM_REQUIRED` 加节点；loader 自动发现 |
| 改 L3 蒸馏内容/格式 | `llm/distill.ts:DISTILL_TEMPLATE` |
| 加新表 / 字段 | `db/schema.ts:SCHEMA_SQL` 加 CREATE，或在底下 `for (const sql of [...])` 加 idempotent ALTER |
| 改 system prompt | `chat.ts:SYSTEM_PROMPT`（orchestrator）/ `node.ts:buildSystemPrompt()`（executor） |
| 加新 web 页面 | `agent/web/app/<name>/page.tsx`，走 `app/api/proxy` 转 server |
| 调 turn cap | `chat.ts:ORCHESTRATOR_TURN_CAP=12` / `node.ts:DEFAULT_TURN_CAP=30` |

---

## 10. 启动与端口

```
agent/bin/start.sh  # 同时起 server (3001) + web (4000)

环境变量（server/.env.local）：
  OPENAI_API_KEY        必填
  OPENAI_MODEL          默认 gpt-4o
  OPENAI_BASE_URL       可选（如 OpenRouter / 自建代理）
  OPENAI_IMAGE_MODEL    默认 gpt-image-1
  REPO_ROOT             默认 /Users/yckj/Desktop/aisd_skills
  WORKSPACE_PATH        默认 <REPO_ROOT>/petropolitian
  AGENT_DB_PATH         默认 <REPO_ROOT>/agent/server/data/aisd.sqlite
  PORT                  默认 3001
```

健康检查：`GET http://localhost:3001/health`
