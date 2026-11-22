ALTER TABLE client_media RENAME TO client_media_before_expiry_fix;
CREATE TABLE client_media(client_id TEXT NOT NULL REFERENCES social_clients(id),asset_id TEXT NOT NULL REFERENCES instagram_media_assets(id) ON DELETE CASCADE,PRIMARY KEY(client_id,asset_id));
INSERT INTO client_media(client_id,asset_id) SELECT client_id,asset_id FROM client_media_before_expiry_fix;
DROP TABLE client_media_before_expiry_fix;
