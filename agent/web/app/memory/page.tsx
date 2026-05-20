'use client';

import { useEffect, useState } from 'react';
import Sidebar from '../../components/Sidebar';
import {
  type Project,
  type MemoryRow,
  deleteMemory,
  fetchProjects,
  fetchMemories,
  saveMemory,
} from '../../lib/agent';

export default function MemoryPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newContent, setNewContent] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    fetchProjects().then(({ projects: bs, default_project_id }) => {
      setProjects(bs);
      setActiveProjectId(default_project_id ?? bs[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!activeProjectId) return;
    fetchMemories(activeProjectId, query.trim() || undefined).then(setMemories);
  }, [activeProjectId, query, refreshTick]);

  const submitMemory = async () => {
    if (!activeProjectId || !newKey.trim() || !newContent.trim()) return;
    await saveMemory(activeProjectId, newKey.trim(), newContent.trim());
    setNewKey('');
    setNewContent('');
    setShowAdd(false);
    setRefreshTick((t) => t + 1);
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this memory?')) return;
    await deleteMemory(id);
    setRefreshTick((t) => t + 1);
  };

  return (
    <>
      <Sidebar />
      <main className="main">
        <div className="main-header">
          <div className="main-title">Memory</div>
          <select
            value={activeProjectId ?? ''}
            onChange={(e) => setActiveProjectId(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
          >
            {projects.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button
            className="btn-primary"
            onClick={() => setShowAdd(true)}
            data-magic="手动给当前项目加一条记忆；之后跟 agent 聊天它会自动带上"
          >
            + New memory
          </button>
        </div>
        <div className="main-body" style={{ padding: 24, maxWidth: 820, margin: '0 auto', width: '100%' }}>
          <input
            type="text"
            placeholder="Search keys or content…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-magic="模糊搜 key 或正文；agent 自动归档的记忆按 key（如 project_brief、tone）分组"
            style={{
              width: '100%',
              padding: 10,
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 16,
              background: 'var(--bg-card)',
            }}
          />
          {memories.length === 0 && (
            <div style={{ color: 'var(--fg-muted)', fontSize: 14 }}>No memories for this project yet.</div>
          )}
          {memories.map((m) => (
            <div
              key={m.id}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: 14,
                marginBottom: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <code
                  style={{ background: 'var(--bg-code)', padding: '2px 6px', borderRadius: 4 }}
                  data-magic="key 是 agent 自己起的标签；相同 key 会被新内容覆盖（最新一次为准）"
                >
                  {m.key}
                </code>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                  {new Date(m.updated_at).toLocaleString()}
                </span>
                <button
                  className="icon-btn"
                  onClick={() => remove(m.id)}
                  title="Delete"
                  data-magic="删掉这条记忆；之后聊天 agent 就读不到了"
                >
                  ×
                </button>
              </div>
              <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 13 }}>{m.content}</div>
            </div>
          ))}
        </div>

        {showAdd && (
          <div className="modal-backdrop" onClick={() => setShowAdd(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>New memory</h2>
              <label>Key</label>
              <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="project_brief" autoFocus />
              <label>Content</label>
              <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} rows={5} />
              <div className="modal-actions">
                <button className="btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
                <button className="btn-primary" onClick={submitMemory}>Save</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
