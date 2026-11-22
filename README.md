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

## Pembaruan 10 — Data Pendamping bernama
- Pendamping didaftarkan lengkap (Nama, Dapukan, Jenis, Kelompok/Desa); kartu menampilkan nama & dapukan.
- Scan kartu pendamping: nama langsung muncul dan hadir tercatat otomatis.
- Absen manual hanya menampilkan pengurus yang belum absen.
- Total hadir = pengurus wajib + pendamping (persentase tetap khusus pengurus).
- Pembaruan 11: data pendamping ditambah Tempat/Tanggal lahir, Alamat, No. HP (tampil di kartu).
- Pembaruan 12: urutan form pendamping disusun ulang; No. HP disimpan tetapi tidak dicetak di kartu.
- Pembaruan 13: tombol Simpan selalu tampil di bawah form pendamping.
- Pembaruan 14: unggah foto pendamping (tampil di ID Card).
- Pembaruan 15: pengurus bisa punya beberapa dapukan; ID Card menampilkan dapukan bertingkat tertinggi (Daerah > Desa > Kelompok).
- Pembaruan 16: Data Pengurus menampilkan semua dapukan; filter & pencarian mencakup semua dapukan.
