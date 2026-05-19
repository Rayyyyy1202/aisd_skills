# aisd Agent — Web 端

把 `~/Desktop/aisd_skills/` 9 个 skill 串成可对话、可批准、可回放的 web pipeline。基于 `~/Desktop/eec_skills/agent/` fork 而来，移除了独立站专属的 site-spec 与 voice-askme 子系统。

## 进程拓扑

- **server** (`localhost:3001`) — Hono 4.6，OpenAI SDK 直驱（不依赖 Claude）
- **web** (`localhost:4000`) — Next.js 15 App Router

## 启动

```bash
cd ~/Desktop/aisd_skills/agent
./bin/start.sh           # 同时拉起 server + web
# 日志: /tmp/aisd-agent-server.log, /tmp/aisd-agent-web.log
```

打开 http://localhost:4000，看到项目列表（默认种子 `demo-drama`），开始对话。

## 必填环境变量

在 `server/.env.local`：

```bash
OPENAI_API_KEY=sk-...                       # 必填
OPENAI_MODEL=gpt-4o                         # 默认；剧本创作可换 gpt-5.4
OPENAI_IMAGE_MODEL=gpt-image-1              # 默认（与 aisd_skills 主仓一致）
# OPENAI_BASE_URL=https://...               # 可选，走代理时配
# REPO_ROOT=/Users/yckj/Desktop/aisd_skills # 默认从脚本位置推
# WORKSPACE_PATH=/Users/yckj/Desktop/aisd_skills/workspace
# AGENT_DB_PATH=/Users/yckj/Desktop/aisd_skills/agent/server/data/aisd.sqlite
# PORT=3001

# 视频 provider（aisd-05-video 用，05 跑起来前必须配）
AISD_VIDEO_PROVIDER=                        # kling | runway | vidu | hailuo | minimax | veo
KLING_API_KEY=...
# RUNWAY_API_KEY=...
# ...
```

## 9 阶段 Pipeline

| # | Skill | 状态 |
|---|---|---|
| 01 | aisd-01-topic | ✓ P0 |
| 02 | aisd-02-script | ✓ P0 |
| 03 | aisd-03-assets | ✓ P0 |
| 04 | aisd-04-storyboard | ✓ P0 |
| 05 | aisd-05-video | ✓ P0 |
| 06 | aisd-06-audio | Phase 2（pipeline UI 灰色） |
| 07 | aisd-07-editing | Phase 2 |
| 08 | aisd-08-distribution | Phase 2 |
| 09 | aisd-09-feedback | Phase 2 |

Phase 2 节点在 `/pipeline` 页面显示为灰色 + "Coming Phase 2"，点击无效；executor 端也会拒绝运行（返回 `reason: 'phase2_not_implemented'`）。

## 与 eec_skills/agent 的差异

| 项 | eec | aisd |
|---|---|---|
| Skill 目录正则 | `^eec-(\d{2}[a-z]?)-(.+)$` | `^aisd-(\d{2})-(.+)$` |
| DAG | 14 节点（含 03b/04b/05b/11b/13） | 9 节点（无子序号） |
| 抽象 | brand（品牌） | project（项目） |
| 数据库 | `eec.sqlite` | `aisd.sqlite` |
| Workspace 输出根 | `<workspace>/eec/` | `<workspace>/aisd/` |
| site-spec / build-plan / voice-askme | 有 | **删除**（独立站专属） |
| L3 distill prompt | 品牌定位/audience/SKU/调性 | 题材/平台/锁定资产/美术 DNA |
| 默认种子 | Petropolitian | demo-drama |

## 文件结构

```
agent/
├── ARCHITECTURE.md     架构详解
├── bin/start.sh
├── server/
│   ├── .env.local      （手动建）
│   ├── package.json    "aisd-agent-server"
│   └── src/
│       ├── api/        Hono routes (chat / assets / distill / integrations / server)
│       ├── db/         SQLite schema (projects/conversations/messages/memories/approvals/tasks/attachments)
│       ├── executor/   runSkill 编排（Phase 2 检查、preflight、stub、LLM 主循环）
│       ├── llm/        OpenAI 封装（chat / image / compact / distill）
│       ├── skills/     SkillRegistry + loader（gray-matter 解析 SKILL.md frontmatter）
│       ├── tools/      sandbox fs / shell whitelist / ajv validator
│       └── workspace/  路径解析（aisd/<NN>-<slug>/output.json）
└── web/
    ├── package.json    "aisd-agent-web"
    └── app/
        ├── page.tsx                          项目列表
        ├── chat/[conversationId]/page.tsx    对话面板（SSE）
        ├── pipeline/page.tsx                 9 节点 DAG，6-9 灰色
        ├── assets/[projectId]/page.tsx       素材库
        ├── memory/page.tsx                   L2 记忆 CRUD
        └── integrations/page.tsx             API key 健康检查
```

## 后续 TODO

- 视频 provider 健康检查 UI（在 integrations 页面加 6 张卡片）
- Inspector 里单独渲染视频 async task 轮询状态
- 检测到 `aisd/05-video/preview.mp4` 时内嵌 `<video controls>` 直接看片
- Phase 2 (06-09) 真正实现
