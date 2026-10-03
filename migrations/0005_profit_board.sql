-- Profit reports sent by the EA (WebRequest) and the public progress board
ALTER TABLE licenses ADD COLUMN report_token TEXT;
ALTER TABLE licenses ADD COLUMN board_show INTEGER NOT NULL DEFAULT 1;       -- admin: show this account on the board
ALTER TABLE licenses ADD COLUMN board_hide_name INTEGER NOT NULL DEFAULT 0;  -- admin: show as "Member Anonim"

CREATE TABLE ea_stats (
  license_id   INTEGER PRIMARY KEY REFERENCES licenses(id),
  login        TEXT NOT NULL,
  server       TEXT NOT NULL DEFAULT '',
  currency     TEXT NOT NULL DEFAULT '',
  balance      REAL NOT NULL DEFAULT 0,
  equity       REAL NOT NULL DEFAULT 0,
  profit_day   REAL NOT NULL DEFAULT 0,
  profit_week  REAL NOT NULL DEFAULT 0,
  profit_month REAL NOT NULL DEFAULT 0,
  positions    INTEGER NOT NULL DEFAULT 0,
  ea_version   TEXT NOT NULL DEFAULT '',
  updated_at   INTEGER NOT NULL
);

CREATE TABLE ea_stats_daily (
  license_id INTEGER NOT NULL,
  day        TEXT NOT NULL,          -- YYYY-MM-DD (WIB)
  profit     REAL NOT NULL DEFAULT 0,
  balance    REAL NOT NULL DEFAULT 0,
  currency   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (license_id, day)
);

INSERT OR IGNORE INTO settings (key, value) VALUES
 ('board_enabled', '1'),
 ('board_name_mode', 'first_initial'),  -- full | first_initial | first | hidden
 ('board_landing_top', '50'),
 ('board_stale_days', '3'),
 ('auto_rebuild_on_version', '1');      -- new #property version in the .mq5/.mq4 -> rebuild every active licence
