const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "../data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "production.db");
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS production_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_code TEXT NOT NULL UNIQUE,
    school_name TEXT NOT NULL,
    photo_date TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    total_students INTEGER NOT NULL DEFAULT 0,
    total_photos INTEGER NOT NULL DEFAULT 0,
    matched_count INTEGER NOT NULL DEFAULT 0,
    missing_count INTEGER NOT NULL DEFAULT 0,
    review_count INTEGER NOT NULL DEFAULT 0,
    ready_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    student_code TEXT,
    student_name TEXT NOT NULL,
    class_name TEXT,
    original_filename TEXT,
    final_filename TEXT,
    photo_status TEXT NOT NULL DEFAULT 'PENDING',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (session_id)
      REFERENCES production_sessions(id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_students_session_id
  ON students(session_id);

  CREATE INDEX IF NOT EXISTS idx_students_student_code
  ON students(student_code);

  CREATE INDEX IF NOT EXISTS idx_students_photo_status
  ON students(photo_status);

  CREATE TABLE IF NOT EXISTS photo_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    folder_path TEXT NOT NULL,
    total_files INTEGER NOT NULL DEFAULT 0,
    registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (session_id)
      REFERENCES production_sessions(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS session_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    photo_source_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    extension TEXT NOT NULL,
    source_path TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    photo_status TEXT NOT NULL DEFAULT 'REGISTERED',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (session_id)
      REFERENCES production_sessions(id)
      ON DELETE CASCADE,
    FOREIGN KEY (photo_source_id)
      REFERENCES photo_sources(id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_photo_sources_session_id
  ON photo_sources(session_id);

  CREATE INDEX IF NOT EXISTS idx_session_photos_session_id
  ON session_photos(session_id);

  CREATE INDEX IF NOT EXISTS idx_session_photos_filename
  ON session_photos(filename);
`);

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn("production_sessions", "period", "TEXT");
ensureColumn("production_sessions", "imported_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("production_sessions", "invalid_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("production_sessions", "imported_at", "TEXT");
ensureColumn("production_sessions", "import_sheet_name", "TEXT");
ensureColumn("production_sessions", "import_header_row", "INTEGER");
ensureColumn("production_sessions", "import_columns", "TEXT");

ensureColumn("students", "import_row_number", "INTEGER");
ensureColumn("students", "is_valid", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("students", "validation_errors", "TEXT");
ensureColumn("students", "raw_data", "TEXT");
ensureColumn("students", "photo_number", "TEXT");
ensureColumn("students", "match_status", "TEXT NOT NULL DEFAULT 'PENDING'");
ensureColumn("students", "rename_status", "TEXT NOT NULL DEFAULT 'PENDING'");
ensureColumn("students", "source_path", "TEXT");
ensureColumn("students", "destination_path", "TEXT");
ensureColumn("students", "serial_filename", "TEXT");
ensureColumn("students", "serial_path", "TEXT");
ensureColumn("students", "qc_status", "TEXT NOT NULL DEFAULT 'PENDING'");
ensureColumn("students", "qc_notes", "TEXT");
ensureColumn("students", "processing_status", "TEXT NOT NULL DEFAULT 'PENDING'");
ensureColumn("students", "processing_path", "TEXT");
ensureColumn("students", "processing_notes", "TEXT");
ensureColumn("students", "processing_background", "TEXT");

ensureColumn("session_photos", "relative_path", "TEXT");
ensureColumn("session_photos", "photo_number", "TEXT");
ensureColumn("session_photos", "match_status", "TEXT NOT NULL DEFAULT 'PENDING'");
ensureColumn("session_photos", "student_id", "INTEGER");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_students_photo_number
  ON students(photo_number);

  CREATE INDEX IF NOT EXISTS idx_students_match_status
  ON students(match_status);

  CREATE INDEX IF NOT EXISTS idx_students_rename_status
  ON students(rename_status);

  CREATE INDEX IF NOT EXISTS idx_students_qc_status
  ON students(qc_status);

  CREATE INDEX IF NOT EXISTS idx_students_processing_status
  ON students(processing_status);

  CREATE INDEX IF NOT EXISTS idx_session_photos_photo_number
  ON session_photos(photo_number);

  CREATE INDEX IF NOT EXISTS idx_session_photos_match_status
  ON session_photos(match_status);
`);

console.log("SQLite ready:", dbPath);

module.exports = db;
