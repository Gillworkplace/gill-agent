CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY, username VARCHAR(32) UNIQUE NOT NULL,
  password_hash VARCHAR(100) NOT NULL, role VARCHAR(8) NOT NULL DEFAULT 'USER',
  status VARCHAR(8) NOT NULL DEFAULT 'ACTIVE',
  custom_instructions VARCHAR(2000),
  storage_quota_bytes BIGINT NOT NULL DEFAULT 5368709120,
  token_quota_daily BIGINT NOT NULL DEFAULT 2000000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_login_at TIMESTAMPTZ);

CREATE TABLE spaces (
  id UUID PRIMARY KEY, type VARCHAR(8) NOT NULL,          -- personal|group
  name VARCHAR(64) NOT NULL, owner_user_id BIGINT NOT NULL REFERENCES users(id),
  default_approval VARCHAR(8) NOT NULL DEFAULT 'auto',
  default_op_mode VARCHAR(8) NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), dissolved_at TIMESTAMPTZ);

CREATE TABLE space_members (
  space_id UUID REFERENCES spaces(id), user_id BIGINT REFERENCES users(id),
  role VARCHAR(8) NOT NULL DEFAULT 'member', joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id));

CREATE TABLE invites (
  id UUID PRIMARY KEY, space_id UUID NOT NULL REFERENCES spaces(id),
  token VARCHAR(32) UNIQUE NOT NULL, created_by BIGINT NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL, revoked BOOLEAN NOT NULL DEFAULT false,
  accepted_by BIGINT REFERENCES users(id));

CREATE TABLE space_chat (
  id BIGSERIAL PRIMARY KEY, space_id UUID NOT NULL REFERENCES spaces(id),
  user_id BIGINT NOT NULL REFERENCES users(id), content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON space_chat (space_id, created_at DESC);

CREATE TABLE pats (
  id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
  name VARCHAR(64) NOT NULL, token_hash VARCHAR(64) UNIQUE NOT NULL,  -- sha256(gpat_...)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT false);

CREATE TABLE sessions (
  id UUID PRIMARY KEY, space_id UUID NOT NULL REFERENCES spaces(id),
  user_id BIGINT NOT NULL REFERENCES users(id),           -- 创建者
  title VARCHAR(50), project_tag VARCHAR(50),
  status VARCHAR(12) NOT NULL DEFAULT 'created',          -- created|sandbox_creating|active|idle|closing|closed|error|interrupted|archived
  sandbox_id VARCHAR(64), node_owner VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ);
CREATE INDEX ON sessions (space_id, status);

CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY, session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INT NOT NULL, role VARCHAR(12) NOT NULL,            -- user|assistant|tool|system|handoff
  content TEXT, actor_user_id BIGINT REFERENCES users(id),
  tool_name VARCHAR(48), tool_args JSONB, tool_result JSONB,
  trace_id VARCHAR(32), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq));

CREATE TABLE command_audit (
  id BIGSERIAL PRIMARY KEY, session_id UUID REFERENCES sessions(id),
  space_id UUID, user_id BIGINT NOT NULL,                 -- actor
  sandbox_id VARCHAR(64), command TEXT NOT NULL,
  risk_level VARCHAR(8), rule_id VARCHAR(8),
  decision VARCHAR(12), decision_by BIGINT,
  exit_code INT, duration_ms INT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON command_audit (space_id, created_at DESC);

CREATE TABLE file_objects (
  id UUID PRIMARY KEY, space_id UUID NOT NULL REFERENCES spaces(id),
  user_id BIGINT NOT NULL, session_id UUID,
  direction VARCHAR(8) NOT NULL,                          -- upload|export
  object_key TEXT NOT NULL, filename VARCHAR(255) NOT NULL,
  size_bytes BIGINT NOT NULL, status VARCHAR(10) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expired_at TIMESTAMPTZ);
CREATE INDEX ON file_objects (space_id, created_at DESC);

CREATE TABLE knowledge_items (
  id UUID PRIMARY KEY, user_id BIGINT NOT NULL,           -- 创建者
  space_id UUID,                                          -- scope=user 时=个人空间id；group=协作空间id
  scope VARCHAR(8) NOT NULL,                              -- session|project|group|user
  project_tag VARCHAR(50), session_id UUID,
  type VARCHAR(12) NOT NULL,                              -- preference|fact|correction|project|snippet
  title VARCHAR(128) NOT NULL, content TEXT NOT NULL, tags TEXT[] DEFAULT '{}',
  source VARCHAR(8) NOT NULL,                             -- auto|explicit
  source_msg_id BIGINT, embedding vector(1024),
  confidence REAL NOT NULL DEFAULT 0.8, hit_count INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ, pinned BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(8) NOT NULL DEFAULT 'active',
  version INT NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON knowledge_items USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON knowledge_items (space_id, scope, status);

CREATE TABLE extensions (
  id UUID PRIMARY KEY, user_id BIGINT NOT NULL,           -- 安装者
  space_id UUID,                                          -- visibility=space 时归属空间（private 时=个人空间id）
  visibility VARCHAR(8) NOT NULL DEFAULT 'private',
  name VARCHAR(32) NOT NULL, version VARCHAR(16) NOT NULL,
  type VARCHAR(16) NOT NULL,                              -- http-tools|script-tools|skill|mcp|prompt
  manifest JSONB NOT NULL, status VARCHAR(8) NOT NULL DEFAULT 'enabled',
  call_count_7d INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, name));

CREATE TABLE extension_secrets (
  id UUID PRIMARY KEY, user_id BIGINT NOT NULL,
  name VARCHAR(64) NOT NULL, cipher BYTEA NOT NULL,        -- AES-256-GCM(KB_MASTER_KEY)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (user_id, name));

CREATE TABLE llm_usage (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL, session_id UUID,
  model VARCHAR(32) NOT NULL, prompt_tokens INT NOT NULL, completion_tokens INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON llm_usage (user_id, created_at DESC);
-- 定时清理：space_chat>30d；file_objects expired；解散空间 dissolved_at+7d 级联
