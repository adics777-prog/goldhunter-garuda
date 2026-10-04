-- AI signals: the MASTER EA (one MT5 terminal that calls the Claude API once per H1 candle) publishes every
-- decision here; CLIENT EAs read the latest one and open their own order. Phase 1: shared keys (env SIGNAL_SECRET
-- for publishing, SIGNAL_KEY for reading), not yet tied to member licences.
CREATE TABLE IF NOT EXISTS signals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol      TEXT    NOT NULL,
  bar_time    INTEGER NOT NULL,          -- unix time of the H1 candle the decision belongs to (broker server time)
  created_at  INTEGER NOT NULL,          -- unix time (UTC) the signal reached the server
  valid_until INTEGER NOT NULL,          -- clients do not open a new order after this (UTC)
  decision    TEXT    NOT NULL,          -- BUY | SELL | WAIT
  confidence  INTEGER NOT NULL DEFAULT 0,
  price       REAL    NOT NULL DEFAULT 0,
  sl          REAL    NOT NULL DEFAULT 0,
  tp          REAL    NOT NULL DEFAULT 0,
  trend_h4    TEXT    NOT NULL DEFAULT '',
  trend_h1    TEXT    NOT NULL DEFAULT '',
  reason      TEXT    NOT NULL DEFAULT '',
  model       TEXT    NOT NULL DEFAULT '',
  cost_usd    REAL    NOT NULL DEFAULT 0,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  -- outcome, reported by the MASTER EA which follows every BUY/SELL signal until TP / SL
  status      TEXT    NOT NULL DEFAULT 'open',  -- open | TP | SL | BE | CLOSE  (WAIT rows: 'wait')
  close_price REAL,
  closed_at   INTEGER,
  pips        REAL                              -- gold: 1 pip = 0.10 USD of price
);
CREATE INDEX IF NOT EXISTS idx_signals_symbol_id ON signals (symbol, id);
CREATE INDEX IF NOT EXISTS idx_signals_trades ON signals (decision, created_at);
