-- Daily trade limit and daily loss stop, set in Admin (were EA inputs: 3 trades, 3%)
INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_max_trades_day', '10'), ('ai_max_daily_loss', '3');
