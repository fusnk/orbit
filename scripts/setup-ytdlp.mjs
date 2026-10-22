// Downloads the pinned yt-dlp build Orbit finds trailers with, checks it
// against its SHA-256, and saves it to src-tauri/libs/windows/ (yt-dlp.exe) or,
// on macOS, src-tauri/libs/macos/ (yt-dlp_macos, for Apple silicon and Intel).
// Usage: pnpm run setup:ytdlp
//
// yt-dlp is public domain (Unlicense). Orbit runs a copy of it in the app's
// data folder, which yt-dlp keeps up to date itself (YouTube changes often).
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mac = process.platform === 'darwin';
const RELEASE = mac
  ? {
      url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_macos',
      sha256: '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202',
    }
  : {
      url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe',
      sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a',
    };
const EXE = mac ? 'yt-dlp_macos' : 'yt-dlp.exe';

if (process.platform !== 'win32' && !mac) {
  console.log('yt-dlp setup is Windows and macOS only for now; skipping.');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src-tauri', 'libs', mac ? 'macos' : 'windows');
const target = join(outDir, EXE);
const stamp = join(outDir, `${EXE}.source`);

if (existsSync(target) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === RELEASE.sha256) {
  console.log(`${EXE} is already set up.`);
  process.exit(0);
}

console.log(`Downloading ${RELEASE.url}`);
const response = await fetch(RELEASE.url);
if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
const exe = Buffer.from(await response.arrayBuffer());

const actual = createHash('sha256').update(exe).digest('hex');
if (actual !== RELEASE.sha256) throw new Error(`Checksum mismatch: expected ${RELEASE.sha256}, got ${actual}. Not saving.`);

mkdirSync(outDir, { recursive: true });
writeFileSync(target, exe);
if (mac) chmodSync(target, 0o755);
writeFileSync(stamp, `${RELEASE.sha256}\n`);
console.log(`Installed ${target}`);
