-- GOLD HUNTER GARUDA live monitor: master-account heartbeats, finished series, events and daily history
CREATE TABLE IF NOT EXISTS ea_live (
  id INTEGER PRIMARY KEY,
  updated_at INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}'
);
INSERT OR IGNORE INTO ea_live (id, updated_at, data) VALUES (1, 0, '{}');
CREATE TABLE IF NOT EXISTS ea_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  closed_at INTEGER NOT NULL,
  side TEXT NOT NULL,
  positions INTEGER NOT NULL DEFAULT 0,
  lots REAL NOT NULL DEFAULT 0,
  profit REAL NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ea_series_closed ON ea_series(closed_at);
CREATE TABLE IF NOT EXISTS ea_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  profit REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ea_events_at ON ea_events(at);
CREATE TABLE IF NOT EXISTS ea_days (
  day TEXT PRIMARY KEY,
  profit REAL NOT NULL DEFAULT 0,
  series INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  equity REAL NOT NULL DEFAULT 0,
  min_equity REAL NOT NULL DEFAULT 0,
  max_dd_pct REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
