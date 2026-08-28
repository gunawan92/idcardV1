# Backend API V1

Base URL local:

```text
http://localhost:3001
```

## Health

```http
GET /api/health
```

Untuk cek backend hidup.

## Production Session

```http
POST /api/sessions
GET  /api/sessions
GET  /api/sessions/:id
PUT  /api/sessions/:id
```

Payload create:

```json
{
  "school_name": "SD Alzahra",
  "photo_date": "2026-08-27",
  "period": "2026 / 2027"
}
```

Status session yang dipakai V1:

```text
DRAFT
DATA_IMPORTED
PHOTO_MATCHED
RENAMED
REVIEW
READY_FOR_PROCESSING
PROCESSING
READY
```

## Import Excel

```http
POST /api/sessions/:id/import-xlsx
GET  /api/sessions/:id/students
```

Upload field:

```text
file
```

Mapper header fleksibel:

```text
Nama / Nama Siswa / student_name
NIS / NISN / ID / student_code
Kelas / class / class_name
Foto / File / Filename / original_filename
No Foto / photo_number
```

Response import utama:

```json
{
  "total": 432,
  "valid": 428,
  "invalid": 4
}
```

Backend menyimpan semua isi row Excel di `students.raw_data`, jadi frontend bisa menampilkan seluruh kolom sheet.

## Register Folder Foto

```http
POST /api/sessions/:id/photo-source
GET  /api/sessions/:id/photos
```

Payload:

```json
{
  "folder_path": "C:\\CAMERA\\SD_ALZHAR_2026"
}
```

Backend menyimpan path file, bukan copy semua foto.

Ekstensi V1:

```text
.jpg
.jpeg
.png
```

## Matching

```http
POST /api/sessions/:id/match-photos
GET  /api/sessions/:id/matching
```

Status matching:

```text
MATCHED
PHOTO_MISSING
DATA_NOT_FOUND
DUPLICATE_NUMBER
FILENAME_CONFLICT
INVALID_DATA
PENDING
```

Matching memakai angka terakhir sebelum ekstensi filename kamera.

Contoh:

```text
IMG_9693.JPG -> 9693
DSC_1001.JPG -> 1001
```

## Background Removal / Processing

```http
POST /api/sessions/:id/process
GET  /api/sessions/:id/processing-items
GET  /api/sessions/:id/processing-items/:studentId/image
```

Payload:

```json
{
  "limit": 1,
  "background_color": "#FFFFFF"
}
```

Untuk No Fill/transparan:

```json
{
  "limit": 1,
  "background_color": "NO_FILL"
}
```

Catatan:

- Backend V1 hard cap 1 foto per request.
- Worker Python memakai `worker\remove_bg.py`.
- Source processing adalah `source_path` foto RAW/original yang sudah `MATCHED`.
- Output masuk ke `storage\sessions\{id}\processing`.
- Output Fill: JPG, mode RGB, portrait 3:4, subject center.
- Output No Fill: PNG transparan, mode RGBA, portrait 3:4, subject center.
- Background Fill memakai hex color dari operator.

## Rename Output Cetak

```http
POST /api/sessions/:id/rename
```

Syarat:

- Semua item `MATCHED` sudah `processing_status = READY`.
- Rename mengambil source dari `processing_path`, bukan dari RAW original.

Behavior:

- Original file tidak diubah.
- File hasil processing dicopy ke `storage\sessions\{id}\renamed`.
- `destination_path` diisi ke DB.
- File hasil processing juga dicopy ke `storage\sessions\{id}\serial`.
- `serial_filename` memakai kolom `serial` atau `idkartu` dari XLSX, contoh `ALZIN51999.jpg` untuk Fill atau `ALZIN51999.png` untuk No Fill.
- `serial_path` diisi ke DB.
- Jika file tujuan sudah ada, backend repair path dan tidak overwrite.

## QC Rename

```http
GET /api/sessions/:id/renamed-items
GET /api/sessions/:id/renamed-items/:studentId/image
PUT /api/sessions/:id/renamed-items/:studentId/qc
```

Payload QC:

```json
{
  "qc_status": "APPROVED",
  "qc_notes": "optional"
}
```

Status QC:

```text
PENDING
APPROVED
NEEDS_REVIEW
REJECTED
```

## Manifest

```http
POST /api/sessions/:id/manifest
```

Output:

```text
storage\sessions\{id}\manifest.xlsx
```

Manifest berisi kolom Excel asli plus field workflow seperti match, rename, QC, processing, source path, dan destination path.
