CREATE TABLE IF NOT EXISTS instagram_media_assets (
 id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS instagram_media_chunks (
 asset_id TEXT NOT NULL REFERENCES instagram_media_assets(id) ON DELETE CASCADE,
 part INTEGER NOT NULL, content BLOB NOT NULL, PRIMARY KEY(asset_id,part)
);
