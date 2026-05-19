import type { Hono } from 'hono';
import type { Repo } from '../db/repo.ts';
import type { LLMClient } from '../llm/openai.ts';
import { Workspace } from '../workspace/path.ts';
import { distillProjectProfile } from '../llm/distill.ts';

const APPROVAL_HISTORY_LIMIT = 50;

export interface DistillDeps {
  repo: Repo;
  llm: LLMClient | null;
}

/**
 * Run a distillation pass for a project and persist the result.
 * Returns the saved profile, or throws on missing inputs / LLM errors.
 *
 * Used both by the manual endpoint and the auto-trigger inside the approval
 * handler. Caller is responsible for any in-flight de-duplication.
 */
export async function distillAndSave(
  deps: DistillDeps,
  projectId: string,
): Promise<{ profile: string; updated_at: string; promptTokens?: number; completionTokens?: number }> {
  if (!deps.llm) throw new Error('LLM not configured');
  const project = deps.repo.getProject(projectId);
  if (!project) throw new Error(`project not found: ${projectId}`);

  const workspace = new Workspace(project.workspace);
  const memories = deps.repo.listMemories(projectId);
  const recentApprovals = deps.repo.listApprovals(projectId).slice(0, APPROVAL_HISTORY_LIMIT);

  const result = await distillProjectProfile({
    llm: deps.llm,
    brief: project.project_brief ?? '',
    workspace,
    recentApprovals,
    memories,
  });

  if (!result.profile) throw new Error('distillation produced empty profile');
  deps.repo.setProjectProfile(projectId, result.profile);
  const saved = deps.repo.getProjectProfile(projectId);
  if (!saved) throw new Error('failed to read back saved profile');

  return {
    profile: saved.profile,
    updated_at: saved.updated_at,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
  };
}

// ─── In-flight de-duplication ────────────────────────────────────────────────
// If multiple approvals fire in quick succession we don't want N parallel
// distill calls hitting the LLM for the same project. Coalesce into the latest.

const inFlight = new Map<string, Promise<unknown>>();

export function distillAndSaveDedup(
  deps: DistillDeps,
  projectId: string,
): Promise<unknown> {
  const existing = inFlight.get(projectId);
  if (existing) return existing;
  const p = distillAndSave(deps, projectId).finally(() => {
    if (inFlight.get(projectId) === p) inFlight.delete(projectId);
  });
  inFlight.set(projectId, p);
  return p;
}

export function mountDistillRoutes(app: Hono, deps: DistillDeps): void {
  app.post('/projects/:id/distill-profile', async (c) => {
    const id = c.req.param('id');
    if (!deps.repo.getProject(id)) return c.json({ error: 'project not found' }, 404);
    if (!deps.llm) return c.json({ error: 'llm not configured' }, 503);
    try {
      const result = await distillAndSave(deps, id);
      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 500);
    }
  });

  app.get('/projects/:id/profile', (c) => {
    const id = c.req.param('id');
    if (!deps.repo.getProject(id)) return c.json({ error: 'project not found' }, 404);
    const p = deps.repo.getProjectProfile(id);
    if (!p) return c.json({ profile: null, updated_at: null });
    return c.json(p);
  });
}
