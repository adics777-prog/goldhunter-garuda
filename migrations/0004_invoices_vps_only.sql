-- Automatic monthly invoices, VPS-only rentals (for one-time EA buyers), profit-estimate promo settings
INSERT INTO products (code, name, kind, billing, includes_ea, includes_vps, requires_ib, managed_vps, price, description, features, sort) VALUES
 ('vps', 'Sewa VPS Pribadi (tanpa EA)', 'vps', 'monthly', 0, 1, 0, 0, 150000,
  'Untuk Anda yang sudah punya EA (beli sekali / selamanya): sewa VPS Windows pribadi 24 jam. Yang ditagih tiap bulan hanya VPS.',
  'Cocok untuk pembeli EA sekali beli
VPS pribadi, akses Remote Desktop
Tagihan bulanan hanya untuk VPS
Pengingat sebelum masa sewa habis', 5),
 ('vps_shared', 'Sewa VPS Share (tanpa EA)', 'vps_shared', 'monthly', 0, 1, 0, 1, 50000,
  'Untuk Anda yang sudah punya EA (beli sekali / selamanya): VPS share dikelola admin, dibantu setup sampai EA berjalan. Yang ditagih tiap bulan hanya VPS.',
  'Cocok untuk pembeli EA sekali beli
Dikelola admin, dibantu setup sampai jalan
Tagihan bulanan hanya untuk VPS
Pantau dari HP pakai akun pantau (investor)', 6);

INSERT OR IGNORE INTO settings (key, value) VALUES
 ('invoice_days_before', '7'),
 ('profit_est_enabled', '0'),
 ('profit_est_min_idr', ''),
 ('profit_est_max_idr', ''),
 ('profit_est_basis', '');
