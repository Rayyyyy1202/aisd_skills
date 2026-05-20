'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  type Project,
  type Conversation,
  fetchProjects,
  fetchConversations,
  createProject,
  createConversation,
  archiveConversation,
  renameConversation,
  deleteProject,
  updateProject,
} from '../lib/agent';

interface SidebarProps {
  activeConversationId?: string;
  activeProjectId?: string;
  onActiveProjectChange?: (projectId: string | null) => void;
}

export default function Sidebar({ activeConversationId, activeProjectId, onActiveProjectChange }: SidebarProps) {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [defaultProjectId, setDefaultProjectId] = useState<string | null>(null);
  const [convsByProject, setConvsByProject] = useState<Record<string, Conversation[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    fetchProjects().then(({ projects: bs, default_project_id }) => {
      setProjects(bs);
      setDefaultProjectId(default_project_id);
      const next: Record<string, boolean> = {};
      for (const b of bs) next[b.id] = true;
      setExpanded(next);
    });
  }, [refreshTick]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(projects.map(async (b) => [b.id, await fetchConversations(b.id)] as const)).then((rows) => {
      if (cancelled) return;
      const map: Record<string, Conversation[]> = {};
      for (const [id, list] of rows) map[id] = list;
      setConvsByProject(map);
    });
    return () => {
      cancelled = true;
    };
  }, [projects, refreshTick]);

  // notify parent of active project
  useEffect(() => {
    if (!activeConversationId || !onActiveProjectChange) return;
    for (const [bid, list] of Object.entries(convsByProject)) {
      if (list.some((c) => c.id === activeConversationId)) {
        onActiveProjectChange(bid);
        return;
      }
    }
  }, [activeConversationId, convsByProject, onActiveProjectChange]);

  const handleNewConv = async (projectId: string) => {
    const c = await createConversation(projectId);
    setRefreshTick((t) => t + 1);
    router.push(`/chat/${c.id}`);
  };

  const handleRename = async (c: Conversation) => {
    const next = window.prompt('Rename conversation', c.title);
    if (!next || next === c.title) return;
    await renameConversation(c.id, next);
    setRefreshTick((t) => t + 1);
  };

  const handleArchive = async (c: Conversation) => {
    if (!window.confirm(`Archive "${c.title}"?`)) return;
    await archiveConversation(c.id);
    if (c.id === activeConversationId) router.push('/chat');
    setRefreshTick((t) => t + 1);
  };

  const handleRenameProject = async (b: Project) => {
    const next = window.prompt('Rename project', b.name);
    if (!next || next === b.name) return;
    await updateProject(b.id, { name: next });
    setRefreshTick((t) => t + 1);
  };

  const handleArchiveProject = async (b: Project) => {
    if (!window.confirm(`Archive project "${b.name}"? Conversations stay in the database but the project is hidden.`)) return;
    await deleteProject(b.id);
    setRefreshTick((t) => t + 1);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <Link href="/chat" className="sidebar-logo" style={{ color: 'inherit' }}>
          <span className="logo-mark" />
          <span>aisd Agent</span>
        </Link>
        <div className="sidebar-actions">
          <button
            className="icon-btn"
            title="New project"
            onClick={() => setShowProjectModal(true)}
            aria-label="New project"
            data-magic="新建项目：会建一个独立的 workspace 文件夹，存这个项目所有的对话、产出、素材"
          >
            +
          </button>
        </div>
      </div>

      <div className="sidebar-scroll">
        {projects.length === 0 && (
          <div style={{ padding: '12px', color: 'var(--fg-muted)', fontSize: 12 }}>
            No projects yet. Click + to add one.
          </div>
        )}
        {projects.map((b) => {
          const isExpanded = expanded[b.id] !== false;
          const convs = convsByProject[b.id] ?? [];
          return (
            <div className="project-group" key={b.id}>
              <div
                className={`project-row ${isExpanded ? 'expanded' : ''}`}
                onClick={() => setExpanded({ ...expanded, [b.id]: !isExpanded })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const choice = window.prompt(`Project actions for "${b.name}":\n  r — rename\n  d — archive\n(empty = cancel)`);
                  if (choice === 'r') handleRenameProject(b);
                  else if (choice === 'd') handleArchiveProject(b);
                }}
                title="Right-click for actions"
                data-magic="一个项目的所有对话和产物都收在这里。点击展开，右键改名 / 归档"
              >
                <span className="project-avatar">{b.name.slice(0, 1).toUpperCase()}</span>
                <span className="project-name">{b.name}</span>
                {b.id === defaultProjectId && (
                  <span style={{ fontSize: 10, color: 'var(--fg-faint)' }}>default</span>
                )}
                <span className="project-caret">▶</span>
              </div>
              {isExpanded && (
                <div className="conv-list">
                  {convs.length === 0 && <div className="conv-empty">No conversations</div>}
                  {convs.map((c) => (
                    <div
                      key={c.id}
                      className={`conv-row ${c.id === activeConversationId ? 'active' : ''}`}
                      onClick={() => router.push(`/chat/${c.id}`)}
                      title={c.title}
                      data-magic="一次跟 agent 的连续聊天。所有消息会持久保存，可以随时回来继续"
                    >
                      <span className="conv-title">{c.title}</span>
                      <span className="conv-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="icon-btn"
                          style={{ width: 22, height: 22, fontSize: 11 }}
                          onClick={() => handleRename(c)}
                          title="Rename"
                        >
                          ✎
                        </button>
                        <button
                          className="icon-btn"
                          style={{ width: 22, height: 22, fontSize: 13 }}
                          onClick={() => handleArchive(c)}
                          title="Archive"
                        >
                          ×
                        </button>
                      </span>
                    </div>
                  ))}
                  <div
                    className="project-add-conv"
                    onClick={() => handleNewConv(b.id)}
                  >
                    + New conversation
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sidebar-footer">
        <Link
          href="/pipeline"
          className="footer-link"
          style={{ color: 'inherit' }}
          data-magic="Pipeline：9 个 skill 的流程总览图，看每一步当前状态、点开能单独跑"
        >
          <span className="icon">▦</span>
          <span>Pipeline</span>
        </Link>
        <div
          className="footer-link"
          onClick={() => {
            const target = activeProjectId ?? defaultProjectId ?? projects[0]?.id;
            if (target) router.push(`/assets/${target}`);
          }}
          title={activeProjectId ?? defaultProjectId ? 'Open asset library' : 'No project selected'}
          data-magic="素材库：当前项目产生的图片 / banner / 产品图，可按用途/渠道筛"
        >
          <span className="icon">◇</span>
          <span>素材库</span>
        </div>
        <div
          className="footer-link"
          onClick={() => router.push('/memory')}
          data-magic="Memory：项目长期记忆库（key-value 笔记），所有对话都能查到"
        >
          <span className="icon">◆</span>
          <span>Memory</span>
        </div>
        <Link
          href="/integrations"
          className="footer-link"
          style={{ color: 'inherit' }}
          data-magic="API 接口：列出所有外部服务（GA / Meta Ads / Shopify…）的接入状态"
        >
          <span className="icon">⌬</span>
          <span>API 接口</span>
        </Link>
      </div>

      {showProjectModal && (
        <NewProjectModal
          onClose={() => setShowProjectModal(false)}
          onCreated={(b) => {
            setShowProjectModal(false);
            setRefreshTick((t) => t + 1);
            handleNewConv(b.id);
          }}
        />
      )}
    </aside>
  );
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (b: Project) => void }) {
  const [name, setName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [brief, setBrief] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setErr('name is required');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const b = await createProject(name.trim(), workspace.trim(), brief.trim() || undefined);
      onCreated(b);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New project</h2>
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Petropolitian" autoFocus />
        <label>Workspace path <span style={{ color: 'var(--fg-faint)', fontWeight: 400 }}>(optional — auto from name if empty)</span></label>
        <input
          type="text"
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          placeholder={name.trim() ? `auto: <repo>/${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}` : '/Users/you/projects/my-project'}
        />
        <label>Default project brief (optional)</label>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          placeholder="designer dog collars sized for every dog"
        />
        {err && <div style={{ color: 'var(--status-err)', fontSize: 12, marginTop: 8 }}>{err}</div>}
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  );
}
