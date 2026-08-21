const path = require('path');
const { Arch } = require('builder-util');
const { prepareWhisperRuntime } = require('./prepare-whisper-runtime');

/** Add the matching native runtime after Electron has assembled each target.
 *
 * Opt-in via CUE_BUNDLE_WHISPER=1. Preparing the runtime downloads a pinned
 * release on Windows/Linux and builds whisper.cpp from source with cmake on
 * macOS, so leaving it on by default would make every `npm run pack` and every
 * release build depend on the network and on a local toolchain — including the
 * signed macOS release, which has nothing to do with local transcription.
 * Local whisper is one optional speech-to-text provider among several; the app
 * runs fine without the bundled runtime and simply does not offer it.
 */
module.exports = async function afterPack(context) {
  if (!process.env.CUE_BUNDLE_WHISPER) {
    console.log('[cue] Skipping the bundled whisper runtime (set CUE_BUNDLE_WHISPER=1 to include it).');
    return;
  }
  const platform = context.packager.platform.nodeName;
  const architecture = typeof context.arch === 'number' ? Arch[context.arch] : context.arch;
  if (!platform || !architecture) throw new Error('electron-builder did not provide a runtime target.');

  // Resources live in different places per platform: appOutDir/resources on
  // Windows and Linux, but appOutDir/<Product>.app/Contents/Resources on macOS.
  // electron-builder resolves that difference for us; hardcoding the former put
  // the runtime next to the bundle instead of inside it, so the packaged macOS
  // app never found local whisper at all.
  const resourcesDirectory = typeof context.packager.getResourcesDir === 'function'
    ? context.packager.getResourcesDir(context.appOutDir)
    : path.join(context.appOutDir, 'resources');
  const outputDirectory = path.join(resourcesDirectory, 'whisper-runtime');
  await prepareWhisperRuntime({ platform, architecture, outputDirectory });
};
