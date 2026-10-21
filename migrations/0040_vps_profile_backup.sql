-- GOLD HUNTER GARUDA: latest chart-profile backup per licence, uploaded by the member's VPS agent (agent 1.3+).
-- The one-file installer restores it on a new VPS: charts, symbols, timeframes, the attached EA + all its inputs,
-- and the [Experts] lines of common.ini (algo trading, WebRequest, the encrypted WebRequest URL list).
-- Never holds passwords / accounts.dat: only MQL5\Profiles\Charts\<active profile>\* and the [Experts] lines.
CREATE TABLE IF NOT EXISTS ea_vps_profile (
  license_id   INTEGER PRIMARY KEY,
  platform     TEXT NOT NULL DEFAULT 'mt5',
  login        TEXT NOT NULL DEFAULT '',   -- account logged in where the profile was taken (= licence account)
  server       TEXT NOT NULL DEFAULT '',   -- broker server of that terminal
  host         TEXT NOT NULL DEFAULT '',   -- VPS name (COMPUTERNAME)
  profile_name TEXT NOT NULL DEFAULT '',
  files        TEXT NOT NULL DEFAULT '[]', -- JSON [{name, b64}]: chart*.chr, order.wnd, ... of that profile
  experts_ini  TEXT NOT NULL DEFAULT '',   -- [Experts] lines of config\common.ini (incl. WebRequestUrl)
  charts       INTEGER NOT NULL DEFAULT 0, -- number of chart*.chr files
  ea_charts    INTEGER NOT NULL DEFAULT 0, -- charts with GOLD HUNTER GARUDA attached
  size         INTEGER NOT NULL DEFAULT 0, -- total bytes of the files
  sha          TEXT NOT NULL DEFAULT '',
  updated_at   INTEGER NOT NULL DEFAULT 0
);
