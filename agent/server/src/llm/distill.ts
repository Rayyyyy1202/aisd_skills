import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LLMClient } from './openai.ts';
import type { ApprovalRow, MemoryRow } from '../db/repo.ts';
import type { Workspace } from '../workspace/path.ts';

const OUTPUT_HEAD_CHARS = 1500;
const APPROVAL_NOTE_MAX = 240;
const MEMORY_CONTENT_MAX = 240;

const DISTILL_SYSTEM = `你在为一个 AI 短剧项目总结"已确立的共识"，结果会自动注入到未来所有 LLM 调用的 system prompt 顶部，所以必须紧凑、具体、不要套话。`;

const DISTILL_TEMPLATE = (sections: {
  brief: string;
  approvals: string;
  memories: string;
  outputs: string;
}) => `# 输入数据

## project_brief
${sections.brief || '（未填写）'}

## 最近 approvals（用户批准/拒绝/要求重跑过的，最新在前）
${sections.approvals || '（无）'}

## 用户主动记录的 memories
${sections.memories || '（无）'}

## 已落盘的 skill 输出（每个文件前 ${OUTPUT_HEAD_CHARS} 字）
${sections.outputs || '（workspace 还没有任何 output.json）'}

---

# 你的任务

请输出一份 markdown profile，**不超过 600 tokens**，结构必须严格为：

# Project Profile (auto-distilled)

## 1. 题材与 logline
（1-2 句：什么类型、什么钩子）

## 2. 平台与时长
（目标平台 / 时长 / 画幅 / 钩子窗口，从 01-topic 确认）

## 3. 已锁定的角色与场景
（从 03-assets approval 后的 asset id + 名字；没有就写"未确立"）

## 4. 美术 DNA / Style Bible
（一两个关键词概括视觉基调；从 03-assets.style_bible 摘）

## 5. 硬约束
（"不要做 X / 必须 Y"：合规标签、平台限制、AI 内容披露要求，从 approvals.note 和 memories 里挖）

## 6. 已踩坑
（失败过的路径：低 qa 镜头、被 'modified_rerun' / 'rejected' 的 shot 或 asset，从 approvals.note 里挖）

要求：每节都要有一行内容；没料就写"未确立"。直接输出 markdown，不要解释，不要再加任何前后缀。`;

function safeReadJsonHead(path: string, headChars: number): string | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    return raw.length > headChars ? raw.slice(0, headChars) + '\n…(truncated)' : raw;
  } catch {
    return null;
  }
}

function collectWorkspaceOutputs(workspace: Workspace): string {
  const aisdRoot = join(workspace.root, 'aisd');
  if (!existsSync(aisdRoot)) return '';
  let entries: string[];
  try {
    entries = readdirSync(aisdRoot).sort();
  } catch {
    return '';
  }
  const blocks: string[] = [];
  for (const entry of entries) {
    const dir = join(aisdRoot, entry);
    let isDir = false;
    try { isDir = statSync(dir).isDirectory(); } catch { /* skip */ }
    if (!isDir) continue;
    const outputPath = join(dir, 'output.json');
    const head = safeReadJsonHead(outputPath, OUTPUT_HEAD_CHARS);
    if (!head) continue;
    blocks.push(`### ${entry}\n\`\`\`json\n${head}\n\`\`\``);
  }
  return blocks.join('\n\n');
}

function formatApprovals(rows: ApprovalRow[]): string {
  if (rows.length === 0) return '';
  return rows
    .map((r) => {
      const note = (r.note ?? '').slice(0, APPROVAL_NOTE_MAX).replace(/\n/g, ' ');
      return `- [${r.created_at.slice(0, 19)}] skill=${r.skill_id} decision=${r.decision}${note ? ` note="${note}"` : ''}`;
    })
    .join('\n');
}

function formatMemories(rows: MemoryRow[]): string {
  if (rows.length === 0) return '';
  return rows
    .map((m) => {
      const c = m.content.slice(0, MEMORY_CONTENT_MAX).replace(/\n/g, ' ');
      return `- ${m.key}: ${c}`;
    })
    .join('\n');
}

export interface DistillInput {
  llm: LLMClient;
  brief: string;
  workspace: Workspace;
  recentApprovals: ApprovalRow[];
  memories: MemoryRow[];
  model?: string;
}

export interface DistillResult {
  profile: string;
  promptTokens?: number;
  completionTokens?: number;
}

export async function distillProjectProfile(input: DistillInput): Promise<DistillResult> {
  const userMsg = DISTILL_TEMPLATE({
    brief: input.brief.trim(),
    approvals: formatApprovals(input.recentApprovals),
    memories: formatMemories(input.memories),
    outputs: collectWorkspaceOutputs(input.workspace),
  });

  const resp = await input.llm.chat(
    [
      { role: 'system', content: DISTILL_SYSTEM },
      { role: 'user', content: userMsg },
    ],
    [],
    input.model,
  );

  return {
    profile: (resp.text || '').trim(),
    promptTokens: resp.usage?.prompt_tokens,
    completionTokens: resp.usage?.completion_tokens,
  };
}
