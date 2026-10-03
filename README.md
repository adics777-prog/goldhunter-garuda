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
| EA Gratis (IB Exness) | Member ajukan nomor akun, admin cek di portal partner lalu klik **Ya, under IB**, **Proses** (EA di-compile), **Selesai** (otomatis) |
| VPS untuk EA Gratis (IB) | Seperti di atas, ditambah member transfer Rp 50rb/bulan. Admin isi detail VPS, lalu klik **Selesai** |
| Sewa EA / Beli EA / VPS + EA | Member transfer dan upload bukti, admin klik **Proses** (EA di-compile, terkunci di akun + tanggal habis), lalu **Selesai** |

- Lisensi dikunci ke nomor akun MT. Untuk ganti akun, member mengajukan, admin menyetujui, dan EA otomatis di-compile ulang.
- Pengingat email 7/3/1 hari sebelum masa sewa habis, dengan link **Perpanjang**.
- EA sewa berhenti sendiri setelah tanggal habis. EA gratis (IB) dan EA beli tidak ada tanggal habis.

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
