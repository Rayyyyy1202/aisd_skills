'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../../components/Sidebar';
import Inspector from '../../components/Inspector';
import { type Project, createConversation, fetchProjects } from '../../lib/agent';

const SUGGESTIONS: Array<{ title: string; sub: string; prompt: string }> = [
  {
    title: '检查工作区状态',
    sub: '看一下哪些 skill 已有 output、哪些还缺',
    prompt: '帮我看看当前工作区的进度，哪些 skill 已经跑过、哪些还没做？',
  },
  {
    title: '从某个节点开始跑',
    sub: '比如直接从素材工厂入手',
    prompt: '我想直接跑 04 素材工厂，缺的上游用合成 stub 顶上即可。品牌 brief 你按默认的来。',
  },
  {
    title: '完整链路',
    sub: '从调研到优化，按顺序推进',
    prompt: '从 01 调研开始，依次跑完 01→02→03→04→05→06→07a→08→09。每步完成后简要汇报。',
  },
  {
    title: '分析一张参考图',
    sub: '上传图片让我提取风格 / 关键词',
    prompt: '我会上传一张参考图，请提取它的色彩、构图和氛围关键词，用于后续素材生成。',
  },
];

export default function ChatHome() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [defaultProjectId, setDefaultProjectId] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects().then(({ projects: bs, default_project_id }) => {
      setProjects(bs);
      setDefaultProjectId(default_project_id);
    });
  }, []);

  const startConversation = async (prompt?: string) => {
    const projectId = defaultProjectId ?? projects[0]?.id;
    if (!projectId) {
      alert('Please create a project first.');
      return;
    }
    const c = await createConversation(projectId);
    const url = `/chat/${c.id}${prompt ? `?seed=${encodeURIComponent(prompt)}` : ''}`;
    router.push(url);
  };

  return (
    <>
      <Sidebar />
      <main className="main">
        <div className="main-header">
          <div className="main-title">aisd Workbench</div>
          <div className="main-meta">
            {projects.length} project{projects.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="main-body">
          <div className="empty">
            <div className="empty-card">
              <div className="empty-orb" />
              <h1>What can I help you with?</h1>
              <p>
                Run any of the 14 aisd pipeline skills against your project workspace, or just chat — I'll figure out what
                to call.
              </p>
              <div className="suggestion-grid">
                {SUGGESTIONS.map((s) => (
                  <button key={s.title} className="suggestion" onClick={() => startConversation(s.prompt)}>
                    <div className="suggestion-title">{s.title}</div>
                    <div className="suggestion-sub">{s.sub}</div>
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 24 }}>
                <button className="btn-primary" onClick={() => startConversation()}>
                  + New conversation
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Inspector />
    </>
  );
}
