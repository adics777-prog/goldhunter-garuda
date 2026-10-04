-- Telegram: also post WAIT analyses (education) at most every N hours per market
INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_wait', '1'), ('telegram_wait_hours', '3');
