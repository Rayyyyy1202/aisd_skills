// Module-level store for the "currently open artifact" — a document the user
// clicked on in a chat tool-result card. Components subscribe via
// useSyncExternalStore; opening one always replaces any previously open one
// (single-panel UX, like Claude.ai's right side panel).

export interface ArtifactPayload {
  // Stable identifier so React can keep panel state when re-opening the same one.
  key: string;
  title: string;
  subtitle: string;
  // The structured JSON we render as a document.
  data: unknown;
  // Absolute or workspace-relative path for the "copy path" affordance.
  path: string | null;
  // ISO timestamp of last modification, if known.
  mtime: string | null;
}

type Listener = () => void;

let current: ArtifactPayload | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* noop */
    }
  });
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getArtifact(): ArtifactPayload | null {
  return current;
}

export function openArtifact(p: ArtifactPayload): void {
  current = p;
  notify();
}

export function closeArtifact(): void {
  if (current === null) return;
  current = null;
  notify();
}
