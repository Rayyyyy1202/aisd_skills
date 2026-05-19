import type { SkillRecord } from './loader.ts';
import { loadSkillsFromRepo } from './loader.ts';

/**
 * Upstream dependency graph for the aisd 9-stage pipeline.
 *
 * Source of truth: ~/Desktop/aisd_skills/shared/data-contracts.md §2.
 *
 * P0 (implemented): 01 → 02 → 03 → 04 → 05
 * Phase 2 (placeholder skills, executor refuses to run): 06 / 07 / 08 / 09.
 */
const UPSTREAM_REQUIRED: Record<string, string[]> = {
  '01': [],
  '02': ['01'],
  '03': ['02'],
  '04': ['02', '03'],
  '05': ['04'],
  '06': ['02', '04', '05'],
  '07': ['05', '06'],
  '08': ['01', '07'],
  '09': ['08'],
};

const UPSTREAM_OPTIONAL: Record<string, string[]> = {
  '04': ['01'],
  '05': ['01'],
  '08': ['05'],
  '09': ['01', '02', '03', '04', '05'],
};

/**
 * Skills marked as not-yet-implemented. Executor returns
 * `{ ok: false, reason: 'phase2_not_implemented' }` when these are invoked,
 * but they still appear in the pipeline UI (grayed out).
 */
export const PHASE2_PLACEHOLDER: ReadonlySet<string> = new Set(['06', '07', '08', '09']);

export interface SkillNode extends SkillRecord {
  upstreamRequired: string[];
  upstreamOptional: string[];
  phase2Placeholder: boolean;
}

export class SkillRegistry {
  private byId = new Map<string, SkillNode>();

  constructor(private repoRoot: string) {
    const records = loadSkillsFromRepo(repoRoot);
    for (const r of records) {
      this.byId.set(r.id, {
        ...r,
        upstreamRequired: UPSTREAM_REQUIRED[r.id] ?? [],
        upstreamOptional: UPSTREAM_OPTIONAL[r.id] ?? [],
        phase2Placeholder: PHASE2_PLACEHOLDER.has(r.id),
      });
    }
  }

  list(): SkillNode[] {
    return [...this.byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): SkillNode | undefined {
    return this.byId.get(id);
  }

  get root(): string {
    return this.repoRoot;
  }
}
