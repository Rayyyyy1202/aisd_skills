import type { Hono } from 'hono';
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Repo } from '../db/repo.ts';
import type { SkillRegistry } from '../skills/registry.ts';
import type { Validator } from '../tools/validate.ts';
import { Workspace } from '../workspace/path.ts';

export interface AssetRoutesDeps {
  repo: Repo;
  registry: SkillRegistry;
  validator: Validator;
}

interface AssetRecord {
  id: string;
  type: string;
  purpose: string;
  channel: string;
  language: string;
  format?: string;
  sku_id?: string;
  audience_ids?: string[];
  source?: string;
  auto_tagged?: boolean;
  uploaded_at?: string;
  file_path?: string;
  delivered_file_path?: string;
  width?: number;
  height?: number;
  alt_text?: string;
  prompt_used?: string;
  approved?: boolean;
  status?: string;
  shoot_brief_md_path?: string;
  size_bytes?: number;
  text_content?: string;
}

interface OutputBundle {
  assets?: AssetRecord[];
  [k: string]: unknown;
}

const SAFE_FIELDS: ReadonlyArray<keyof AssetRecord> = [
  'type',
  'purpose',
  'channel',
  'language',
  'format',
  'sku_id',
  'audience_ids',
  'source',
  'auto_tagged',
  'uploaded_at',
  'alt_text',
  'status',
  'approved',
  'delivered_file_path',
  'width',
  'height',
];

const ALLOWED_UPLOAD_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif', '.svg',
  '.mp4', '.webm', '.mov',
]);

function loadOutput(workspace: Workspace, registry: SkillRegistry): { path: string; data: OutputBundle } | null {
  const skill = registry.get('04');
  if (!skill) return null;
  const path = workspace.outputJsonPath(skill);
  if (!existsSync(path)) return null;
  try {
    return { path, data: JSON.parse(readFileSync(path, 'utf-8')) as OutputBundle };
  } catch {
    return null;
  }
}

/**
 * Resolves both root and candidate through realpath so symlinks cannot escape
 * the workspace. The candidate may not exist yet (uploads write a fresh path),
 * in which case we realpath the deepest existing ancestor and append the
 * remainder — that still detects symlinked ancestors.
 */
function ensureWithin(root: string, candidate: string): string | null {
  let realRoot: string;
  try {
    realRoot = realpathSync(resolve(root));
  } catch {
    return null;
  }
  const rootWithSep = realRoot + sep;
  const abs = resolve(candidate);

  let realAbs: string;
  try {
    realAbs = realpathSync(abs);
  } catch {
    // Candidate doesn't exist yet — walk up to the nearest existing ancestor,
    // realpath that, then re-attach the missing tail.
    let parent = abs;
    let tail = '';
    while (parent !== sep && parent.length > 1) {
      const next = resolve(parent, '..');
      if (next === parent) break;
      try {
        const realParent = realpathSync(parent);
        realAbs = tail ? join(realParent, tail) : realParent;
        break;
      } catch {
        tail = tail ? join(parent.slice(next.length + 1), tail) : parent.slice(next.length + 1);
        parent = next;
      }
    }
    // Fallback if the loop never set realAbs (root itself missing — already handled above).
    realAbs ??= abs;
  }

  if (!realAbs.startsWith(rootWithSep)) return null;
  return realAbs;
}

export function mountAssetRoutes(app: Hono, deps: AssetRoutesDeps): void {
  // GET /projects/:id/assets — return assets[] from skill 04 output.json
  app.get('/projects/:id/assets', (c) => {
    const project = deps.repo.getProject(c.req.param('id'));
    if (!project) return c.json({ error: 'unknown project' }, 404);
    const ws = new Workspace(project.workspace);
    const out = loadOutput(ws, deps.registry);
    if (!out) return c.json({ assets: [], output_exists: false, workspace: ws.root });
    const skill = deps.registry.get('04')!;
    return c.json({
      assets: out.data.assets ?? [],
      output_path: out.path,
      output_exists: true,
      workspace: ws.root,
      naming_convention: out.data.naming_convention ?? null,
      schema_path: skill.schemaPath,
    });
  });

  // PATCH /projects/:id/assets/:asset_id — partial update on a single asset
  app.patch('/projects/:id/assets/:asset_id', async (c) => {
    const project = deps.repo.getProject(c.req.param('id'));
    if (!project) return c.json({ error: 'unknown project' }, 404);
    const ws = new Workspace(project.workspace);
    const out = loadOutput(ws, deps.registry);
    if (!out) return c.json({ error: '04 output.json not found — run skill 04 first' }, 404);

    const assetId = c.req.param('asset_id');
    const assets = (out.data.assets ?? []) as AssetRecord[];
    const idx = assets.findIndex((a) => a.id === assetId);
    if (idx < 0) return c.json({ error: `asset not found: ${assetId}` }, 404);

    const body = (await c.req.json().catch(() => ({}))) as Partial<AssetRecord>;
    const patch: Partial<AssetRecord> = {};
    for (const k of SAFE_FIELDS) {
      if (k in body) (patch as Record<string, unknown>)[k] = body[k];
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ error: 'no updatable fields in body' }, 400);
    }

    const next = { ...assets[idx], ...patch } as AssetRecord;
    const nextAssets = [...assets.slice(0, idx), next, ...assets.slice(idx + 1)];
    const nextBundle: OutputBundle = { ...out.data, assets: nextAssets };

    const skill = deps.registry.get('04')!;
    if (skill.schemaPath) {
      const result = deps.validator.validate(skill.schemaPath, nextBundle);
      if (!result.ok) {
        return c.json({ error: 'schema validation failed', errors: result.errors }, 400);
      }
    }

    // Atomic write: write a sibling tmp then rename. Avoids leaving a truncated
    // output.json if the process crashes mid-write (which JSON.parse rejects,
    // effectively losing all asset metadata).
    // NOTE: not concurrency-safe — two simultaneous PATCHes can lose updates
    // (read-modify-write without locking). Acceptable for a single-user local tool.
    const tmp = `${out.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(nextBundle, null, 2));
    renameSync(tmp, out.path);
    return c.json({ ok: true, asset: next });
  });

  // POST /projects/:id/assets/upload — multipart upload to workspace uploads/
  app.post('/projects/:id/assets/upload', async (c) => {
    const project = deps.repo.getProject(c.req.param('id'));
    if (!project) return c.json({ error: 'unknown project' }, 404);
    const ws = new Workspace(project.workspace);

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch (e) {
      return c.json({ error: 'invalid multipart body', message: (e as Error).message }, 400);
    }

    const entries = form.getAll('files') as unknown[];
    const files: FileLike[] = entries.filter(isFileLike);
    if (files.length === 0) return c.json({ error: 'no files in form field "files"' }, 400);

    const uploadsDir = join(ws.root, 'aisd', '03-assets', 'uploads');
    mkdirSync(uploadsDir, { recursive: true });

    const saved: Array<{ name: string; rel_path: string; bytes: number }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const f of files) {
      const ext = extname(f.name).toLowerCase();
      if (!ALLOWED_UPLOAD_EXT.has(ext)) {
        skipped.push({ name: f.name, reason: `unsupported extension ${ext || '(none)'}` });
        continue;
      }
      const safeBase = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      let target = join(uploadsDir, safeBase);
      let safeTarget = ensureWithin(uploadsDir, target);
      if (!safeTarget) {
        skipped.push({ name: f.name, reason: 'path traversal blocked' });
        continue;
      }
      if (existsSync(safeTarget)) {
        const stem = safeBase.slice(0, safeBase.length - ext.length);
        let n = 2;
        while (existsSync(join(uploadsDir, `${stem}-${n}${ext}`))) n++;
        target = join(uploadsDir, `${stem}-${n}${ext}`);
        safeTarget = ensureWithin(uploadsDir, target);
        if (!safeTarget) {
          skipped.push({ name: f.name, reason: 'path traversal blocked (collision rename)' });
          continue;
        }
      }
      const buf = Buffer.from(await f.arrayBuffer());
      writeFileSync(safeTarget, buf);
      saved.push({
        name: f.name,
        rel_path: safeTarget.slice(ws.root.length + 1),
        bytes: buf.length,
      });
    }

    return c.json({
      ok: true,
      uploads_dir: uploadsDir.slice(ws.root.length + 1),
      saved,
      skipped,
      next_step_hint:
        'Re-run skill 04 with --existing-dir=aisd/03-assets/uploads/ to let AI propose tags, or --existing-manifest=<json> if you tagged them yourself.',
    });
  });

  // GET /projects/:id/assets/file?path=<rel> — serve workspace files (under public/ or aisd/)
  app.get('/projects/:id/assets/file', (c) => {
    const project = deps.repo.getProject(c.req.param('id'));
    if (!project) return c.json({ error: 'unknown project' }, 404);
    const ws = new Workspace(project.workspace);

    const raw = c.req.query('path');
    if (!raw) return c.json({ error: 'missing ?path=' }, 400);

    // delivered_file_path is /og/x.png → maps to <workspace>/public/og/x.png
    // file_path is "public/og/x.png" or "aisd/03-assets/uploads/x.jpg"
    const cleaned = normalize(raw).replace(/^[\\/]+/, '');
    let abs: string;
    if (raw.startsWith('/')) {
      abs = join(ws.root, 'public', cleaned);
    } else {
      abs = join(ws.root, cleaned);
    }
    const safe = ensureWithin(ws.root, abs);
    if (!safe) return c.json({ error: 'path escapes workspace' }, 400);
    if (!existsSync(safe)) return c.json({ error: 'file not found', resolved: safe }, 404);

    const buf = readFileSync(safe);
    const mime = mimeFromExt(extname(safe).toLowerCase());
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': mime,
        'content-length': String(buf.length),
        'cache-control': 'private, max-age=60',
      },
    });
  });
}

interface FileLike {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function isFileLike(v: unknown): v is FileLike {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { name?: unknown }).name === 'string' &&
    typeof (v as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  );
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.avif':
      return 'image/avif';
    case '.svg':
      return 'image/svg+xml';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    default:
      return 'application/octet-stream';
  }
}
