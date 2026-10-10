-- GOLD HUNTER GARUDA: update otomatis EA + preset di VPS.
-- Rilis (ex5 + preset) disimpan di tabel files (kind vps_ex5 / vps_preset), ringkasannya di settings.vps_release.
-- Setiap agen VPS melapor status ke tabel ini.
CREATE TABLE IF NOT EXISTS ea_vps (
  host        TEXT PRIMARY KEY,
  version     TEXT NOT NULL DEFAULT '',
  sha         TEXT NOT NULL DEFAULT '',
  terminals   TEXT NOT NULL DEFAULT '[]',   -- JSON: data folder, install path, running
  note        TEXT NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL DEFAULT 0,   -- detak terakhir
  installed_at INTEGER NOT NULL DEFAULT 0   -- rilis terakhir terpasang
);
