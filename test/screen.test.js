const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

test('screenshots are capped at 1600 pixels and encoded as JPEG before sending', async () => {
  const originalLoad = Module._load;
  const screenPath = require.resolve('../src/screen');
  let sourceRequest;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return {
      screen: { getPrimaryDisplay: () => ({ id: 7, size: { width: 2560, height: 1440 }, scaleFactor: 2 }) },
      desktopCapturer: {
        getSources: async (requestOptions) => {
          sourceRequest = requestOptions;
          return [{ display_id: '7', thumbnail: { isEmpty: () => false, toJPEG: (quality) => { assert.equal(quality, 90); return Buffer.from('screen'); } } }];
        }
      }
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[screenPath];
    const { captureScreenshot } = require('../src/screen');
    assert.equal(await captureScreenshot(), 'data:image/jpeg;base64,c2NyZWVu');
    assert.deepEqual(sourceRequest.thumbnailSize, { width: 1600, height: 900 });
  } finally {
    delete require.cache[screenPath];
    Module._load = originalLoad;
  }
});
