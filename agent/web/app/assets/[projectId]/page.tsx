'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '../../../components/Sidebar';
import {
  type AssetRecord,
  type AssetSource,
  assetFileUrl,
  fetchAssets,
  patchAsset,
  uploadAssetFiles,
} from '../../../lib/agent';

const PROXY = '/api/proxy';

type SkuLite = { id: string; name: string };
type AudienceLite = { id: string; name?: string; persona_name?: string };

interface FilterState {
  source: AssetSource | 'all';
  pendingOnly: boolean;
  purpose: string | 'all';
  channel: string | 'all';
  sku: string | 'all';
  q: string;
}

const DEFAULT_FILTER: FilterState = {
  source: 'all',
  pendingOnly: false,
  purpose: 'all',
  channel: 'all',
  sku: 'all',
  q: '',
};

const PURPOSES = ['hero', 'product', 'lifestyle', 'ad', 'email', 'social', 'seo', 'testimonial', 'ugc'] as const;
const CHANNELS = ['meta', 'tiktok', 'google', 'youtube', 'email', 'web', 'pinterest', 'x', 'any'] as const;
const SOURCES: AssetSource[] = ['ai_generated', 'user_uploaded', 'shot', 'stock'];

export default function AssetLibraryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [outputExists, setOutputExists] = useState(true);
  const [skus, setSkus] = useState<SkuLite[]>([]);
  const [audiences, setAudiences] = useState<AudienceLite[]>([]);
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  // Load assets
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAssets(projectId)
      .then((r) => {
        if (cancelled) return;
        setAssets(r.assets);
        setOutputExists(r.output_exists);
      })
      .catch(() => {
        if (cancelled) return;
        setAssets([]);
        setOutputExists(false);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshTick]);

  // Load skus + audiences from upstream skills
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${PROXY}/projects/${projectId}/skills/02/output`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${PROXY}/projects/${projectId}/skills/01/output`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([s02, s01]) => {
      if (cancelled) return;
      const skuList = (s02?.data?.skus ?? []) as SkuLite[];
      const audList = (s01?.data?.audience_profiles ?? []) as AudienceLite[];
      setSkus(skuList);
      setAudiences(audList);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const filtered = useMemo(() => filterAssets(assets, filter), [assets, filter]);
  const pendingCount = useMemo(() => assets.filter((a) => a.auto_tagged).length, [assets]);
  const editing = editingId ? assets.find((a) => a.id === editingId) ?? null : null;

  const onSavePatch = async (id: string, patch: Partial<AssetRecord>) => {
    const r = await patchAsset(projectId, id, patch);
    setAssets((prev) => prev.map((a) => (a.id === id ? r.asset : a)));
  };

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadStatus(`uploading ${files.length} file${files.length === 1 ? '' : 's'}…`);
    try {
      const r = await uploadAssetFiles(projectId, Array.from(files));
      const skipped = r.skipped.length ? ` (跳过 ${r.skipped.length})` : '';
      setUploadStatus(
        `✓ 已存到 ${r.uploads_dir} — 共 ${r.saved.length} 个${skipped}。下一步：在对话里 \`run 04 --existing-dir=${r.uploads_dir}\` 让 AI 标注，或写 manifest 后 \`--existing-manifest=<path>\`。`,
      );
    } catch (e) {
      setUploadStatus(`✗ 上传失败: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <Sidebar activeProjectId={projectId} />
      <main className="main">
        <div className="main-header">
          <div className="main-title">素材库</div>
          <div className="main-meta">
            {loading ? '加载中…' : `${assets.length} assets`}
            {pendingCount > 0 && (
              <button
                className="al-pending-badge"
                onClick={() => setFilter({ ...DEFAULT_FILTER, pendingOnly: true })}
                title="筛出 AI 推荐待复核"
                data-magic="一键筛出 AI 自动打标但还没人工确认的素材；过完要点每条的「确认 AI 标注」"
              >
                ⚠️ 待复核 {pendingCount}
              </button>
            )}
            <button
              className="btn-ghost"
              onClick={() => setRefreshTick((t) => t + 1)}
              style={{ marginLeft: 8 }}
              data-magic="重新拉一次素材；agent 跑完 04 后点这个能立刻看到新产出"
            >
              ↻ 刷新
            </button>
          </div>
        </div>

        <div className="main-body" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="al-toolbar">
            <ChipRow
              label="source"
              options={['all', ...SOURCES]}
              value={filter.source}
              onChange={(v) => setFilter({ ...filter, source: v as FilterState['source'] })}
              renderLabel={(v) => (v === 'all' ? '全部' : SOURCE_LABEL[v as AssetSource])}
            />
            <ChipRow
              label="purpose"
              options={['all', ...PURPOSES]}
              value={filter.purpose}
              onChange={(v) => setFilter({ ...filter, purpose: v })}
            />
            <ChipRow
              label="channel"
              options={['all', ...CHANNELS]}
              value={filter.channel}
              onChange={(v) => setFilter({ ...filter, channel: v })}
            />
            <div className="al-toolbar-row">
              <label className="al-label">sku</label>
              <select value={filter.sku} onChange={(e) => setFilter({ ...filter, sku: e.target.value })}>
                <option value="all">全部</option>
                {skus.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} · {s.name}
                  </option>
                ))}
              </select>
              <input
                className="al-search"
                placeholder="搜 alt_text / id"
                value={filter.q}
                onChange={(e) => setFilter({ ...filter, q: e.target.value })}
              />
              <label
                className="al-toggle"
                data-magic="只显示 AI 推荐、还没人工确认的素材；适合一次性快速过完所有待复核"
              >
                <input
                  type="checkbox"
                  checked={filter.pendingOnly}
                  onChange={(e) => setFilter({ ...filter, pendingOnly: e.target.checked })}
                />
                只看待复核
              </label>
              <button className="btn-ghost" onClick={() => setFilter(DEFAULT_FILTER)}>
                清除筛选
              </button>
            </div>
          </div>

          {loading ? (
            <div className="al-empty">加载中…</div>
          ) : !outputExists ? (
            <EmptyOutput onUpload={onUpload} uploadStatus={uploadStatus} />
          ) : (
            <div className="al-grid-wrap">
              <div className="al-grid">
                {filtered.length === 0 && <div className="al-empty">没有匹配的素材</div>}
                {filtered.map((a) => (
                  <AssetCard
                    key={a.id}
                    asset={a}
                    projectId={projectId}
                    sku={skus.find((s) => s.id === a.sku_id) ?? null}
                    onClick={() => setEditingId(a.id)}
                  />
                ))}
              </div>
              <UploadDock onUpload={onUpload} status={uploadStatus} />
            </div>
          )}
        </div>
      </main>

      {editing && (
        <EditDrawer
          key={editing.id}
          asset={editing}
          skus={skus}
          audiences={audiences}
          projectId={projectId}
          onClose={() => setEditingId(null)}
          onSave={async (patch) => {
            await onSavePatch(editing.id, patch);
            setEditingId(null);
          }}
        />
      )}

      <style jsx global>{`
        .al-toolbar {
          padding: 12px 20px;
          background: var(--bg-card);
          border-bottom: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .al-toolbar-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .al-label {
          font-size: 11px;
          color: var(--fg-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin-right: 4px;
          min-width: 56px;
        }
        .al-chip {
          padding: 4px 10px;
          border-radius: 999px;
          background: var(--bg-sidebar);
          color: var(--fg-secondary);
          font-size: 12px;
          border: 1px solid transparent;
          cursor: pointer;
        }
        .al-chip.active {
          background: var(--bg-active);
          color: var(--primary);
          border-color: var(--primary);
        }
        .al-toolbar select,
        .al-toolbar input[type='text'],
        .al-search {
          padding: 5px 10px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: white;
          font-size: 12px;
        }
        .al-search {
          flex: 1;
          min-width: 160px;
        }
        .al-toggle {
          font-size: 12px;
          color: var(--fg-secondary);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .al-pending-badge {
          padding: 3px 10px;
          margin-left: 12px;
          border-radius: 999px;
          background: rgba(245, 158, 11, 0.15);
          color: #92400e;
          font-size: 11px;
          font-weight: 600;
          border: 1px solid rgba(245, 158, 11, 0.4);
        }
        .al-grid-wrap {
          height: calc(100vh - 240px);
          overflow-y: auto;
          padding: 16px 20px 120px;
          position: relative;
        }
        .al-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 14px;
        }
        .al-empty {
          padding: 60px 20px;
          text-align: center;
          color: var(--fg-muted);
        }
        .al-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          overflow: hidden;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          transition: box-shadow 0.15s, border-color 0.15s;
        }
        .al-card:hover {
          box-shadow: var(--shadow-md);
          border-color: var(--border-strong);
        }
        .al-card.pending {
          border-color: rgba(245, 158, 11, 0.6);
          box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.15);
        }
        .al-thumb {
          aspect-ratio: 1 / 1;
          background: var(--bg-sidebar);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--fg-faint);
          font-size: 12px;
          position: relative;
          overflow: hidden;
        }
        .al-thumb img,
        .al-thumb video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .al-badge {
          position: absolute;
          top: 6px;
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 999px;
          font-weight: 600;
        }
        .al-badge.source {
          right: 6px;
          background: rgba(0, 0, 0, 0.65);
          color: white;
        }
        .al-badge.pending {
          left: 6px;
          background: rgba(245, 158, 11, 0.95);
          color: white;
        }
        .al-badge.approved {
          left: 6px;
          background: var(--status-ok);
          color: white;
        }
        .al-card-body {
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .al-card-id {
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: var(--fg-faint);
        }
        .al-card-tags {
          font-size: 11.5px;
          color: var(--fg-secondary);
        }
        .al-card-sku {
          font-size: 11px;
          color: var(--fg-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .al-drawer-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(17, 24, 39, 0.4);
          z-index: 100;
        }
        .al-drawer {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: min(480px, 90vw);
          background: var(--bg-card);
          border-left: 1px solid var(--border);
          z-index: 101;
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-lg);
        }
        .al-drawer-head {
          padding: 14px 18px;
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .al-drawer-body {
          padding: 14px 18px;
          overflow-y: auto;
          flex: 1;
        }
        .al-drawer-foot {
          padding: 12px 18px;
          border-top: 1px solid var(--border);
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
        .al-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 12px;
        }
        .al-field label {
          font-size: 11px;
          color: var(--fg-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .al-field input,
        .al-field select,
        .al-field textarea {
          padding: 6px 10px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: white;
          font-size: 13px;
        }
        .al-field textarea {
          resize: vertical;
          min-height: 60px;
        }
        .al-aud-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 6px 10px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          max-height: 160px;
          overflow-y: auto;
          background: white;
        }
        .al-aud-item {
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .al-upload-dock {
          position: fixed;
          bottom: 16px;
          left: 296px;
          right: 16px;
          background: var(--bg-card);
          border: 2px dashed var(--border-strong);
          border-radius: var(--radius-md);
          padding: 14px 18px;
          z-index: 50;
          box-shadow: var(--shadow-md);
        }
        @media (max-width: 1100px) {
          .al-upload-dock { left: 256px; }
        }
        .al-upload-dock.dragging {
          border-color: var(--primary);
          background: var(--bg-active);
        }
        .al-upload-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .al-upload-text {
          font-size: 13px;
          color: var(--fg-secondary);
        }
        .al-upload-status {
          margin-top: 8px;
          font-size: 12px;
          color: var(--fg-muted);
        }
      `}</style>
    </>
  );
}

const SOURCE_LABEL: Record<AssetSource, string> = {
  ai_generated: '🤖 AI 生成',
  user_uploaded: '👤 用户上传',
  shot: '📷 实拍',
  stock: '📦 图库',
};

function ChipRow({
  label,
  options,
  value,
  onChange,
  renderLabel,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  renderLabel?: (v: string) => string;
}) {
  return (
    <div className="al-toolbar-row">
      <label className="al-label">{label}</label>
      {options.map((o) => (
        <button
          key={o}
          className={`al-chip ${value === o ? 'active' : ''}`}
          onClick={() => onChange(o)}
        >
          {renderLabel ? renderLabel(o) : o === 'all' ? '全部' : o}
        </button>
      ))}
    </div>
  );
}

function AssetCard({
  asset,
  projectId,
  sku,
  onClick,
}: {
  asset: AssetRecord;
  projectId: string;
  sku: SkuLite | null;
  onClick: () => void;
}) {
  const isPending = asset.auto_tagged === true;
  const isApproved = asset.status === 'approved';
  const src = asset.delivered_file_path
    ? assetFileUrl(projectId, asset.delivered_file_path)
    : asset.file_path
      ? assetFileUrl(projectId, asset.file_path)
      : null;
  return (
    <div className={`al-card ${isPending ? 'pending' : ''}`} onClick={onClick}>
      <div className="al-thumb">
        {src && asset.type === 'image' && <img src={src} alt={asset.alt_text ?? asset.id} loading="lazy" />}
        {src && asset.type === 'video' && <video src={src} muted preload="metadata" />}
        {!src && (asset.status === 'brief' || asset.status === 'stub') && <span>📝 brief only</span>}
        {!src && asset.type === 'copy' && <span>✏️ copy</span>}
        {asset.source && (
          <span className="al-badge source">{SOURCE_LABEL[asset.source]}</span>
        )}
        {isPending && <span className="al-badge pending">待复核</span>}
        {!isPending && isApproved && <span className="al-badge approved">✓</span>}
      </div>
      <div className="al-card-body">
        <div className="al-card-id">{asset.id}</div>
        <div className="al-card-tags">
          {asset.purpose} · {asset.channel} · {asset.language}
          {asset.format ? ` · ${asset.format}` : ''}
        </div>
        <div className="al-card-sku">{sku ? `${sku.id} ${sku.name}` : 'project-level'}</div>
      </div>
    </div>
  );
}

function EmptyOutput({
  onUpload,
  uploadStatus,
}: {
  onUpload: (f: FileList | null) => void;
  uploadStatus: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="al-empty">
      <div style={{ fontSize: 16, marginBottom: 8 }}>这个项目还没有 03 资产产出</div>
      <p style={{ color: 'var(--fg-muted)' }}>
        在对话里跑一次 <code>03 资产</code>（角色 / 场景 / 道具 + Style Bible），或先把参考图丢进来。
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => onUpload(e.target.files)}
      />
      <button
        className="btn-primary"
        style={{ marginTop: 12 }}
        onClick={() => inputRef.current?.click()}
        data-magic="上传图/视频；之后到对话里跑 04 --existing-dir=... 让 agent 自动打 purpose / channel / sku 标"
      >
        + 上传素材
      </button>
      {uploadStatus && <div className="al-upload-status">{uploadStatus}</div>}
    </div>
  );
}

function UploadDock({
  onUpload,
  status,
}: {
  onUpload: (f: FileList | null) => void;
  status: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`al-upload-dock ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onUpload(e.dataTransfer.files);
      }}
    >
      <div className="al-upload-row">
        <div className="al-upload-text">
          📁 把图片/视频拖进来，或者
          <button
            className="btn-ghost"
            style={{ marginLeft: 6, padding: '2px 8px' }}
            onClick={() => inputRef.current?.click()}
          >
            选择文件
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
          上传后到对话里跑 <code>04 --existing-dir=...</code> 让 AI 自动标注
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={(e) => onUpload(e.target.files)}
      />
      {status && <div className="al-upload-status">{status}</div>}
    </div>
  );
}

function EditDrawer({
  asset,
  skus,
  audiences,
  projectId,
  onClose,
  onSave,
}: {
  asset: AssetRecord;
  skus: SkuLite[];
  audiences: AudienceLite[];
  projectId: string;
  onClose: () => void;
  onSave: (patch: Partial<AssetRecord>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<AssetRecord>>({
    sku_id: asset.sku_id ?? '',
    audience_ids: asset.audience_ids ?? [],
    purpose: asset.purpose,
    channel: asset.channel,
    language: asset.language,
    alt_text: asset.alt_text ?? '',
    status: asset.status,
    auto_tagged: asset.auto_tagged ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const src = asset.delivered_file_path
    ? assetFileUrl(projectId, asset.delivered_file_path)
    : asset.file_path
      ? assetFileUrl(projectId, asset.file_path)
      : null;

  const submit = async (extra: Partial<AssetRecord> = {}) => {
    setBusy(true);
    setErr(null);
    try {
      const patch: Partial<AssetRecord> = { ...draft, ...extra };
      // empty string sku → leave null (field will not be patched)
      if (!patch.sku_id) delete patch.sku_id;
      await onSave(patch);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="al-drawer-backdrop" onClick={onClose} />
      <div className="al-drawer">
        <div className="al-drawer-head">
          <div>
            <div style={{ fontWeight: 600 }}>{asset.id}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
              {asset.delivered_file_path ?? asset.file_path ?? '(no file)'}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            ×
          </button>
        </div>
        <div className="al-drawer-body">
          {src && asset.type === 'image' && (
            <img
              src={src}
              alt={asset.alt_text ?? asset.id}
              style={{ width: '100%', borderRadius: 6, marginBottom: 12 }}
            />
          )}
          {asset.auto_tagged && (
            <div
              style={{
                padding: '8px 10px',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                borderRadius: 6,
                marginBottom: 12,
                fontSize: 12,
                color: '#92400e',
              }}
            >
              ⚠️ 这条标注是 AI 推荐的，请快速过一遍 → 「确认 AI 标注」
            </div>
          )}

          <div className="al-field">
            <label>SKU</label>
            <select
              value={draft.sku_id ?? ''}
              onChange={(e) => setDraft({ ...draft, sku_id: e.target.value })}
            >
              <option value="">project-level (none)</option>
              {skus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} · {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="al-field">
            <label>Audiences</label>
            <div className="al-aud-list">
              {audiences.length === 0 && <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>(01 没有 audience_profiles)</div>}
              {audiences.map((a) => {
                const checked = (draft.audience_ids ?? []).includes(a.id);
                return (
                  <label key={a.id} className="al-aud-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(draft.audience_ids ?? []);
                        if (e.target.checked) next.add(a.id);
                        else next.delete(a.id);
                        setDraft({ ...draft, audience_ids: [...next] });
                      }}
                    />
                    {a.id} {a.name ?? a.persona_name ?? ''}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="al-field">
            <label>Purpose</label>
            <select value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}>
              {PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="al-field">
            <label>Channel</label>
            <select value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value })}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="al-field">
            <label>Language</label>
            <input
              type="text"
              value={draft.language ?? ''}
              onChange={(e) => setDraft({ ...draft, language: e.target.value })}
              placeholder="en / zh / ja..."
            />
          </div>

          <div className="al-field">
            <label>Alt text</label>
            <textarea
              value={draft.alt_text ?? ''}
              onChange={(e) => setDraft({ ...draft, alt_text: e.target.value })}
              rows={3}
            />
          </div>

          <div className="al-field">
            <label>Status</label>
            <select
              value={draft.status ?? 'brief'}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as AssetRecord['status'] })}
            >
              {(['brief', 'stub', 'shot', 'retouched', 'approved'] as const).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {err && <div style={{ color: 'var(--status-err)', fontSize: 12 }}>✗ {err}</div>}
        </div>
        <div className="al-drawer-foot">
          {asset.auto_tagged && (
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() => submit({ auto_tagged: false })}
              data-magic="确认这条 AI 推荐标注 OK；标完它就从「待复核」消失，变成正式标注"
            >
              确认 AI 标注
            </button>
          )}
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn-primary" onClick={() => submit()} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </>
  );
}

function filterAssets(assets: AssetRecord[], f: FilterState): AssetRecord[] {
  return assets.filter((a) => {
    if (f.source !== 'all' && a.source !== f.source) return false;
    if (f.pendingOnly && !a.auto_tagged) return false;
    if (f.purpose !== 'all' && a.purpose !== f.purpose) return false;
    if (f.channel !== 'all' && a.channel !== f.channel) return false;
    if (f.sku !== 'all' && a.sku_id !== f.sku) return false;
    if (f.q.trim()) {
      const q = f.q.toLowerCase();
      const hay = `${a.id} ${a.alt_text ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
