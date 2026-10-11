-- Satu akun MT5 bisa menjalankan banyak setup di pair yang sama (GOLD HUNTER GARUDA XAU 1 / 2 / 3):
-- setup dikenali dari akun + pair + MAGIC, dan setiap setup punya anggaran dana sendiri (persen = profit / anggaran).
-- Tabel ea_setups masih kosong di produksi, jadi dibuat ulang dengan kunci baru.
DROP TABLE IF EXISTS ea_setups;
CREATE TABLE ea_setups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  login       TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  magic       INTEGER NOT NULL DEFAULT 0,
  broker_symbol TEXT NOT NULL DEFAULT '',
  server      TEXT NOT NULL DEFAULT '',
  currency    TEXT NOT NULL DEFAULT '',
  setup_name  TEXT NOT NULL DEFAULT '',     -- dari input EA 1.3 (mis. XAU 1)
  budget      REAL NOT NULL DEFAULT 0,      -- anggaran dana setup (input EA 4.0); 0 = pakai balance akun
  ea_risk     TEXT NOT NULL DEFAULT '',
  risk        TEXT NOT NULL DEFAULT '',
  label       TEXT NOT NULL DEFAULT '',
  visible     INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  since       INTEGER NOT NULL DEFAULT 0,
  total       REAL NOT NULL DEFAULT 0,
  acct_total  REAL NOT NULL DEFAULT 0,
  total_ok    INTEGER NOT NULL DEFAULT 0,
  balance     REAL NOT NULL DEFAULT 0,
  equity      REAL NOT NULL DEFAULT 0,
  max_dd_pct  REAL NOT NULL DEFAULT 0,
  min_float   REAL NOT NULL DEFAULT 0,
  max_layers  INTEGER NOT NULL DEFAULT 0,
  offline_state INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0,
  data        TEXT NOT NULL DEFAULT '{}',
  UNIQUE (login, symbol, magic)
);
