-- Whether the GitHub bot started this session to submit a pull request review
-- (a review request or auto-review), as opposed to answering a PR comment or a
-- review-thread mention. Only such sessions may mint the reviewer App's token.
-- Set once at creation from the bot's service-authenticated request; existing
-- sessions are not review sessions.
ALTER TABLE sessions ADD COLUMN github_review INTEGER NOT NULL DEFAULT 0 CHECK (github_review IN (0, 1));
