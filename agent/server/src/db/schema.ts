import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  workspace                TEXT NOT NULL,           -- absolute path to <workspace>/aisd/
  project_brief              TEXT,                    -- default brief reused across conversations
  project_profile            TEXT,                    -- L3 distilled long-term knowledge (auto-injected into system prompts)
  project_profile_updated_at TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at              TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT 'New conversation',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_conv_project ON conversations(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,        -- 'user' | 'assistant' | 'tool' | 'system'
  content           TEXT NOT NULL DEFAULT '',
  tool_call_id      TEXT,                 -- set for role=tool messages
  tool_calls_json   TEXT,                 -- JSON of OpenAI tool_calls when assistant requests them
  attachments_json  TEXT,                 -- JSON array of attachment refs (id list)
  prompt_tokens     INTEGER,              -- usage.prompt_tokens from the OpenAI response (assistant messages only)
  completion_tokens INTEGER,              -- usage.completion_tokens from the OpenAI response
  total_tokens      INTEGER,              -- usage.total_tokens; convenience denormalization
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS attachments (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      TEXT REFERENCES messages(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,        -- 'image' | 'file'
  mime            TEXT NOT NULL,
  filename        TEXT,
  data_base64     TEXT NOT NULL,         -- inlined for MVP (cap 4MB at API)
  bytes           INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_att_conv ON attachments(conversation_id);

CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_id       TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | in_progress | completed | cancelled
  notes           TEXT,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_task_conv ON tasks(conversation_id, position);
CREATE INDEX IF NOT EXISTS idx_task_parent ON tasks(parent_id);

CREATE TABLE IF NOT EXISTS memories (
  id            TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  content       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(project_id, key)
);
CREATE INDEX IF NOT EXISTS idx_mem_project ON memories(project_id);

CREATE TABLE IF NOT EXISTS approvals (
  id              TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  skill_id        TEXT NOT NULL,                    -- '01', '02', ...
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  decision        TEXT NOT NULL,                    -- 'approved' | 'modified_rerun' | 'rejected'
  output_snapshot TEXT,                             -- inline copy of output.json at approval time (so later modifications can be diffed)
  note            TEXT,                             -- free-text comment / modification request
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_approvals_project_skill ON approvals(project_id, skill_id, created_at DESC);
`;

let _db: DB | null = null;

export function openDatabase(path: string): DB {
  if (_db) return _db;
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  // Idempotent ALTERs for columns added after the initial schema. SQLite has no
  // ADD COLUMN IF NOT EXISTS, so swallow "duplicate column" errors.
  for (const sql of [
    `ALTER TABLE projects ADD COLUMN project_profile TEXT`,
    `ALTER TABLE projects ADD COLUMN project_profile_updated_at TEXT`,
    `ALTER TABLE messages ADD COLUMN prompt_tokens INTEGER`,
    `ALTER TABLE messages ADD COLUMN completion_tokens INTEGER`,
    `ALTER TABLE messages ADD COLUMN total_tokens INTEGER`,
  ]) {
    try { db.exec(sql); } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/duplicate column/i.test(msg)) throw e;
    }
  }
  _db = db;
  return db;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
