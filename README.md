# Noor Presence — Absensi Pengajian Pengurus

Frontend statis (HTML/CSS/JS) untuk GitHub Pages. Backend: Google Apps Script (REST API JSON) + Google Sheets.

```
index.html      ← halaman utama (HARUS di root repo)
css/style.css
js/config.js    ← isi GAS_URL di sini
js/app.js
```

Isi `js/config.js` dengan URL Web App Apps Script (`.../exec`) sebelum upload.
Panduan lengkap: lihat `PANDUAN-INSTALASI.md`.

## Pembaruan: ID Card, Pendamping, Hapus
- Judul kartu otomatis: ID CARD PENGURUS DAERAH / DESA / KELOMPOK (pilih "Tingkat pengurus" di form).
- Kode barcode baru berformat `KTP-` + inisial + angka (mis. `KTP-IH001`). Kartu lama tetap valid.
- Unduh JPG: tombol di pratinjau kartu, atau centang beberapa pengurus lalu "JPG Terpilih".
- Kartu Pendamping (PDP-001 dst): cetak/unduh dari tombol "Kartu Pendamping". Saat dipindai di sesi aktif, muncul isian Nama, Kelompok, Desa, Dapukan. Pendamping belum masuk Laporan.
- Hapus: ikon hapus per baris, atau "Hapus Terpilih". Yang punya riwayat kehadiran ditanya ulang sebelum dihapus beserta riwayatnya.
- Umur otomatis dari tanggal lahir (di kartu, tabel, dan form).
- Logo di sidebar mengikuti logo yang diunggah di Pengaturan → ID Card.
- Kartu Belakang: tombol "Cetak Belakang" / "Kartu Belakang" (cetak atau JPG).
