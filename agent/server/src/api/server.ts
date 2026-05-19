import { Hono } from 'hono';
// touch: reload registry after 04 SKILL.md update
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { SkillRegistry, type SkillNode } from '../skills/registry.ts';
import { Workspace } from '../workspace/path.ts';
import { Validator } from '../tools/validate.ts';
import { preflight, readSkillState } from '../executor/preflight.ts';
import { runSkill, type RunEvent } from '../executor/node.ts';
import { LLMClient } from '../llm/openai.ts';
import { openDatabase } from '../db/schema.ts';
import { Repo } from '../db/repo.ts';
import { seedDefaultProject } from '../db/bootstrap.ts';
import { mountChatRoutes } from './chat.ts';
// spec routes removed — 'aisd'-specific site-spec subsystem N/A for aisd
import { mountDistillRoutes } from './distill.ts';
import { mountAssetRoutes } from './assets.ts';
import { mountIntegrationsRoutes } from './integrations.ts';
// realtime voice removed — 'aisd'-specific askme voice subsystem N/A for aisd

// derive repo root from this file's location: agent/server/src/api/server.ts → ../../../..
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(process.env.REPO_ROOT ?? resolve(__dirname, '../../../..'));
const WORKSPACE_PATH = resolve(process.env.WORKSPACE_PATH ?? `${REPO_ROOT}/workspace`);
const PORT = Number(process.env.PORT ?? 3001);
const DB_PATH = resolve(process.env.AGENT_DB_PATH ?? `${REPO_ROOT}/agent/server/data/aisd.sqlite`);

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

const registry = new SkillRegistry(REPO_ROOT);
const validator = new Validator(`${REPO_ROOT}/shared/schemas`);
const llm = OPENAI_API_KEY
  ? new LLMClient({ apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL, model: OPENAI_MODEL })
  : null;

const db = openDatabase(DB_PATH);
const repo = new Repo(db);
const defaultProjectId = seedDefaultProject(repo, WORKSPACE_PATH);

const app = new Hono();
app.use('*', cors());

// ─── helpers ─────────────────────────────────────────────────────────────

function workspaceForProject(projectId: string): Workspace | null {
  const b = repo.getProject(projectId);
  if (!b) return null;
  return new Workspace(b.workspace);
}

function workspaceFromHeaderOrDefault(c: { req: { header(k: string): string | undefined } }): Workspace | null {
  const id = c.req.header('x-project-id') ?? defaultProjectId;
  if (!id) return null;
  return workspaceForProject(id);
}

function skillSummary(s: SkillNode) {
  return {
    id: s.id,
    full_name: s.fullName,
    slug: s.slug,
    tier: s.tier,
    description: s.description,
    argument_description: s.argument_description ?? null,
    upstream_required: s.upstreamRequired,
    upstream_optional: s.upstreamOptional,
    schema_path: s.schemaPath,
    module_count: s.modulePaths.length,
  };
}

// ─── core endpoints ──────────────────────────────────────────────────────

app.get('/health', (c) =>
  c.json({
    ok: true,
    repo_root: REPO_ROOT,
    default_workspace: WORKSPACE_PATH,
    default_project_id: defaultProjectId,
    llm_ready: llm !== null,
    db_path: DB_PATH,
    default_model: OPENAI_MODEL,
    available_models: ['gpt-4o', 'gpt-5.4'],
  }),
);

app.get('/skills', (c) => c.json({ skills: registry.list().map(skillSummary) }));

app.get('/skills/:id', (c) => {
  const s = registry.get(c.req.param('id'));
  if (!s) return c.json({ error: 'not found' }, 404);
  return c.json({
    ...skillSummary(s),
    skill_path: s.skillPath,
    modules: s.modulePaths,
    templates: s.templatePaths,
  });
});

// ─── projects ──────────────────────────────────────────────────────────────

app.get('/projects', (c) => c.json({ projects: repo.listProjects(), default_project_id: defaultProjectId }));

app.post('/projects', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { name, workspace, project_brief } = body as { name?: string; workspace?: string; project_brief?: string };
  if (!name || !name.trim()) return c.json({ error: 'name is required' }, 400);
  const wsAbs = workspace && workspace.trim()
    ? resolve(workspace.trim())
    : deriveWorkspace(name.trim());
  const project = repo.createProject(name.trim(), wsAbs, project_brief);
  return c.json(project, 201);
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'project';
}

function deriveWorkspace(name: string): string {
  const base = slugify(name);
  const existing = new Set(repo.listProjects().map((b) => b.workspace));
  let candidate = resolve(REPO_ROOT, base);
  let n = 2;
  while (existing.has(candidate)) {
    candidate = resolve(REPO_ROOT, `${base}-${n}`);
    n++;
  }
  return candidate;
}

app.patch('/projects/:id', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<{
    name: string;
    workspace: string;
    project_brief: string;
  }>;
  const updated = repo.updateProject(c.req.param('id'), {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.workspace !== undefined && { workspace: resolve(body.workspace) }),
    ...(body.project_brief !== undefined && { project_brief: body.project_brief }),
  });
  if (!updated) return c.json({ error: 'not found' }, 404);
  return c.json(updated);
});

app.delete('/projects/:id', (c) => {
  if (!repo.getProject(c.req.param('id'))) return c.json({ error: 'not found' }, 404);
  repo.archiveProject(c.req.param('id'));
  return c.json({ ok: true });
});

// ─── per-project workspace + skill operations ──────────────────────────────

app.get('/projects/:id/workspace/state', (c) => {
  const ws = workspaceForProject(c.req.param('id'));
  if (!ws) return c.json({ error: 'unknown project' }, 404);
  const states = registry.list().map((s) => {
    const { id: _omit, ...state } = readSkillState(s, ws, validator);
    return { id: s.id, full_name: s.fullName, tier: s.tier, ...state };
  });
  return c.json({ workspace: ws.root, states });
});

app.get('/projects/:id/skills/:skill/preflight', (c) => {
  const ws = workspaceForProject(c.req.param('id'));
  if (!ws) return c.json({ error: 'unknown project' }, 404);
  const skill = c.req.param('skill');
  if (!registry.get(skill)) return c.json({ error: 'unknown skill' }, 404);
  return c.json(preflight(skill, registry, ws, validator));
});

app.get('/projects/:id/skills/:skill/output', (c) => {
  const ws = workspaceForProject(c.req.param('id'));
  if (!ws) return c.json({ error: 'unknown project' }, 404);
  const s = registry.get(c.req.param('skill'));
  if (!s) return c.json({ error: 'not found' }, 404);
  const out = ws.outputJsonPath(s);
  if (!existsSync(out)) return c.json({ error: 'output.json not found', path: out }, 404);
  try {
    const data = JSON.parse(readFileSync(out, 'utf-8'));
    const stat = statSync(out);
    return c.json({ skill_id: s.id, path: out, data, mtime: stat.mtime.toISOString() });
  } catch (e) {
    return c.json({ error: 'parse failed', message: (e as Error).message }, 500);
  }
});

app.put('/projects/:id/skills/:skill/output', async (c) => {
  const ws = workspaceForProject(c.req.param('id'));
  if (!ws) return c.json({ error: 'unknown project' }, 404);
  const s = registry.get(c.req.param('skill'));
  if (!s) return c.json({ error: 'unknown skill' }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json({ error: 'invalid JSON', message: (e as Error).message }, 400);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'output must be a JSON object (not array or scalar)' }, 400);
  }

  if (s.schemaPath) {
    const r = validator.validate(s.schemaPath, body);
    if (!r.ok) {
      return c.json({ error: 'schema validation failed', errors: r.errors.slice(0, 50) }, 400);
    }
  }

  const out = ws.outputJsonPath(s);
  try {
    mkdirSync(dirname(out), { recursive: true });
    const text = JSON.stringify(body, null, 2);
    writeFileSync(out, text, 'utf-8');
    const stat = statSync(out);
    return c.json({ ok: true, path: out, bytes: text.length, mtime: stat.mtime.toISOString() });
  } catch (e) {
    return c.json({ error: 'write failed', message: (e as Error).message }, 500);
  }
});

app.post('/projects/:id/skills/:skill/run', async (c) => {
  const ws = workspaceForProject(c.req.param('id'));
  if (!ws) return c.json({ error: 'unknown project' }, 404);
  const skill = c.req.param('skill');
  if (!registry.get(skill)) return c.json({ error: 'unknown skill' }, 404);
  if (!llm) return c.json({ error: 'OPENAI_API_KEY not set on server' }, 503);

  const body = (await c.req.json().catch(() => ({}))) as {
    project_brief?: string;
    turn_cap?: number;
    allow_missing_upstream?: boolean;
    auto_stub_upstream?: boolean;
    model?: string;
  };
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;

  const clientSignal = c.req.raw.signal;
  return streamSSE(c, async (stream) => {
    const send = async (e: RunEvent) => {
      await stream.writeSSE({ event: e.type, data: JSON.stringify(e.payload) });
    };
    try {
      const result = await runSkill(
        skill,
        registry,
        ws,
        validator,
        llm,
        (e) => void send(e),
        {
          projectBrief: body.project_brief,
          turnCap: body.turn_cap,
          allowMissingUpstream: body.allow_missing_upstream,
          autoStubUpstream: body.auto_stub_upstream,
          model,
          signal: clientSignal,
        },
      );
      await stream.writeSSE({ event: 'result', data: JSON.stringify(result) });
    } catch (e) {
      if (clientSignal.aborted) {
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ ok: false, outputPath: null, reason: 'cancelled' }) });
      } else {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: (e as Error).message }) });
      }
    }
  });
});

// ─── legacy flat endpoints (default project) ───────────────────────────────

app.get('/workspace/state', (c) => {
  const ws = workspaceFromHeaderOrDefault(c);
  if (!ws) return c.json({ error: 'no default project configured' }, 503);
  const states = registry.list().map((s) => {
    const { id: _omit, ...state } = readSkillState(s, ws, validator);
    return { id: s.id, full_name: s.fullName, tier: s.tier, ...state };
  });
  return c.json({ workspace: ws.root, states });
});

app.get('/skills/:id/preflight', (c) => {
  const ws = workspaceFromHeaderOrDefault(c);
  if (!ws) return c.json({ error: 'no default project configured' }, 503);
  const id = c.req.param('id');
  if (!registry.get(id)) return c.json({ error: 'unknown skill' }, 404);
  return c.json(preflight(id, registry, ws, validator));
});

app.get('/skills/:id/output', (c) => {
  const ws = workspaceFromHeaderOrDefault(c);
  if (!ws) return c.json({ error: 'no default project configured' }, 503);
  const s = registry.get(c.req.param('id'));
  if (!s) return c.json({ error: 'not found' }, 404);
  const out = ws.outputJsonPath(s);
  if (!existsSync(out)) return c.json({ error: 'output.json not found', path: out }, 404);
  try {
    const data = JSON.parse(readFileSync(out, 'utf-8'));
    const stat = statSync(out);
    return c.json({ skill_id: s.id, path: out, data, mtime: stat.mtime.toISOString() });
  } catch (e) {
    return c.json({ error: 'parse failed', message: (e as Error).message }, 500);
  }
});

app.put('/skills/:id/output', async (c) => {
  const ws = workspaceFromHeaderOrDefault(c);
  if (!ws) return c.json({ error: 'no default project configured' }, 503);
  const s = registry.get(c.req.param('id'));
  if (!s) return c.json({ error: 'unknown skill' }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json({ error: 'invalid JSON', message: (e as Error).message }, 400);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'output must be a JSON object (not array or scalar)' }, 400);
  }

  if (s.schemaPath) {
    const r = validator.validate(s.schemaPath, body);
    if (!r.ok) {
      return c.json({ error: 'schema validation failed', errors: r.errors.slice(0, 50) }, 400);
    }
  }

  const out = ws.outputJsonPath(s);
  try {
    mkdirSync(dirname(out), { recursive: true });
    const text = JSON.stringify(body, null, 2);
    writeFileSync(out, text, 'utf-8');
    const stat = statSync(out);
    return c.json({ ok: true, path: out, bytes: text.length, mtime: stat.mtime.toISOString() });
  } catch (e) {
    return c.json({ error: 'write failed', message: (e as Error).message }, 500);
  }
});

app.post('/skills/:id/run', async (c) => {
  const ws = workspaceFromHeaderOrDefault(c);
  if (!ws) return c.json({ error: 'no default project configured' }, 503);
  const id = c.req.param('id');
  if (!registry.get(id)) return c.json({ error: 'unknown skill' }, 404);
  if (!llm) return c.json({ error: 'OPENAI_API_KEY not set on server' }, 503);

  const body = (await c.req.json().catch(() => ({}))) as {
    project_brief?: string;
    turn_cap?: number;
    allow_missing_upstream?: boolean;
    auto_stub_upstream?: boolean;
    model?: string;
  };
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;

  const clientSignal = c.req.raw.signal;
  return streamSSE(c, async (stream) => {
    const send = async (e: RunEvent) => {
      await stream.writeSSE({ event: e.type, data: JSON.stringify(e.payload) });
    };
    try {
      const result = await runSkill(
        id,
        registry,
        ws,
        validator,
        llm,
        (e) => void send(e),
        {
          projectBrief: body.project_brief,
          turnCap: body.turn_cap,
          allowMissingUpstream: body.allow_missing_upstream,
          autoStubUpstream: body.auto_stub_upstream,
          model,
          signal: clientSignal,
        },
      );
      await stream.writeSSE({ event: 'result', data: JSON.stringify(result) });
    } catch (e) {
      if (clientSignal.aborted) {
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ ok: false, outputPath: null, reason: 'cancelled' }) });
      } else {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: (e as Error).message }) });
      }
    }
  });
});

// ─── chat (Phase C) ──────────────────────────────────────────────────────

mountChatRoutes(app, { repo, registry, validator, llm });

// ─── L3 project profile distillation ───────────────────────────────────────

mountDistillRoutes(app, { repo, llm });

// ─── asset library (skill 04 output editor + uploads) ───────────────────

mountAssetRoutes(app, { repo, registry, validator });

// ─── api integrations catalog (env-var detected) ────────────────────────

mountIntegrationsRoutes(app);

// build-plan / spec / realtime-voice routes removed ('aisd'-specific)

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[agent] server listening on http://localhost:${info.port}`);
  console.log(`[agent] repo root: ${REPO_ROOT}`);
  console.log(`[agent] db: ${DB_PATH}`);
  console.log(`[agent] loaded ${registry.list().length} skills`);
  console.log(`[agent] projects: ${repo.listProjects().length} (default: ${defaultProjectId ?? '—'})`);
});
