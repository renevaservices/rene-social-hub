CREATE TABLE IF NOT EXISTS threads_oauth_states(state TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS threads_pending_connections(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,username TEXT NOT NULL,encrypted_access_token TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS threads_connections(slot INTEGER PRIMARY KEY CHECK(slot=1),account_id TEXT NOT NULL,username TEXT NOT NULL,encrypted_access_token TEXT NOT NULL,expires_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS threads_publish_jobs(post_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,content TEXT NOT NULL,scheduled_at INTEGER NOT NULL,status TEXT NOT NULL,container_id TEXT,media_id TEXT,error_message TEXT,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS threads_jobs_due ON threads_publish_jobs(status,scheduled_at);
