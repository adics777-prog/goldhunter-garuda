-- Separate filter for pending orders: lower confidence allowed when the reward : risk makes the expected value clearly positive
INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_min_conf_pending', '55'), ('ai_min_ev', '0.5');
