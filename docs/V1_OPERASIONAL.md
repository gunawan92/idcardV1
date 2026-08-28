# STELA Photo Production V1 - Panduan Operasional

## Fungsi V1

V1 berhenti sampai workflow berikut:

1. Buat Production Session.
2. Import Excel siswa.
3. Preview seluruh kolom dari sheet Excel.
4. Register folder foto kamera lokal.
5. Matching No Foto Excel dengan filename kamera.
6. Copy + rename foto ke folder session.
7. QC hasil rename: OK, Cek, Tolak.
8. Background removal lokal via Python, 1 foto per klik.
9. Output remove background PNG rasio 4:3 dengan subject center.
10. Buat manifest XLSX.

V1 belum masuk approval production final, crop advanced, auto alignment detail, ready-to-print packaging final, atau agent integration.

## Cara Menjalankan Harian

Cara cepat:

1. Double click `START_V1.bat`.
2. Tunggu 2 terminal terbuka:
   - Backend API: `http://localhost:3001`
   - Frontend: `http://localhost:5174`
3. Buka browser ke `http://localhost:5174`.

Cara manual:

Terminal backend:

```bat
cd /d C:\xampp\htdocs\SETDEV\production-win\backend
npm start
```

Terminal frontend:

```bat
cd /d C:\xampp\htdocs\SETDEV\production-win\frontend
npm run dev -- --host 127.0.0.1 --port 5174
```

## Shortcut Workflow Operator

1. Step `Session`
   - Isi nama sekolah.
   - Isi tanggal foto.
   - Isi periode.
   - Pilih file Excel.
   - Klik `Buat Session + Import XLSX`.

2. Step `Data Siswa`
   - Cek total, valid, invalid.
   - Pastikan semua kolom Excel tampil.
   - Row invalid harus dicek sebelum lanjut produksi serius.

3. Step `Foto RAW`
   - Isi path folder foto kamera, contoh:

```text
C:\xampp\htdocs\SETDEV\production-win\bahan\SD ALZIND 24 8 2026\foto
```

   - Klik `Scan Folder`.
   - Sistem hanya register path foto, bukan copy semua file.

4. Step `Matching`
   - Klik `Run Matching`.
   - Cek status:
     - `MATCHED`: data Excel dan foto cocok.
     - `PHOTO_MISSING`: data siswa ada, foto belum ketemu.
     - `DATA_NOT_FOUND`: foto ada, data siswa tidak ada.
     - `DUPLICATE_NUMBER`: No Foto duplicate.
     - `FILENAME_CONFLICT`: nama output bentrok.
   - Kalau aman, klik `Copy & Rename`.

5. Step `QC Rename`
   - Cek thumbnail hasil rename.
   - Klik:
     - `OK`: foto disetujui.
     - `Cek`: perlu review ulang.
     - `Tolak`: tidak lolos.
   - Jika semua sudah OK, klik `Ready for Processing`.

6. Step `Remove BG`
   - Klik `Process 1 Foto`.
   - Tunggu sampai selesai.
   - Klik lagi untuk foto berikutnya.
   - Jangan proses batch besar di laptop RAM terbatas.

7. Manifest
   - Dari area hasil rename, klik `Buat Manifest`.
   - File manifest dibuat di folder session.

## Folder Output

Data aplikasi:

```text
data\production.db
```

Storage session:

```text
storage\sessions\{session_id}\
```

Isi folder session:

```text
import\       file Excel yang diimport
renamed\      hasil copy + rename dari foto original
processing\   hasil remove background PNG 4:3
review\       disiapkan untuk tahap berikutnya
ready\        disiapkan untuk tahap berikutnya
manifest.xlsx hasil manifest
```

Foto original di folder kamera tidak dihapus dan tidak diubah.

## Catatan Remove Background

V1 memakai Python worker lokal:

```text
worker\remove_bg.py
```

Output:

- Format PNG.
- Background transparan.
- Rasio 4:3.
- Subject center.

Run pertama `rembg` akan download model sekitar 1 GB. Setelah itu model tersimpan di cache user Windows dan proses berikutnya tidak download ulang.

Karena proses ini berat, V1 sengaja dibuat 1 foto per klik untuk menghindari out of memory.

## Stop Aplikasi

Tutup dua terminal yang dibuka `START_V1.bat`, atau tekan `Ctrl+C` di masing-masing terminal.

