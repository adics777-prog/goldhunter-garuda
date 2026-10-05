-- Autopost content videos to Facebook Page Reels, Instagram Reels and TikTok (draft in the TikTok inbox)
ALTER TABLE content_jobs ADD COLUMN social TEXT NOT NULL DEFAULT '{}';
INSERT OR IGNORE INTO settings (key, value) VALUES ('content_fb', '0'), ('content_ig', '0'), ('content_tt', '0'), ('meta_ver', 'v23.0'), ('telegram_public_link', '');
