-- VPS Share: account runs on the admin's VPS, admin installs and sets up the EA (member gives login + password + server)
ALTER TABLE products ADD COLUMN managed_vps INTEGER NOT NULL DEFAULT 0;

INSERT INTO products (code, name, kind, billing, includes_ea, includes_vps, requires_ib, managed_vps, price, description, features, sort) VALUES
 ('ib_vps_shared', 'VPS Share untuk EA Gratis (IB)', 'ib_vps_shared', 'monthly', 1, 1, 1, 1, 75000,
  'Khusus akun di bawah partner (IB) GoldHunter Garuda. VPS dikelola admin: akun Anda dipasang di server kami dan dibantu setup sampai EA berjalan.',
  'EA GRATIS + VPS share 24 jam
Dikelola admin, dibantu setup sampai selesai
Cukup kirim nomor akun, password & server
Pantau dari HP pakai akun pantau (investor)', 1),
 ('vps_ea_shared', 'Paket VPS Share + EA', 'vps_ea_shared', 'monthly', 1, 1, 0, 1, 375000,
  'Lisensi EA + VPS share dikelola admin untuk broker apa pun. Akun Anda dipasang di server kami dan dibantu setup sampai EA berjalan.',
  'Lisensi EA terkunci di nomor akun Anda
VPS share 24 jam, dikelola admin
Cukup kirim nomor akun, password & server
Pantau dari HP pakai akun pantau (investor)', 2);
