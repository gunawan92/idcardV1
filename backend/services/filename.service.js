const path = require("path");

function extractPhotoNumber(filename) {
  const nameOnly = path.basename(String(filename || ""), path.extname(String(filename || "")));
  const matches = nameOnly.match(/\d+/g);

  if (!matches || matches.length === 0) {
    return null;
  }

  return String(Number(matches[matches.length - 1]));
}

function normalizePhotoNumber(value) {
  const text = String(value ?? "").trim();

  if (!text || text === "-") {
    return null;
  }

  const numeric = text.match(/\d+(?:\.0+)?$/);

  if (!numeric) {
    return null;
  }

  return String(Number(numeric[0]));
}

function normalizeStudentName(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text || null;
}

function sanitizeFilename(name) {
  return String(name || "")
    .replace(/[<>:"/\\|?*]+/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/g, "")
    .trim();
}

function buildFinalFilename(studentName, photoNumber, extension, duplicateName) {
  const safeName = sanitizeFilename(studentName);
  const safeBase = duplicateName ? `${safeName}_${photoNumber}` : safeName;
  const ext = String(extension || "").startsWith(".") ? extension : `.${extension}`;

  return `${safeBase}${ext}`;
}

module.exports = {
  extractPhotoNumber,
  normalizePhotoNumber,
  normalizeStudentName,
  sanitizeFilename,
  buildFinalFilename,
};
