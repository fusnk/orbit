// Downloads the pinned libmpv build Orbit plays video with, checks it against
// its SHA-256, and extracts it: libmpv-2.dll to src-tauri/libs/windows/, or on
// macOS libmpv.dylib and the libraries it needs to src-tauri/libs/macos/.
// Usage: pnpm run setup:libmpv
//
// The LGPL build is used on purpose: Orbit only loads the DLL at runtime, so
// shipping it doesn't put Orbit itself under the GPL.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Orbit's own mirror of zhongfly/mpv-winbuild's 2026-09-29-b4b5d69a44 release:
// upstream removes releases after about a month. The mirror release also holds
// the build's complete source (see its SOURCES.md).
const ARCHIVE = {
  url: 'https://github.com/fusnk/orbit-libmpv/releases/download/libmpv-20260929-b4b5d69a44/mpv-dev-lgpl-x86_64-20260929-git-b4b5d69a44.7z',
  sha256: '8c80c506cf95f403d8a2b9d672d5f88d965885666f25c850f711a06b9510dfc8',
};
const DLL = 'libmpv-2.dll';

// macOS: media-kit/libmpv-darwin-build v0.7.3, the LGPL "video-full" flavour (mpv 0.36,
// FFmpeg 6.0 without --enable-gpl), one universal build for Apple silicon and Intel.
// libmpv.dylib and the libraries it loads (by @rpath, which resolves to the bundle's
// Contents/Frameworks) go to src-tauri/libs/macos/; tauri.macos.conf.json lists the same files.
const MAC_ARCHIVE = {
  url: 'https://github.com/media-kit/libmpv-darwin-build/releases/download/v0.7.3/libmpv-libs_v0.7.3_macos-universal-video-full.tar.gz',
  sha256: 'f570695d8ba8534835dd4cba0b6e275579c1c22c01a9da0442748ca37e2daac1',
};
const MAC_LIBS = [
  'libmpv.dylib', 'libass.dylib', 'libavcodec.dylib', 'libavfilter.dylib', 'libavformat.dylib', 'libavutil.dylib',
  'libdav1d.dylib', 'libfreetype.dylib', 'libfribidi.dylib', 'libharfbuzz.dylib', 'libmbedcrypto.dylib', 'libmbedtls.dylib',
  'libmbedx509.dylib', 'libpng16.dylib', 'libswresample.dylib', 'libswscale.dylib', 'libuchardet.dylib', 'libxml2.dylib',
];

if (process.platform === 'linux') {
  try {
    const version = execFileSync('pkg-config', ['--modversion', 'mpv'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    console.log(`Using system libmpv ${version}; no bundled library is downloaded on Linux.`);
  } catch {
    throw new Error('Linux uses system libmpv. Install pkg-config and libmpv-dev with your distribution package manager.');
  }
  process.exit(0);
}

if (process.platform === 'darwin') {
  await setupMac();
  process.exit(0);
}

if (process.platform !== 'win32') {
  console.log('libmpv setup is Windows and macOS only for now; skipping.');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src-tauri', 'libs', 'windows');
const target = join(outDir, DLL);
const stamp = join(outDir, `${DLL}.source`);

if (existsSync(target) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === ARCHIVE.sha256) {
  console.log(`${DLL} is already set up.`);
  process.exit(0);
}

console.log(`Downloading ${ARCHIVE.url}`);
const response = await fetch(ARCHIVE.url);
if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());

const actual = createHash('sha256').update(archive).digest('hex');
if (actual !== ARCHIVE.sha256) throw new Error(`Checksum mismatch: expected ${ARCHIVE.sha256}, got ${actual}. Not extracting.`);

const work = mkdtempSync(join(tmpdir(), 'orbit-libmpv-'));
try {
  const file = join(work, 'mpv-dev.7z');
  writeFileSync(file, archive);
  // Windows' bundled bsdtar reads 7z archives, so no extra tool is needed.
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-xf', file, '-C', work, DLL], { stdio: 'inherit' });
  mkdirSync(outDir, { recursive: true });
  // Copy, not rename: the temp dir may be on another drive.
  copyFileSync(join(work, DLL), target);
  writeFileSync(stamp, `${ARCHIVE.sha256}\n`);
  console.log(`Installed ${target}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

async function setupMac() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = join(root, 'src-tauri', 'libs', 'macos');
  const stamp = join(outDir, 'libmpv.source');
  if (MAC_LIBS.every((lib) => existsSync(join(outDir, lib))) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === MAC_ARCHIVE.sha256) {
    console.log('libmpv for macOS is already set up.');
    return;
  }
  console.log(`Downloading ${MAC_ARCHIVE.url}`);
  const response = await fetch(MAC_ARCHIVE.url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== MAC_ARCHIVE.sha256) throw new Error(`Checksum mismatch: expected ${MAC_ARCHIVE.sha256}, got ${actual}. Not extracting.`);
  const work = mkdtempSync(join(tmpdir(), 'orbit-libmpv-'));
  try {
    const file = join(work, 'libmpv.tar.gz');
    writeFileSync(file, archive);
    execFileSync('/usr/bin/tar', ['-xzf', file, '-C', work], { stdio: 'inherit' });
    const extracted = join(work, MAC_ARCHIVE.url.split('/').pop().replace(/\.tar\.gz$/, ''));
    mkdirSync(outDir, { recursive: true });
    for (const lib of MAC_LIBS) copyFileSync(join(extracted, lib), join(outDir, lib));
    writeFileSync(stamp, `${MAC_ARCHIVE.sha256}\n`);
    console.log(`Installed ${MAC_LIBS.length} libraries in ${outDir}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
