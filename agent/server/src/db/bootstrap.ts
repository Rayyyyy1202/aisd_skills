import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Repo } from './repo.ts';

/**
 * If the projects table is empty AND a workspace path is supplied + populated,
 * seed a default project. Returns the resulting project id (or null when nothing
 * to seed).
 */
export function seedDefaultProject(repo: Repo, workspacePath?: string, name = 'demo-drama'): string | null {
  const existing = repo.listProjects();
  if (existing.length > 0) return existing[0]!.id;

  if (!workspacePath) return null;
  const abs = resolve(workspacePath);
  if (!existsSync(abs)) return null;

  const project = repo.createProject(name, abs, undefined);
  return project.id;
}
