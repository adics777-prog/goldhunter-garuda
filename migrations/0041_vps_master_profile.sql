-- GOLD HUNTER GARUDA: owner's master-mode chart-profile backups, one row per logged-in account on the owner's VPS.
-- The master VPS agent (1.4+) backs up each running terminal's active profile + [Experts] lines, keyed by account
-- login + broker server (+ platform). The admin installer restores them on a new VPS. Same filters as the licence
-- backup: only profiles that contain a GOLD HUNTER GARUDA EA, never accounts.dat / passwords / credentials.
CREATE TABLE IF NOT EXISTS ea_vps_master_profile (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  login        TEXT NOT NULL,
  server       TEXT NOT NULL DEFAULT '',
  platform     TEXT NOT NULL DEFAULT 'mt5',
  host         TEXT NOT NULL DEFAULT '',   -- VPS name (COMPUTERNAME) the backup came from
  profile_name TEXT NOT NULL DEFAULT '',
  files        TEXT NOT NULL DEFAULT '[]', -- JSON [{name, b64}]: chart*.chr, order.wnd, ... of the active profile
  experts_ini  TEXT NOT NULL DEFAULT '',   -- [Experts] lines of config\common.ini (incl. WebRequestUrl)
  charts       INTEGER NOT NULL DEFAULT 0,
  ea_charts    INTEGER NOT NULL DEFAULT 0, -- charts with GOLD HUNTER GARUDA attached
  size         INTEGER NOT NULL DEFAULT 0,
  sha          TEXT NOT NULL DEFAULT '',
  updated_at   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (login, server, platform)
);
CREATE INDEX IF NOT EXISTS idx_ea_vps_master_profile_login ON ea_vps_master_profile(login);
