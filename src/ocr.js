const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function isPackaged() {
  try {
    return require('electron').app?.isPackaged === true;
  } catch (_) {
    return false;
  }
}

function locateOcrBinary() {
  if (process.platform !== 'darwin') return null;
  const candidates = [];
  if (process.env.CUE_OCR_BINARY) candidates.push(path.resolve(process.env.CUE_OCR_BINARY));
  if (isPackaged() && process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'ocr', 'cue-ocr'));
  if (!isPackaged()) candidates.push(path.join(__dirname, '..', '.cache', 'ocr', 'cue-ocr'));
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function isOcrAvailable() {
  return !!locateOcrBinary();
}

async function extractTextFromImage(dataUrl) {
  const binary = locateOcrBinary();
  if (!binary) return { text: null, error: 'OCR helper is not installed.' };
  if (typeof dataUrl !== 'string') return { text: null, error: 'Screenshot data is invalid.' };

  let tempDirectory;
  let imagePath;
  try {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return { text: null, error: 'Screenshot data is invalid.' };
    tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cue-ocr-'));
    imagePath = path.join(tempDirectory, 'screen.png');
    await fs.promises.writeFile(imagePath, Buffer.from(dataUrl.slice(comma + 1), 'base64'));
    return await new Promise((resolve) => {
      let settled = false;
      let output = '';
      let timer;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const child = spawn(binary, [imagePath], { stdio: ['ignore', 'pipe', 'ignore'] });
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.once('error', (error) => finish({ text: null, error: `OCR could not start: ${error.message}` }));
      child.once('close', (code) => {
        const text = output.trim();
        if (code !== 0) return finish({ text: null, error: `OCR exited with code ${code}.` });
        finish(text ? { text: text.slice(0, 6000), error: null } : { text: null, error: 'OCR found no readable text.' });
      });
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish({ text: null, error: 'OCR timed out.' });
      }, 5000);
    });
  } catch (error) {
    return { text: null, error: `OCR could not read the screenshot: ${error.message}` };
  } finally {
    if (imagePath) await fs.promises.unlink(imagePath).catch(() => {});
    if (tempDirectory) await fs.promises.rmdir(tempDirectory).catch(() => {});
  }
}

module.exports = { isOcrAvailable, extractTextFromImage };
