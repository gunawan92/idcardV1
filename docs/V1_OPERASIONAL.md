# STELA Photo Production V1 - Panduan Operasional

## Fungsi V1

V1 berhenti sampai workflow berikut:

1. Buat Production Session.
2. Import Excel siswa.
3. Preview seluruh kolom dari sheet Excel.
4. Register folder foto kamera lokal.
5. Matching No Foto Excel dengan filename kamera.
6. Process foto: remove background, isi background baru dari input hex color.
7. Output processing berupa JPG RGB rasio 4:3.
8. Rename hasil processing ke dua folder output: nama murid dan serial cetak.
9. QC hasil output cetak: OK, Cek, Tolak.
10. Buat manifest XLSX.

V1 belum masuk approval production final, crop advanced, auto alignment detail, ready-to-print packaging final, atau agent integration.

## Cara Menjalankan Harian

Cara cepat:

1. Double click `START_V1.bat`.
2. Tunggu 2 terminal terbuka:
   - Backend API: `http://localhost:3001`
   - PWA frontend: `http://localhost:5174`
3. `START_V1.bat` akan membuka window app STELA otomatis.
4. Kalau window app masih blank, tunggu Vite selesai lalu refresh.

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

Setelah frontend aktif, buka:

```text
http://localhost:5174
```

Browser Chrome/Edge akan mendeteksi STELA sebagai PWA. Operator bisa klik icon install di address bar untuk memasang shortcut app lokal.

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
   - Kalau aman, lanjut ke step `Process Foto`.

5. Step `Process Foto`
   - Pilih warna background memakai color picker atau input hex, contoh `#FFFFFF`.
   - Klik `Process 1 Foto`.
   - Tunggu sampai selesai.
   - Klik lagi untuk foto berikutnya.
   - Sistem membuat JPG RGB 4:3 di folder `processing`.
   - Kalau semua foto selesai, klik `Buat Output Cetak`.

6. Step `Output Cetak`
   - Cek thumbnail hasil rename final.
   - Klik:
     - `OK`: foto disetujui.
     - `Cek`: perlu review ulang.
     - `Tolak`: tidak lolos.

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
renamed\      hasil copy + rename dengan nama murid
serial\       hasil copy + rename dengan serial No Foto untuk cetak
processing\   hasil process foto JPG RGB 4:3 dengan background baru
review\       disiapkan untuk tahap berikutnya
ready\        disiapkan untuk tahap berikutnya
manifest.xlsx hasil manifest
```

Foto original di folder kamera tidak dihapus dan tidak diubah.

Output cetak V1 sengaja dibuat dua versi setelah processing selesai:

```text
renamed\Allysha Putri Anwar.JPG
serial\9693.JPG
```

Nilai serial berasal dari kolom `No Foto` di XLSX. File di folder `renamed` dan `serial` berasal dari JPG hasil processing, bukan dari RAW original.

## Catatan Remove Background

V1 memakai Python worker lokal:

```text
worker\remove_bg.py
```

Output:

- Format JPG.
- Mode warna RGB.
- Background baru sesuai input hex color operator, atau `No Fill` untuk mempertahankan background original.
- Rasio portrait 3:4 untuk frame pasfoto/cetak 4x3.
- Subject center dengan posisi kepala dan bahu lebih penuh seperti sample pasfoto.

Run pertama `rembg` akan download model sekitar 1 GB. Setelah itu model tersimpan di cache user Windows dan proses berikutnya tidak download ulang.

Karena proses ini berat, V1 sengaja dibuat 1 foto per klik untuk menghindari out of memory.

## Stop Aplikasi

Tutup dua terminal yang dibuka `START_V1.bat`, atau tekan `Ctrl+C` di masing-masing terminal.

## PWA Lokal

File PWA berada di frontend:

```text
frontend\public\manifest.webmanifest
frontend\public\service-worker.js
frontend\public\pwa-icon.svg
```

Catatan:

- PWA tetap membutuhkan backend dan frontend lokal aktif.
- PWA bukan aplikasi offline penuh untuk proses produksi karena API backend, database, dan foto lokal tetap harus berjalan di PC.
- `START_V1.bat` membuka Chrome/Edge dengan mode app melalui `--app=http://localhost:5174`.
