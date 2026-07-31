# Deploy Forge Backend ke Vercel

Dokumen ini menjelaskan deployment `forge-be` menggunakan Vercel, Neon PostgreSQL, Prisma, dan Gemini API. Setelah backend selesai, lanjutkan dengan panduan deployment di repository `forge-fe`.

## Arsitektur produksi

```text
Browser
  │
  ├── https://<forge-fe>.vercel.app
  │        Next.js frontend
  │
  └── https://<forge-be>.vercel.app
           Express Vercel Function
             ├── Neon PostgreSQL
             └── Gemini Developer API
```

Gemini API key hanya boleh berada di environment backend. Jangan pernah menambahkan key tersebut ke repository, browser, atau variable yang diawali `NEXT_PUBLIC_`.

## Prasyarat

- Akun GitHub.
- Akun [Vercel](https://vercel.com/).
- Project PostgreSQL di [Neon](https://neon.com/).
- Gemini API key dari [Google AI Studio](https://aistudio.google.com/apikey).
- Node.js 20 atau lebih baru untuk menjalankan migration dari komputer lokal.

## 1. Siapkan repository backend

Folder `forge-be` harus menjadi repository Git tersendiri. Pastikan `.env` tidak ikut ter-commit.

```bash
cd forge-be
git init
git add .
git commit -m "Initial Forge backend"
git branch -M main
git remote add origin https://github.com/<username>/forge-be.git
git push -u origin main
```

Jika repository sudah memiliki Git remote, cukup commit dan push perubahan terbaru. Jangan menjalankan `git init` lagi.

## 2. Buat database Neon

1. Buat project baru di Neon.
2. Buka **Connect** pada Neon Console.
3. Salin dua connection string:
   - Connection pooling aktif untuk `DATABASE_URL`. Host biasanya mengandung `-pooler`.
   - Connection pooling nonaktif/direct untuk `DIRECT_URL`.
4. Simpan keduanya sebagai secret. Jangan menambahkannya ke Git.

Contoh bentuk variable:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST-pooler/forge?sslmode=require"
DIRECT_URL="postgresql://USER:PASSWORD@HOST/forge?sslmode=require"
```

Vercel Functions sebaiknya menggunakan pooled connection untuk request aplikasi, sedangkan Prisma migration menggunakan direct connection. Lihat [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).

## 3. Buat project Vercel backend

1. Di Vercel Dashboard, pilih **Add New → Project**.
2. Import repository `forge-be`.
3. Pastikan **Root Directory** menunjuk ke root `forge-be`.
4. Biarkan Install Command menggunakan `npm install`.
5. Konfigurasi `vercel.json` yang tersedia akan mengarahkan request ke `api/index.ts`.
6. Jangan deploy sebelum environment variables di bawah sudah diisi.

## 4. Tambahkan environment variables backend

Masuk ke **Project Settings → Environment Variables**. Tambahkan variable berikut untuk Production. Gunakan variable terpisah untuk Preview jika Preview memakai database berbeda.

| Variable | Wajib | Contoh/keterangan |
|---|---:|---|
| `DATABASE_URL` | Ya | Neon pooled connection string |
| `DIRECT_URL` | Ya | Neon direct connection string |
| `JWT_SECRET` | Ya | Secret acak minimal 32 byte |
| `FRONTEND_URL` | Ya | URL frontend tanpa trailing slash; boleh dipisah koma |
| `GEMINI_API_KEY` | Ya untuk AI | API key server-side dari Google AI Studio |
| `GEMINI_MODEL` | Tidak | `gemini-2.5-flash-lite` |
| `GEMINI_TIMEOUT_MS` | Tidak | `45000` |
| `AI_FALLBACK_MODE` | Tidak | `true` agar AI lokal aktif ketika Gemini gagal |
| `AI_RATE_LIMIT_PER_MINUTE` | Tidak | `20` |
| `ALLOW_CLIENT_MODEL_OVERRIDE` | Tidak | `true`; tetap dibatasi allowlist backend |
| `GEMINI_ALLOWED_MODELS` | Tidak | Daftar model dipisahkan koma |

Generate JWT secret di komputer lokal:

```bash
openssl rand -base64 48
```

Untuk deployment backend pertama, jika URL frontend belum tersedia, isi sementara:

```env
FRONTEND_URL="https://placeholder.invalid"
```

Setelah frontend mendapat domain Vercel, ganti variable ini dengan URL frontend yang sebenarnya dan redeploy backend.

Jangan mengaktifkan `AUTH_DISABLED` di production. Backend memang mengabaikan bypass ini ketika `NODE_ENV=production`, tetapi sebaiknya variable tersebut tidak dibuat sama sekali.

## 5. Deploy backend pertama kali

Klik **Deploy**. Setelah deployment berhasil, catat domain backend, misalnya:

```text
https://forge-be.vercel.app
```

Periksa health endpoint:

```bash
curl https://forge-be.vercel.app/health
```

Output yang diharapkan:

```json
{"ok":true,"runtime":"node","env":"production"}
```

Health check hanya membuktikan Function hidup. Database belum siap sampai migration dijalankan.

## 6. Jalankan Prisma migration

Migration production harus menggunakan `prisma migrate deploy`, bukan `prisma migrate dev` atau `prisma db push`. Command tersebut menerapkan migration yang belum dijalankan tanpa mereset data. Lihat [Prisma migrate deploy](https://docs.prisma.io/docs/cli/migrate/deploy).

### Opsi A — deployment pertama dari komputer lokal

Link folder backend ke project Vercel dan tarik environment Production ke file `.env` yang sudah di-ignore oleh Git:

```bash
cd forge-be
npx vercel link
npx vercel env pull .env --environment=production
npx prisma migrate deploy
```

Jangan commit file `.env`. Setelah migration, simpan atau hapus file tersebut sesuai kebijakan secret management tim.

### Opsi B — CI/CD

Untuk production jangka panjang, jalankan command berikut pada pipeline hanya ketika `prisma/migrations/**` berubah:

```bash
npx prisma migrate deploy
```

Berikan `DATABASE_URL` dan `DIRECT_URL` melalui GitHub Actions Secrets atau secret manager CI, bukan file repository. Prisma merekomendasikan migration production dijalankan melalui pipeline. Lihat [Prisma deployment guide](https://docs.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate).

Seed demo tidak diperlukan di production. Pengguna pertama dapat membuat akun melalui halaman Register di frontend.

## 7. Deploy frontend dan perbarui CORS

Ikuti `DEPLOYMENT.md` di repository `forge-fe` dan isi:

```env
NEXT_PUBLIC_FORGE_API_URL="https://forge-be.vercel.app"
```

Setelah frontend mendapat URL production, kembali ke environment backend:

```env
FRONTEND_URL="https://forge-fe.vercel.app"
```

Untuk lebih dari satu origin:

```env
FRONTEND_URL="https://forge-fe.vercel.app,https://preview-forge-fe.vercel.app"
```

Gunakan origin lengkap tanpa path dan tanpa trailing slash. Environment variable baru hanya berlaku pada deployment baru, sehingga backend harus di-redeploy setelah `FRONTEND_URL` berubah. Lihat [Vercel environment variables](https://vercel.com/docs/environment-variables).

## 8. Verifikasi end-to-end

1. Buka URL frontend.
2. Register akun baru dengan password minimal delapan karakter.
3. Buat project.
4. Buka AI Workspace dan kirim prompt `Generate PRD untuk login dan register`.
5. Pastikan Requirement muncul dan respons AI tidak error.
6. Klik **Send to Kanban**.
7. Pastikan task Kanban terbentuk.
8. Buka Design Canvas, buat sebuah frame, tunggu minimal satu detik, lalu refresh.
9. Pastikan screen dan node canvas tetap tersimpan.

Pada respons `POST /api/ai/chat`, nilai `mode` seharusnya `gemini`. Jika bernilai `local`, periksa Gemini key, quota, model, dan log Vercel.

## Preview deployment

Vercel Preview memiliki environment variables sendiri. Gunakan database/branch Neon terpisah jika Preview tidak boleh menyentuh data Production. Karena CORS backend memakai exact origin, gunakan fixed branch alias atau tambahkan URL Preview yang memang diperlukan ke `FRONTEND_URL`.

## Troubleshooting

### `Origin is not allowed by CORS`

- Pastikan `FRONTEND_URL` sama persis dengan origin browser.
- Jangan menambahkan path atau trailing slash.
- Setelah mengubah variable, redeploy backend.

### `401 Bearer token is required` atau `INVALID_TOKEN`

- Sign out lalu sign in kembali.
- Pastikan `JWT_SECRET` tidak berubah antar-deployment.
- Jika secret sengaja dirotasi, semua session lama memang harus login ulang.

### Prisma `P2021` atau tabel tidak ditemukan

Jalankan:

```bash
npx prisma migrate deploy
```

Pastikan command menggunakan database Production yang benar.

### Terlalu banyak koneksi database

Pastikan `DATABASE_URL` menggunakan host Neon pooled (`-pooler`) dan `DIRECT_URL` menggunakan direct connection.

### AI selalu menggunakan `mode: local`

- Pastikan `GEMINI_API_KEY` ada pada environment deployment yang sedang dibuka.
- Pastikan model berada dalam `GEMINI_ALLOWED_MODELS`.
- Periksa quota dan Vercel Function logs.
- Pastikan backend sudah di-redeploy setelah variable ditambahkan.

### Perubahan environment tidak terlihat

Vercel tidak menerapkan perubahan environment variable ke deployment lama. Buat deployment baru atau gunakan **Redeploy**.

## Checklist production

- [ ] `.env` dan seluruh secret tidak pernah masuk Git.
- [ ] `DATABASE_URL` menggunakan pooled connection.
- [ ] Migration Production berhasil.
- [ ] `JWT_SECRET` kuat dan stabil.
- [ ] `FRONTEND_URL` memakai domain frontend sebenarnya.
- [ ] `GEMINI_API_KEY` hanya ada di backend.
- [ ] Register, project, Gemini, Kanban, dan canvas persistence sudah diuji.
- [ ] Preview tidak memakai database Production tanpa sengaja.
- [ ] Dependency audit dan backup database sudah ditinjau sebelum public launch.
