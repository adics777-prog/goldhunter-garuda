-- GoldHunter Garuda: member area, orders, licenses, EA builds
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL DEFAULT '',
  address       TEXT NOT NULL DEFAULT '',
  pass_hash     TEXT NOT NULL,
  pass_salt     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',      -- member | admin
  status        TEXT NOT NULL DEFAULT 'active',      -- active | blocked
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE login_attempts (
  key        TEXT NOT NULL,         -- email or ip
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts(key, created_at);

-- kind: ea_ib | ib_vps | ea_lifetime | ea_rent | vps_ea | vps
-- billing: free (IB, no payment) | lifetime (price = once) | monthly (price = per month)
CREATE TABLE products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  billing      TEXT NOT NULL,
  includes_ea  INTEGER NOT NULL DEFAULT 1,
  includes_vps INTEGER NOT NULL DEFAULT 0,
  requires_ib  INTEGER NOT NULL DEFAULT 0,   -- 1 = only for accounts under our IB link
  price        INTEGER NOT NULL,            -- Rupiah
  description  TEXT NOT NULL DEFAULT '',
  features     TEXT NOT NULL DEFAULT '',    -- one per line
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE licenses (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  product_id          INTEGER NOT NULL REFERENCES products(id),
  platform            TEXT NOT NULL,            -- mt5 | mt4
  account_number      TEXT NOT NULL,
  broker              TEXT NOT NULL DEFAULT '',
  broker_server       TEXT NOT NULL DEFAULT '',
  trading_pass_enc    TEXT,
  expires_at          INTEGER,                  -- NULL = selamanya
  status              TEXT NOT NULL DEFAULT 'processing', -- processing | active | expired | suspended
  vps_ip              TEXT NOT NULL DEFAULT '',
  vps_user            TEXT NOT NULL DEFAULT '',
  vps_pass_enc        TEXT,
  vps_note            TEXT NOT NULL DEFAULT '',
  current_build_id    INTEGER,
  reminder_exp        INTEGER,                  -- expires_at the reminders below belong to
  reminders_sent      TEXT NOT NULL DEFAULT '', -- e.g. "7,3"
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_licenses_user ON licenses(user_id);

CREATE TABLE orders (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  code               TEXT NOT NULL UNIQUE,
  user_id            INTEGER NOT NULL REFERENCES users(id),
  kind               TEXT NOT NULL DEFAULT 'new',  -- new | renew
  product_id         INTEGER NOT NULL REFERENCES products(id),
  license_id         INTEGER REFERENCES licenses(id),
  platform           TEXT NOT NULL,
  account_number     TEXT NOT NULL,
  broker             TEXT NOT NULL DEFAULT '',
  broker_server      TEXT NOT NULL DEFAULT '',
  trading_pass_enc   TEXT,
  months             INTEGER,                      -- NULL = lifetime
  unit_price         INTEGER NOT NULL,
  discount_pct       INTEGER NOT NULL DEFAULT 0,
  subtotal           INTEGER NOT NULL,
  unique_code        INTEGER NOT NULL DEFAULT 0,
  total              INTEGER NOT NULL,
  -- awaiting_payment -> awaiting_verification -> processing -> completed
  -- (rejected | cancelled | expired possible)
  status             TEXT NOT NULL DEFAULT 'awaiting_payment',
  ib_status          TEXT NOT NULL DEFAULT '',     -- '' (not checked) | yes | no  (only for requires_ib products)
  ib_checked_at      INTEGER,
  proof_file_id      INTEGER,
  payer_name         TEXT NOT NULL DEFAULT '',
  payer_bank         TEXT NOT NULL DEFAULT '',
  member_note        TEXT NOT NULL DEFAULT '',
  admin_note         TEXT NOT NULL DEFAULT '',
  created_at         INTEGER NOT NULL,
  pay_deadline       INTEGER NOT NULL,
  confirmed_at       INTEGER,
  processed_at       INTEGER,
  completed_at       INTEGER
);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  kind       TEXT NOT NULL,     -- proof | ea
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  data_b64   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE builds (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id     INTEGER NOT NULL REFERENCES licenses(id),
  platform       TEXT NOT NULL,
  account_number TEXT NOT NULL,
  expires_at     INTEGER,
  status         TEXT NOT NULL DEFAULT 'queued',  -- queued | building | done | failed | replaced
  file_id        INTEGER,
  ea_version     TEXT NOT NULL DEFAULT '',
  log            TEXT NOT NULL DEFAULT '',
  reason         TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  started_at     INTEGER,
  finished_at    INTEGER
);
CREATE INDEX idx_builds_status ON builds(status);
CREATE INDEX idx_builds_license ON builds(license_id);

CREATE TABLE account_changes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id       INTEGER NOT NULL REFERENCES licenses(id),
  user_id          INTEGER NOT NULL REFERENCES users(id),
  old_account      TEXT NOT NULL,
  new_account      TEXT NOT NULL,
  new_server       TEXT NOT NULL DEFAULT '',
  new_pass_enc     TEXT,
  reason           TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  admin_note       TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL,
  decided_at       INTEGER
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notif_user ON notifications(user_id, is_read);

CREATE TABLE emails (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr    TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body_html  TEXT NOT NULL,
  status     TEXT NOT NULL,     -- sent | failed | logged
  error      TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Contoh harga (ubah dari Admin > Produk & Harga)
INSERT INTO products (code, name, kind, billing, includes_ea, includes_vps, requires_ib, price, description, features, sort) VALUES
 ('ea_ib', 'EA Gratis (Akun IB Exness)', 'ea_ib', 'free', 1, 0, 1, 0,
  'EA GRATIS untuk akun Exness yang terdaftar di bawah partner (IB) GoldHunter Garuda. Admin mengecek akun Anda, lalu file EA dikirim.',
  'GRATIS tanpa biaya lisensi
Syarat: akun Exness di bawah partner GoldHunter Garuda (daftar baru / pindah partner)
File .ex5 terkunci di nomor akun Anda
Panduan di menu "Syarat EA Gratis"', 0),
 ('ib_vps', 'VPS Pribadi untuk EA Gratis (IB)', 'ib_vps', 'monthly', 1, 1, 1, 150000,
  'Khusus akun di bawah partner (IB) GoldHunter Garuda: EA gratis + VPS Windows pribadi 24 jam. Anda login lewat Remote Desktop dan mengatur EA sendiri.',
  'EA GRATIS, cukup bayar VPS
VPS pribadi: RAM 2 GB, 2 core, disk 40 GB
Akses Remote Desktop, setting EA bebas
Pengingat sebelum masa sewa VPS habis', 1),
 ('vps_ea', 'Paket VPS Pribadi + EA', 'vps_ea', 'monthly', 1, 1, 0, 450000,
  'File EA berlisensi + VPS Windows pribadi 24 jam untuk broker apa pun. Anda login lewat Remote Desktop dan mengatur EA sendiri.',
  'VPS pribadi: RAM 2 GB, 2 core, disk 40 GB
File .ex5 terkunci di nomor akun Anda
Akses Remote Desktop, setting EA bebas
Pengingat sebelum masa sewa habis', 2),
 ('ea_rent', 'Sewa EA Bulanan', 'ea_rent', 'monthly', 1, 0, 0, 300000,
  'File EA (.ex5) berlisensi atas nomor akun Anda, berlaku sesuai masa sewa.',
  'File .ex5 terkunci di nomor akun Anda
Pilih 1, 3, 4, 5, 6 atau 12 bulan
Sewa 12 bulan lebih hemat 25%
Bisa diperpanjang dari member area', 3),
 ('ea_lifetime', 'Beli EA Selamanya', 'ea_lifetime', 'lifetime', 1, 0, 0, 5000000,
  'Bayar sekali, EA (.ex5) berlaku selamanya untuk nomor akun Anda.',
  'Bayar sekali, tanpa biaya bulanan
File .ex5 terkunci di nomor akun Anda
Ganti nomor akun lewat pengajuan ke admin', 4);

INSERT INTO settings (key, value) VALUES
 ('durations', '[1,3,4,5,6,12]'),
 ('discounts', '{"12":25}'),
 ('bank_accounts', 'BCA 1234567890 a.n. NAMA ANDA
DANA / OVO 08xxxxxxxxxx a.n. NAMA ANDA'),
 ('admin_notify_email', ''),
 ('whatsapp', ''),
 ('pay_deadline_hours', '24'),
 ('reminder_days', '[7,3,1]'),
 ('mt4_enabled', '0'),
 ('unique_code', '1'),
 ('auto_complete_ea', '1'),
 ('welcome_email_password', '1'),
 ('vps_spec', 'RAM 2 GB, 2 core, disk 40 GB, Windows'), -- put the chosen password in the welcome email (never stored in the email log)
 ('email_provider', ''),         -- '' = use env EMAIL_PROVIDER; log | resend | brevo
 ('email_from', ''),
 ('email_from_name', ''),      -- EA-only order: mark completed as soon as the .ex5 is built
 ('auto_process_paid', '0'),     -- process right after the member confirms payment (later: payment gateway)
 ('ib_brokers', '[{"name":"Exness","link":"https://one.exnessonelink.com/a/kln1psl33l","active":true},{"name":"HFM","link":"","active":false}]');
