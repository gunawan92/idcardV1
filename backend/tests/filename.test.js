const assert = require("node:assert/strict");
const {
  extractPhotoNumber,
  buildSerialFilename,
  normalizePhotoNumber,
  sanitizeFilename,
} = require("../services/filename.service");

const extractCases = [
  ["IMG_9693.JPG", "9693"],
  ["DSC_9693.JPG", "9693"],
  ["DSC09693.JPG", "9693"],
  ["_9693.JPG", "9693"],
  ["9693.JPG", "9693"],
  ["IMG_2026_9693.JPG", "9693"],
  ["no-number.JPG", null],
];

for (const [input, expected] of extractCases) {
  assert.equal(extractPhotoNumber(input), expected);
}

assert.equal(normalizePhotoNumber(9693), "9693");
assert.equal(normalizePhotoNumber("9693"), "9693");
assert.equal(normalizePhotoNumber("9693.0"), "9693");
assert.equal(normalizePhotoNumber("-"), null);
assert.equal(sanitizeFilename("Allysha Putri / Anwar "), "Allysha Putri - Anwar");
assert.equal(buildSerialFilename("ALZIN51999", ".JPG"), "ALZIN51999.JPG");
assert.equal(buildSerialFilename("ALZIN51999", "jpg"), "ALZIN51999.jpg");

console.log("filename tests passed");
