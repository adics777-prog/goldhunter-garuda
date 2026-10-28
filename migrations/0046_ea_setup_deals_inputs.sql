-- Trading history of a live setup: every closed / opened deal of the EA (magic + pair), sent by the EA with its heartbeat
-- (EA v3.28+). time = UTC seconds; type 0 buy / 1 sell; entry 0 in / 1 out / 2 in-out / 3 out-by. Ticket is unique per setup.
CREATE TABLE IF NOT EXISTS ea_setup_deals (
  setup_id INTEGER NOT NULL,
  ticket INTEGER NOT NULL,
  pos INTEGER NOT NULL DEFAULT 0,
  time INTEGER NOT NULL,
  type INTEGER NOT NULL DEFAULT 0,
  entry INTEGER NOT NULL DEFAULT 0,
  volume REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  profit REAL NOT NULL DEFAULT 0,
  swap REAL NOT NULL DEFAULT 0,
  commission REAL NOT NULL DEFAULT 0,
  fee REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (setup_id, ticket)
);
CREATE INDEX IF NOT EXISTS idx_ea_setup_deals_time ON ea_setup_deals (setup_id, time);

-- Every input of a live setup as the EA runs it right now ("Name=value" lines, web key blank): the downloadable preset.
CREATE TABLE IF NOT EXISTS ea_setup_inputs (
  setup_id INTEGER PRIMARY KEY,
  set_text TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
