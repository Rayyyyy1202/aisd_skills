import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';

export interface FsToolset {
  readFile(path: string): { ok: boolean; content?: string; error?: string };
  writeFile(path: string, content: string): { ok: boolean; bytes?: number; error?: string };
  writeBinaryFile(path: string, bytes: Buffer): { ok: boolean; bytes?: number; error?: string };
  listDir(path: string): { ok: boolean; entries?: Array<{ name: string; kind: 'file' | 'dir'; size?: number }>; error?: string };
  exists(path: string): boolean;
}

const MAX_READ_BYTES = 512 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_BINARY_WRITE_BYTES = 16 * 1024 * 1024;

/**
 * Workspace-scoped filesystem tools exposed to the LLM.
 *
 * Every path is resolved relative to the workspace root and rejected if it
 * escapes (no `..` traversal). Absolute paths inside the workspace are
 * accepted and normalized; absolute paths outside are rejected.
 */
export class WorkspaceFs implements FsToolset {
  constructor(private root: string) {
    this.root = resolve(root);
  }

  private safe(p: string): string {
    const abs = isAbsolute(p) ? resolve(p) : resolve(this.root, p);
    const rel = relative(this.root, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`path escapes workspace: ${p}`);
    }
    return abs;
  }

  exists(path: string): boolean {
    try {
      return existsSync(this.safe(path));
    } catch {
      return false;
    }
  }

  readFile(path: string) {
    try {
      const abs = this.safe(path);
      if (!existsSync(abs)) return { ok: false, error: `not found: ${path}` };
      const st = statSync(abs);
      if (st.size > MAX_READ_BYTES) {
        return { ok: false, error: `file too large (${st.size} > ${MAX_READ_BYTES})` };
      }
      return { ok: true, content: readFileSync(abs, 'utf-8') };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  writeFile(path: string, content: string) {
    try {
      const bytes = Buffer.byteLength(content, 'utf-8');
      if (bytes > MAX_WRITE_BYTES) {
        return { ok: false, error: `content too large (${bytes} > ${MAX_WRITE_BYTES})` };
      }
      const abs = this.safe(path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf-8');
      return { ok: true, bytes };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  writeBinaryFile(path: string, bytes: Buffer) {
    try {
      if (bytes.length > MAX_BINARY_WRITE_BYTES) {
        return { ok: false, error: `content too large (${bytes.length} > ${MAX_BINARY_WRITE_BYTES})` };
      }
      const abs = this.safe(path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, bytes);
      return { ok: true, bytes: bytes.length };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  listDir(path: string) {
    try {
      const abs = this.safe(path);
      if (!existsSync(abs)) return { ok: true, entries: [] as Array<{ name: string; kind: 'file' | 'dir'; size?: number }> };
      const entries = readdirSync(abs).map((name) => {
        const st = statSync(join(abs, name));
        return {
          name,
          kind: (st.isDirectory() ? 'dir' : 'file') as 'file' | 'dir',
          size: st.isFile() ? st.size : undefined,
        };
      });
      return { ok: true, entries };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
