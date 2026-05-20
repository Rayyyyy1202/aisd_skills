// ─── Skills (existing) ──────────────────────────────────────────────────

export interface SkillSummary {
  id: string;
  full_name: string;
  slug: string;
  tier: 'main' | 'side';
  description: string;
  argument_description: string | null;
  upstream_required: string[];
  upstream_optional: string[];
  schema_path: string | null;
  module_count: number;
  phase2_placeholder: boolean;
}

export interface SkillState {
  id: string;
  full_name: string;
  tier: 'main' | 'side';
  exists: boolean;
  valid: boolean;
  synthetic: boolean;
  mtime: string | null;
  error: string | null;
}

export interface PreflightReport {
  skillId: string;
  upstreamRequired: Array<{ id: string; exists: boolean; valid: boolean; synthetic: boolean; error: string | null }>;
  upstreamOptional: Array<{ id: string; exists: boolean; valid: boolean; synthetic: boolean; error: string | null }>;
  blockers: string[];
  ready: boolean;
}

export type RunEvent =
  | { type: 'start'; payload: { skillId: string; turnCap: number } }
  | { type: 'preflight'; payload: { ready: boolean; blockers: string[] } }
  | { type: 'stub'; payload: { skillId: string; ok: boolean; preExisted: boolean; path: string; error?: string } }
  | { type: 'turn'; payload: { index: number; text: string; finish: string | null } }
  | { type: 'tool_call'; payload: { id: string; name: string; arguments: string } }
  | { type: 'tool_result'; payload: { id: string; ok: boolean; summary: string } }
  | { type: 'partial_output'; payload: { skillId: string; data: unknown; bytes: number } }
  | { type: 'validate'; payload: { ok: boolean; errors: Array<{ path: string; message: string }> } }
  | { type: 'done'; payload: { ok: boolean; outputPath: string | null; reason: string } }
  | { type: 'result'; payload: { ok: boolean; outputPath: string | null; reason: string; turns: number } }
  | { type: 'error'; payload: { message: string } };

// ─── Projects ─────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  workspace: string;
  project_brief: string | null;
  created_at: string;
  archived_at: string | null;
}

// ─── Conversations + Messages ───────────────────────────────────────────

export interface Conversation {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  tool_call_id: string | null;
  tool_calls_json: string | null;
  attachments_json: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
}

export interface ConversationUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  assistant_turns: number;
}

export interface AttachmentMeta {
  id: string;
  conversation_id: string;
  message_id: string | null;
  kind: 'image' | 'file';
  mime: string;
  filename: string | null;
  bytes: number;
  created_at: string;
}

export interface TaskRow {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface MemoryRow {
  id: string;
  project_id: string;
  key: string;
  content: string;
  created_at: string;
  updated_at: string;
}

// ─── API integrations ───────────────────────────────────────────────────

export type IntegrationPriority = 'required' | 'recommended' | 'optional';

export interface IntegrationStatus {
  id: string;
  name: string;
  category: string;
  description: string;
  used_by_skills: string[];
  env_vars: string[];
  docs_url?: string;
  priority: IntegrationPriority;
  connected: boolean;
  detected_env_vars: string[];
}

export interface IntegrationsResponse {
  summary: { total: number; connected: number };
  integrations: IntegrationStatus[];
}

// ─── Approvals ──────────────────────────────────────────────────────────

export type ApprovalDecision = 'approved' | 'modified_rerun' | 'rejected';

export interface Approval {
  id: string;
  project_id: string;
  skill_id: string;
  conversation_id: string | null;
  decision: ApprovalDecision;
  output_snapshot: string | null;
  note: string | null;
  created_at: string;
}

export interface AwaitingApprovalPayload {
  skill_id: string;
  full_name: string;
  output_path: string;
  summary: string;
  data?: unknown;
}

// ─── Chat SSE events (orchestrator stream) ──────────────────────────────

export type ChatEvent =
  | { type: 'message_persisted'; payload: Message }
  | {
      type: 'assistant_message';
      payload: {
        id: string;
        content: string;
        tool_calls?: Array<{ id: string; name: string; arguments: string }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
    }
  | { type: 'tool_call'; payload: { id: string; name: string; arguments: string } }
  | { type: 'tool_result'; payload: { id: string; ok: boolean; summary: string; data?: unknown } }
  | { type: 'nested_run'; payload: { tool_call_id: string; event: RunEvent } }
  | { type: 'task_changed'; payload: { task: TaskRow; action: 'created' | 'updated' | 'deleted' } }
  | { type: 'memory_saved'; payload: { key: string } }
  | { type: 'conversation_renamed'; payload: { id: string; title: string } }
  | { type: 'awaiting_approval'; payload: AwaitingApprovalPayload }
  | { type: 'approval_recorded'; payload: { id: string; skill_id: string; decision: ApprovalDecision } }
  | { type: 'done'; payload: { turns: number } }
  | { type: 'error'; payload: { message: string } };

// (Build Plan / SiteSpec types removed — eec-specific subsystem deleted)

// ─── Model picker ───────────────────────────────────────────────────────

export interface ModelOption {
  id: string;
  label: string;
}

export const AVAILABLE_MODELS: readonly ModelOption[] = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
] as const;

export const DEFAULT_MODEL_ID: string = 'gpt-5.4';

const MODEL_STORAGE_KEY = 'aisd.model';

export function getStoredModel(): string {
  if (typeof window === 'undefined') return DEFAULT_MODEL_ID;
  try {
    const v = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (v && AVAILABLE_MODELS.some((m) => m.id === v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_MODEL_ID;
}

export function setStoredModel(id: string): void {
  if (typeof window === 'undefined') return;
  if (!AVAILABLE_MODELS.some((m) => m.id === id)) return;
  try {
    window.localStorage.setItem(MODEL_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

// ─── HTTP client ────────────────────────────────────────────────────────

const PROXY = '/api/proxy';

async function getJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${PROXY}${path}`, { cache: 'no-store', ...init });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

// skills
export const fetchSkills = (): Promise<SkillSummary[]> =>
  getJSON<{ skills: SkillSummary[] }>(`/skills`).then((j) => j.skills);

// integrations
export const fetchIntegrations = (): Promise<IntegrationsResponse> =>
  getJSON<IntegrationsResponse>(`/integrations`);

export const fetchWorkspaceState = (projectId?: string): Promise<SkillState[]> => {
  const url = projectId ? `/projects/${projectId}/workspace/state` : `/workspace/state`;
  return getJSON<{ states: SkillState[] }>(url).then((j) => j.states);
};

export const fetchPreflight = (id: string, projectId?: string): Promise<PreflightReport> => {
  const url = projectId ? `/projects/${projectId}/skills/${id}/preflight` : `/skills/${id}/preflight`;
  return getJSON<PreflightReport>(url);
};

export interface SkillOutput {
  skill_id: string;
  path: string;
  data: unknown;
  mtime?: string;
}

export const fetchSkillOutput = (skillId: string, projectId?: string): Promise<SkillOutput | null> => {
  const url = projectId ? `/projects/${projectId}/skills/${skillId}/output` : `/skills/${skillId}/output`;
  return fetch(`${PROXY}${url}`, { cache: 'no-store' }).then(async (r) => {
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return (await r.json()) as SkillOutput;
  });
};

export interface SkillOutputUpdateResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  mtime?: string;
  error?: string;
  errors?: Array<{ path: string; message: string }>;
}

export const updateSkillOutput = async (
  skillId: string,
  data: unknown,
  projectId?: string,
): Promise<SkillOutputUpdateResult> => {
  const url = projectId ? `/projects/${projectId}/skills/${skillId}/output` : `/skills/${skillId}/output`;
  const r = await fetch(`${PROXY}${url}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  const j = (await r.json().catch(() => ({}))) as SkillOutputUpdateResult;
  return { ...j, ok: r.ok && j.ok !== false };
};

// projects
export const fetchProjects = (): Promise<{ projects: Project[]; default_project_id: string | null }> =>
  getJSON(`/projects`);

export const createProject = (name: string, workspace?: string, project_brief?: string): Promise<Project> =>
  getJSON(`/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, ...(workspace ? { workspace } : {}), project_brief }),
  });

export const updateProject = (id: string, fields: Partial<Pick<Project, 'name' | 'workspace' | 'project_brief'>>): Promise<Project> =>
  getJSON(`/projects/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fields),
  });

export const deleteProject = (id: string): Promise<{ ok: true }> =>
  getJSON(`/projects/${id}`, { method: 'DELETE' });

// conversations
export const fetchConversations = (projectId: string): Promise<Conversation[]> =>
  getJSON<{ conversations: Conversation[] }>(`/projects/${projectId}/conversations`).then((j) => j.conversations);

export const createConversation = (projectId: string, title?: string): Promise<Conversation> =>
  getJSON(`/projects/${projectId}/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(title ? { title } : {}),
  });

export const renameConversation = (id: string, title: string): Promise<Conversation> =>
  getJSON(`/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });

export const archiveConversation = (id: string): Promise<{ ok: true }> =>
  getJSON(`/conversations/${id}`, { method: 'DELETE' });

export const fetchConversation = (id: string): Promise<Conversation> =>
  getJSON<{ conversation: Conversation; project?: Project } | Conversation>(`/conversations/${id}`).then((j) => {
    // server returns { conversation, project }; older shape returned a flat Conversation
    if (j && typeof j === 'object' && 'conversation' in j) return (j as { conversation: Conversation }).conversation;
    return j as Conversation;
  });

export const fetchMessages = (
  conversationId: string,
): Promise<{ messages: Message[]; attachments: AttachmentMeta[] }> =>
  getJSON(`/conversations/${conversationId}/messages`);

export const fetchConversationUsage = (conversationId: string): Promise<ConversationUsage> =>
  getJSON(`/conversations/${conversationId}/usage`);

// attachments
export const uploadAttachment = (
  conversationId: string,
  body: { kind: 'image' | 'file'; mime: string; filename?: string; data_base64: string },
): Promise<AttachmentMeta> =>
  getJSON(`/conversations/${conversationId}/attachments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const attachmentUrl = (id: string): string => `${PROXY}/attachments/${id}`;

// tasks
export const fetchTasks = (conversationId: string): Promise<TaskRow[]> =>
  getJSON<{ tasks: TaskRow[] }>(`/conversations/${conversationId}/tasks`).then((j) => j.tasks);

// memories
export const fetchMemories = (projectId: string, query?: string): Promise<MemoryRow[]> =>
  getJSON<{ memories: MemoryRow[] }>(
    `/projects/${projectId}/memories${query ? `?q=${encodeURIComponent(query)}` : ''}`,
  ).then((j) => j.memories);

export const saveMemory = (projectId: string, key: string, content: string): Promise<MemoryRow> =>
  getJSON(`/projects/${projectId}/memories`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, content }),
  });

export const deleteMemory = (id: string): Promise<{ ok: true }> =>
  getJSON(`/memories/${id}`, { method: 'DELETE' });

// ─── Asset library (skill 03) ───────────────────────────────────────────

export type AssetType = 'character' | 'scene' | 'prop' | 'style_ref';

export interface AssetVariant {
  variant_id: string;
  path: string;
  stage: string;
  qa_score?: { identity?: number; style?: number; tech?: number };
}

export interface AssetRecord {
  id: string;
  asset_type: AssetType;
  name: string;
  /** upstream id this asset was generated for (02 char/scene/prop id) */
  source_id?: string;
  master_path: string;
  variants?: AssetVariant[];
  negative_prompt?: string;
  notes?: string;
}

export interface AssetListResponse {
  assets: AssetRecord[];
  output_exists: boolean;
  output_path?: string;
  workspace: string;
  schema_path?: string | null;
}

export const fetchAssets = (projectId: string): Promise<AssetListResponse> =>
  getJSON(`/projects/${projectId}/assets`);

export const patchAsset = (
  projectId: string,
  assetId: string,
  patch: Partial<AssetRecord>,
): Promise<{ ok: true; asset: AssetRecord }> =>
  getJSON(`/projects/${projectId}/assets/${assetId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });

export interface UploadResult {
  ok: true;
  uploads_dir: string;
  saved: Array<{ name: string; rel_path: string; bytes: number }>;
  skipped: Array<{ name: string; reason: string }>;
  next_step_hint: string;
}

export async function uploadAssetFiles(projectId: string, files: File[]): Promise<UploadResult> {
  const fd = new FormData();
  for (const f of files) fd.append('files', f, f.name);
  const r = await fetch(`${PROXY}/projects/${projectId}/assets/upload`, {
    method: 'POST',
    body: fd,
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as UploadResult;
}

export function assetFileUrl(projectId: string, path: string): string {
  return `${PROXY}/projects/${projectId}/assets/file?path=${encodeURIComponent(path)}`;
}

// approvals
export const fetchApprovals = (projectId: string, skillId?: string): Promise<Approval[]> =>
  getJSON<{ approvals: Approval[] }>(
    `/projects/${projectId}/approvals${skillId ? `?skill_id=${encodeURIComponent(skillId)}` : ''}`,
  ).then((j) => j.approvals);

export const createApproval = (
  projectId: string,
  body: {
    skill_id: string;
    decision: ApprovalDecision;
    conversation_id?: string;
    note?: string;
    output_path?: string;
  },
): Promise<Approval> =>
  getJSON(`/projects/${projectId}/approvals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// ─── SSE streamers ──────────────────────────────────────────────────────

async function streamSSE(
  url: string,
  init: RequestInit,
  onEvent: (event: string, data: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { ...init, signal });
  if (!res.ok) {
    const err = new Error(`http_${res.status}`);
    (err as Error & { code: number }).code = res.status;
    throw err;
  }
  if (!res.body) throw new Error('no SSE body');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const lines = chunk.split('\n');
      let event = 'message';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      onEvent(event, data);
    }
  }
}

export async function streamRun(
  id: string,
  body: { project_brief?: string; auto_stub_upstream?: boolean; allow_missing_upstream?: boolean; model?: string },
  onEvent: (e: RunEvent) => void,
  projectId?: string,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${PROXY}${projectId ? `/projects/${projectId}/skills/${id}/run` : `/skills/${id}/run`}`;
  await streamSSE(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    (event, data) => {
      try {
        onEvent({ type: event as RunEvent['type'], payload: JSON.parse(data) } as RunEvent);
      } catch {
        /* skip */
      }
    },
    signal,
  );
}

export async function streamChat(
  conversationId: string,
  body: { content: string; attachment_ids?: string[]; model?: string },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await streamSSE(
    `${PROXY}/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    (event, data) => {
      try {
        onEvent({ type: event as ChatEvent['type'], payload: JSON.parse(data) } as ChatEvent);
      } catch {
        /* skip */
      }
    },
    signal,
  );
}

// Triggers the kickoff greeting on an empty conversation. Server returns 409 if
// the conversation already has any non-system message — callers can ignore that.
export async function streamGreet(
  conversationId: string,
  body: { model?: string },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await streamSSE(
    `${PROXY}/conversations/${conversationId}/greet`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    (event, data) => {
      try {
        onEvent({ type: event as ChatEvent['type'], payload: JSON.parse(data) } as ChatEvent);
      } catch {
        /* skip */
      }
    },
    signal,
  );
}
