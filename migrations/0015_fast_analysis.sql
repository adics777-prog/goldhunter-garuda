-- Analysis every N minutes per market (60 / 30 / 15) and quick re-analysis when price reaches a level Claude is waiting for
INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_interval_min', '60'), ('ai_level_trigger', '1');
