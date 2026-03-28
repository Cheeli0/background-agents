ALTER TABLE sessions ADD COLUMN creation_source TEXT NOT NULL DEFAULT 'web';
ALTER TABLE sessions ADD COLUMN branch_name TEXT;
