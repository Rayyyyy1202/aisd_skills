'use client';

// Recursive renderer that turns a skill output.json into a structured document.
// Strategy:
//   - object  → titled section per key, sorted "important fields first"
//   - array of primitives → bulleted list
//   - array of objects    → card stack
//   - string  → paragraph; URLs auto-link
//   - number / bool / null → key-value row
// Metadata-ish sub-objects (`claim_meta`, `meta`) are visually dimmed so the
// reader's eye lands on the substance, not the provenance.

import { Fragment } from 'react';

// Keys we either drop or dim. Skill outputs put provenance under `claim_meta`
// and a top-level `meta` block — useful but not what you want to read first.
const DIM_KEYS = new Set(['claim_meta', 'meta', 'schema_version', 'skill_version']);

// Keys we always pin to the top of an object section, in this order. Anything
// else falls back to insertion order (which is already meaningful for JSON we
// control: skills emit fields most-important-first).
const PIN_FIRST = ['id', 'name', 'project', 'title', 'summary', 'key_angle', 'primary_keyword'];

const URL_RE = /\bhttps?:\/\/[^\s)>"']+/g;

function isPrimitive(v: unknown): boolean {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function humanKey(k: string): string {
  // Best effort: snake_case → Title Case, with a couple acronym preservations.
  return k
    .split('_')
    .map((part) => {
      if (/^(id|url|usd|seo|sku|moq|cpm|cad|us|mx|uk|jp|kr|cn)$/i.test(part)) return part.toUpperCase();
      if (part.length === 0) return part;
      return part[0].toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function sortedEntries(obj: Record<string, unknown>): Array<[string, unknown]> {
  const entries = Object.entries(obj);
  const pinned = PIN_FIRST.flatMap((k) => {
    const idx = entries.findIndex(([key]) => key === k);
    return idx >= 0 ? [entries.splice(idx, 1)[0]] : [];
  });
  return [...pinned, ...entries];
}

function formatPrimitive(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '是' : '否';
  return String(v);
}

function Linkified({ text }: { text: string }) {
  // Split by URL regex; even indices are plain text, odd indices are URLs.
  const parts: Array<{ kind: 'text' | 'url'; value: string }> = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(URL_RE.source, 'g');
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push({ kind: 'text', value: text.slice(last, match.index) });
    parts.push({ kind: 'url', value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });
  if (parts.length === 0) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'url' ? (
          <a key={i} href={p.value} target="_blank" rel="noreferrer" className="doc-link">
            {p.value}
          </a>
        ) : (
          <Fragment key={i}>{p.value}</Fragment>
        ),
      )}
    </>
  );
}

interface NodeProps {
  value: unknown;
  depth: number;
}

function ValueNode({ value, depth }: NodeProps) {
  if (value === null || value === undefined) {
    return <span className="doc-muted">—</span>;
  }
  if (typeof value === 'string') {
    return (
      <p className="doc-paragraph">
        <Linkified text={value} />
      </p>
    );
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="doc-scalar">{formatPrimitive(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="doc-muted">（空）</span>;
    }
    if (value.every(isPrimitive)) {
      return (
        <ul className="doc-list">
          {value.map((item, i) => (
            <li key={i}>
              <ValueNode value={item} depth={depth + 1} />
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className="doc-stack">
        {value.map((item, i) => (
          <div key={i} className="doc-card-row">
            <div className="doc-card-row-index">{i + 1}</div>
            <div className="doc-card-row-body">
              <ValueNode value={item} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (isPlainObject(value)) {
    return <ObjectNode obj={value} depth={depth} />;
  }
  return <span className="doc-muted">{String(value)}</span>;
}

function ObjectNode({ obj, depth }: { obj: Record<string, unknown>; depth: number }) {
  const entries = sortedEntries(obj);
  return (
    <dl className={`doc-object depth-${Math.min(depth, 3)}`}>
      {entries.map(([k, v]) => {
        const dim = DIM_KEYS.has(k);
        // For shallow primitive leaves, render an inline key/value row.
        if (isPrimitive(v)) {
          return (
            <div key={k} className={`doc-kv ${dim ? 'is-dim' : ''}`}>
              <dt className="doc-kv-key">{humanKey(k)}</dt>
              <dd className="doc-kv-value">
                {typeof v === 'string' ? (
                  <Linkified text={v} />
                ) : v === null || v === undefined ? (
                  <span className="doc-muted">—</span>
                ) : (
                  <span className="doc-scalar">{formatPrimitive(v)}</span>
                )}
              </dd>
            </div>
          );
        }
        // For nested structures, render a titled section.
        return (
          <section key={k} className={`doc-section ${dim ? 'is-dim' : ''}`}>
            <h3 className={`doc-heading h${Math.min(depth + 2, 4)}`}>{humanKey(k)}</h3>
            <div className="doc-section-body">
              <ValueNode value={v} depth={depth + 1} />
            </div>
          </section>
        );
      })}
    </dl>
  );
}

export interface JsonDocumentViewProps {
  data: unknown;
}

export function JsonDocumentView({ data }: JsonDocumentViewProps) {
  return (
    <div className="json-doc">
      <ValueNode value={data} depth={0} />
    </div>
  );
}
