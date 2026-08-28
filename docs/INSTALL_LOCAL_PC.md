# Install STELA Photo Production V1 di PC Baru

## Software Wajib

Install ini dulu:

1. Node.js 22.x atau lebih baru.
2. Python 3.12 atau lebih baru.
3. Git, jika source diambil dari repository.
4. Browser Chrome/Edge.

Catatan backend: project memakai `node:sqlite`, jadi gunakan Node.js versi modern. Jika pakai Node lama, backend bisa gagal start.

## Copy Project

Copy folder project ke lokasi lokal, contoh:

```text
C:\xampp\htdocs\SETDEV\production-win
```

Lokasi boleh beda, tapi path folder foto nanti harus sesuai lokasi PC tersebut.

## Install Dependency Backend

```bat
cd /d C:\xampp\htdocs\SETDEV\production-win\backend
npm install
```

## Install Dependency Frontend

```bat
cd /d C:\xampp\htdocs\SETDEV\production-win\frontend
npm install
```

## Install Dependency Python Worker

```bat
cd /d C:\xampp\htdocs\SETDEV\production-win
python -m pip install -r worker\requirements.txt
```

Jika PC punya beberapa versi Python, pakai launcher:

```bat
py -3.12 -m pip install -r worker\requirements.txt
```

## Test Instalasi

Backend syntax:

```bat
cd /d C:\xampp\htdocs\SETDEV\production-win
node -c backend\server.js
```

Backend unit test:

```bat
cd /d C:\xampp\htdocs\SETDEV\production-win\backend
npm test
```

Frontend build:

```bat
cd /d C:\xampp\htdocs\SETDEV\production-win\frontend
npm run build
```

Python worker compile:

```bat
cd /d C:\xampp\htdocs\SETDEV\production-win
python -m py_compile worker\remove_bg.py
```

## Jalankan Aplikasi

Double click:

```text
START_V1.bat
```

Atau jalankan manual:

```bat
cd /d C:\xampp\htdocs\SETDEV\production-win\backend
npm start
```

Terminal kedua:

```bat
cd /d C:\xampp\htdocs\SETDEV\production-win\frontend
npm run dev -- --host 127.0.0.1 --port 5174
```

Buka:

```text
http://localhost:5174
```

## Port yang Dipakai

Backend:

```text
3001
```

Frontend:

```text
5174
```

Kalau port bentrok, tutup aplikasi lama yang memakai port itu.

## File yang Perlu Dibackup

Backup minimal:

```text
data\production.db
storage\
```

Jika foto original tetap berada di folder kamera eksternal, backup folder foto original juga.

## Troubleshooting

Backend gagal start:

- Pastikan Node.js 22+.
- Jalankan `npm install` di folder `backend`.
- Cek port 3001 belum dipakai aplikasi lain.

Frontend gagal start:

- Jalankan `npm install` di folder `frontend`.
- Cek port 5174 belum dipakai aplikasi lain.

Remove background gagal:

- Jalankan `python -m pip install -r worker\requirements.txt`.
- Pastikan Python bisa dipanggil dengan command `python`.
- Run pertama butuh internet untuk download model `rembg` sekitar 1 GB.
- Jika laptop out of memory, jangan klik berulang. Tunggu 1 foto selesai dulu.

Foto tidak match:

- Pastikan kolom No Foto di Excel berisi angka foto.
- Pastikan filename kamera punya angka yang sama, contoh `IMG_9693.JPG`.
- Sistem membaca angka terakhir sebelum ekstensi filename.

`destination_path` kosong:

- Row yang belum `MATCHED` atau belum `DONE` memang belum punya destination.
- Untuk session lama yang sudah rename tapi path kosong, klik `Copy & Rename` ulang. Sistem akan repair path tanpa overwrite file.

