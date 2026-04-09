-- CAP-058 / story 017-003: PAT fallback polling failure counter.
-- Used by pat-poller.ts to back off repos that repeatedly fail
-- API calls, so one broken repo can't starve the polling budget.

ALTER TABLE repos ADD COLUMN poll_failures INTEGER NOT NULL DEFAULT 0;
