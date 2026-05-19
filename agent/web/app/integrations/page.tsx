'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '../../components/Sidebar';
import {
  type IntegrationStatus,
  type IntegrationPriority,
  fetchIntegrations,
} from '../../lib/agent';
import { skillDisplayName } from '../../lib/skill-names';

const PRIORITY_LABEL: Record<IntegrationPriority, string> = {
  required: '必填',
  recommended: '推荐',
  optional: '可选',
};

export default function IntegrationsPage() {
  const [items, setItems] = useState<IntegrationStatus[]>([]);
  const [summary, setSummary] = useState<{ total: number; connected: number }>({ total: 0, connected: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchIntegrations()
      .then((r) => {
        setItems(r.integrations);
        setSummary(r.summary);
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const connected = useMemo(() => items.filter((i) => i.connected), [items]);
  const recommended = useMemo(
    () => items.filter((i) => !i.connected && i.priority !== 'optional'),
    [items],
  );
  const optional = useMemo(
    () => items.filter((i) => !i.connected && i.priority === 'optional'),
    [items],
  );

  return (
    <>
      <Sidebar />
      <main className="main">
        <div className="main-header">
          <div className="main-title">API 接口</div>
          <div className="main-meta">
            已接入 {summary.connected} / {summary.total}
          </div>
        </div>
        <div className="main-body" style={{ padding: '20px 28px 60px' }}>
          {loading && <div style={{ color: 'var(--fg-muted)' }}>加载中…</div>}
          {err && <div style={{ color: 'var(--status-err)' }}>加载失败：{err}</div>}

          {!loading && !err && (
            <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
              <Section
                title="已接入"
                subtitle="server 启动时检测到对应 env var"
                items={connected}
                emptyHint="还没有接入任何外部 API。在 agent/server/.env.local 里配置下方推荐的接口即可。"
              />
              <Section
                title="推荐接入"
                subtitle="跑 06 / 07a / 08 / 09 强烈建议接入"
                items={recommended}
                emptyHint="所有推荐接口都已接入。"
              />
              <Section
                title="可选 / Phase 2"
                subtitle="按业务需要再接"
                items={optional}
                emptyHint="—"
              />
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function Section({
  title,
  subtitle,
  items,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  items: IntegrationStatus[];
  emptyHint: string;
}) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
        <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{subtitle}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--fg-faint)', fontSize: 12 }}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div style={{ padding: '14px 16px', background: 'var(--bg-card)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--fg-muted)', fontSize: 13 }}>
          {emptyHint}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
          {items.map((it) => <IntegrationCard key={it.id} item={it} />)}
        </div>
      )}
    </section>
  );
}

function IntegrationCard({ item }: { item: IntegrationStatus }) {
  return (
    <div className={`integration-card ${item.connected ? 'is-connected' : ''}`}>
      <div className="integration-card-head">
        <div className="integration-card-title">
          <span className={`integration-dot ${item.connected ? 'on' : 'off'}`} />
          <span>{item.name}</span>
        </div>
        <span
          className={`integration-priority p-${item.priority}`}
          data-magic={
            item.priority === 'required'
              ? '必填：不接这个就没法用整套流程'
              : item.priority === 'recommended'
                ? '推荐：接了体验完整不少'
                : '可选：按需接，不影响主流程'
          }
        >
          {PRIORITY_LABEL[item.priority]}
        </span>
      </div>

      <div className="integration-meta">
        <span className="integration-category">{item.category}</span>
      </div>

      <p className="integration-desc">{item.description}</p>

      <div className="integration-skills">
        {item.used_by_skills.map((sid) => (
          <span key={sid} className="integration-skill-tag" title={`flow ${sid}`}>
            {skillDisplayName(sid)}
          </span>
        ))}
      </div>

      {item.env_vars.length > 0 && (
        <div className="integration-env">
          <div className="integration-env-label">环境变量</div>
          <div className="integration-env-vars">
            {item.env_vars.map((k) => {
              const isSet = item.detected_env_vars.includes(k);
              return (
                <code key={k} className={`integration-env-var ${isSet ? 'set' : 'missing'}`}>
                  {k}
                  <span className="integration-env-state">{isSet ? '✓' : '·'}</span>
                </code>
              );
            })}
          </div>
        </div>
      )}

      {item.docs_url && (
        <a
          className="integration-docs"
          href={item.docs_url}
          target="_blank"
          rel="noreferrer noopener"
        >
          文档 →
        </a>
      )}
    </div>
  );
}
