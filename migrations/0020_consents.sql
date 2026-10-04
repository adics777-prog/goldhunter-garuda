-- Evidence that every member accepted the risk warning: archived wording per version + one row per acceptance
CREATE TABLE IF NOT EXISTS legal_texts (
  version    TEXT NOT NULL,
  lang       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (version, lang)
);
CREATE TABLE IF NOT EXISTS consents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,               -- risk_warning
  version     TEXT NOT NULL,
  lang        TEXT NOT NULL,
  text_hash   TEXT NOT NULL,               -- sha256 of the exact text shown
  ip          TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  accepted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS consents_user ON consents(user_id);
