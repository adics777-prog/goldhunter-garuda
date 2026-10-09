-- Several charts (XAUUSD, BTCUSD, EURUSD, USDJPY) run the EA on one account: keep one live snapshot per symbol,
-- tag series / events with the symbol and keep a per-symbol daily history (profit, series, longest basket, deepest floating)
CREATE TABLE IF NOT EXISTS ea_live_sym (
  symbol TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}'
);
ALTER TABLE ea_series ADD COLUMN symbol TEXT NOT NULL DEFAULT '';
ALTER TABLE ea_events ADD COLUMN symbol TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS ea_days_sym (
  symbol TEXT NOT NULL,
  day TEXT NOT NULL,
  profit REAL NOT NULL DEFAULT 0,
  series INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  max_layers INTEGER NOT NULL DEFAULT 0,
  min_float REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, day)
);
