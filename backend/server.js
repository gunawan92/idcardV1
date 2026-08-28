const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const { spawnSync } = require("child_process");
const XLSX = require("xlsx");
const db = require("./db");
const {
  buildFinalFilename,
  buildSerialFilename,
  extractPhotoNumber,
  normalizePhotoNumber,
  normalizeStudentName,
} = require("./services/filename.service");

const app = express();
const PORT = process.env.PORT || 3001;
const upload = multer({ storage: multer.memoryStorage() });
const frontendDistDir = path.join(__dirname, "../frontend/dist");
const frontendIndexPath = path.join(frontendDistDir, "index.html");

app.use(cors());
app.use(express.json());

const COLUMN_ALIASES = {
  student_name: ["nama", "nama siswa", "student_name", "student name", "name"],
  student_code: ["nis", "nisn", "nis/nisn/nip", "id", "student_code", "student code", "kode siswa", "no induk"],
  class_name: ["kelas", "class", "class_name", "class name", "rombel"],
  original_filename: ["foto", "no foto", "nomor foto", "file", "filename", "original_filename", "original filename", "nama file"],
  photo_number: ["no foto", "no_foto", "nomor foto", "nomor_foto", "foto", "photo", "photo number", "photo_number", "no photo"],
};
const PHOTO_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
]);

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function cellValue(row, columnIndex) {
  if (columnIndex === undefined) {
    return null;
  }

  const value = row[columnIndex];
  const text = String(value ?? "").trim();
  return text || null;
}

function mappedValue(row, columnIndex) {
  const value = cellValue(row, columnIndex);

  if (!value || value === "-") {
    return null;
  }

  return value;
}

function ensureSessionStorage(sessionId) {
  const baseDir = path.join(__dirname, "../storage/sessions", String(sessionId));
  const dirs = ["import", "renamed", "serial", "processing", "review", "ready"];

  for (const dir of dirs) {
    fs.mkdirSync(path.join(baseDir, dir), { recursive: true });
  }

  return {
    baseDir,
    importDir: path.join(baseDir, "import"),
    renamedDir: path.join(baseDir, "renamed"),
    serialDir: path.join(baseDir, "serial"),
    processingDir: path.join(baseDir, "processing"),
  };
}

function buildColumns(headerRow) {
  const seen = new Map();

  return headerRow.map((value, index) => {
    const baseName = String(value || "").trim() || `Column ${index + 1}`;
    const count = seen.get(baseName) || 0;
    seen.set(baseName, count + 1);

    return count === 0 ? baseName : `${baseName} (${count + 1})`;
  });
}

function buildRawData(columns, row) {
  return Object.fromEntries(
    columns.map((column, index) => [column, cellValue(row, index) || ""])
  );
}

function findHeaderRow(rows) {
  let best = { index: -1, mapping: {}, score: 0 };

  rows.slice(0, 20).forEach((row, index) => {
    const normalizedHeaders = row.map(normalizeHeader);
    const mapping = {};
    let score = 0;

    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      const columnIndex = normalizedHeaders.findIndex((header) => aliases.includes(header));

      if (columnIndex >= 0) {
        mapping[field] = columnIndex;
        score += field === "student_name" || field === "student_code" ? 2 : 1;
      }
    }

    if (score > best.score) {
      best = { index, mapping, score };
    }
  });

  return best;
}

function parseStudentsFromWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("File Excel tidak memiliki sheet.");
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    header: 1,
    defval: "",
    blankrows: false,
  });
  const header = findHeaderRow(rows);

  if (
    header.index < 0 ||
    header.mapping.student_name === undefined ||
    header.mapping.photo_number === undefined
  ) {
    const error = new Error("Header wajib photo_number/No Foto dan nama siswa tidak ditemukan lengkap.");
    error.statusCode = 400;
    throw error;
  }

  const columns = buildColumns(rows[header.index]);
  const students = rows
    .slice(header.index + 1)
    .map((row, index) => {
      const student = {
        import_row_number: header.index + index + 2,
        student_name: normalizeStudentName(mappedValue(row, header.mapping.student_name)),
        student_code: mappedValue(row, header.mapping.student_code),
        class_name: mappedValue(row, header.mapping.class_name),
        original_filename: mappedValue(row, header.mapping.original_filename),
        photo_number: normalizePhotoNumber(mappedValue(row, header.mapping.photo_number)),
        raw_data: buildRawData(columns, row),
      };
      const errors = [];

      if (!student.student_name) {
        errors.push("student_name kosong");
      }

      if (!student.photo_number) {
        errors.push("photo_number kosong/tidak valid");
      }

      return {
        ...student,
        is_valid: errors.length === 0 ? 1 : 0,
        match_status: errors.length === 0 ? "PENDING" : "INVALID_DATA",
        validation_errors: errors.length ? errors.join("; ") : null,
      };
    })
    .filter((student) =>
      student.student_name ||
      student.student_code ||
      student.class_name ||
      student.original_filename ||
      Object.values(student.raw_data).some(Boolean)
    );

  return {
    sheet_name: firstSheetName,
    header_row_number: header.index + 1,
    columns,
    mapping: Object.fromEntries(
      Object.entries(header.mapping).map(([field, columnIndex]) => [
        field,
        rows[header.index][columnIndex],
      ])
    ),
    students,
  };
}

function markDuplicatePhotoNumbers(students) {
  const counts = new Map();

  for (const student of students) {
    if (student.photo_number) {
      counts.set(student.photo_number, (counts.get(student.photo_number) || 0) + 1);
    }
  }

  return students.map((student) => {
    if (student.photo_number && counts.get(student.photo_number) > 1) {
      const validationErrors = [
        student.validation_errors,
        "duplicate photo_number",
      ].filter(Boolean).join("; ");

      return {
        ...student,
        is_valid: 0,
        match_status: "DUPLICATE_NUMBER",
        validation_errors: validationErrors,
      };
    }

    return student;
  });
}

function getSession(id) {
  return db.prepare(`
    SELECT *
    FROM production_sessions
    WHERE id = ?
  `).get(id);
}

function scanPhotoFiles(folderPath) {
  const normalizedFolderPath = path.resolve(folderPath);

  if (!fs.existsSync(normalizedFolderPath)) {
    throw new Error("Folder foto tidak ditemukan.");
  }

  const rootStat = fs.statSync(normalizedFolderPath);

  if (!rootStat.isDirectory()) {
    throw new Error("Path foto harus berupa folder.");
  }

  const photos = [];
  const stack = [normalizedFolderPath];

  while (stack.length) {
    const currentPath = stack.pop();
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();

      if (!PHOTO_EXTENSIONS.has(extension)) {
        continue;
      }

      const stat = fs.statSync(entryPath);

      photos.push({
        filename: entry.name,
        extension: extension.slice(1).toUpperCase(),
        relative_path: path.relative(normalizedFolderPath, entryPath),
        photo_number: extractPhotoNumber(entry.name),
        source_path: entryPath,
        file_size: stat.size,
      });
    }
  }

  photos.sort((a, b) => a.source_path.localeCompare(b.source_path));

  return {
    folder_path: normalizedFolderPath,
    photos,
  };
}

function groupBy(items, keyFn) {
  const grouped = new Map();

  for (const item of items) {
    const key = keyFn(item);

    if (!key) {
      continue;
    }

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(item);
  }

  return grouped;
}

function buildMatchingItems(students, photos) {
  const validStudents = students.filter((student) => student.photo_number);
  const studentsByNumber = groupBy(validStudents, (student) => student.photo_number);
  const photosWithNumbers = photos.map((photo) => ({
    ...photo,
    photo_number: photo.photo_number || extractPhotoNumber(photo.filename),
  }));
  const photosByNumber = groupBy(photosWithNumbers, (photo) => photo.photo_number);
  const studentNameCounts = groupBy(
    validStudents.filter((student) => studentsByNumber.get(student.photo_number)?.length === 1),
    (student) => normalizeStudentName(student.student_name)
  );
  const finalNameCounts = new Map();
  const studentItems = [];
  const photoItems = [];

  for (const student of students) {
    if (!student.photo_number) {
      studentItems.push({
        type: "student",
        student_id: student.id,
        photo_number: null,
        student_name: student.student_name,
        original_filename: null,
        final_filename: null,
        source_path: null,
        status: "INVALID_DATA",
        notes: student.validation_errors || "photo_number kosong/tidak valid",
      });
      continue;
    }

    const candidates = photosByNumber.get(student.photo_number) || [];
    const sameNumberStudents = studentsByNumber.get(student.photo_number) || [];

    if (sameNumberStudents.length > 1 || candidates.length > 1) {
      studentItems.push({
        type: "student",
        student_id: student.id,
        photo_number: student.photo_number,
        student_name: student.student_name,
        original_filename: candidates.map((photo) => photo.filename).join(", "),
        final_filename: null,
        source_path: candidates[0]?.source_path || null,
        status: "DUPLICATE_NUMBER",
        notes: "Nomor foto duplicate di Excel atau folder foto.",
      });
      continue;
    }

    if (candidates.length === 0) {
      studentItems.push({
        type: "student",
        student_id: student.id,
        photo_number: student.photo_number,
        student_name: student.student_name,
        original_filename: null,
        final_filename: null,
        source_path: null,
        status: "PHOTO_MISSING",
        notes: "Nomor foto ada di Excel tetapi file kamera tidak ditemukan.",
      });
      continue;
    }

    const photo = candidates[0];
    const extension = path.extname(photo.filename);
    const duplicateName = (studentNameCounts.get(normalizeStudentName(student.student_name)) || []).length > 1;
    let finalFilename = buildFinalFilename(student.student_name, student.photo_number, extension, duplicateName);
    finalNameCounts.set(finalFilename, (finalNameCounts.get(finalFilename) || 0) + 1);

    studentItems.push({
      type: "student",
      student_id: student.id,
      photo_id: photo.id,
      photo_number: student.photo_number,
      student_name: student.student_name,
      original_filename: photo.filename,
      final_filename: finalFilename,
      source_path: photo.source_path,
      status: "MATCHED",
      notes: null,
    });
  }

  for (const photo of photosWithNumbers) {
    const number = photo.photo_number;
    const sameNumberStudents = studentsByNumber.get(number) || [];
    const sameNumberPhotos = photosByNumber.get(number) || [];

    if (!number || sameNumberStudents.length === 0) {
      photoItems.push({
        type: "photo",
        photo_id: photo.id,
        photo_number: number,
        student_name: null,
        original_filename: photo.filename,
        final_filename: null,
        source_path: photo.source_path,
        status: "DATA_NOT_FOUND",
        notes: "File kamera ditemukan tetapi nomor foto tidak ada di Excel.",
      });
    } else if (sameNumberPhotos.length > 1) {
      photoItems.push({
        type: "photo",
        photo_id: photo.id,
        photo_number: number,
        student_name: null,
        original_filename: photo.filename,
        final_filename: null,
        source_path: photo.source_path,
        status: "DUPLICATE_NUMBER",
        notes: "Nomor foto duplicate di folder foto.",
      });
    }
  }

  for (const item of studentItems) {
    if (item.status === "MATCHED" && finalNameCounts.get(item.final_filename) > 1) {
      item.status = "FILENAME_CONFLICT";
      item.notes = "Nama output bentrok.";
    }
  }

  return [...studentItems, ...photoItems];
}

function matchingSummary(items, totalStudents, totalPhotos) {
  return {
    total_students: totalStudents,
    total_photos: totalPhotos,
    matched: items.filter((item) => item.status === "MATCHED").length,
    photo_missing: items.filter((item) => item.status === "PHOTO_MISSING").length,
    data_not_found: items.filter((item) => item.status === "DATA_NOT_FOUND").length,
    duplicates: items.filter((item) => item.status === "DUPLICATE_NUMBER").length,
    conflicts: items.filter((item) => item.status === "FILENAME_CONFLICT").length,
  };
}

function processingOutputFilename(finalFilename) {
  return `${path.basename(String(finalFilename || "output"), path.extname(String(finalFilename || "")))}.jpg`;
}

function normalizeHexColor(value) {
  const raw = String(value || "#FFFFFF").trim();
  const hex = raw.startsWith("#") ? raw : `#${raw}`;

  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) {
    return "#FFFFFF";
  }

  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toUpperCase();
  }

  return hex.toUpperCase();
}

function normalizeBackgroundInput(value) {
  const raw = String(value || "#FFFFFF").trim();

  if (["none", "no_fill", "nofill", "transparent"].includes(raw.toLowerCase())) {
    return "NO_FILL";
  }

  return normalizeHexColor(raw);
}

function safeUnlinkSessionFile(filePath, allowedDirs) {
  if (!filePath) {
    return;
  }

  const resolvedPath = path.resolve(filePath);
  const allowed = allowedDirs.some((dir) => {
    const resolvedDir = path.resolve(dir);
    return resolvedPath === resolvedDir || resolvedPath.startsWith(resolvedDir + path.sep);
  });

  if (allowed && fs.existsSync(resolvedPath)) {
    fs.unlinkSync(resolvedPath);
  }
}

function runRemoveBackground(sourcePath, destinationPath, backgroundColor) {
  const workerPath = path.join(__dirname, "../worker/remove_bg.py");
  const result = spawnSync(
    "python",
    [workerPath, "--source", sourcePath, "--destination", destinationPath, "--background", backgroundColor],
    {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
    }
  );
  const output = String(result.stdout || "").trim();
  const errorOutput = String(result.stderr || "").trim();

  if (!output) {
    return {
      success: false,
      message: errorOutput || "Worker Python tidak mengembalikan output.",
    };
  }

  try {
    const parsed = JSON.parse(output);

    if (!parsed.success && errorOutput) {
      parsed.message = `${parsed.message || "Worker gagal"} ${errorOutput}`.trim();
    }

    return parsed;
  } catch (error) {
    return {
      success: false,
      message: `${output} ${errorOutput}`.trim(),
    };
  }
}

app.get("/", (req, res) => {
  if (fs.existsSync(frontendIndexPath)) {
    return res.sendFile(frontendIndexPath);
  }

  res.json({
    success: false,
    message: "Frontend belum dibuild. Jalankan npm run build di folder frontend.",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    database: "sqlite",
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/sessions", (req, res) => {
  try {
    const { school_name, photo_date, period } = req.body;

    if (!school_name) {
      return res.status(400).json({
        success: false,
        message: "school_name wajib diisi",
      });
    }

    const sessionCode =
      "PHOTO-" +
      new Date().toISOString().slice(0, 10).replaceAll("-", "") +
      "-" +
      crypto.randomUUID().slice(0, 6).toUpperCase();

    const result = db.prepare(`
      INSERT INTO production_sessions
      (session_code, school_name, photo_date, period)
      VALUES (?, ?, ?, ?)
    `).run(sessionCode, school_name, photo_date || null, period || null);

    res.status(201).json({
      success: true,
      data: getSession(result.lastInsertRowid),
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/sessions", (req, res) => {
  try {
    const sessions = db.prepare(`
      SELECT *
      FROM production_sessions
      ORDER BY id DESC
    `).all();

    res.json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/sessions/:id", (req, res) => {
  try {
    const session = getSession(req.params.id);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    res.json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.put("/api/sessions/:id", (req, res) => {
  try {
    const current = getSession(req.params.id);

    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    const {
      school_name = current.school_name,
      photo_date = current.photo_date,
      period = current.period,
      status = current.status,
    } = req.body;

    db.prepare(`
      UPDATE production_sessions
      SET school_name = ?,
          photo_date = ?,
          period = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(school_name, photo_date, period, status, req.params.id);

    res.json({
      success: true,
      data: getSession(req.params.id),
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/sessions/:id/import-xlsx", upload.single("file"), (req, res) => {
  const startedAt = Date.now();

  try {
    const session = getSession(req.params.id);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "File XLSX wajib diupload dengan field file",
      });
    }

    const storage = ensureSessionStorage(req.params.id);
    const savedImportPath = path.join(storage.importDir, req.file.originalname || "import.xlsx");
    fs.writeFileSync(savedImportPath, req.file.buffer);

    const parsed = parseStudentsFromWorkbook(req.file.buffer);
    parsed.students = markDuplicatePhotoNumbers(parsed.students);
    const total = parsed.students.length;
    const valid = parsed.students.filter((student) => student.is_valid).length;
    const invalid = total - valid;
    const duplicatePhotoNumbers = parsed.students.filter(
      (student) => student.match_status === "DUPLICATE_NUMBER"
    ).length;
    const insertStudent = db.prepare(`
      INSERT INTO students (
        session_id,
        import_row_number,
        photo_number,
        student_code,
        student_name,
        class_name,
        original_filename,
        photo_status,
        match_status,
        rename_status,
        is_valid,
        validation_errors,
        raw_data,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec("BEGIN");

    try {
      db.prepare("DELETE FROM students WHERE session_id = ?").run(req.params.id);

      for (const student of parsed.students) {
        insertStudent.run(
          req.params.id,
          student.import_row_number,
          student.photo_number,
          student.student_code,
          student.student_name || "",
          student.class_name,
          student.original_filename,
          "PENDING",
          student.match_status,
          "PENDING",
          student.is_valid,
          student.validation_errors,
          JSON.stringify(student.raw_data),
          student.validation_errors
        );
      }

      db.prepare(`
        UPDATE production_sessions
        SET status = 'DATA_IMPORTED',
            total_students = ?,
            imported_count = ?,
            invalid_count = ?,
            imported_at = CURRENT_TIMESTAMP,
            import_sheet_name = ?,
            import_header_row = ?,
            import_columns = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        total,
        valid,
        invalid,
        parsed.sheet_name,
        parsed.header_row_number,
        JSON.stringify(parsed.columns),
        req.params.id
      );

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    console.log(
      `[SESSION ${req.params.id}] XLSX_IMPORT rows=${total} valid=${valid} duplicate=${duplicatePhotoNumbers} duration=${Date.now() - startedAt}ms`
    );

    res.json({
      success: true,
      data: {
        total,
        valid,
        invalid,
        session_id: Number(req.params.id),
        total_rows: total,
        valid_rows: valid,
        invalid_rows: invalid,
        duplicate_photo_numbers: duplicatePhotoNumbers,
        import_path: savedImportPath,
        sheet_name: parsed.sheet_name,
        header_row_number: parsed.header_row_number,
        columns: parsed.columns,
        mapping: parsed.mapping,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/sessions/:id/students", (req, res) => {
  try {
    if (!getSession(req.params.id)) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const students = db.prepare(`
      SELECT
        id,
        import_row_number,
        photo_number,
        student_code,
        student_name,
        class_name,
        original_filename,
        final_filename,
        serial_filename,
        photo_status,
        match_status,
        rename_status,
        qc_status,
        qc_notes,
        processing_status,
        processing_path,
        processing_background,
        processing_notes,
        source_path,
        destination_path,
        serial_path,
        is_valid,
        validation_errors,
        raw_data
      FROM students
      WHERE session_id = ?
      ORDER BY import_row_number ASC, id ASC
      LIMIT ? OFFSET ?
    `).all(req.params.id, limit, offset);
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN is_valid = 1 THEN 1 ELSE 0 END) AS valid,
        SUM(CASE WHEN is_valid = 0 THEN 1 ELSE 0 END) AS invalid
      FROM students
      WHERE session_id = ?
    `).get(req.params.id);

    const columns = db.prepare(`
      SELECT import_columns
      FROM production_sessions
      WHERE id = ?
    `).get(req.params.id);

    res.json({
      success: true,
      data: {
        total: summary.total || 0,
        valid: summary.valid || 0,
        invalid: summary.invalid || 0,
        columns: JSON.parse(columns.import_columns || "[]"),
        students: students.map((student) => ({
          ...student,
          raw_data: JSON.parse(student.raw_data || "{}"),
        })),
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/sessions/:id/photo-source", (req, res) => {
  try {
    const session = getSession(req.params.id);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    const { folder_path } = req.body;

    if (!folder_path) {
      return res.status(400).json({
        success: false,
        message: "folder_path wajib diisi",
      });
    }

    const scanned = scanPhotoFiles(folder_path);
    const insertSource = db.prepare(`
      INSERT INTO photo_sources (session_id, folder_path, total_files)
      VALUES (?, ?, ?)
    `);
    const insertPhoto = db.prepare(`
      INSERT INTO session_photos (
        session_id,
        photo_source_id,
        filename,
        extension,
        relative_path,
        photo_number,
        source_path,
        file_size,
        photo_status,
        match_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec("BEGIN");

    try {
      db.prepare("DELETE FROM photo_sources WHERE session_id = ?").run(req.params.id);
      db.prepare("DELETE FROM session_photos WHERE session_id = ?").run(req.params.id);

      const sourceResult = insertSource.run(
        req.params.id,
        scanned.folder_path,
        scanned.photos.length
      );

      for (const photo of scanned.photos) {
        insertPhoto.run(
          req.params.id,
          sourceResult.lastInsertRowid,
          photo.filename,
          photo.extension,
          photo.relative_path,
          photo.photo_number,
          photo.source_path,
          photo.file_size,
          "REGISTERED",
          "PENDING"
        );
      }

      db.prepare(`
        UPDATE production_sessions
        SET total_photos = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(scanned.photos.length, req.params.id);

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    res.json({
      success: true,
      data: {
        folder_path: scanned.folder_path,
        total: scanned.photos.length,
        preview: scanned.photos.slice(0, 20),
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/sessions/:id/photos", (req, res) => {
  try {
    if (!getSession(req.params.id)) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const source = db.prepare(`
      SELECT id, folder_path, total_files, registered_at
      FROM photo_sources
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(req.params.id);
    const photos = db.prepare(`
      SELECT id, filename, extension, source_path, file_size, photo_status
      FROM session_photos
      WHERE session_id = ?
      ORDER BY source_path ASC
      LIMIT ? OFFSET ?
    `).all(req.params.id, limit, offset);
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN extension IN ('JPG', 'JPEG', 'PNG') THEN 1 ELSE 0 END) AS raster,
        SUM(CASE WHEN extension NOT IN ('JPG', 'JPEG', 'PNG') THEN 1 ELSE 0 END) AS raw
      FROM session_photos
      WHERE session_id = ?
    `).get(req.params.id);

    res.json({
      success: true,
      data: {
        source: source || null,
        total: summary.total || 0,
        raster: summary.raster || 0,
        raw: summary.raw || 0,
        photos,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/sessions/:id/match-photos", (req, res) => {
  const startedAt = Date.now();

  try {
    const session = getSession(req.params.id);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    const requestFiles = Array.isArray(req.body.files) ? req.body.files : null;

    if (requestFiles) {
      db.exec("BEGIN");

      try {
        db.prepare("DELETE FROM session_photos WHERE session_id = ?").run(req.params.id);
        db.prepare("DELETE FROM photo_sources WHERE session_id = ?").run(req.params.id);

        const sourceResult = db.prepare(`
          INSERT INTO photo_sources (session_id, folder_path, total_files)
          VALUES (?, ?, ?)
        `).run(req.params.id, "BROWSER_DIRECTORY_METADATA", requestFiles.length);
        const insertPhoto = db.prepare(`
          INSERT INTO session_photos (
            session_id,
            photo_source_id,
            filename,
            extension,
            relative_path,
            photo_number,
            source_path,
            file_size,
            photo_status,
            match_status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const file of requestFiles) {
          const extension = path.extname(file.filename || "").slice(1).toUpperCase();

          if (!["JPG", "JPEG", "PNG"].includes(extension)) {
            continue;
          }

          insertPhoto.run(
            req.params.id,
            sourceResult.lastInsertRowid,
            file.filename,
            extension,
            file.relative_path || file.filename,
            extractPhotoNumber(file.filename),
            file.source_path || file.relative_path || file.filename,
            Number(file.size) || 0,
            "REGISTERED",
            "PENDING"
          );
        }

        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }

    const students = db.prepare(`
      SELECT id, photo_number, student_name, validation_errors
      FROM students
      WHERE session_id = ?
      ORDER BY import_row_number ASC, id ASC
    `).all(req.params.id);
    const photos = db.prepare(`
      SELECT id, filename, extension, relative_path, photo_number, source_path, file_size
      FROM session_photos
      WHERE session_id = ?
      ORDER BY source_path ASC
    `).all(req.params.id);
    const items = buildMatchingItems(students, photos);
    const summary = matchingSummary(items, students.length, photos.length);

    db.exec("BEGIN");

    try {
      db.prepare(`
        UPDATE students
        SET match_status = CASE WHEN match_status = 'DUPLICATE_NUMBER' THEN 'DUPLICATE_NUMBER' ELSE 'PENDING' END,
            original_filename = NULL,
            final_filename = NULL,
            source_path = NULL,
            destination_path = NULL,
            serial_filename = NULL,
            serial_path = NULL,
            notes = validation_errors
        WHERE session_id = ?
      `).run(req.params.id);
      db.prepare(`
        UPDATE session_photos
        SET match_status = 'PENDING',
            student_id = NULL
        WHERE session_id = ?
      `).run(req.params.id);

      const updateStudent = db.prepare(`
        UPDATE students
        SET match_status = ?,
            original_filename = ?,
            final_filename = ?,
            source_path = ?,
            notes = ?
        WHERE id = ?
      `);
      const updatePhoto = db.prepare(`
        UPDATE session_photos
        SET match_status = ?,
            student_id = ?
        WHERE id = ?
      `);

      for (const item of items) {
        if (item.type === "student") {
          updateStudent.run(
            item.status,
            item.original_filename,
            item.final_filename,
            item.source_path,
            item.notes,
            item.student_id
          );
        }

        if (item.photo_id) {
          updatePhoto.run(item.status, item.student_id || null, item.photo_id);
        }
      }

      db.prepare(`
        UPDATE production_sessions
        SET status = 'PHOTO_MATCHED',
            total_photos = ?,
            matched_count = ?,
            missing_count = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(summary.total_photos, summary.matched, summary.photo_missing, req.params.id);

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    console.log(
      `[SESSION ${req.params.id}] PHOTO_MATCH files=${summary.total_photos} matched=${summary.matched} missing=${summary.photo_missing} duration=${Date.now() - startedAt}ms`
    );

    res.json({
      success: true,
      summary,
      items,
    });
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/sessions/:id/matching", (req, res) => {
  try {
    if (!getSession(req.params.id)) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    const students = db.prepare(`
      SELECT id, photo_number, student_name, original_filename, final_filename, source_path, match_status, notes
      FROM students
      WHERE session_id = ?
      ORDER BY import_row_number ASC, id ASC
    `).all(req.params.id);
    const unmatchedPhotos = db.prepare(`
      SELECT id, photo_number, filename, source_path, match_status
      FROM session_photos
      WHERE session_id = ? AND match_status IN ('DATA_NOT_FOUND', 'DUPLICATE_NUMBER')
      ORDER BY source_path ASC
    `).all(req.params.id);
    const items = [
      ...students.map((student) => ({
        type: "student",
        student_id: student.id,
        photo_number: student.photo_number,
        student_name: student.student_name,
        original_filename: student.original_filename,
        final_filename: student.final_filename,
        source_path: student.source_path,
        status: student.match_status,
        notes: student.notes,
      })),
      ...unmatchedPhotos.map((photo) => ({
        type: "photo",
        photo_id: photo.id,
        photo_number: photo.photo_number,
        student_name: null,
        original_filename: photo.filename,
        final_filename: null,
        source_path: photo.source_path,
        status: photo.match_status,
        notes: "File kamera tidak punya data siswa yang cocok.",
      })),
    ];
    const photoCount = db.prepare(`
      SELECT COUNT(*) AS total FROM session_photos WHERE session_id = ?
    `).get(req.params.id).total;

    res.json({
      success: true,
      summary: matchingSummary(items, students.length, photoCount),
      items,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/sessions/:id/renamed-items", (req, res) => {
  try {
    if (!getSession(req.params.id)) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    const status = req.query.status;
    const whereStatus = status && status !== "ALL" ? "AND qc_status = ?" : "";
    const params = status && status !== "ALL" ? [req.params.id, status] : [req.params.id];
    const items = db.prepare(`
      SELECT
        id,
        photo_number,
        student_name,
        class_name,
        original_filename,
        final_filename,
        serial_filename,
        rename_status,
        qc_status,
        qc_notes,
        destination_path,
        serial_path,
        notes
      FROM students
      WHERE session_id = ?
        AND rename_status IN ('DONE', 'FAILED')
        ${whereStatus}
      ORDER BY import_row_number ASC, id ASC
    `).all(...params);
    const summary = db.prepare(`
      SELECT
        SUM(CASE WHEN rename_status = 'DONE' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN rename_status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN qc_status = 'PENDING' AND rename_status = 'DONE' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN qc_status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN qc_status = 'NEEDS_REVIEW' THEN 1 ELSE 0 END) AS needs_review,
        SUM(CASE WHEN qc_status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected
      FROM students
      WHERE session_id = ?
    `).get(req.params.id);

    res.json({
      success: true,
      data: {
        summary: {
          done: summary.done || 0,
          failed: summary.failed || 0,
          pending: summary.pending || 0,
          approved: summary.approved || 0,
          needs_review: summary.needs_review || 0,
          rejected: summary.rejected || 0,
        },
        items,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/sessions/:id/renamed-items/:studentId/image", (req, res) => {
  try {
    const student = db.prepare(`
      SELECT destination_path
      FROM students
      WHERE session_id = ? AND id = ? AND rename_status = 'DONE'
    `).get(req.params.id, req.params.studentId);

    if (!student || !student.destination_path || !fs.existsSync(student.destination_path)) {
      return res.status(404).json({
        success: false,
        message: "File hasil rename tidak ditemukan",
      });
    }

    const storage = ensureSessionStorage(req.params.id);
    const resolvedDestination = path.resolve(student.destination_path);
    const resolvedRenamedDir = path.resolve(storage.renamedDir);

    if (!resolvedDestination.startsWith(resolvedRenamedDir + path.sep)) {
      return res.status(403).json({
        success: false,
        message: "Path file tidak valid",
      });
    }

    res.sendFile(resolvedDestination);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.put("/api/sessions/:id/renamed-items/:studentId/qc", (req, res) => {
  try {
    if (!getSession(req.params.id)) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    const { qc_status, qc_notes } = req.body;
    const allowedStatuses = new Set(["PENDING", "APPROVED", "NEEDS_REVIEW", "REJECTED"]);

    if (!allowedStatuses.has(qc_status)) {
      return res.status(400).json({
        success: false,
        message: "qc_status tidak valid",
      });
    }

    const result = db.prepare(`
      UPDATE students
      SET qc_status = ?,
          qc_notes = ?
      WHERE session_id = ? AND id = ? AND rename_status = 'DONE'
    `).run(qc_status, qc_notes || null, req.params.id, req.params.studentId);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: "Item rename tidak ditemukan atau belum DONE",
      });
    }

    const item = db.prepare(`
      SELECT id, photo_number, student_name, final_filename, serial_filename, rename_status, qc_status, qc_notes, destination_path, serial_path
      FROM students
      WHERE session_id = ? AND id = ?
    `).get(req.params.id, req.params.studentId);

    res.json({
      success: true,
      data: item,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/sessions/:id/ready-for-processing", (req, res) => {
  try {
    const session = getSession(req.params.id);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    const summary = db.prepare(`
      SELECT
        SUM(CASE WHEN rename_status = 'DONE' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN rename_status = 'DONE' AND qc_status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN rename_status = 'DONE' AND qc_status IN ('PENDING', 'NEEDS_REVIEW', 'REJECTED') THEN 1 ELSE 0 END) AS blocked
      FROM students
      WHERE session_id = ?
    `).get(req.params.id);

    if ((summary.done || 0) === 0) {
      return res.status(400).json({
        success: false,
        message: "Belum ada hasil rename yang bisa diproses.",
      });
    }

    if ((summary.blocked || 0) > 0) {
      return res.status(400).json({
        success: false,
        message: "Masih ada hasil rename yang belum APPROVED.",
        data: summary,
      });
    }

    db.prepare(`
      UPDATE production_sessions
      SET status = 'READY_FOR_PROCESSING',
          ready_count = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(summary.approved || 0, req.params.id);

    res.json({
      success: true,
      data: getSession(req.params.id),
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/sessions/:id/process", (req, res) => {
  const startedAt = Date.now();

  try {
    const session = getSession(req.params.id);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    if (!["PHOTO_MATCHED", "PROCESSING", "REVIEW", "READY"].includes(session.status)) {
      return res.status(400).json({
        success: false,
        message: "Processing hanya boleh setelah matching dijalankan.",
      });
    }

    const limit = 1;
    const backgroundColor = normalizeBackgroundInput(req.body.background_color);
    const storage = ensureSessionStorage(req.params.id);
    const items = db.prepare(`
      SELECT id, final_filename, source_path, processing_status
      FROM students
      WHERE session_id = ?
        AND match_status = 'MATCHED'
        AND (
          processing_status IN ('PENDING', 'FAILED')
          OR (processing_status = 'READY' AND LOWER(COALESCE(processing_path, '')) NOT LIKE '%.jpg')
        )
      ORDER BY import_row_number ASC, id ASC
      LIMIT ?
    `).all(req.params.id, limit);
    const updateProcessing = db.prepare(`
      UPDATE students
      SET processing_status = ?,
          processing_path = ?,
          processing_background = ?,
          processing_notes = ?
      WHERE id = ?
    `);
    const summary = {
      requested: items.length,
      processed: 0,
      failed: 0,
      skipped: 0,
    };
    const results = [];

    db.prepare(`
      UPDATE production_sessions
      SET status = 'PROCESSING',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.params.id);

    for (const item of items) {
      const destinationPath = path.join(storage.processingDir, processingOutputFilename(item.final_filename));

      if (item.processing_status === "READY" && fs.existsSync(destinationPath)) {
        summary.skipped += 1;
        results.push({ id: item.id, status: "SKIPPED_ALREADY_DONE", processing_path: destinationPath });
        continue;
      }

      const workerResult = runRemoveBackground(item.source_path, destinationPath, backgroundColor);

      if (workerResult.success) {
        updateProcessing.run("READY", destinationPath, backgroundColor, null, item.id);
        summary.processed += 1;
        results.push({ id: item.id, status: "READY", processing_path: destinationPath, background_color: backgroundColor });
      } else {
        updateProcessing.run("FAILED", destinationPath, backgroundColor, workerResult.message, item.id);
        summary.failed += 1;
        results.push({ id: item.id, status: "FAILED", processing_path: destinationPath, message: workerResult.message });
      }
    }

    const remaining = db.prepare(`
      SELECT COUNT(*) AS total
      FROM students
      WHERE session_id = ?
        AND match_status = 'MATCHED'
        AND (
          processing_status IN ('PENDING', 'FAILED')
          OR (processing_status = 'READY' AND LOWER(COALESCE(processing_path, '')) NOT LIKE '%.jpg')
        )
    `).get(req.params.id).total;

    db.prepare(`
      UPDATE production_sessions
      SET status = ?,
          review_count = ?,
          ready_count = (
            SELECT COUNT(*)
            FROM students
            WHERE session_id = ? AND processing_status = 'READY'
          ),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(summary.failed > 0 ? "REVIEW" : remaining > 0 ? "PROCESSING" : "READY", summary.failed, req.params.id, req.params.id);

    console.log(
      `[SESSION ${req.params.id}] PROCESS_BG requested=${summary.requested} success=${summary.processed} failure=${summary.failed} duration=${Date.now() - startedAt}ms`
    );

    res.json({
      success: true,
      summary,
      remaining,
      results,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/sessions/:id/processing-items", (req, res) => {
  try {
    if (!getSession(req.params.id)) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    const items = db.prepare(`
      SELECT
        id,
        photo_number,
        student_name,
        class_name,
        final_filename,
        destination_path,
        source_path,
        processing_status,
        processing_path,
        processing_background,
        processing_notes
      FROM students
      WHERE session_id = ?
        AND match_status = 'MATCHED'
      ORDER BY import_row_number ASC, id ASC
    `).all(req.params.id);
    const summary = db.prepare(`
      SELECT
        SUM(CASE WHEN processing_status = 'PENDING' OR (processing_status = 'READY' AND LOWER(COALESCE(processing_path, '')) NOT LIKE '%.jpg') THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN processing_status = 'READY' AND LOWER(COALESCE(processing_path, '')) LIKE '%.jpg' THEN 1 ELSE 0 END) AS ready,
        SUM(CASE WHEN processing_status = 'FAILED' THEN 1 ELSE 0 END) AS failed
      FROM students
      WHERE session_id = ?
        AND match_status = 'MATCHED'
    `).get(req.params.id);

    res.json({
      success: true,
      data: {
        summary: {
          pending: summary.pending || 0,
          ready: summary.ready || 0,
          failed: summary.failed || 0,
        },
        items,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/sessions/:id/processing-items/:studentId/image", (req, res) => {
  try {
    const student = db.prepare(`
      SELECT processing_path
      FROM students
      WHERE session_id = ? AND id = ? AND processing_status = 'READY'
    `).get(req.params.id, req.params.studentId);

    if (!student || !student.processing_path || !fs.existsSync(student.processing_path)) {
      return res.status(404).json({
        success: false,
        message: "File processing tidak ditemukan",
      });
    }

    const storage = ensureSessionStorage(req.params.id);
    const resolvedProcessing = path.resolve(student.processing_path);
    const resolvedProcessingDir = path.resolve(storage.processingDir);

    if (!resolvedProcessing.startsWith(resolvedProcessingDir + path.sep)) {
      return res.status(403).json({
        success: false,
        message: "Path file tidak valid",
      });
    }

    res.sendFile(resolvedProcessing);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/sessions/:id/processing-items/:studentId/reset", (req, res) => {
  try {
    const session = getSession(req.params.id);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    const storage = ensureSessionStorage(req.params.id);
    const student = db.prepare(`
      SELECT id, processing_path, destination_path, serial_path
      FROM students
      WHERE session_id = ? AND id = ? AND match_status = 'MATCHED'
    `).get(req.params.id, req.params.studentId);

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Item processing tidak ditemukan",
      });
    }

    safeUnlinkSessionFile(student.processing_path, [storage.processingDir]);
    safeUnlinkSessionFile(student.destination_path, [storage.renamedDir]);
    safeUnlinkSessionFile(student.serial_path, [storage.serialDir]);

    db.prepare(`
      UPDATE students
      SET processing_status = 'PENDING',
          processing_path = NULL,
          processing_background = NULL,
          processing_notes = NULL,
          rename_status = 'PENDING',
          destination_path = NULL,
          serial_filename = NULL,
          serial_path = NULL,
          qc_status = 'PENDING',
          qc_notes = NULL,
          notes = NULL
      WHERE session_id = ? AND id = ?
    `).run(req.params.id, req.params.studentId);

    db.prepare(`
      UPDATE production_sessions
      SET status = 'PROCESSING',
          ready_count = (
            SELECT COUNT(*)
            FROM students
            WHERE session_id = ? AND processing_status = 'READY'
          ),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.params.id, req.params.id);

    res.json({
      success: true,
      data: db.prepare(`
        SELECT
          id,
          photo_number,
          student_name,
          class_name,
          final_filename,
          destination_path,
          source_path,
          processing_status,
          processing_path,
          processing_background,
          processing_notes
        FROM students
        WHERE session_id = ? AND id = ?
      `).get(req.params.id, req.params.studentId),
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/sessions/:id/rename", (req, res) => {
  const startedAt = Date.now();

  try {
    const session = getSession(req.params.id);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    if (!["READY", "REVIEW", "RENAMED"].includes(session.status)) {
      return res.status(400).json({
        success: false,
        message: "Rename hanya boleh setelah semua foto selesai processing.",
      });
    }

    const storage = ensureSessionStorage(req.params.id);
    const blocking = db.prepare(`
      SELECT COUNT(*) AS total
      FROM students
      WHERE session_id = ?
        AND match_status = 'MATCHED'
        AND (
          processing_status != 'READY'
          OR LOWER(COALESCE(processing_path, '')) NOT LIKE '%.jpg'
        )
    `).get(req.params.id).total;

    if (blocking > 0) {
      return res.status(400).json({
        success: false,
        message: `${blocking} foto matched belum selesai processing.`,
      });
    }

    const matchedStudents = db.prepare(`
      SELECT id, photo_number, processing_path, final_filename, rename_status, destination_path, serial_path
      FROM students
      WHERE session_id = ? AND match_status = 'MATCHED' AND processing_status = 'READY'
      ORDER BY import_row_number ASC, id ASC
    `).all(req.params.id);
    const updateRename = db.prepare(`
      UPDATE students
      SET final_filename = ?,
          rename_status = ?,
          destination_path = ?,
          serial_filename = ?,
          serial_path = ?,
          notes = ?
      WHERE id = ?
    `);
    const summary = {
      requested: matchedStudents.length,
      renamed: 0,
      failed: 0,
      skipped: 0,
    };
    const results = [];

    for (const student of matchedStudents) {
      const printFilename = buildFinalFilename(
        path.basename(student.final_filename, path.extname(student.final_filename)),
        student.photo_number,
        ".jpg",
        false
      );
      const destinationPath = path.join(storage.renamedDir, printFilename);
      const serialFilename = buildSerialFilename(student.photo_number, ".jpg");
      const serialPath = path.join(storage.serialDir, serialFilename);

      try {
        if (
          student.rename_status === "DONE" &&
          student.destination_path &&
          student.serial_path &&
          fs.existsSync(student.destination_path) &&
          fs.existsSync(student.serial_path)
        ) {
          summary.skipped += 1;
          results.push({
            id: student.id,
            status: "SKIPPED_ALREADY_DONE",
            destination_path: student.destination_path,
            serial_path: student.serial_path,
          });
          continue;
        }

        if (!student.processing_path || !fs.existsSync(student.processing_path)) {
          throw new Error("File hasil processing tidak ditemukan.");
        }

        let copied = false;

        if (!fs.existsSync(destinationPath)) {
          fs.copyFileSync(student.processing_path, destinationPath);
          copied = true;
        }

        if (!fs.existsSync(serialPath)) {
          fs.copyFileSync(student.processing_path, serialPath);
          copied = true;
        }

        if (!fs.existsSync(destinationPath) || !fs.existsSync(serialPath)) {
          throw new Error("Copy gagal diverifikasi.");
        }

        updateRename.run(printFilename, "DONE", destinationPath, serialFilename, serialPath, null, student.id);

        if (copied) {
          summary.renamed += 1;
          results.push({
            id: student.id,
            status: "DONE",
            destination_path: destinationPath,
            serial_filename: serialFilename,
            serial_path: serialPath,
          });
        } else {
          summary.skipped += 1;
          results.push({
            id: student.id,
            status: "REPAIRED_EXISTING_DESTINATION",
            destination_path: destinationPath,
            serial_filename: serialFilename,
            serial_path: serialPath,
          });
        }
      } catch (error) {
        updateRename.run(printFilename, "FAILED", destinationPath, serialFilename, serialPath, error.message, student.id);
        summary.failed += 1;
        results.push({
          id: student.id,
          status: "FAILED",
          destination_path: destinationPath,
          serial_filename: serialFilename,
          serial_path: serialPath,
          message: error.message,
        });
      }
    }

    db.prepare(`
      UPDATE production_sessions
      SET status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(summary.failed === 0 ? "RENAMED" : "REVIEW", req.params.id);

    console.log(
      `[SESSION ${req.params.id}] RENAME success=${summary.renamed} failed=${summary.failed} skipped=${summary.skipped} duration=${Date.now() - startedAt}ms`
    );

    res.json({
      success: true,
      summary,
      results,
    });
  } catch (error) {
    console.error(error);

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/sessions/:id/manifest", (req, res) => {
  const startedAt = Date.now();

  try {
    const session = getSession(req.params.id);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Session tidak ditemukan",
      });
    }

    const storage = ensureSessionStorage(req.params.id);
    const columns = JSON.parse(session.import_columns || "[]");
    const students = db.prepare(`
      SELECT
        import_row_number,
        photo_number,
        student_code,
        student_name,
        class_name,
        original_filename,
        final_filename,
        serial_filename,
        match_status,
        rename_status,
        qc_status,
        qc_notes,
        processing_status,
        processing_path,
        processing_notes,
        source_path,
        destination_path,
        serial_path,
        notes,
        raw_data
      FROM students
      WHERE session_id = ?
      ORDER BY import_row_number ASC, id ASC
    `).all(req.params.id);
    const rows = students.map((student) => {
      const rawData = JSON.parse(student.raw_data || "{}");
      const orderedRawData = Object.fromEntries(
        columns.map((column) => [column, rawData[column] || ""])
      );

      return {
        ...orderedRawData,
        photo_number: student.photo_number || "",
        student_code: student.student_code || "",
        student_name: student.student_name || "",
        class_name: student.class_name || "",
        original_filename: student.original_filename || "",
        final_filename: student.final_filename || "",
        serial_filename: student.serial_filename || "",
        match_status: student.match_status || "",
        rename_status: student.rename_status || "",
        qc_status: student.qc_status || "",
        qc_notes: student.qc_notes || "",
        processing_status: student.processing_status || "",
        processing_path: student.processing_path || "",
        processing_background: student.processing_background || "",
        processing_notes: student.processing_notes || "",
        source_path: student.source_path || "",
        destination_path: student.destination_path || "",
        serial_path: student.serial_path || "",
        notes: student.notes || "",
      };
    });
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const manifestPath = path.join(storage.baseDir, "manifest.xlsx");

    XLSX.utils.book_append_sheet(workbook, worksheet, "manifest");
    XLSX.writeFile(workbook, manifestPath);

    console.log(
      `[SESSION ${req.params.id}] MANIFEST rows=${rows.length} path=${manifestPath} duration=${Date.now() - startedAt}ms`
    );

    res.json({
      success: true,
      data: {
        path: manifestPath,
        total_rows: rows.length,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

if (fs.existsSync(frontendDistDir)) {
  app.use(express.static(frontendDistDir));

  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(frontendIndexPath);
  });
}

app.listen(PORT, () => {
  console.log("");
  console.log("======================================");
  console.log(" STELA PHOTO PRODUCTION");
  console.log("======================================");
  console.log(" API      : http://localhost:" + PORT);
  console.log(" Health   : http://localhost:" + PORT + "/api/health");
  console.log(" Sessions : http://localhost:" + PORT + "/api/sessions");
  console.log("======================================");
});
