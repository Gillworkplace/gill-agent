CREATE TABLE team_workspaces (
 owner_user_id BIGINT PRIMARY KEY REFERENCES users(id),
 revision BIGINT NOT NULL DEFAULT 0,
 document JSONB NOT NULL DEFAULT '{}',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE team_requests (
 owner_user_id BIGINT NOT NULL REFERENCES users(id),
 request_key VARCHAR(180) NOT NULL,
 request_hash VARCHAR(64) NOT NULL,
 result JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_user_id,request_key)
);
CREATE TABLE team_events (
 id BIGSERIAL PRIMARY KEY,
 owner_user_id BIGINT NOT NULL REFERENCES users(id),
 team_id UUID,
 revision BIGINT NOT NULL,
 kind VARCHAR(80) NOT NULL,
 payload JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON team_events(owner_user_id,id);
CREATE TABLE team_jobs (
 id UUID PRIMARY KEY,
 owner_user_id BIGINT NOT NULL REFERENCES users(id),
 team_id UUID,
 payload JSONB NOT NULL,
 checkpoint JSONB NOT NULL DEFAULT '{}',
 state VARCHAR(32) NOT NULL DEFAULT 'queued',
 worker_id VARCHAR(100),
 fence BIGINT NOT NULL DEFAULT 0,
 lease_until TIMESTAMPTZ,
 sandbox_id VARCHAR(128),
 result JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON team_jobs(state,lease_until,created_at);
CREATE INDEX ON team_jobs(owner_user_id,team_id);
CREATE TABLE team_actions (
 id UUID PRIMARY KEY,
 job_id UUID NOT NULL REFERENCES team_jobs(id),
 request_key VARCHAR(180) NOT NULL,
 request_hash VARCHAR(64) NOT NULL,
 kind VARCHAR(64) NOT NULL,
 input JSONB NOT NULL,
 state VARCHAR(32) NOT NULL,
 result JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(job_id,request_key)
);
CREATE INDEX ON team_actions(job_id,state);
