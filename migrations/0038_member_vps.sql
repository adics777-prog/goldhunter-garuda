-- GOLD HUNTER GARUDA: kunci lisensi member (lic.<license_id>.<report_token>) untuk detak EA berlisensi dan agen VPS member.
-- Baris EA Live dari EA berlisensi mencatat pemiliknya; baris kunci master (akun admin sendiri) tetap NULL.
ALTER TABLE ea_setups ADD COLUMN license_id INTEGER;
ALTER TABLE ea_setups ADD COLUMN user_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_ea_setups_license ON ea_setups(license_id);

-- Agen VPS member: satu baris per lisensi + VPS (agen melapor tiap 5 menit dan sesudah memasang build baru).
CREATE TABLE IF NOT EXISTS ea_vps_lic (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id   INTEGER NOT NULL,
  host         TEXT NOT NULL,
  version      TEXT NOT NULL DEFAULT '',   -- versi EA terpasang (ea_version build)
  build_id     INTEGER NOT NULL DEFAULT 0, -- build terpasang
  agent        TEXT NOT NULL DEFAULT '',   -- versi agen
  terminals    TEXT NOT NULL DEFAULT '[]', -- JSON: folder data, folder instalasi, login, cocok, berjalan
  note         TEXT NOT NULL DEFAULT '',
  updated_at   INTEGER NOT NULL DEFAULT 0, -- detak terakhir
  installed_at INTEGER NOT NULL DEFAULT 0, -- build terakhir terpasang
  UNIQUE (license_id, host)
);
CREATE INDEX IF NOT EXISTS idx_ea_vps_lic_license ON ea_vps_lic(license_id);
