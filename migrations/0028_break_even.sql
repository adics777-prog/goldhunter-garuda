-- Break even reported by the master: the stop now sits at the entry (shown on the website and in Telegram)
ALTER TABLE signals ADD COLUMN sl_now REAL NOT NULL DEFAULT 0;
ALTER TABLE signals ADD COLUMN be_at INTEGER NOT NULL DEFAULT 0;
