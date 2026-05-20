import { execFile } from 'node:child_process';
import { resolve, isAbsolute, relative } from 'node:path';

export interface ShellResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  error?: string;
  command?: string;
}

interface Rule {
  binary: string;
  /** Returns true if the args list is acceptable. */
  match: (args: string[]) => boolean;
  /** Optional human-readable shape of allowed args (for error messages). */
  shape: string;
}

const RULES: Rule[] = [
  {
    binary: 'npx',
    shape: 'npx ajv-cli@5 ...',
    match: (a) => a[0] === 'ajv-cli@5' || a[0] === 'ajv',
  },
  {
    binary: 'npx',
    shape: 'npx prisma <subcmd>',
    match: (a) => a[0] === 'prisma',
  },
  {
    binary: 'pnpm',
    shape: 'pnpm --dir <path> <build|dev|test|typecheck|lint>',
    match: (a) =>
      a[0] === '--dir' &&
      typeof a[1] === 'string' &&
      ['build', 'dev', 'test', 'typecheck', 'lint', 'install'].includes(a[2] ?? ''),
  },
  {
    // Inline eval (-e/-p/--eval/--print) is intentionally NOT allowed: it turns the
    // whitelist into arbitrary code execution (node -e "require('child_process')...").
    // Only invoking a script file by path is permitted.
    binary: 'node',
    shape: 'node <ws-relative-script.{js,mjs,ts}>',
    match: (a) => typeof a[0] === 'string' && /\.(c?js|mjs|ts|tsx)$/.test(a[0]),
  },
  {
    binary: 'tsx',
    shape: 'tsx <ws-relative-script.ts>',
    match: (a) => typeof a[0] === 'string' && /\.(ts|tsx)$/.test(a[0]),
  },
];

const TIMEOUT_MS = 60_000;
const MAX_BUFFER = 8 * 1024 * 1024;

function pathInsideWorkspace(arg: string, workspaceRoot: string): boolean {
  const abs = isAbsolute(arg) ? resolve(arg) : resolve(workspaceRoot, arg);
  const rel = relative(workspaceRoot, abs);
  return !rel.startsWith('..') && !isAbsolute(rel);
}

export class ShellRunner {
  constructor(private workspaceRoot: string) {
    this.workspaceRoot = resolve(workspaceRoot);
  }

  async run(binary: string, args: string[]): Promise<ShellResult> {
    const command = `${binary} ${args.join(' ')}`;

    const rule = RULES.find((r) => r.binary === binary && r.match(args));
    if (!rule) {
      return {
        ok: false,
        code: null,
        stdout: '',
        stderr: '',
        command,
        error: `command not whitelisted: ${command}`,
      };
    }

    if (args.some((a) => a === '..' || a.startsWith('../') || a.includes('/../') || a.endsWith('/..'))) {
      return {
        ok: false,
        code: null,
        stdout: '',
        stderr: '',
        command,
        error: `parent traversal in args is not allowed`,
      };
    }

    for (const a of args) {
      if (a.startsWith('/') && !pathInsideWorkspace(a, this.workspaceRoot)) {
        return {
          ok: false,
          code: null,
          stdout: '',
          stderr: '',
          command,
          error: `absolute path outside workspace: ${a}`,
        };
      }
    }

    // `pnpm --dir <path>` lets the LLM choose the working directory; the path
    // (relative or absolute) MUST resolve inside the workspace, otherwise an
    // arbitrary package.json elsewhere on disk could be installed/run.
    if (binary === 'pnpm' && args[0] === '--dir') {
      const dirArg = args[1] ?? '';
      if (!pathInsideWorkspace(dirArg, this.workspaceRoot)) {
        return {
          ok: false,
          code: null,
          stdout: '',
          stderr: '',
          command,
          error: `pnpm --dir path escapes workspace: ${dirArg}`,
        };
      }
    }

    return await new Promise<ShellResult>((resolveP) => {
      execFile(
        binary,
        args,
        { cwd: this.workspaceRoot, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
        (err, stdout, stderr) => {
          if (err && (err as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
            resolveP({
              ok: false,
              code: null,
              stdout: stdout.toString(),
              stderr: stderr.toString(),
              command,
              error: 'timeout',
            });
            return;
          }
          const code = (err as { code?: number } | null)?.code ?? 0;
          resolveP({
            ok: !err,
            code: typeof code === 'number' ? code : null,
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            command,
            error: err ? (err as Error).message : undefined,
          });
        },
      );
    });
  }
}
