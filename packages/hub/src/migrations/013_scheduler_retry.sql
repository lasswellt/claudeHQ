-- E003 / story 014-001: scheduler lifecycle columns.
--
-- machines.capabilities and queue.requirements already exist (see
-- 005_enhanced_schema.sql). This migration adds:
--   - sessions.requirements — JSON array; scheduler considers this
--     when placing an existing session without a pinned machineId.
--   - queue.retry_policy    — JSON { backoffSeconds, maxRetries,
--                              retryOnExitCodes } for CAP-012 re-queue.
--   - queue.retry_count     — bumped each time the task re-enters
--                              the queue after a retry-eligible failure.
--   - queue.available_at    — unix seconds; the scheduler ignores
--                              rows whose available_at is in the future
--                              (backoff window).
--   - sessions.retry_count  — mirrors queue.retry_count so the
--                              detail view can show retry history.
--   - sessions.retry_of     — foreign-key-ish link to the session
--                              that triggered this retry.
--   - sessions.termination_reason — 'timeout' | 'cost_limit_exceeded'
--                              | 'user_killed' | 'agent_crash' (CAP-011).

ALTER TABLE sessions ADD COLUMN requirements TEXT;
ALTER TABLE sessions ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN retry_of TEXT;
ALTER TABLE sessions ADD COLUMN termination_reason TEXT;

ALTER TABLE queue ADD COLUMN retry_policy TEXT;
ALTER TABLE queue ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue ADD COLUMN available_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_queue_available_at ON queue(available_at);
CREATE INDEX IF NOT EXISTS idx_sessions_termination_reason ON sessions(termination_reason);
