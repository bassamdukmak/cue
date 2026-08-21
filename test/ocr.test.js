const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const { extractTextFromImage } = require('../src/ocr');

test('OCR failure to locate a binary returns a typed reason', async () => {
  const existsSync = fs.existsSync;
  fs.existsSync = () => false;
  try {
    assert.deepEqual(await extractTextFromImage('data:image/png;base64,AA=='), {
      text: null,
      error: 'OCR helper is not installed.'
    });
  } finally {
    fs.existsSync = existsSync;
  }
});
