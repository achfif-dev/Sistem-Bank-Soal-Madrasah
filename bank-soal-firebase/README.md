# Bank Soal Madrasah (Firebase)

Penyusunan, review, dan ekspor soal berbasis teks kitab. Semua berjalan di Firebase:

| Bagian | Layanan |
|---|---|
| Halaman | Firebase Hosting (`public/index.html`) |
| Login | Firebase Authentication (Google) |
| Bank soal bersama | Cloud Firestore (`soal`, `users`) + `firestore.rules` |
| API AI (Claude) | Cloud Functions: `/api/generate`, `/api/session` |
| API key Anthropic | Secret Manager (`firebase functions:secrets:set`) |

Peran: **pending** (baru daftar), **penyusun** (membuat soal), **editor** (menyetujui atau meminta revisi), **admin** (mengelola pengguna dan semua soal), **nonaktif**.
Editor tidak bisa menyetujui soal buatannya sendiri.

## Fitur teks kitab dan bantuan AI

**Ambil teks kitab**
- *Dari tautan online:* tempel alamat satu halaman dari shamela.ws, al-maktaba.org, islamweb.net, ar.wikisource.org, atau archive.org (teks). Server mengambil halaman itu, menyaring isi kitab (menu, skrip, dan catatan kaki dibuang), lalu mengisi kolom teks. Untuk shamela.ws dan al-maktaba.org, nama kitab dan nomor halaman terisi dari judul halaman. Tombol "Halaman sebelumnya/berikutnya" dan kotak "Tambahkan ke teks yang sudah ada" memudahkan bahasan yang berlanjut. Tautan sumber disimpan bersama soal.
- *Dari Maktabah Syamilah desktop:* aplikasi ini berjalan offline di Windows dan tidak bisa diakses dari web. Salin teks dari aplikasinya (atau ekspor ke .txt), lalu tempel atau pakai tombol "Impor file .txt". Tombol "Bersihkan teks" membuang penanda halaman seperti `[ص: 12]`, nomor catatan kaki `(1)`, tatwil, dan karakter tak terlihat.
- Daftar situs diatur lewat `KITAB_ALLOWED_HOSTS`. Server hanya mau mengambil https dari domain di daftar itu, memeriksa ulang setiap pengalihan, dan membatasi ukuran dan waktu.
- Teks selalu bisa disunting sebelum dipakai. Struktur halaman situs bisa berubah; bila gagal, salin manual. Pastikan penggunaan teks sesuai ketentuan situs sumber dan hak cipta edisi kitabnya: aplikasi ini hanya mengambil kutipan pendek untuk bahan soal dan mencatat sumbernya.

**Bantuan AI** (semua berdasar teks Arab yang Anda berikan, dengan konteks Ahlussunnah wal Jamaah yang moderat)
- *Terjemahkan:* terjemahan Indonesia, poin inti, dan istilah penting.
- *Analisis teks:* tema, hal yang ditegaskan teks, ide soal per level (L1/L2/L3), calon pengecoh, dan perbedaan pendapat bila teks menyebutnya. Tombol "Buat soal dari fokus ini" mengisi fokus untuk Generate.
- *Telaah & Perbaiki:* AI memeriksa kunci, pengecoh, kejelasan, level, bahasa, pembahasan, rujukan, dan indikator terhadap teks kitab, lalu mengusulkan soal yang diperbaiki. Perbaikan baru masuk form setelah Anda menekan "Terapkan", dan ada tombol "Urungkan". Editor punya tombol "Telaah AI" di tab Review, dengan opsi menyalin temuan ke catatan revisi.

## Pemasangan

Butuh Node 22 dan akun Google.

1. **Buat project** di https://console.firebase.google.com. Naikkan ke paket **Blaze** (Cloud Functions dan Secret Manager mewajibkannya; ada kuota gratis). Pasang peringatan anggaran di Google Cloud Billing.
2. **Authentication** > Sign-in method > aktifkan **Google**.
3. **Firestore Database** > Create database > mode Production, lokasi **asia-southeast2 (Jakarta)**. Lokasi ini sama dengan wilayah fungsi di `functions/index.js` dan `firebase.json`.
4. Pasang CLI dan login:
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
5. Isi ID project di `.firebaserc` (atau `firebase use --add`).
6. Pasang dependensi fungsi:
   ```bash
   cd functions && npm install && cd ..
   ```
7. **Simpan API key sebagai secret** (bukan di file, bukan di Git):
   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY
   ```
   Tempel key saat diminta.
8. Atur admin pertama: salin `functions/.env.example` menjadi `functions/.env`, isi `ADMIN_EMAILS=email-google-anda@gmail.com`. Opsional: `ALLOWED_EMAIL_DOMAIN` untuk membatasi domain email sekolah.
9. Deploy:
   ```bash
   firebase deploy
   ```
10. Buka URL Hosting yang ditampilkan, masuk dengan Google memakai email admin tadi. Akun itu otomatis menjadi admin. Guru lain yang masuk berstatus "Menunggu persetujuan" sampai Anda memberi peran di tab **Pengguna**.

Mencoba tanpa mengganggu situs utama: `firebase hosting:channel:deploy uji` menghasilkan URL pratinjau. Domain pratinjau dan domain kustom perlu ditambahkan di Authentication > Settings > Authorized domains bila belum otomatis.

## Upload ke GitHub

```bash
git init && git add . && git commit -m "Bank Soal Madrasah (Firebase)"
git branch -M main
git remote add origin https://github.com/<akun>/<repo>.git
git push -u origin main
```

`.gitignore` sudah mengecualikan `functions/.env`, `node_modules`, dan `.firebase/`. Tidak ada rahasia di repositori: API key ada di Secret Manager, dan konfigurasi web Firebase disediakan otomatis oleh Hosting (`/__/firebase/init.json`).

## Keamanan dan biaya

- Browser tidak pernah memegang API key. `/api/generate` memverifikasi token login, memeriksa peran di Firestore, lalu memanggil Claude.
- Batas pemakaian per pengguna disimpan di Firestore (`rate/{uid}`), berlaku di semua instance: 8 per menit dan 100 per hari secara bawaan untuk semua fitur AI (`LIMIT_PER_MINUTE`, `LIMIT_PER_DAY`), dan 10 per menit dan 200 per hari untuk pengambilan teks kitab (`LIMIT_KITAB_PER_MINUTE`, `LIMIT_KITAB_PER_DAY`). `maxInstances: 5` membatasi lonjakan.
- `firestore.rules` memaksa: hanya peran aktif yang boleh membaca soal; penyusun hanya mengubah soalnya sendiri saat Draft atau Perlu Revisi; hanya editor/admin yang boleh mengubah status menjadi Approved; peran hanya diubah admin. Profil pengguna hanya dibuat server.
- Atur batas pengeluaran bulanan di Console Anthropic dan anggaran di Google Cloud.
- Jika API key pernah tampil di chat atau commit: buat ulang di Console, lalu jalankan lagi langkah 7.

## Kontrak API

Semua permintaan membawa `Authorization: Bearer <ID token Firebase>`.

`POST /api/generate` dengan `{ teks, nama, juz, hal, tingkat, mapel, level }` mengembalikan `{ soal: { stimulus, pertanyaan, pilihan_a..e, kunci_jawaban, pembahasan, indikator_kisi_kisi } }`.
Galat: `{ error: { code, message, retryAfter? } }` dengan kode `AUTH_REQUIRED` (401), `FORBIDDEN_ROLE` (403), `INVALID_ARABIC`/`TEKS_TOO_LONG`/`TEKS_TIDAK_MEMADAI` (422), `RATE_LIMIT_LOCAL`/`RATE_LIMIT_DAILY`/`RATE_LIMIT` (429), `AI_*` (502-504).

`POST /api/assist` dengan `{ aksi: "terjemah" | "analisis" | "telaah", teks, nama, tingkat, mapel, ... }` mengembalikan `{ aksi, hasil }`. Untuk `telaah`, tambahkan `juz`, `hal`, `level`, dan `soal: { stimulus, pertanyaan, opsi: {A..E}, kunci, pembahasan, indikator }`.

`POST /api/kitab` dengan `{ url }` mengembalikan `{ sumber: { url, host, judul, nama, hal, teks, terpotong } }`. Galat khusus: `URL_INVALID`, `URL_NOT_ALLOWED`, `SUMBER_NOT_FOUND`, `SUMBER_BLOCKED`, `SUMBER_TIMEOUT`, `SUMBER_BUKAN_TEKS`, `TEKS_TIDAK_DITEMUKAN`.

`POST /api/session` membuat atau menyegarkan profil pengguna setelah login.

## Struktur

```
public/index.html            frontend React (satu file)
functions/index.js           Cloud Functions: generate, assist, kitab, session
functions/src/soalService.js validasi, system prompt, panggilan Claude
functions/src/assistService.js terjemah, analisis, telaah soal
functions/src/kitabFetch.js  pengambilan dan penyaringan teks kitab online
functions/src/access.js      peran, domain, batas pemakaian (logika murni)
functions/test/              tes: cd functions && npm test
firestore.rules              aturan keamanan data
firebase.json, .firebaserc   konfigurasi Firebase
```

## Catatan

- Frontend memuat React, Tailwind, dan Babel dari CDN agar tanpa langkah build.
- Soal AI tetap perlu ditelaah manusia lewat tab Review/Validasi.
- Penyaringan halaman situs kitab dirancang dari struktur umum (`class="nass"` di shamela.ws/al-maktaba.org) dan diuji dengan HTML contoh, belum dengan semua situs. Coba beberapa halaman nyata setelah deploy.
