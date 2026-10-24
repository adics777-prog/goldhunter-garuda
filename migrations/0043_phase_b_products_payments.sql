-- GOLD HUNTER GARUDA (phase B): new product set, per-duration rent prices, sharing profit, trial, payment methods.
--
-- Products (prices shown on the website, editable in Admin > Produk & Harga):
--   ghg_rent  ea_rent   monthly  Sewa EA: one price per duration in products.prices (JSON months -> Rupiah)
--   ghg_ib    ea_ib     free     EA gratis for accounts under our IB (admin checks the partner portal)
--   ghg_share ea_share  share    Sharing profit: commission settings.share_commission_pct % of the weekly closed profit
--   ghg_trial ea_trial  trial    Trial settings.trial_days days, once per account number and per member
-- The old EA products (hidden since 0013) are retired: kept for history (orders / licences may point at them), never shown.
-- The EA + VPS packages are shown again; VPS-only packages stay as they are.

ALTER TABLE products ADD COLUMN prices TEXT NOT NULL DEFAULT '';          -- rent: {"1":300000,"2":...,"12":...,"18":...,"24":...}
ALTER TABLE products ADD COLUMN name_en TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN description_en TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN features_en TEXT NOT NULL DEFAULT '';

UPDATE products SET active = 0, sort = 90 + sort, name = '[Lama] ' || name
 WHERE code IN ('ea_ib', 'ea_rent', 'ea_lifetime') AND name NOT LIKE '[Lama]%';

-- PLACEHOLDER PRICES (contoh pola diskon): the owner fills the real prices in Admin > Produk & Harga.
INSERT INTO products (code, name, kind, billing, includes_ea, includes_vps, requires_ib, managed_vps, price, prices, description, features, active, sort,
                      name_en, description_en, features_en) VALUES
 ('ghg_rent', 'Sewa EA', 'ea_rent', 'monthly', 1, 0, 0, 0, 300000,
  '{"1":300000,"2":590000,"3":870000,"4":1140000,"5":1400000,"6":1650000,"7":1890000,"8":2120000,"9":2340000,"10":2550000,"11":2750000,"12":2950000,"18":4250000,"24":5400000}',
  'Lisensi EA GOLD HUNTER GARUDA atas nomor akun Anda, berlaku sesuai masa sewa. Makin lama makin hemat.',
  'File EA terkunci di nomor akun Anda
Pilih 1 sampai 11 bulan, 1 tahun, 1,5 tahun atau 2 tahun
Update EA otomatis gratis selama masa sewa
Pengingat H-3 dan H-1 sebelum masa sewa habis', 1, 1,
  'EA Rental',
  'A GOLD HUNTER GARUDA licence locked to your account number, valid for the rental period. The longer, the cheaper.',
  'EA file locked to your account number
Choose 1 to 11 months, 1 year, 1.5 years or 2 years
Free automatic EA updates during the rental
Reminders 3 days and 1 day before it ends'),
 ('ghg_ib', 'EA Gratis (Akun IB)', 'ea_ib', 'free', 1, 0, 1, 0, 0, '',
  'EA GRATIS tanpa masa habis untuk akun yang terdaftar di bawah partner (IB) GoldHunter Garuda. Admin mengecek akun Anda di portal partner.',
  'GRATIS selama akun di bawah IB kami
Lisensi tanpa masa habis
Update EA otomatis gratis
Panduan daftar / pindah partner di menu "Syarat EA Gratis"', 1, 2,
  'Free EA (IB Account)',
  'FREE EA without expiry for accounts registered under the GoldHunter Garuda partner (IB) link. The admin checks your account in the partner portal.',
  'FREE while the account stays under our IB
Licence without expiry
Free automatic EA updates
Sign-up / partner-change guide in "Free EA Terms"'),
 ('ghg_share', 'Sharing Profit', 'ea_share', 'share', 1, 0, 0, 0, 0, '',
  'Tanpa biaya di depan: Anda hanya membayar komisi dari profit EA. Tagihan mingguan tiap hari Minggu berisi laporan profit per chart EA; minggu tanpa profit tidak ditagih.',
  'Tanpa biaya di depan
Komisi hanya dari profit tertutup EA
Laporan + tagihan tiap Minggu, minggu rugi tidak ditagih
EA wajib melapor ke web (WebRequest aktif)', 1, 3,
  'Profit Sharing',
  'No upfront fee: you only pay a commission on the EA''s profit. A weekly invoice every Sunday carries the profit report per EA chart; weeks without profit are not invoiced.',
  'No upfront fee
Commission on the EA''s closed profit only
Report + invoice every Sunday, losing weeks are free
The EA must report to the website (WebRequest on)'),
 ('ghg_trial', 'Trial 7 Hari', 'ea_trial', 'trial', 1, 0, 0, 0, 0, '',
  'Coba EA GOLD HUNTER GARUDA gratis 7 hari di akun Anda. Langsung aktif tanpa menunggu admin; satu kali per nomor akun dan per member.',
  'Gratis 7 hari, langsung aktif
Semua fitur EA
Satu kali per nomor akun dan per member
Lanjutkan dengan Sewa atau Sharing Profit', 1, 4,
  '7-Day Trial',
  'Try the GOLD HUNTER GARUDA EA free for 7 days on your account. Active right away, no admin wait; once per account number and per member.',
  'Free for 7 days, active right away
Every EA feature
Once per account number and per member
Continue with Rental or Profit Sharing');

UPDATE products SET active = 1, sort = 10 + sort WHERE code IN ('ib_vps', 'ib_vps_shared', 'vps_ea', 'vps_ea_shared') AND sort < 10;
UPDATE products SET sort = 20 + sort WHERE code IN ('vps', 'vps_shared') AND sort < 20;

-- Sharing profit: start of the next period that has not been billed yet (unix; periods end Sunday 00:00 WIB)
ALTER TABLE licenses ADD COLUMN share_next INTEGER NOT NULL DEFAULT 0;

-- EA live daily rows: the EA's cumulative closed profit (`total`, EA magic + symbol, since `since`) at the last heartbeat
-- of the WIB day. Weekly sharing profit = difference of these totals, so no closed deal is lost between days.
ALTER TABLE ea_setup_days ADD COLUMN total_end REAL NOT NULL DEFAULT 0;
ALTER TABLE ea_setup_days ADD COLUMN tot_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ea_setup_days ADD COLUMN since_at INTEGER NOT NULL DEFAULT 0;

-- Payment method per order / invoice (member can switch while unpaid) and automatic payment data
ALTER TABLE orders ADD COLUMN pay_method TEXT NOT NULL DEFAULT '';        -- '' | bank | usdt | gateway (QRIS / VA)
ALTER TABLE orders ADD COLUMN amount_usd REAL NOT NULL DEFAULT 0;         -- sharing profit invoice: commission in USD
ALTER TABLE orders ADD COLUMN usdt_amount REAL NOT NULL DEFAULT 0;        -- locked unique USDT amount
ALTER TABLE orders ADD COLUMN usdt_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN usdt_locked_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN usdt_tx TEXT;                               -- matched TRC20 transaction id
-- automatic gateway (provider-agnostic, server/gateway): provider, its transaction reference, channel (QRIS / bank VA), view
ALTER TABLE orders ADD COLUMN gateway_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN gateway_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN gateway_method TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN gateway_data TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN gateway_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN paid_via TEXT NOT NULL DEFAULT '';          -- bank | usdt | gateway (who confirmed the money)
ALTER TABLE orders ADD COLUMN paid_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN checked_at INTEGER NOT NULL DEFAULT 0;      -- last "Saya sudah bayar" check
ALTER TABLE orders ADD COLUMN reminded_at INTEGER NOT NULL DEFAULT 0;     -- sharing invoice: due reminder sent
ALTER TABLE orders ADD COLUMN share_report_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_usdt_tx ON orders(usdt_tx) WHERE usdt_tx IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_license ON orders(license_id, kind, status);

-- Weekly sharing profit report per licence (also when there is nothing to invoice)
CREATE TABLE IF NOT EXISTS share_reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id     INTEGER NOT NULL,
  user_id        INTEGER NOT NULL,
  period_start   INTEGER NOT NULL,
  period_end     INTEGER NOT NULL,
  rows           TEXT NOT NULL DEFAULT '[]',     -- per EA chart: label, symbol, magic, currency, profit, profit_usd, source
  profit_usd     REAL NOT NULL DEFAULT 0,
  commission_pct REAL NOT NULL DEFAULT 0,
  commission_usd REAL NOT NULL DEFAULT 0,
  commission_idr INTEGER NOT NULL DEFAULT 0,
  usd_idr        REAL NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT '',       -- invoiced | no_profit | below_min | no_data
  order_id       INTEGER,
  note           TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  UNIQUE (license_id, period_start)
);
CREATE INDEX IF NOT EXISTS idx_share_reports_license ON share_reports(license_id, period_start);

INSERT OR IGNORE INTO settings (key, value) VALUES
 ('share_commission_pct', '10'),
 ('share_due_days', '3'),
 ('share_min_idr', '0'),
 ('trial_days', '7'),
 ('usdt_auto', '1'),
 ('gateway_provider', ''),        -- '' = off | linkqu (stub until its official API docs arrive) | tripay
 ('gateway_enabled', '0'),
 ('gateway_mode', 'sandbox'),
 ('prices_placeholder', '1');
-- Reminders H-3 and H-1 (then on the expiry day and a renewal email the day after)
UPDATE settings SET value = '[3,1]' WHERE key = 'reminder_days' AND value = '[7,3,1]';
