-- GOLD HUNTER GARUDA: laporan live per SETUP (satu chart EA = satu setup, kunci akun + pair).
-- Akun master (4 pair di satu akun) = 4 setup; akun pantau LOW / MEDIUM / HIGH per pair = satu setup tiap akun.
-- Profit total dihitung EA sejak `since` (diberikan server, bisa diatur admin): modal = balance - total akun.
-- Tabel live lama (satu akun) kosong di produksi dan diganti.
DROP TABLE IF EXISTS ea_live;
DROP TABLE IF EXISTS ea_live_sym;
DROP TABLE IF EXISTS ea_days;
DROP TABLE IF EXISTS ea_days_sym;

CREATE TABLE IF NOT EXISTS ea_setups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  login       TEXT NOT NULL,
  symbol      TEXT NOT NULL,                -- kanonik: XAUUSD, BTCUSD, EURUSD, USDJPY
  broker_symbol TEXT NOT NULL DEFAULT '',   -- mis. XAUUSDc
  server      TEXT NOT NULL DEFAULT '',
  currency    TEXT NOT NULL DEFAULT '',
  magic       INTEGER NOT NULL DEFAULT 0,
  ea_risk     TEXT NOT NULL DEFAULT '',     -- dari input EA 13.6
  risk        TEXT NOT NULL DEFAULT '',     -- pilihan admin ('' = ikut EA, 'NONE' = tanpa label)
  label       TEXT NOT NULL DEFAULT '',     -- nama tampilan pilihan admin ('' = otomatis)
  visible     INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  since       INTEGER NOT NULL DEFAULT 0,   -- mulai hitung (detik UTC)
  total       REAL NOT NULL DEFAULT 0,      -- profit tertutup EA ini sejak `since`
  acct_total  REAL NOT NULL DEFAULT 0,      -- profit tertutup seluruh akun sejak `since`
  total_ok    INTEGER NOT NULL DEFAULT 0,   -- 1 = total sudah dihitung EA dengan `since` yang berlaku
  balance     REAL NOT NULL DEFAULT 0,
  equity      REAL NOT NULL DEFAULT 0,
  max_dd_pct  REAL NOT NULL DEFAULT 0,      -- DD equity terdalam sejak `since`
  min_float   REAL NOT NULL DEFAULT 0,      -- floating setup terdalam sejak `since`
  max_layers  INTEGER NOT NULL DEFAULT 0,
  offline_state INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0,
  data        TEXT NOT NULL DEFAULT '{}',   -- snapshot terakhir
  UNIQUE (login, symbol)
);

CREATE TABLE IF NOT EXISTS ea_setup_days (
  setup_id    INTEGER NOT NULL,
  day         TEXT NOT NULL,                -- YYYY-MM-DD (WIB)
  profit      REAL NOT NULL DEFAULT 0,
  series      INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  balance     REAL NOT NULL DEFAULT 0,
  equity      REAL NOT NULL DEFAULT 0,
  min_equity  REAL NOT NULL DEFAULT 0,
  max_dd_pct  REAL NOT NULL DEFAULT 0,
  max_layers  INTEGER NOT NULL DEFAULT 0,
  min_float   REAL NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (setup_id, day)
);

ALTER TABLE ea_series ADD COLUMN setup_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ea_events ADD COLUMN setup_id INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_ea_series_setup ON ea_series(setup_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_ea_events_setup ON ea_events(setup_id, at);

-- Papan hasil member: lama trading, profit total & persen modal sejak mulai melapor
ALTER TABLE ea_stats ADD COLUMN started_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ea_stats ADD COLUMN total_profit REAL NOT NULL DEFAULT 0;
ALTER TABLE ea_stats ADD COLUMN total_ok INTEGER NOT NULL DEFAULT 0;

-- Papan hasil member tampil (pemilik: hasil trading member ditampilkan, nama disensor)
UPDATE settings SET value = '1' WHERE key = 'board_enabled';
-- Sinyal AI dimatikan di web (Garuda AI diarsipkan)
INSERT OR REPLACE INTO settings (key, value) VALUES ('signals_public', '0');
