'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '../../../components/Sidebar';
import {
  type AssetRecord,
  type AssetType,
  assetFileUrl,
  fetchAssets,
  patchAsset,
  uploadAssetFiles,
} from '../../../lib/agent';

const TYPE_LABEL: Record<AssetType, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  style_ref: '风格参考',
};

const TYPE_FILTERS: Array<AssetType | 'all'> = ['all', 'character', 'scene', 'prop', 'style_ref'];

function isImagePath(p: string): boolean {
  return /\.(png|jpe?g|webp|avif|gif)$/i.test(p);
}

export default function AssetLibraryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [outputExists, setOutputExists] = useState(true);
  const [typeFilter, setTypeFilter] = useState<AssetType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAssets(projectId)
      .then((r) => {
        if (cancelled) return;
        setAssets(r.assets);
        setOutputExists(r.output_exists);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setAssets([]);
        setOutputExists(false);
        setError(`无法加载资产: ${e.message}`);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshTick]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (typeFilter !== 'all' && a.asset_type !== typeFilter) return false;
      if (q && !`${a.id} ${a.name} ${a.source_id ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assets, typeFilter, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of assets) c[a.asset_type] = (c[a.asset_type] ?? 0) + 1;
    return c;
  }, [assets]);

  const editing = editingId ? assets.find((a) => a.id === editingId) ?? null : null;

  const onSavePatch = async (id: string, patch: Partial<AssetRecord>) => {
    try {
      const r = await patchAsset(projectId, id, patch);
      setAssets((prev) => prev.map((a) => (a.id === id ? r.asset : a)));
      setEditingId(null);
    } catch (e) {
      setError(`保存失败: ${(e as Error).message}`);
    }
  };

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadStatus(`上传 ${files.length} 个文件中…`);
    try {
      const r = await uploadAssetFiles(projectId, Array.from(files));
      const skipped = r.skipped.length ? `（跳过 ${r.skipped.length}）` : '';
      setUploadStatus(`✓ 已存到 ${r.uploads_dir} — 共 ${r.saved.length} 个${skipped}。${r.next_step_hint}`);
    } catch (e) {
      setUploadStatus(`✗ 上传失败: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <Sidebar activeProjectId={projectId} />
      <main className="main">
        <div className="main-header">
          <div className="main-title">资产库（03 assets）</div>
          <div className="main-meta">
            {loading ? '加载中…' : `${assets.length} 个资产`}
            <button
              className="btn-ghost"
              onClick={() => setRefreshTick((t) => t + 1)}
              style={{ marginLeft: 8 }}
              data-magic="重新拉一次资产；agent 跑完 03 后点这个能立刻看到新产出"
            >
              ↻ 刷新
            </button>
          </div>
        </div>

        <div className="main-body" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="al-toolbar">
            <div className="al-toolbar-row">
              {TYPE_FILTERS.map((t) => (
                <button
                  key={t}
                  className={`al-chip ${typeFilter === t ? 'active' : ''}`}
                  onClick={() => setTypeFilter(t)}
                >
                  {t === 'all' ? '全部' : `${TYPE_LABEL[t]}${counts[t] ? ` ${counts[t]}` : ''}`}
                </button>
              ))}
              <input
                className="al-search"
                placeholder="搜 id / 名称 / 来源"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {error && <div className="al-error">{error}</div>}

          {loading ? (
            <div className="al-empty">加载中…</div>
          ) : !outputExists ? (
            <EmptyOutput onUpload={onUpload} uploadStatus={uploadStatus} />
          ) : (
            <div className="al-grid-wrap">
              <div className="al-grid">
                {filtered.length === 0 && <div className="al-empty">没有匹配的资产</div>}
                {filtered.map((a) => (
                  <AssetCard key={a.id} asset={a} projectId={projectId} onClick={() => setEditingId(a.id)} />
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
          projectId={projectId}
          onClose={() => setEditingId(null)}
          onSave={(patch) => onSavePatch(editing.id, patch)}
        />
      )}

      <style jsx global>{`
        .al-toolbar {
          padding: 12px 20px;
          background: var(--bg-card);
          border-bottom: 1px solid var(--border);
        }
        .al-toolbar-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .al-chip {
          padding: 4px 12px;
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
        .al-search {
          flex: 1;
          min-width: 180px;
          padding: 5px 10px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: white;
          font-size: 12px;
        }
        .al-error {
          margin: 10px 20px 0;
          padding: 8px 12px;
          border-radius: var(--radius-sm);
          background: rgba(200, 30, 30, 0.1);
          color: #b91c1c;
          font-size: 12px;
        }
        .al-grid-wrap {
          height: calc(100vh - 200px);
          overflow-y: auto;
          padding: 16px 20px 120px;
          position: relative;
        }
        .al-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
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
        .al-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .al-badge {
          position: absolute;
          top: 6px;
          right: 6px;
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 999px;
          font-weight: 600;
          background: rgba(0, 0, 0, 0.65);
          color: white;
        }
        .al-card-body {
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .al-card-name {
          font-size: 13px;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .al-card-id {
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: var(--fg-faint);
        }
        .al-card-meta {
          font-size: 11px;
          color: var(--fg-muted);
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
          width: min(520px, 92vw);
          background: var(--bg-card);
          border-left: 1px solid var(--border);
          z-index: 101;
          overflow-y: auto;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .al-drawer h3 {
          margin: 0;
          font-size: 16px;
        }
        .al-drawer .close {
          position: absolute;
          top: 14px;
          right: 16px;
          background: none;
          border: none;
          font-size: 22px;
          cursor: pointer;
          color: var(--fg-muted);
        }
        .al-master {
          width: 100%;
          border-radius: var(--radius-md);
          border: 1px solid var(--border);
          background: var(--bg-sidebar);
        }
        .al-variants {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
          gap: 8px;
        }
        .al-variant {
          aspect-ratio: 1 / 1;
          border-radius: var(--radius-sm);
          overflow: hidden;
          border: 1px solid var(--border);
          background: var(--bg-sidebar);
          position: relative;
        }
        .al-variant img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .al-variant span {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          font-size: 9px;
          padding: 2px 4px;
          background: rgba(0, 0, 0, 0.6);
          color: white;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .al-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .al-field label {
          font-size: 11px;
          color: var(--fg-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .al-field input,
        .al-field textarea {
          padding: 7px 10px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          font-size: 13px;
          background: white;
          font-family: inherit;
        }
        .al-dock {
          position: sticky;
          bottom: 16px;
          margin-top: 20px;
          padding: 12px 16px;
          background: var(--bg-card);
          border: 1px dashed var(--border-strong);
          border-radius: var(--radius-md);
          font-size: 12px;
          color: var(--fg-secondary);
        }
      `}</style>
    </>
  );
}

function AssetCard({
  asset,
  projectId,
  onClick,
}: {
  asset: AssetRecord;
  projectId: string;
  onClick: () => void;
}) {
  const showImage = asset.master_path && isImagePath(asset.master_path);
  const variantCount = asset.variants?.length ?? 0;
  return (
    <div className="al-card" onClick={onClick}>
      <div className="al-thumb">
        {showImage ? (
          <img src={assetFileUrl(projectId, asset.master_path)} alt={asset.name} loading="lazy" />
        ) : (
          <span>无预览</span>
        )}
        <span className="al-badge">{TYPE_LABEL[asset.asset_type] ?? asset.asset_type}</span>
      </div>
      <div className="al-card-body">
        <span className="al-card-name">{asset.name}</span>
        <span className="al-card-id">{asset.id}{asset.source_id ? ` ← ${asset.source_id}` : ''}</span>
        {variantCount > 0 && <span className="al-card-meta">{variantCount} 个变体</span>}
      </div>
    </div>
  );
}

function EditDrawer({
  asset,
  projectId,
  onClose,
  onSave,
}: {
  asset: AssetRecord;
  projectId: string;
  onClose: () => void;
  onSave: (patch: Partial<AssetRecord>) => void;
}) {
  const [name, setName] = useState(asset.name);
  const [notes, setNotes] = useState(asset.notes ?? '');
  const dirty = name !== asset.name || notes !== (asset.notes ?? '');

  return (
    <>
      <div className="al-drawer-backdrop" onClick={onClose} />
      <div className="al-drawer">
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h3>
          {asset.name}{' '}
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            {TYPE_LABEL[asset.asset_type] ?? asset.asset_type} · {asset.id}
          </span>
        </h3>

        {asset.master_path && isImagePath(asset.master_path) && (
          <img className="al-master" src={assetFileUrl(projectId, asset.master_path)} alt={asset.name} />
        )}

        {asset.variants && asset.variants.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>
              变体 ({asset.variants.length})
            </div>
            <div className="al-variants">
              {asset.variants.map((v) => (
                <div className="al-variant" key={v.variant_id}>
                  {isImagePath(v.path) ? (
                    <img src={assetFileUrl(projectId, v.path)} alt={v.stage} loading="lazy" />
                  ) : (
                    <span>{v.stage}</span>
                  )}
                  <span>{v.stage}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="al-field">
          <label>名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="al-field">
          <label>备注 / notes</label>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            disabled={!dirty}
            onClick={() => onSave({ name, notes })}
          >
            保存
          </button>
        </div>
      </div>
    </>
  );
}

function UploadDock({
  onUpload,
  status,
}: {
  onUpload: (files: FileList | null) => void;
  status: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="al-dock">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={(e) => onUpload(e.target.files)}
      />
      <button className="btn-ghost" onClick={() => inputRef.current?.click()}>
        ⬆ 上传参考图 / 素材
      </button>
      {status && <div style={{ marginTop: 8 }}>{status}</div>}
    </div>
  );
}

function EmptyOutput({
  onUpload,
  uploadStatus,
}: {
  onUpload: (files: FileList | null) => void;
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
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={(e) => onUpload(e.target.files)}
      />
      <button className="btn-ghost" onClick={() => inputRef.current?.click()} style={{ marginTop: 12 }}>
        ⬆ 上传参考图
      </button>
      {uploadStatus && <div style={{ marginTop: 10, fontSize: 12 }}>{uploadStatus}</div>}
    </div>
  );
}
