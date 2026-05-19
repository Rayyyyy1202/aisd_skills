'use client';

import { useEffect, useState } from 'react';
import type { FieldEnvelope, SpecSource } from '../lib/agent';

interface SpecFieldProps<T> {
  label: string;
  path: string;
  envelope: FieldEnvelope<T>;
  multiline?: boolean;
  /** Render raw value as a string for editing. */
  toInput?: (v: T | null) => string;
  /** Parse the input string back into a value (throws on invalid). */
  fromInput?: (s: string) => T;
  onSave: (path: string, value: unknown) => Promise<void>;
  onAskMe: (path: string, label: string) => void;
}

export function SpecField<T>({
  label,
  path,
  envelope,
  multiline = false,
  toInput,
  fromInput,
  onSave,
  onAskMe,
}: SpecFieldProps<T>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDraft(toInput ? toInput(envelope.value) : String(envelope.value ?? ''));
  }, [envelope.value, toInput]);

  const v = envelope.value;
  const isEmpty =
    v == null ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0);

  const begin = () => {
    setDraft(toInput ? toInput(envelope.value) : String(envelope.value ?? ''));
    setEditing(true);
    setErr(null);
  };

  const commit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const parsed = fromInput ? fromInput(draft) : (draft as unknown as T);
      await onSave(path, parsed);
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setDraft(toInput ? toInput(envelope.value) : String(envelope.value ?? ''));
    setEditing(false);
    setErr(null);
  };

  return (
    <div className="spec-field">
      <div className="spec-field-head">
        <span className="spec-field-label">
          {label}
          {envelope.required && <span className="spec-field-required" title="required">*</span>}
        </span>
        <SourceBadge source={envelope.source} locked={envelope.locked} />
      </div>
      {editing ? (
        <div className="spec-field-edit">
          {multiline ? (
            <textarea
              value={draft}
              autoFocus
              rows={3}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <input
              type="text"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !multiline) commit();
                if (e.key === 'Escape') cancel();
              }}
            />
          )}
          <div className="spec-field-edit-actions">
            <button className="btn-ghost" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button className="btn-primary" onClick={commit} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          {err && <div className="spec-field-error">{err}</div>}
        </div>
      ) : (
        <div className="spec-field-value-row">
          <div
            className={`spec-field-value ${isEmpty ? 'is-empty' : ''}`}
            onClick={begin}
            title="Click to edit"
          >
            {isEmpty ? <em>empty — click to fill</em> : renderValue(v)}
          </div>
          <div className="spec-field-actions">
            {isEmpty && (
              <button className="btn-askme" onClick={() => onAskMe(path, label)}>
                ✦ ask me
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function renderValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ');
  return JSON.stringify(v);
}

export function SourceBadge({ source, locked }: { source: SpecSource; locked?: boolean }) {
  return (
    <span className={`source-badge src-${source.replace('+', '-')}`} title={`source: ${source}${locked ? ' · locked' : ''}`}>
      {source === 'empty' ? '—' : `from ${source}`}
      {locked && <span className="lock">🔒</span>}
    </span>
  );
}
