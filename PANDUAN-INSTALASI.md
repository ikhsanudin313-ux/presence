# Panduan Migrasi — Noor Presence (Backend GAS + Frontend GitHub Pages)

## Gambaran
- **Backend** = Google Apps Script (hanya API JSON). Data tetap di Google Sheets Anda.
- **Frontend** = folder `noor-presence` (ZIP) → GitHub Pages.
- **Data lama aman.** Pakai proyek Apps Script & Spreadsheet yang sudah ada (tidak perlu setup ulang).

## A. Backend (Apps Script)
1. Buka proyek Apps Script Anda yang lama.
2. Ganti **seluruh isi** file `Kode` dengan `Kode.gs` yang baru.
3. **Hapus** file `Index`, `Stylesheet`, dan `JavaScript` (tidak dipakai lagi).
4. Ganti `appsscript.json` bila perlu (Project Settings → centang "Show appsscript.json"). Isinya sama dengan yang lama.
5. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.**
   Pengaturan: Execute as **Me**, Who has access **Anyone**.
6. Salin URL Web App (berakhiran `/exec`).
7. Tes: buka URL itu di browser → harus tampil `{"ok":true,"app":"Noor Presence","msg":"API aktif..."}`.

> Proyek baru (bukan upgrade)? Tempel `Kode.gs`, jalankan `setupApp` sekali, catat akun awal di log, lalu deploy seperti di atas.

## B. Frontend
1. Ekstrak ZIP → folder **`noor-presence`**. Folder inilah yang di-`git init` (di dalamnya langsung terlihat `index.html`, `css`, `js`).
2. Buka `js/config.js`, ganti `GANTI_DENGAN_URL_EXEC_APPS_SCRIPT` dengan URL `/exec` tadi (tetap dalam tanda kutip).
3. Lanjut ke GitHub Pages (dipandu langkah demi langkah di chat).

## C. Tes
1. Buka `https://USERNAME.github.io/NAMA-REPO/`
2. Login → data tampil. Ubah satu data → cek di Google Sheets.
3. F12 → Console: tidak boleh ada error merah soal CORS.

## Catatan
- Setiap mengubah **Kode.gs**: Deploy → New version. Setiap mengubah **frontend**: `git add .` → `git commit` → `git push`, lalu Ctrl+Shift+R.
- Kamera scan sekarang berjalan di HTTPS GitHub Pages (lebih andal daripada di dalam Apps Script).
- Jika login gagal dengan "Respons server tidak valid": deployment belum versi terbaru atau akses bukan "Anyone".
