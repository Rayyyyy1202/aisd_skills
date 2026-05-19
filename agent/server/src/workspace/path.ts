import { resolve, join } from 'node:path';
import type { SkillNode } from '../skills/registry.ts';

/**
 * Workspace path resolver.
 *
 * Per shared/conventions.md §1, every skill emits to
 * `<workspace>/aisd/<id>-<slug>/output.json` (and side artifacts in the same dir).
 */
export class Workspace {
  constructor(public readonly root: string) {
    this.root = resolve(root);
  }

  /** Directory for a given skill's outputs */
  skillDir(node: SkillNode): string {
    return join(this.root, 'aisd', `${node.id}-${node.slug}`);
  }

  outputJsonPath(node: SkillNode): string {
    return join(this.skillDir(node), 'output.json');
  }

  /** Sub-path inside a skill directory (e.g., reports, assets, drafts) */
  resolveInside(node: SkillNode, ...segments: string[]): string {
    return join(this.skillDir(node), ...segments);
  }
}
