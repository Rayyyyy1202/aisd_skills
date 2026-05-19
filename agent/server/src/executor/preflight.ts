import { readFileSync, existsSync, statSync } from 'node:fs';
import type { SkillRegistry, SkillNode } from '../skills/registry.ts';
import type { Workspace } from '../workspace/path.ts';
import type { Validator } from '../tools/validate.ts';

export interface SkillState {
  id: string;
  exists: boolean;
  valid: boolean;
  synthetic: boolean;
  mtime: string | null;
  error: string | null;
}

export interface PreflightReport {
  skillId: string;
  upstreamRequired: SkillState[];
  upstreamOptional: SkillState[];
  blockers: string[];
  ready: boolean;
}

const SYNTHETIC_RE = /"synthetic"\s*:\s*true/;

export function readSkillState(
  node: SkillNode,
  workspace: Workspace,
  validator: Validator,
): SkillState {
  const out = workspace.outputJsonPath(node);
  const base: SkillState = {
    id: node.id,
    exists: false,
    valid: false,
    synthetic: false,
    mtime: null,
    error: null,
  };

  if (!existsSync(out)) return base;

  try {
    const raw = readFileSync(out, 'utf-8');
    const data = JSON.parse(raw);
    base.exists = true;
    base.mtime = statSync(out).mtime.toISOString();
    base.synthetic = SYNTHETIC_RE.test(raw);

    if (!node.schemaPath) {
      base.valid = true;
      return base;
    }
    const r = validator.validate(node.schemaPath, data);
    base.valid = r.ok;
    if (!r.ok) base.error = r.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('; ');
  } catch (e) {
    base.exists = true;
    base.error = (e as Error).message;
  }
  return base;
}

export function preflight(
  skillId: string,
  registry: SkillRegistry,
  workspace: Workspace,
  validator: Validator,
): PreflightReport {
  const node = registry.get(skillId);
  if (!node) throw new Error(`unknown skill: ${skillId}`);

  const required = node.upstreamRequired.map((id) => {
    const u = registry.get(id);
    if (!u) return { id, exists: false, valid: false, synthetic: false, mtime: null, error: 'unknown upstream' };
    return readSkillState(u, workspace, validator);
  });
  const optional = node.upstreamOptional.map((id) => {
    const u = registry.get(id);
    if (!u) return { id, exists: false, valid: false, synthetic: false, mtime: null, error: 'unknown upstream' };
    return readSkillState(u, workspace, validator);
  });

  const blockers = required
    .filter((s) => !s.exists || !s.valid)
    .map((s) =>
      !s.exists ? `upstream ${s.id} missing` : `upstream ${s.id} invalid: ${s.error ?? ''}`,
    );

  return {
    skillId,
    upstreamRequired: required,
    upstreamOptional: optional,
    blockers,
    ready: blockers.length === 0,
  };
}
