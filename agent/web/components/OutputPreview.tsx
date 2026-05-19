'use client';

import { useEffect, useState } from 'react';
import type { SkillOutputUpdateResult } from '@/lib/agent';

export interface OutputPreviewProps {
  data: unknown;
  readonly: boolean;
  live?: boolean;
  lastUpdatedAt?: string | null;
  onSave?: (data: unknown) => Promise<SkillOutputUpdateResult>;
}

function serialize(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const ms = Date.now() - t;
  if (ms < 5000) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export function OutputPreview({
  data,
  readonly,
  live = false,
  lastUpdatedAt,
  onSave,
}: OutputPreviewProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [text, setText] = useState<string>(() => serialize(data));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Array<{ path: string; message: string }>>([]);

  // Re-sync text when underlying data changes AND we're not actively editing.
  useEffect(() => {
    if (mode === 'view') setText(serialize(data));
  }, [data, mode]);

  const startEdit = () => {
    if (readonly) return;
    setText(serialize(data));
    setError(null);
    setErrors([]);
    setMode('edit');
  };

  const cancel = () => {
    setText(serialize(data));
    setError(null);
    setErrors([]);
    setMode('view');
  };

  const save = async () => {
    if (!onSave) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setError('Output must be a JSON object (not array or scalar).');
      return;
    }
    setSaving(true);
    setError(null);
    setErrors([]);
    try {
      const r = await onSave(parsed);
      if (!r.ok) {
        setError(r.error ?? 'Save failed');
        if (Array.isArray(r.errors)) setErrors(r.errors);
      } else {
        setMode('view');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const empty = data === null || data === undefined;
  const lineCount = mode === 'view' ? text.split('\n').length : 0;

  return (
    <div className="output-preview">
      <div className="output-preview-head">
        <div className="output-preview-title">
          <span className="output-preview-label">output.json</span>
          {live && (
            <span
              className="output-preview-badge live"
              data-magic="agent 正在写这个文件，每写一次就会刷新；等它跑完再点 Edit"
            >
              live
            </span>
          )}
          {!live && lastUpdatedAt && (
            <span className="output-preview-meta">saved {timeAgo(lastUpdatedAt)}</span>
          )}
          {!live && !lastUpdatedAt && !empty && (
            <span className="output-preview-meta">{lineCount} lines</span>
          )}
        </div>
        <div className="output-preview-actions">
          {mode === 'view' && onSave && !readonly && !empty && (
            <button
              type="button"
              className="btn-ghost"
              onClick={startEdit}
              data-magic="直接改这一步的产出 JSON（如改 audience、加 SKU），保存后下游的 skill 会按新版本跑"
            >
              Edit
            </button>
          )}
          {mode === 'edit' && (
            <>
              <button type="button" className="btn-ghost" onClick={cancel} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {empty && mode === 'view' ? (
        <div className="output-preview-empty">No output yet.</div>
      ) : mode === 'view' ? (
        <pre className="output-preview-body">{text}</pre>
      ) : (
        <textarea
          className="output-preview-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          disabled={saving}
        />
      )}

      {error && <div className="output-preview-error">{error}</div>}
      {errors.length > 0 && (
        <ul className="output-preview-errors">
          {errors.slice(0, 10).map((e, i) => (
            <li key={i}>
              <code>{e.path || '/'}</code> — {e.message}
            </li>
          ))}
          {errors.length > 10 && <li>… and {errors.length - 10} more</li>}
        </ul>
      )}
    </div>
  );
}
