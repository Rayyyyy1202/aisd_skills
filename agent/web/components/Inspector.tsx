'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  type SkillState,
  type TaskRow,
  fetchTasks,
  fetchWorkspaceState,
} from '../lib/agent';
import { skillDisplayName } from '../lib/skill-names';
import { INSPECTOR_TAB_BLURBS } from '../lib/magic-blurbs';

interface InspectorProps {
  conversationId?: string;
  projectId?: string | null;
  /** ticks higher whenever the chat stream emits a relevant event */
  refreshSignal?: number;
  /** flat tool-call/result log from the live stream */
  toolLog?: ToolLogEntry[];
}

export interface ToolLogEntry {
  id: string;
  name: string;
  args: string;
  result?: { ok: boolean; summary: string };
  startedAt: string;
}

type Tab = 'tasks' | 'tools' | 'pipeline';

export default function Inspector({ conversationId, projectId, refreshSignal, toolLog = [] }: InspectorProps) {
  const [tab, setTab] = useState<Tab>('tasks');
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [states, setStates] = useState<SkillState[]>([]);

  useEffect(() => {
    if (!conversationId) {
      setTasks([]);
      return;
    }
    fetchTasks(conversationId).then(setTasks).catch(() => setTasks([]));
  }, [conversationId, refreshSignal]);

  useEffect(() => {
    if (!projectId) {
      setStates([]);
      return;
    }
    fetchWorkspaceState(projectId).then(setStates).catch(() => setStates([]));
  }, [projectId, refreshSignal]);

  const pendingSkillIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of toolLog) {
      if (e.result || e.name !== 'run_skill') continue;
      try {
        const args = JSON.parse(e.args) as { skill_id?: string };
        if (args.skill_id) set.add(args.skill_id);
      } catch {
        /* skip malformed args */
      }
    }
    return set;
  }, [toolLog]);

  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        <button
          className={`inspector-tab ${tab === 'tasks' ? 'active' : ''}`}
          onClick={() => setTab('tasks')}
          data-magic={INSPECTOR_TAB_BLURBS.tasks}
        >
          任务
        </button>
        <button
          className={`inspector-tab ${tab === 'tools' ? 'active' : ''}`}
          onClick={() => setTab('tools')}
          data-magic={INSPECTOR_TAB_BLURBS.tools}
        >
          工具调用
        </button>
        <button
          className={`inspector-tab ${tab === 'pipeline' ? 'active' : ''}`}
          onClick={() => setTab('pipeline')}
          data-magic={INSPECTOR_TAB_BLURBS.pipeline}
        >
          流程
        </button>
      </div>
      <div className="inspector-body">
        {tab === 'tasks' && <TaskTree tasks={tasks} />}
        {tab === 'tools' && <ToolLog entries={toolLog} />}
        {tab === 'pipeline' && <PipelineMini states={states} pendingIds={pendingSkillIds} />}
      </div>
    </aside>
  );
}

const TASK_STATUS_LABEL: Record<TaskRow['status'], string> = {
  pending: '待办',
  in_progress: '进行中',
  completed: '完成',
  cancelled: '已取消',
};

function TaskTree({ tasks }: { tasks: TaskRow[] }) {
  if (tasks.length === 0) {
    return <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>暂无任务。</div>;
  }
  const roots = tasks.filter((t) => !t.parent_id);
  return (
    <div>
      {roots.map((t) => (
        <TaskItem key={t.id} task={t} all={tasks} />
      ))}
    </div>
  );
}

function TaskItem({ task, all }: { task: TaskRow; all: TaskRow[] }) {
  const children = all.filter((t) => t.parent_id === task.id);
  const mark =
    task.status === 'completed' ? '✓' : task.status === 'in_progress' ? '◐' : task.status === 'cancelled' ? '×' : '○';
  const isRunning = task.status === 'in_progress';
  return (
    <div className={`task-node s-${task.status}${isRunning ? ' is-running' : ''}`}>
      <div className="title">
        <span className={`check${isRunning ? ' aisd-pulse-soft' : ''}`}>{mark}</span>
        {task.title}
      </div>
      {task.notes && <div className="meta">{task.notes}</div>}
      <div className="meta">{TASK_STATUS_LABEL[task.status]}</div>
      {children.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {children.map((c) => (
            <TaskItem key={c.id} task={c} all={all} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolLog({ entries }: { entries: ToolLogEntry[] }) {
  if (entries.length === 0) {
    return <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>暂无工具调用。</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map((e) => {
        const result = e.result;
        const pending = !result;
        const tagClass = result ? (result.ok ? 'tag tag-ok' : 'tag tag-err') : 'tag tag-run aisd-pulse-soft';
        const tagText = result ? (result.ok ? '完成' : '失败') : '运行中';
        return (
          <div key={e.id} className={`tool-card${pending ? ' is-running' : ''}`}>
            <div className="tool-card-head">
              <span className={tagClass}>{tagText}</span>
              <span>{toolDisplayName(e)}</span>
            </div>
            {e.args && e.args !== '{}' && (
              <div className="tool-card-body muted">{prettifyJSON(e.args)}</div>
            )}
            {e.result && <div className="tool-card-body">{e.result.summary}</div>}
          </div>
        );
      })}
    </div>
  );
}

function toolDisplayName(e: ToolLogEntry): string {
  if (e.name === 'run_skill') {
    try {
      const args = JSON.parse(e.args) as { skill_id?: string };
      if (args.skill_id) return `运行 · ${skillDisplayName(args.skill_id)}`;
    } catch {
      /* fall through */
    }
  }
  return e.name;
}

function prettifyJSON(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function PipelineMini({ states, pendingIds }: { states: SkillState[]; pendingIds: Set<string> }) {
  if (states.length === 0) {
    return <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>选择品牌以查看流程状态。</div>;
  }
  const requestJump = (s: SkillState) => {
    window.dispatchEvent(
      new CustomEvent('pipeline:jump-request', {
        detail: {
          skill_id: s.id,
          full_name: s.full_name,
          already_done: s.exists && s.valid && !s.synthetic,
        },
      }),
    );
  };
  return (
    <div>
      {states.map((s) => {
        const pending = pendingIds.has(s.id);
        const dot = pending
          ? 'pending'
          : s.error
            ? 'err'
            : s.synthetic && s.exists
              ? 'warn'
              : s.exists && s.valid
                ? 'ok'
                : 'gray';
        return (
          <button
            key={s.id}
            type="button"
            className={`skill-pill${pending ? ' is-pending' : ''}`}
            title={`${s.full_name}${pending ? ' · 进行中' : ' · 点击让 agent 从这里开始'}`}
            onClick={() => requestJump(s)}
            disabled={pending}
            data-magic="点这一步：agent 会确认上游是否齐全，缺东西就给你弹个填表卡片再决定怎么跑"
          >
            <span className={`dot ${dot}${pending ? ' aisd-pulse-soft' : ''}`} />
            {skillDisplayName(s.id, s.full_name)}
          </button>
        );
      })}
    </div>
  );
}
