CREATE TABLE IF NOT EXISTS instagram_test_posts (
 id TEXT PRIMARY KEY,
 asset_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 status TEXT NOT NULL,
 container_id TEXT,
 media_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
