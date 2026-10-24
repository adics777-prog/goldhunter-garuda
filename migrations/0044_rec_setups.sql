-- GOLD HUNTER GARUDA (phase C): recommended setups per pair (one EA, many setups), shown on /setup, the landing page
-- and the member area. Managed in Admin > Setup Rekomendasi.
--   preset_file_id  an uploaded .set (files.kind = 'setup_preset'), wins over preset_name
--   preset_name     the name of a preset the builder publishes in settings.vps_release (resolved at download time, so
--                   the download is always the latest version the builder synced with the EA inputs)
--   capital_per_lot capital per 0.01 lot in the account currency (account_type cent = USC, standard = USD)
--   budget          recommended starting capital in the same currency
-- Members download the .set only while they have an active EA licence; installed EAs keep receiving the release
-- presets through the agent (licence mode), unchanged.
CREATE TABLE IF NOT EXISTS rec_setups (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol          TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  title_en        TEXT NOT NULL DEFAULT '',
  style           TEXT NOT NULL DEFAULT '',
  style_en        TEXT NOT NULL DEFAULT '',
  risk            TEXT NOT NULL DEFAULT 'medium',     -- low | medium | high (relative to the other setups)
  account_type    TEXT NOT NULL DEFAULT 'cent',       -- cent | standard
  capital_per_lot REAL NOT NULL DEFAULT 0,
  budget          REAL NOT NULL DEFAULT 0,
  timeframe       TEXT NOT NULL DEFAULT 'M1',
  summary         TEXT NOT NULL DEFAULT '',
  summary_en      TEXT NOT NULL DEFAULT '',
  settings        TEXT NOT NULL DEFAULT '',           -- key settings in plain words, one per line
  settings_en     TEXT NOT NULL DEFAULT '',
  preset_name     TEXT NOT NULL DEFAULT '',
  preset_file_id  INTEGER,
  active          INTEGER NOT NULL DEFAULT 1,
  sort            INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rec_setups_sort ON rec_setups (active, sort, id);

-- Starting list (the owner edits / adds pairs in Admin > Setup Rekomendasi). Presets = the default per-pair presets
-- the builder already publishes (EA v3.08, conservative LOW tier).
INSERT INTO rec_setups (symbol, title, title_en, style, style_en, risk, account_type, capital_per_lot, budget, timeframe, summary, summary_en, settings, settings_en,
                        preset_name, active, sort, created_at, updated_at) VALUES
 ('XAUUSD', 'Emas · Konservatif', 'Gold · Conservative', 'BARBAR 2 arah · Market Liar aktif', 'BARBAR both directions · Market Liar on', 'low', 'cent', 40000, 40000, 'M1',
  'Setup utama GOLD HUNTER GARUDA untuk emas. Lot kecil terhadap modal, sehingga basket panjang lebih lama aman. Cocok untuk mulai.',
  'The main GOLD HUNTER GARUDA setup for gold. A small lot for the capital, so long baskets stay safe for longer. A good place to start.',
  'BUY & SELL selalu jalan bersamaan (BARBAR)
Lot awal 0,01 per 40.000 USC, ikut balance
Jarak layer $1, melebar ×1,1 sesudah layer 4; lot ×1,15 tiap layer
TP bersama $1,50 dari harga rata-rata, bersih swap
DD reduction mulai 6 posisi, kantong profit 50%
Market Liar: saat harga liar seri baru langsung, TP 70%
Berita: tetap jalan (GASPOL); spread maks $0,60',
  'BUY & SELL always run together (BARBAR)
First lot 0.01 per 40,000 USC, grows with the balance
Layer step $1, widens ×1.1 after layer 4; lot ×1.15 per layer
Shared TP $1.50 from the average price, net of swap
DD reduction from 6 positions, 50% profit pocket
Market Liar: in a wild market new series open at once, TP 70%
News: keeps trading (GASPOL); max spread $0.60',
  'GOLD HUNTER GARUDA.set', 1, 1, strftime('%s','now'), strftime('%s','now')),
 ('USDJPY', 'Dolar/Yen · Konservatif', 'Dollar/Yen · Conservative', 'BARBAR 2 arah · jarak rapat', 'BARBAR both directions · tight steps', 'low', 'cent', 8000, 8000, 'M1',
  'Pasangan forex yang tenang dan likuid untuk modal lebih kecil. Bagus dijalankan berdampingan dengan setup emas (magic berbeda).',
  'A calm, liquid forex pair for smaller capital. Runs well next to the gold setup (different magic).',
  'BUY & SELL selalu jalan bersamaan (BARBAR)
Lot awal 0,01 per 8.000 USC, ikut balance
Jarak layer 3 pip, melebar ×1,1 sesudah layer 4; lot ×1,15 tiap layer
TP bersama 4 pip dari harga rata-rata, bersih swap
DD reduction mulai 6 posisi, kantong profit 50%
Berita: tetap jalan (GASPOL); spread maks 2,5 pip',
  'BUY & SELL always run together (BARBAR)
First lot 0.01 per 8,000 USC, grows with the balance
Layer step 3 pips, widens ×1.1 after layer 4; lot ×1.15 per layer
Shared TP 4 pips from the average price, net of swap
DD reduction from 6 positions, 50% profit pocket
News: keeps trading (GASPOL); max spread 2.5 pips',
  'GOLD HUNTER GARUDA USDJPY.set', 1, 2, strftime('%s','now'), strftime('%s','now')),
 ('EURUSD', 'Euro/Dolar · Konservatif', 'Euro/Dollar · Conservative', 'BARBAR 2 arah · jarak rapat', 'BARBAR both directions · tight steps', 'low', 'cent', 10000, 10000, 'M1',
  'Pair forex paling likuid dengan spread kecil. Setup ringan untuk menambah seri harian di samping emas.',
  'The most liquid forex pair with a small spread. A light setup that adds daily series next to gold.',
  'BUY & SELL selalu jalan bersamaan (BARBAR)
Lot awal 0,01 per 10.000 USC, ikut balance
Jarak layer 3 pip, melebar ×1,1 sesudah layer 4; lot ×1,15 tiap layer
TP bersama 4 pip dari harga rata-rata, bersih swap
DD reduction mulai 6 posisi, kantong profit 50%
Berita: tetap jalan (GASPOL); spread maks 2 pip',
  'BUY & SELL always run together (BARBAR)
First lot 0.01 per 10,000 USC, grows with the balance
Layer step 3 pips, widens ×1.1 after layer 4; lot ×1.15 per layer
Shared TP 4 pips from the average price, net of swap
DD reduction from 6 positions, 50% profit pocket
News: keeps trading (GASPOL); max spread 2 pips',
  'GOLD HUNTER GARUDA EURUSD.set', 1, 3, strftime('%s','now'), strftime('%s','now')),
 ('BTCUSD', 'Bitcoin · Konservatif', 'Bitcoin · Conservative', 'BARBAR 2 arah · jarak lebar', 'BARBAR both directions · wide steps', 'medium', 'cent', 16000, 16000, 'M1',
  'Bitcoin bergerak lebih liar dan jalan juga di akhir pekan. Jarak dan TP lebar; pakai hanya dana yang siap menanggung ayunan besar.',
  'Bitcoin moves wilder and also trades at weekends. Wide steps and TP; only use money that can take big swings.',
  'BUY & SELL selalu jalan bersamaan (BARBAR)
Lot awal 0,01 per 16.000 USC, ikut balance
Jarak layer $35, melebar ×1,1 sesudah layer 4; lot ×1,15 tiap layer
TP bersama $50 dari harga rata-rata, bersih swap
DD reduction mulai 6 posisi, kantong profit 50%
Market Liar aktif; spread maks $16',
  'BUY & SELL always run together (BARBAR)
First lot 0.01 per 16,000 USC, grows with the balance
Layer step $35, widens ×1.1 after layer 4; lot ×1.15 per layer
Shared TP $50 from the average price, net of swap
DD reduction from 6 positions, 50% profit pocket
Market Liar on; max spread $16',
  'GOLD HUNTER GARUDA BTCUSD.set', 1, 4, strftime('%s','now'), strftime('%s','now'));
