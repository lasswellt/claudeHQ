-- CAP-062 / story 016-007: store the GitHub Check Run ID on the job row
-- so the hub can later call checks.update() when the job reaches a
-- terminal status (completed, failed, cancelled, timed_out).

ALTER TABLE jobs ADD COLUMN check_run_id INTEGER;
