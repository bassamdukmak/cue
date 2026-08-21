const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const { extractTextFromImage } = require('../src/ocr');

test('OCR failure to locate a binary returns null', async () => {
  const existsSync = fs.existsSync;
  fs.existsSync = () => false;
  try {
    assert.equal(await extractTextFromImage('data:image/png;base64,AA=='), null);
  } finally {
    fs.existsSync = existsSync;
  }
});
