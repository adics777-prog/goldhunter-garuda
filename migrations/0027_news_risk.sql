-- AI-chosen risk per signal (0.25-1 % of balance), NEWS tag for signals from the news mode, news mode switch
ALTER TABLE signals ADD COLUMN risk_pct REAL NOT NULL DEFAULT 1;
ALTER TABLE signals ADD COLUMN tag TEXT NOT NULL DEFAULT '';
INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_news_mode', '1');
