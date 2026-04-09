-- CAP-071 / story 015-004: hard-stop flag.
--
-- When hard_stop is 1 and the monthly budget is at 100%, session
-- creation is rejected with a 402 Payment Required instead of
-- merely notifying.

ALTER TABLE budget_config ADD COLUMN hard_stop INTEGER NOT NULL DEFAULT 0;
