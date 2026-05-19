'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, { Background, Controls, type Edge, type Node, type NodeProps, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import {
  fetchSkills,
  fetchWorkspaceState,
  fetchPreflight,
  fetchSkillOutput,
  streamRun,
  updateSkillOutput,
  type SkillSummary,
  type SkillState,
  type PreflightReport,
  type RunEvent,
  type SkillOutput,
} from '@/lib/agent';
import { skillDisplayName } from '@/lib/skill-names';
import { OutputPreview } from '@/components/OutputPreview';
import { STATUS_BLURBS, skillNodeBlurb } from '@/lib/magic-blurbs';

function displayName(skill: SkillSummary): string {
  return skillDisplayName(skill.id, skill.slug);
}

type NodeStatus = 'phase2' | 'pending' | 'valid' | 'synthetic' | 'invalid' | 'missing';

function statusFor(skill: SkillSummary, state: SkillState | undefined, pending: boolean): NodeStatus {
  if (skill.phase2_placeholder) return 'phase2';
  if (pending) return 'pending';
  if (!state || !state.exists) return 'missing';
  if (!state.valid) return 'invalid';
  if (state.synthetic) return 'synthetic';
  return 'valid';
}

const STATUS_COLOR: Record<NodeStatus, string> = {
  phase2: '#2a3140',
  pending: '#3a8ee0',
  valid: '#3aae50',
  synthetic: '#d8a93a',
  invalid: '#c93b3b',
  missing: '#3a4452',
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  phase2: 'Coming Phase 2',
  pending: '进行中',
  valid: '完成',
  synthetic: 'stub',
  invalid: '校验失败',
  missing: '未运行',
};

function PipelineNode({
  data,
  selected,
}: NodeProps<{ skill: SkillSummary; state?: SkillState; pending: boolean; onClick: () => void }>) {
  const { skill, state, pending, onClick } = data;
  const status = statusFor(skill, state, pending);
  const bg = STATUS_COLOR[status];
  const isPhase2 = status === 'phase2';
  return (
    <div
      onClick={onClick}
      className={pending ? 'pipeline-node pipeline-node-pending' : 'pipeline-node'}
      data-magic={isPhase2 ? 'Phase 2 — not yet implemented' : skillNodeBlurb(skill.id, status)}
      style={{
        background: bg,
        color: isPhase2 ? '#6b7785' : '#0b0d10',
        border: selected ? '2px solid #fff' : '2px solid transparent',
        borderRadius: 8,
        padding: '10px 14px',
        minWidth: 170,
        textAlign: 'center',
        cursor: isPhase2 ? 'not-allowed' : 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        opacity: isPhase2 ? 0.6 : 1,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#1e2630' }} />
      <div style={{ fontWeight: 700, fontSize: 14 }}>{displayName(skill)}</div>
      <div style={{ fontSize: 10, opacity: 0.75, marginTop: 3 }}>{STATUS_LABEL[status]}</div>
      <Handle type="source" position={Position.Right} style={{ background: '#1e2630' }} />
    </div>
  );
}

const nodeTypes = { skill: PipelineNode };

const MAIN_ORDER = ['01', '02', '03', '04', '05', '06', '07', '08', '09'];

function layoutNodes(
  skills: SkillSummary[],
  states: Map<string, SkillState>,
  pendingSet: Set<string>,
  onClick: (id: string) => void,
): Node[] {
  const xMain = 280;
  const yMain = 220;
  const sideOffset = 180;
  const nodes: Node[] = [];

  const mainIdx = new Map<string, number>();
  MAIN_ORDER.forEach((id, i) => mainIdx.set(id, i));

  for (const s of skills) {
    const isMain = mainIdx.has(s.id);
    let x: number, y: number;
    if (isMain) {
      x = 60 + (mainIdx.get(s.id) ?? 0) * xMain;
      y = yMain;
    } else {
      // side skills positioned near their primary upstream main node
      const anchor = s.upstream_required[0];
      const ax = mainIdx.has(anchor) ? 60 + (mainIdx.get(anchor) ?? 0) * xMain : 60;
      x = ax + 40;
      y = yMain + sideOffset;
    }
    nodes.push({
      id: s.id,
      type: 'skill',
      position: { x, y },
      data: {
        skill: s,
        state: states.get(s.id),
        pending: pendingSet.has(s.id),
        onClick: () => onClick(s.id),
      },
    });
  }
  return nodes;
}

function makeEdges(skills: SkillSummary[]): Edge[] {
  const edges: Edge[] = [];
  for (const s of skills) {
    for (const up of s.upstream_required) {
      edges.push({
        id: `${up}->${s.id}`,
        source: up,
        target: s.id,
        animated: false,
        style: { stroke: '#3b4756', strokeWidth: 2 },
      });
    }
  }
  return edges;
}

export default function PipelinePage() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [states, setStates] = useState<Map<string, SkillState>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingSet, setPendingSet] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    const [sk, st] = await Promise.all([fetchSkills(), fetchWorkspaceState()]);
    setSkills(sk);
    setStates(new Map(st.map((x) => [x.id, x])));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleNodeClick = useCallback(
    (id: string) => {
      const sk = skills.find((s) => s.id === id);
      if (sk?.phase2_placeholder) return;
      setSelected(id);
    },
    [skills],
  );

  const markPending = useCallback((id: string, on: boolean) => {
    setPendingSet((curr) => {
      const next = new Set(curr);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const nodes = useMemo(
    () => layoutNodes(skills, states, pendingSet, handleNodeClick),
    [skills, states, pendingSet, handleNodeClick],
  );
  const edges = useMemo(() => makeEdges(skills), [skills]);

  const selectedSkill = selected ? skills.find((s) => s.id === selected) ?? null : null;
  const selectedState = selected ? states.get(selected) : undefined;

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <div style={{ position: 'fixed', top: 12, left: 16, zIndex: 10, color: '#cdd5dd', fontSize: 13 }}>
        aisd Pipeline · {skills.length} 个流程 · 点击任意节点运行
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e2630" gap={24} />
        <Controls position="bottom-right" />
      </ReactFlow>

      <div className="legend">
        <div data-magic={STATUS_BLURBS.pending}><span className="dot pulse" style={{ background: STATUS_COLOR.pending }} /> 进行中</div>
        <div data-magic={STATUS_BLURBS.valid}><span className="dot" style={{ background: STATUS_COLOR.valid }} /> 完成</div>
        <div data-magic={STATUS_BLURBS.synthetic}><span className="dot" style={{ background: STATUS_COLOR.synthetic }} /> stub</div>
        <div data-magic={STATUS_BLURBS.invalid}><span className="dot" style={{ background: STATUS_COLOR.invalid }} /> 校验失败</div>
        <div data-magic={STATUS_BLURBS.missing}><span className="dot" style={{ background: STATUS_COLOR.missing }} /> 未运行</div>
      </div>

      {selectedSkill && (
        <SkillDrawer
          skill={selectedSkill}
          state={selectedState}
          onStart={() => markPending(selectedSkill.id, true)}
          onFinish={() => {
            markPending(selectedSkill.id, false);
            void reload();
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function SkillDrawer({
  skill,
  state,
  onClose,
  onStart,
  onFinish,
}: {
  skill: SkillSummary;
  state: SkillState | undefined;
  onClose: () => void;
  onStart: () => void;
  onFinish: () => void;
}) {
  const [brief, setBrief] = useState('');
  const [autoStub, setAutoStub] = useState(true);
  const [running, setRunning] = useState(false);
  const [pf, setPf] = useState<PreflightReport | null>(null);
  const [events, setEvents] = useState<Array<{ type: string; payload: unknown }>>([]);
  const [liveOutput, setLiveOutput] = useState<unknown>(null);
  const [savedOutput, setSavedOutput] = useState<SkillOutput | null>(null);

  useEffect(() => {
    setEvents([]);
    setPf(null);
    setLiveOutput(null);
    setSavedOutput(null);
    void fetchPreflight(skill.id).then(setPf);
    void fetchSkillOutput(skill.id).then((o) => setSavedOutput(o));
  }, [skill.id]);

  const onRun = async () => {
    setRunning(true);
    setEvents([]);
    setLiveOutput(null);
    onStart();
    try {
      await streamRun(
        skill.id,
        { project_brief: brief || undefined, auto_stub_upstream: autoStub },
        (e: RunEvent) => {
          setEvents((prev) => [...prev, { type: e.type, payload: e.payload }]);
          if (e.type === 'partial_output') {
            setLiveOutput((e.payload as { data: unknown }).data);
          }
        },
      );
    } catch (e) {
      setEvents((prev) => [...prev, { type: 'error', payload: { message: (e as Error).message } }]);
    } finally {
      setRunning(false);
      onFinish();
      const fresh = await fetchSkillOutput(skill.id).catch(() => null);
      setSavedOutput(fresh);
    }
  };

  const previewData = liveOutput ?? savedOutput?.data ?? null;
  const hasAnyOutput = previewData !== null && previewData !== undefined;

  return (
    <div className="drawer">
      <button className="close" onClick={onClose}>×</button>
      <h2>{displayName(skill)}</h2>
      <div className="meta">{skill.full_name} · {skill.tier} · {skill.module_count} modules</div>
      <div style={{ fontSize: 13, color: '#cdd5dd' }}>{skill.description}</div>

      <label>Upstream readiness</label>
      {pf ? (
        <div>
          {pf.upstreamRequired.length === 0 && <div className="upstream">no upstream</div>}
          {pf.upstreamRequired.map((u) => (
            <div key={u.id} className="upstream">
              <strong>{u.id}</strong> · {u.exists ? (u.valid ? '✓ valid' : '⚠ invalid') : '— missing'}
              {u.synthetic && <span style={{ color: '#d8a93a' }}> · synthetic</span>}
              {u.error && <div style={{ color: '#ff7676', marginTop: 2 }}>{u.error}</div>}
            </div>
          ))}
          {!pf.ready && (
            <div style={{ color: '#ffaa55', fontSize: 12, marginTop: 6 }}>
              {pf.blockers.join('; ')}
            </div>
          )}
        </div>
      ) : (
        <div className="upstream">loading…</div>
      )}

      <label>Project brief (optional)</label>
      <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. designer dog collars sized for every dog" />

      <div
        className="row"
        data-magic="如果上游 skill 还没跑，自动塞占位假数据继续跑这一步；用于单独验证某一步，不会污染最终产物"
      >
        <input type="checkbox" id="autoStub" checked={autoStub} onChange={(e) => setAutoStub(e.target.checked)} />
        <label htmlFor="autoStub" style={{ margin: 0 }}>Auto-stub missing upstream</label>
      </div>

      <button
        disabled={running}
        onClick={onRun}
        data-magic="跑这一步 skill：实时把进度推到下方 events 里，跑完产出 output.json"
      >
        {running ? 'Running…' : `Run ${skill.full_name}`}
      </button>

      {state?.exists && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#8b95a1' }}>
          Current output: {state.exists ? '✓' : '—'}
          {state.synthetic && ' · synthetic'} · last run {state.mtime?.replace('T', ' ').slice(0, 16)}
        </div>
      )}

      {(hasAnyOutput || running) && (
        <OutputPreview
          data={previewData}
          readonly={running}
          live={running && liveOutput !== null}
          lastUpdatedAt={!running ? savedOutput?.mtime ?? null : null}
          onSave={
            running
              ? undefined
              : async (next) => {
                  const r = await updateSkillOutput(skill.id, next);
                  if (r.ok) {
                    const fresh = await fetchSkillOutput(skill.id).catch(() => null);
                    setSavedOutput(fresh);
                  }
                  return r;
                }
          }
        />
      )}

      {events.length > 0 && (
        <div className="events">
          {events.map((e, i) => (
            <div key={i} className={`e-${e.type}`}>
              <strong>[{e.type}]</strong> {summarize(e.type, e.payload)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function summarize(type: string, payload: unknown): string {
  const p = payload as Record<string, unknown>;
  switch (type) {
    case 'start':
      return `skill=${p.skillId} turnCap=${p.turnCap}`;
    case 'preflight':
      return p.ready ? 'ready' : `BLOCKED: ${(p.blockers as string[]).join('; ')}`;
    case 'stub':
      return `${p.skillId} ${(p as { ok: boolean }).ok ? '✓' : '✗'}${(p as { preExisted: boolean }).preExisted ? ' (preserved)' : ' (generated)'}`;
    case 'turn':
      return `t${p.index} finish=${p.finish ?? '—'} ${typeof p.text === 'string' ? p.text.slice(0, 80) : ''}`;
    case 'tool_call':
      return `${p.name}(${(p.arguments as string).slice(0, 80)}…)`;
    case 'tool_result':
      return `id=${(p.id as string).slice(0, 8)} ok=${p.ok}`;
    case 'validate':
      return p.ok ? '✓ schema OK' : `✗ ${(p.errors as Array<{ message: string }>).slice(0, 2).map((x) => x.message).join('; ')}`;
    case 'done':
    case 'result':
      return `ok=${p.ok} reason=${p.reason}`;
    case 'error':
      return String(p.message);
    default:
      return JSON.stringify(p).slice(0, 120);
  }
}
