# GoldHunter Garuda: web + member area + admin area

Website **goldhuntergaruda.com** di Cloudflare Pages: landing page, pendaftaran member, order EA / VPS,
dan admin area. File EA (.ex5) berlisensi dibuat otomatis oleh **builder** di PC/VPS Windows.

```
public/            halaman web (landing, masuk, daftar, member, admin) + aset & logo
functions/api/     backend API (Cloudflare Pages Functions)
server/            logika: lisensi, order, email, pengingat
migrations/        struktur database D1
builder/           program compile EA berlisensi (Python + MetaEditor)
.github/workflows/ tugas harian (pengingat masa sewa via email)
```

## Alur

| Paket | Alur |
|---|---|
| Sewa EA | Harga per durasi (1-11 bulan, 1 tahun, 1,5 tahun, 2 tahun) di Admin > Produk & Harga. Member bayar, lisensi = masa sewa, update EA otomatis gratis |
| EA Gratis (IB) | Member ajukan nomor akun, admin cek di portal partner lalu klik **Ya, under IB**, **Proses**. Lisensi tanpa masa habis |
| Sharing Profit | Langsung aktif. Tiap Minggu laporan profit tertutup EA per chart + tagihan komisi (default 10%), jatuh tempo Minggu + 3 hari. Belum lunas = EA berhenti buka posisi baru |
| Trial 7 hari | Langsung aktif, sekali per nomor akun dan per member |
| Paket + VPS | Seperti sebelumnya: bayar, admin isi detail VPS, **Selesai** |

- Pembayaran: transfer bank (kode unik + bukti, admin klik **Sudah Bayar**) atau **USDT TRC20 otomatis** (nominal unik per tagihan,
  dicek di TronGrid). Metode bisa diganti selama tagihan belum dibayar. Lunas otomatis = lisensi + EA dibuat tanpa admin.
- Payment gateway QRIS / VA: antarmuka penyedia (`server/gateway/`) disiapkan tapi **ditunda / tersembunyi**; adapter LinkQu masih stub
  (menunggu dokumentasi API resmi).
- Lisensi dikunci ke nomor akun MT; jenis lisensi (SEWA / FREE IB / SHARING PROFIT / TRIAL) ikut ke panel EA lewat builder.
- Admin bisa memperpanjang lisensi (hari / bulan) di Admin > Lisensi; EA otomatis di-compile ulang.
- Pengingat email + notifikasi H-3, H-1, hari habis, lalu email perpanjangan sehari sesudahnya.
- Cron: `.github/workflows/daily.yml` (08:00 WIB: sharing mingguan hari Minggu, tagihan, pengingat) dan `payments.yml` (tiap 10 menit: cek USDT).
- Tes tanda tangan gateway: `node scripts/test-gateway-signature.mjs`.

## Coba di komputer sendiri

```powershell
npm install
npx wrangler d1 migrations apply goldhunter-db --local
copy .dev.vars.example .dev.vars    # lalu isi (lihat komentar di file)
npx wrangler pages dev --port 8788  # buka http://localhost:8788
```

Email yang tercantum di `ADMIN_EMAILS` otomatis menjadi admin saat mendaftar.
Builder lokal: salin `builder/config.example.json` ke `builder/config.json`, set `api_base` ke `http://127.0.0.1:8788`
dan `token` sama dengan `BUILDER_TOKEN` di `.dev.vars`, lalu jalankan `python builder/ghg_builder.py`.

Sebelum commit, jalankan `python scripts/version-assets.py` supaya browser langsung memuat JS/CSS terbaru.

## Tayang di goldhuntergaruda.com (sekali saja)

1. Beli domain `goldhuntergaruda.com` di Cloudflare (Domain Registration).
2. `npx wrangler login`
3. `npx wrangler d1 create goldhunter-db`, lalu salin `database_id` ke `wrangler.toml`.
4. `npm run db:migrate:remote`
5. Cloudflare dashboard → Workers & Pages → **goldhunter-garuda** → Settings → Variables and Secrets, tambahkan (tipe *Secret*):
   `ADMIN_EMAILS`, `DATA_KEY` (32 byte base64), `BUILDER_TOKEN`, `CRON_SECRET`.
   **Simpan DATA_KEY baik-baik**: jika hilang, password trading/VPS yang tersimpan tidak bisa dibaca lagi.
6. `git push` (Cloudflare otomatis deploy), lalu Custom domains → tambahkan `goldhuntergaruda.com`.
7. Daftar di web dengan email admin, lalu buka **/admin**. Atur rekening bank, harga, WhatsApp, dan **Email** (Resend).
8. Builder: `builder/config.json` → `api_base: https://goldhuntergaruda.com`, `token` = BUILDER_TOKEN.
   Jalankan **Pasang Autostart Builder.bat** supaya builder ikut menyala bersama Windows.
9. GitHub repo → Settings → Secrets → Actions → `CRON_SECRET` (sama dengan langkah 5) untuk pengingat harian.
