import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import matter from 'gray-matter';

export interface SkillFrontmatter {
  name: string;
  version?: string;
  description: string;
  user_invocable?: boolean;
  argument_description?: string;
}

export interface SkillRecord {
  /** "01", "03b", "07a", "13" */
  id: string;
  /** "'aisd'-01-research" */
  fullName: string;
  /** "research", "project-identity" */
  slug: string;
  /** "main" | "side" — main chain is 01..09, rest are side */
  tier: 'main' | 'side';
  description: string;
  argument_description?: string;
  /** Absolute path to SKILL.md */
  skillPath: string;
  /** Absolute path to schemas/<id>-<slug>.schema.json (or null if missing) */
  schemaPath: string | null;
  /** Absolute paths to module files under modules/ (sorted by name) */
  modulePaths: string[];
  /** Path to template file if present */
  templatePaths: string[];
}

const MAIN_CHAIN_IDS = new Set(['01', '02', '03', '04', '05', '06', '07', '08', '09']);

const SKILL_DIR_RE = /^aisd-(\d{2})-(.+)$/;

function listDir(p: string): string[] {
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .map((n) => join(p, n))
    .filter((f) => statSync(f).isFile())
    .sort();
}

export function loadSkillsFromRepo(repoRoot: string): SkillRecord[] {
  const out: SkillRecord[] = [];
  const schemasDir = resolve(repoRoot, 'shared/schemas');

  for (const entry of readdirSync(repoRoot)) {
    const m = entry.match(SKILL_DIR_RE);
    if (!m) continue;
    const dir = resolve(repoRoot, entry);
    if (!statSync(dir).isDirectory()) continue;

    const skillPath = join(dir, 'SKILL.md');
    if (!existsSync(skillPath)) continue;

    const id = m[1]!;
    const slug = m[2]!;

    const raw = readFileSync(skillPath, 'utf-8');
    const fm = matter(raw).data as Partial<SkillFrontmatter>;

    const schemaPath = join(schemasDir, `${id}-${slug}.schema.json`);
    const modulePaths = listDir(join(dir, 'modules'));
    const templatePaths = listDir(join(dir, 'templates'));

    out.push({
      id,
      fullName: entry,
      slug,
      tier: MAIN_CHAIN_IDS.has(id) ? 'main' : 'side',
      description: (fm.description ?? '').toString().trim(),
      argument_description: fm.argument_description?.toString().trim(),
      skillPath,
      schemaPath: existsSync(schemaPath) ? schemaPath : null,
      modulePaths,
      templatePaths,
    });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function readSkillBody(record: SkillRecord): string {
  const raw = readFileSync(record.skillPath, 'utf-8');
  return matter(raw).content;
}

export function readSkillModules(record: SkillRecord): Array<{ name: string; body: string }> {
  return record.modulePaths.map((p) => ({
    name: basename(p),
    body: readFileSync(p, 'utf-8'),
  }));
}

export function readSkillSchema(record: SkillRecord): unknown | null {
  if (!record.schemaPath) return null;
  return JSON.parse(readFileSync(record.schemaPath, 'utf-8'));
}
