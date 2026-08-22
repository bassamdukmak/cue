// Screenshot via desktopCapturer, capped before it leaves the main process.
// The first call can trigger the system permission prompt for the app.
const { desktopCapturer, screen } = require('electron');
const MAX_SCREENSHOT_EDGE = 1600;

async function captureScreenshot() {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;
  const scale = primary.scaleFactor || 1;
  const retinaWidth = Math.floor(width * scale);
  const retinaHeight = Math.floor(height * scale);
  const resize = Math.min(1, MAX_SCREENSHOT_EDGE / Math.max(retinaWidth, retinaHeight));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.floor(retinaWidth * resize), height: Math.floor(retinaHeight * resize) }
  });
  if (!sources.length) return null;
  // Prefer the primary display source.
  const src = sources.find((s) => String(s.display_id) === String(primary.id)) || sources[0];
  const img = src.thumbnail;
  if (!img || img.isEmpty()) return null;
  return `data:image/jpeg;base64,${img.toJPEG(90).toString('base64')}`;
}

module.exports = { captureScreenshot, MAX_SCREENSHOT_EDGE };
