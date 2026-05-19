import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { SkillRegistry, SkillNode } from '../skills/registry.ts';
import { readSkillBody, readSkillModules } from '../skills/loader.ts';
import type { Workspace } from '../workspace/path.ts';
import type { Validator } from '../tools/validate.ts';
import { WorkspaceFs } from '../tools/fs.ts';
import { ShellRunner } from '../tools/shell.ts';
import { LLMClient, toolMessage, isAbortError } from '../llm/openai.ts';
import { ImageGenerator } from '../llm/image.ts';
import { microcompactMessages, EXECUTOR_COMPACTABLE_TOOLS } from '../llm/compact.ts';
import { preflight } from './preflight.ts';
import { ensureStubsForUpstream, type StubReport } from './stub.ts';

export type RunEvent =
  | { type: 'start'; payload: { skillId: string; turnCap: number } }
  | { type: 'preflight'; payload: { ready: boolean; blockers: string[] } }
  | { type: 'stub'; payload: StubReport }
  | { type: 'turn'; payload: { index: number; text: string; finish: string | null } }
  | { type: 'tool_call'; payload: { id: string; name: string; arguments: string } }
  | { type: 'tool_result'; payload: { id: string; ok: boolean; summary: string } }
  | { type: 'partial_output'; payload: { skillId: string; data: unknown; bytes: number } }
  | { type: 'validate'; payload: { ok: boolean; errors: Array<{ path: string; message: string }> } }
  | { type: 'needs_input'; payload: { message: string } }
  | { type: 'done'; payload: { ok: boolean; outputPath: string | null; reason: string } }
  | { type: 'error'; payload: { message: string } };

export type EventEmitter = (e: RunEvent) => void;

function summarizeToolResult(name: string, result: unknown): { ok: boolean; summary: string } {
  const r = (result ?? {}) as Record<string, unknown>;
  const ok = (typeof r.ok === 'boolean' ? r.ok : true) as boolean;
  if (ok) {
    if (name === 'list_dir' && Array.isArray(r.entries)) {
      return { ok, summary: `ok: ${r.entries.length} entries` };
    }
    if (name === 'read_file' && typeof r.content === 'string') {
      return { ok, summary: `ok: ${r.content.length} chars` };
    }
    if (name === 'write_file' && typeof r.bytes === 'number') {
      return { ok, summary: `ok: wrote ${r.bytes} bytes` };
    }
    if (name === 'validate_schema') {
      const errs = Array.isArray(r.errors) ? r.errors.length : 0;
      return { ok, summary: errs === 0 ? 'ok: schema-valid' : `ok: ${errs} validation errors` };
    }
    if (name === 'run_shell') {
      const code = typeof r.code === 'number' ? r.code : 'n/a';
      return { ok, summary: `ok: exit=${code}` };
    }
    if (name === 'finish') {
      return { ok, summary: `ok: finish(${typeof r.output_path === 'string' ? r.output_path : ''})` };
    }
    return { ok, summary: 'ok' };
  }
  const errMsg = typeof r.error === 'string' ? r.error : '';
  const errs = Array.isArray(r.errors) ? r.errors : [];
  if (errMsg) return { ok, summary: `error: ${errMsg.slice(0, 200)}` };
  if (errs.length > 0) {
    const first = errs[0] as { path?: string; message?: string };
    return { ok, summary: `error: ${errs.length} validation issue(s); first: ${first?.path ?? '/'} ${first?.message ?? ''}`.slice(0, 240) };
  }
  return { ok, summary: 'error: (no detail)' };
}

export interface RunOptions {
  projectBrief?: string;
  /** L3 distilled project profile (auto-injected near top of system prompt). */
  projectProfile?: string;
  turnCap?: number;
  /** if true, missing required upstream is OK; the caller is expected to
   *  have stubbed them already via stub.ts before invoking */
  allowMissingUpstream?: boolean;
  /** Auto-generate synthetic upstream stubs before running the main loop */
  autoStubUpstream?: boolean;
  /** Per-call OpenAI model override (e.g. "gpt-4o", "gpt-5.4"). Falls back to LLMClient default. */
  model?: string;
  /** Cancel the run cooperatively. The loop checks `aborted` before each LLM
   *  call and exits with reason="cancelled" as soon as it fires. */
  signal?: AbortSignal;
}

export interface RunResult {
  ok: boolean;
  outputPath: string | null;
  schemaErrors: Array<{ path: string; message: string }>;
  turns: number;
  reason: string;
}

const DEFAULT_TURN_CAP = 30;
const DONE_SENTINEL = '<<DONE>>';

function tools(): ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file by workspace-relative path. Returns text content.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a workspace-relative path. Creates parent dirs as needed.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'List entries of a workspace-relative directory.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'validate_schema',
        description:
          'Validate a JSON document against the named skill schema. Pass either the full JSON object via "json" or a workspace-relative file path via "path" (the file will be read+parsed for you). Exactly one of json/path is required. Use to self-check before finishing.',
        parameters: {
          type: 'object',
          properties: {
            skill_id: { type: 'string', description: 'e.g. "04", "07a"' },
            json: { type: 'object', additionalProperties: true, description: 'The JSON object to validate (mutually exclusive with path).' },
            path: { type: 'string', description: 'Workspace-relative path to the JSON file to validate (mutually exclusive with json).' },
          },
          required: ['skill_id'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'generate_image',
        description:
          'Generate a PNG image with OpenAI gpt-image-1 and save it to a workspace path. Returns ok=true and the byte size on success.',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Detailed visual description (subject, style, lighting, mood, composition).',
            },
            path: {
              type: 'string',
              description: 'Workspace-relative output path, e.g. aisd/03-assets/assets/img/hero_01.png',
            },
            size: {
              type: 'string',
              enum: ['1024x1024', '1024x1536', '1536x1024'],
              description: 'Image dimensions. Default 1024x1024 (square). Use 1024x1536 for portrait, 1536x1024 for landscape.',
            },
            quality: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description: 'Generation quality. Default "medium". "high" is ~3x more expensive.',
            },
          },
          required: ['prompt', 'path'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_shell',
        description: 'Run a whitelisted command (npx ajv-cli, npx prisma, pnpm --dir, node, tsx).',
        parameters: {
          type: 'object',
          properties: {
            binary: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
          },
          required: ['binary', 'args'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'finish',
        description:
          'Signal completion. Pass the workspace-relative path to the emitted output.json and a 1-line summary.',
        parameters: {
          type: 'object',
          properties: {
            output_path: { type: 'string' },
            summary: { type: 'string' },
          },
          required: ['output_path', 'summary'],
          additionalProperties: false,
        },
      },
    },
  ];
}

function readIfExists(p: string): string | null {
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf-8');
}

interface BuildPromptArgs {
  node: SkillNode;
  registry: SkillRegistry;
  workspace: Workspace;
  projectBrief?: string;
  projectProfile?: string;
  repoRoot: string;
}

function buildSystemPrompt({
  node,
  registry,
  workspace,
  projectBrief,
  projectProfile,
  repoRoot,
}: BuildPromptArgs): string {
  const conventions = readIfExists(resolve(repoRoot, 'shared/conventions.md')) ?? '';
  const dataContracts = readIfExists(resolve(repoRoot, 'shared/data-contracts.md')) ?? '';
  const skillBody = readSkillBody(node);
  const modules = readSkillModules(node);
  const schemaText = node.schemaPath ? readFileSync(node.schemaPath, 'utf-8') : '';

  const upstreamSummary = [
    ...node.upstreamRequired.map((id) => ({ id, kind: 'required' as const })),
    ...node.upstreamOptional.map((id) => ({ id, kind: 'optional' as const })),
  ]
    .map((u) => {
      const un = registry.get(u.id);
      const out = un ? workspace.outputJsonPath(un) : '?';
      const exists = un && existsSync(out);
      return `- ${u.id} (${u.kind}) → ${exists ? out : '(missing)'}`;
    })
    .join('\n');

  const outDir = workspace.skillDir(node);
  const outJson = workspace.outputJsonPath(node);

  return `You are an autonomous executor for the aisd pipeline skill **${node.fullName}**.

You have these tools: read_file, write_file, list_dir, validate_schema, generate_image, run_shell, finish.

# Workspace
- Workspace root: ${workspace.root}
- Your skill output directory: ${relative(workspace.root, outDir)}
- Your skill output JSON path: ${relative(workspace.root, outJson)}

All file paths in your tool calls MUST be workspace-relative or absolute paths inside the workspace. Anything outside the workspace will be rejected.

# IMPORTANT — do NOT waste turns re-reading inlined content
The full SKILL.md, all modules, the JSON Schema, conventions and data-contracts are ALREADY inlined below this prompt. Do NOT call read_file on:
- SKILL.md or any modules/*.md of this skill
- shared/schemas/*.schema.json (the schema for this skill is inlined)
- shared/conventions.md, shared/data-contracts.md
Only use read_file for upstream output.json files (listed below) and for files the user has placed in the workspace (e.g. user-supplied catalogs, briefs).

# Project profile (long-term distilled memory — authoritative for past consensus)
${projectProfile ? projectProfile : '(no distilled profile yet — rely on project_brief and upstream JSONs)'}

# Project brief
${projectBrief ? projectBrief : '(no project_brief supplied — infer from upstream JSONs)'}

# Upstream output.json files
${upstreamSummary || '(none)'}

Read the upstream JSONs you need with read_file. They are authoritative.

# Required output
You MUST produce exactly one valid JSON file at:
  ${relative(workspace.root, outJson)}

After writing, call validate_schema with skill_id="${node.id}" — pass either the inline JSON object as "json" or the file path you just wrote as "path" (e.g. path="${relative(workspace.root, outJson)}"). If validation fails, fix and rewrite. Then call finish.

# Skill specification (SKILL.md)
${skillBody}

# Skill modules (additional reference)
${modules.map((m) => `\n## modules/${m.name}\n${m.body}`).join('\n')}

# JSON Schema for output.json
${schemaText}

# Conventions
${conventions}

# Cross-skill data contracts
${dataContracts}

# Termination
When the output.json validates, call finish(output_path, summary). If you find yourself stuck after several attempts, call finish with a summary explaining what blocked you — do NOT produce an invalid file silently.
`;
}

function buildUserPrompt(node: SkillNode): string {
  return `Run the ${node.fullName} skill for this workspace. Read the upstream JSONs first, then produce a valid output.json.`;
}

export async function runSkill(
  skillId: string,
  registry: SkillRegistry,
  workspace: Workspace,
  validator: Validator,
  llm: LLMClient,
  emit: EventEmitter,
  opts: RunOptions = {},
): Promise<RunResult> {
  const node = registry.get(skillId);
  if (!node) throw new Error(`unknown skill: ${skillId}`);
  const turnCap = opts.turnCap ?? DEFAULT_TURN_CAP;

  emit({ type: 'start', payload: { skillId, turnCap } });

  if (node.phase2Placeholder) {
    emit({
      type: 'done',
      payload: { ok: false, outputPath: null, reason: 'phase2_not_implemented' },
    });
    return {
      ok: false,
      outputPath: null,
      schemaErrors: [],
      turns: 0,
      reason: 'phase2_not_implemented',
    };
  }

  let pf = preflight(skillId, registry, workspace, validator);
  emit({ type: 'preflight', payload: { ready: pf.ready, blockers: pf.blockers } });

  if (!pf.ready && opts.autoStubUpstream) {
    await ensureStubsForUpstream(
      skillId,
      registry,
      workspace,
      validator,
      llm,
      opts.projectBrief,
      (e) => emit(e),
    );
    pf = preflight(skillId, registry, workspace, validator);
    emit({ type: 'preflight', payload: { ready: pf.ready, blockers: pf.blockers } });
  }

  if (!pf.ready && !opts.allowMissingUpstream) {
    return {
      ok: false,
      outputPath: null,
      schemaErrors: [],
      turns: 0,
      reason: `preflight blocked: ${pf.blockers.join('; ')}`,
    };
  }

  const fs = new WorkspaceFs(workspace.root);
  const shell = new ShellRunner(workspace.root);
  const imageGen = new ImageGenerator({
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseURL: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
  });

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: buildSystemPrompt({
        node,
        registry,
        workspace,
        projectBrief: opts.projectBrief,
        projectProfile: opts.projectProfile,
        repoRoot: registry.root,
      }),
    },
    { role: 'user', content: buildUserPrompt(node) },
  ];

  const toolDefs = tools();
  let finishedPath: string | null = null;
  let finishedReason = 'turn cap reached';
  let turns = 0;

  for (let i = 0; i < turnCap; i++) {
    if (opts.signal?.aborted) {
      finishedReason = 'cancelled';
      break;
    }
    turns = i + 1;
    let resp;
    try {
      const compacted = microcompactMessages(messages, EXECUTOR_COMPACTABLE_TOOLS);
      resp = await llm.chat(compacted, toolDefs, opts.model, opts.signal);
    } catch (e) {
      if (isAbortError(e)) {
        finishedReason = 'cancelled';
        break;
      }
      emit({ type: 'error', payload: { message: (e as Error).message } });
      return { ok: false, outputPath: null, schemaErrors: [], turns, reason: `llm error: ${(e as Error).message}` };
    }

    emit({ type: 'turn', payload: { index: turns, text: resp.text, finish: resp.finish } });
    messages.push(resp.message);

    if (resp.toolCalls.length === 0) {
      if (resp.text.includes(DONE_SENTINEL)) {
        finishedReason = 'sentinel';
        break;
      }
      const text = (resp.text ?? '').trim();
      if (text.length > 0) {
        emit({ type: 'needs_input', payload: { message: text } });
        finishedReason = `needs_input: ${text.slice(0, 240)}`;
      } else {
        finishedReason = 'no tool calls';
      }
      break;
    }

    for (const tc of resp.toolCalls) {
      emit({ type: 'tool_call', payload: { id: tc.id, name: tc.name, arguments: tc.arguments } });
      const result = await dispatch(tc.name, tc.arguments, { fs, shell, validator, registry, imageGen, workspaceRoot: workspace.root, skillId, emit });
      const { ok: okFlag, summary } = summarizeToolResult(tc.name, result);
      emit({ type: 'tool_result', payload: { id: tc.id, ok: okFlag, summary } });
      messages.push(toolMessage(tc.id, result));

      if (tc.name === 'finish' && okFlag) {
        const args = safeParseJson(tc.arguments) as { output_path?: string };
        finishedPath = args.output_path ?? null;
        finishedReason = 'finish() called';
      }
    }

    if (finishedPath !== null) break;
  }

  const outAbs = node && workspace.outputJsonPath(node);
  let postOk = false;
  let postErrors: Array<{ path: string; message: string }> = [];
  if (existsSync(outAbs)) {
    try {
      const data = JSON.parse(readFileSync(outAbs, 'utf-8'));
      if (node.schemaPath) {
        const r = validator.validate(node.schemaPath, data);
        postOk = r.ok;
        postErrors = r.errors;
      } else {
        postOk = true;
      }
    } catch (e) {
      postErrors = [{ path: '/', message: `parse error: ${(e as Error).message}` }];
    }
  }

  if (!postOk && existsSync(outAbs)) {
    emit({ type: 'validate', payload: { ok: false, errors: postErrors.slice(0, 10) } });
    messages.push({
      role: 'user',
      content: `Your output.json failed schema validation. Fix it and call finish again. Errors:\n${postErrors.map((e) => `  - ${e.path}: ${e.message}`).join('\n')}`,
    });
    try {
      turns += 1;
      const compacted = microcompactMessages(messages, EXECUTOR_COMPACTABLE_TOOLS);
      const resp = await llm.chat(compacted, toolDefs, opts.model, opts.signal);
      emit({ type: 'turn', payload: { index: turns, text: resp.text, finish: resp.finish } });
      messages.push(resp.message);
      for (const tc of resp.toolCalls) {
        emit({ type: 'tool_call', payload: { id: tc.id, name: tc.name, arguments: tc.arguments } });
        const result = await dispatch(tc.name, tc.arguments, { fs, shell, validator, registry, imageGen, workspaceRoot: workspace.root, skillId, emit });
        const { ok: okFlag, summary } = summarizeToolResult(tc.name, result);
        emit({ type: 'tool_result', payload: { id: tc.id, ok: okFlag, summary } });
        messages.push(toolMessage(tc.id, result));
      }
    } catch (e) {
      emit({ type: 'error', payload: { message: `auto-fix failed: ${(e as Error).message}` } });
    }
    if (existsSync(outAbs)) {
      try {
        const data = JSON.parse(readFileSync(outAbs, 'utf-8'));
        if (node.schemaPath) {
          const r = validator.validate(node.schemaPath, data);
          postOk = r.ok;
          postErrors = r.errors;
        }
      } catch (e) {
        postErrors = [{ path: '/', message: `parse error: ${(e as Error).message}` }];
      }
    }
  }

  emit({ type: 'validate', payload: { ok: postOk, errors: postErrors.slice(0, 10) } });
  emit({ type: 'done', payload: { ok: postOk, outputPath: existsSync(outAbs) ? outAbs : null, reason: finishedReason } });

  return {
    ok: postOk,
    outputPath: existsSync(outAbs) ? outAbs : null,
    schemaErrors: postErrors,
    turns,
    reason: finishedReason,
  };
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

interface DispatchCtx {
  fs: WorkspaceFs;
  shell: ShellRunner;
  validator: Validator;
  registry: SkillRegistry;
  imageGen: ImageGenerator;
  workspaceRoot: string;
  skillId: string;
  emit?: EventEmitter;
}

async function dispatch(
  name: string,
  argsJson: string,
  ctx: DispatchCtx,
): Promise<unknown> {
  const args = safeParseJson(argsJson) as Record<string, unknown>;
  switch (name) {
    case 'read_file':
      return ctx.fs.readFile(String(args.path ?? ''));
    case 'write_file': {
      const path = String(args.path ?? '');
      const content = String(args.content ?? '');
      const r = ctx.fs.writeFile(path, content);
      const ok = (r as { ok?: boolean }).ok === true;
      if (ok && /\/output\.json$/.test(path)) {
        try {
          const data = JSON.parse(content);
          ctx.emit?.({
            type: 'partial_output',
            payload: { skillId: ctx.skillId, data, bytes: content.length },
          });
        } catch {
          /* not valid JSON yet — skill is mid-write, ignore */
        }
      }
      return r;
    }
    case 'list_dir':
      return ctx.fs.listDir(String(args.path ?? ''));
    case 'validate_schema': {
      const id = String(args.skill_id ?? '');
      const node = ctx.registry.get(id);
      if (!node) return { ok: false, error: `unknown skill: ${id}` };
      if (!node.schemaPath) return { ok: true, errors: [], note: 'skill has no schema' };
      let payload: unknown = args.json;
      if (payload === undefined && typeof args.path === 'string' && args.path) {
        const r = ctx.fs.readFile(args.path);
        if (!r.ok) return { ok: false, error: `validate_schema could not read path "${args.path}": ${r.error ?? 'unknown error'}` };
        try {
          payload = JSON.parse(r.content ?? '');
        } catch (e) {
          return { ok: false, error: `validate_schema: file at "${args.path}" is not valid JSON: ${(e as Error).message}` };
        }
      }
      if (payload === undefined) {
        return { ok: false, error: 'validate_schema requires either "json" (an object) or "path" (a workspace-relative file path).' };
      }
      const r = ctx.validator.validate(node.schemaPath, payload);
      return { ok: r.ok, errors: r.errors.slice(0, 20) };
    }
    case 'generate_image': {
      const prompt = String(args.prompt ?? '');
      const path = String(args.path ?? '');
      const size = (args.size as string) || '1024x1024';
      const quality = (args.quality as string) || 'medium';
      if (!prompt || !path) return { ok: false, error: 'prompt and path are required' };
      try {
        const r = await ctx.imageGen.generate({ prompt, size, quality });
        const writeRes = ctx.fs.writeBinaryFile(path, r.bytes);
        if (!writeRes.ok) return { ok: false, error: writeRes.error };
        return { ok: true, path, bytes: r.bytes.length, model: r.model };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }
    case 'run_shell':
      return await ctx.shell.run(String(args.binary ?? ''), Array.isArray(args.args) ? (args.args as string[]) : []);
    case 'finish': {
      const outputPath = String(args.output_path ?? '');
      if (!outputPath) {
        return { ok: false, error: 'output_path is required. Did you forget to write output.json?' };
      }
      const abs = resolve(ctx.workspaceRoot, outputPath);
      if (!existsSync(abs)) {
        return {
          ok: false,
          error: `output file does not exist at ${outputPath}. Write the output.json with write_file BEFORE calling finish.`,
        };
      }
      try {
        const text = readFileSync(abs, 'utf-8');
        JSON.parse(text);
      } catch (e) {
        return {
          ok: false,
          error: `output file at ${outputPath} is not valid JSON: ${(e as Error).message}`,
        };
      }
      const summary = String(args.summary ?? '');
      if (/\b(blocked|could not produce|cannot produce|unable to produce|aborting|giving up)\b/i.test(summary)) {
        return {
          ok: false,
          error: `finish() summary indicates the skill did not actually complete (\"${summary.slice(0, 120)}\"). If you cannot produce a valid output, do NOT call finish — instead emit a final assistant message describing what is missing, and let the executor report a needs_input / error event.`,
        };
      }
      return { ok: true, output_path: outputPath, summary };
    }
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}
