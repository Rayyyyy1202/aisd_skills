'use client';

// Two pieces that work together:
// 1. <DocumentArtifactCard /> — the compact chip rendered inside a tool result
//    in chat. Click → opens the global slide-in panel.
// 2. <DocumentArtifactPanel /> — globally mounted in layout.tsx. Subscribes to
//    artifactStore and renders the open artifact as a Claude.ai-style document.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  closeArtifact,
  getArtifact,
  openArtifact,
  subscribe,
  type ArtifactPayload,
} from '../lib/artifactStore';
import { JsonDocumentView } from './JsonDocumentView';

// SSR reads from the same module-level store as the client. In real Next.js
// SSR the store is empty so this returns null; in tests, the store may have
// been pre-populated and SSR reflects that, which lets us assert the open
// state without a browser.
const ssrEmpty = getArtifact;

// ─── compact card (lives inside ToolCallCard in chat) ─────────────────────

export interface DocumentArtifactCardProps {
  payload: ArtifactPayload;
  /** Optional preamble: small bulleted "what's inside" hint above the click target. */
  highlights?: string[];
}

export function DocumentArtifactCard({ payload, highlights }: DocumentArtifactCardProps) {
  const active = useSyncExternalStore(subscribe, getArtifact, ssrEmpty);
  const isOpen = active?.key === payload.key;

  return (
    <button
      type="button"
      className={`doc-artifact-card ${isOpen ? 'is-open' : ''}`}
      onClick={() => openArtifact(payload)}
      data-magic="点击在右侧打开完整文档；不再是 JSON，而是结构化的可读视图"
    >
      <span className="doc-artifact-icon" aria-hidden>
        📄
      </span>
      <span className="doc-artifact-body">
        <span className="doc-artifact-title">{payload.title}</span>
        <span className="doc-artifact-sub">{payload.subtitle}</span>
        {highlights && highlights.length > 0 && (
          <span className="doc-artifact-highlights">
            {highlights.slice(0, 3).map((h, i) => (
              <span key={i} className="doc-artifact-chip">
                {h}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="doc-artifact-cta" aria-hidden>
        打开 ↗
      </span>
    </button>
  );
}

// ─── slide-in panel (globally mounted) ────────────────────────────────────

export default function DocumentArtifactPanel() {
  const artifact = useSyncExternalStore(subscribe, getArtifact, ssrEmpty);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState<'path' | 'json' | null>(null);

  const open = artifact !== null;

  // Reset transient UI when artifact identity changes.
  useEffect(() => {
    setShowRaw(false);
    setCopied(null);
  }, [artifact?.key]);

  const onClose = useCallback(() => closeArtifact(), []);

  // Esc-to-close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const rawJson = useMemo(() => {
    if (!artifact) return '';
    try {
      return JSON.stringify(artifact.data, null, 2);
    } catch {
      return String(artifact.data);
    }
  }, [artifact]);

  const copy = useCallback(async (text: string, kind: 'path' | 'json') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
    } catch {
      /* clipboard blocked — silently no-op */
    }
  }, []);

  if (!artifact) return null;

  return (
    <>
      <div className="doc-panel-scrim" onClick={onClose} aria-hidden />
      <aside
        className="doc-panel"
        role="dialog"
        aria-label={artifact.title}
        aria-modal="true"
      >
        <header className="doc-panel-head">
          <div className="doc-panel-titles">
            <div className="doc-panel-title">{artifact.title}</div>
            <div className="doc-panel-sub">{artifact.subtitle}</div>
          </div>
          <div className="doc-panel-actions">
            <button
              type="button"
              className="doc-panel-btn"
              onClick={() => setShowRaw((v) => !v)}
              data-magic="切到原始 JSON 视图（适合开发/复制）"
            >
              {showRaw ? '文档视图' : '原始 JSON'}
            </button>
            {artifact.path && (
              <button
                type="button"
                className="doc-panel-btn"
                onClick={() => void copy(artifact.path ?? '', 'path')}
                title={artifact.path}
                data-magic="复制 output.json 的工作区绝对路径"
              >
                {copied === 'path' ? '已复制' : '复制路径'}
              </button>
            )}
            <button
              type="button"
              className="doc-panel-btn"
              onClick={() => void copy(rawJson, 'json')}
              data-magic="复制完整 JSON 内容"
            >
              {copied === 'json' ? '已复制' : '复制 JSON'}
            </button>
            <button
              type="button"
              className="doc-panel-close"
              onClick={onClose}
              aria-label="关闭"
              title="关闭 (Esc)"
            >
              ×
            </button>
          </div>
        </header>
        <div className="doc-panel-body">
          {showRaw ? (
            <pre className="doc-panel-raw">{rawJson}</pre>
          ) : (
            <JsonDocumentView data={artifact.data} />
          )}
        </div>
        {artifact.mtime && (
          <footer className="doc-panel-foot">最后更新 {fmtTime(artifact.mtime)}</footer>
        )}
      </aside>
    </>
  );
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
