CREATE TABLE IF NOT EXISTS instagram_scheduled_posts (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 asset_id TEXT NOT NULL,
 caption TEXT NOT NULL,
 scheduled_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft',
 container_id TEXT,
 media_id TEXT,
 error_message TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS instagram_due_posts ON instagram_scheduled_posts(status,scheduled_at);
