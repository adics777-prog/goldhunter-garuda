-- Automatic promo videos (vertical 9:16): queued on the website, rendered by the builder on the admin PC
CREATE TABLE IF NOT EXISTS content_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  INTEGER NOT NULL,
  kind        TEXT NOT NULL,                 -- signal | weekly
  ref_id      INTEGER NOT NULL DEFAULT 0,    -- signal id for kind signal
  lang        TEXT NOT NULL DEFAULT 'id',
  status      TEXT NOT NULL DEFAULT 'queued', -- queued | rendering | done | failed
  script      TEXT NOT NULL DEFAULT '',      -- JSON written by Claude
  caption     TEXT NOT NULL DEFAULT '',
  error       TEXT NOT NULL DEFAULT '',
  file_name   TEXT NOT NULL DEFAULT '',
  duration    REAL NOT NULL DEFAULT 0,
  size        INTEGER NOT NULL DEFAULT 0,
  tg_file_id  TEXT NOT NULL DEFAULT '',
  rendered_at INTEGER
);
CREATE INDEX IF NOT EXISTS content_jobs_status ON content_jobs(status, id);
INSERT OR IGNORE INTO settings (key, value) VALUES ('content_enabled', '1'), ('content_on_signal', '1'), ('content_weekly', '1'),
  ('content_lang', 'id'), ('content_voice', 'id-ID-ArdiNeural'), ('content_tg', '1');
