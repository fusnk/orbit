// Downloads the pinned yt-dlp build Orbit finds trailers with, checks it
// against its SHA-256, and saves it to src-tauri/libs/windows/.
// Usage: pnpm run setup:ytdlp
//
// yt-dlp is public domain (Unlicense). Orbit runs a copy of it in the app's
// data folder, which yt-dlp keeps up to date itself (YouTube changes often).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE = {
  url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe',
  sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a',
};
const EXE = 'yt-dlp.exe';

if (process.platform !== 'win32') {
  console.log('yt-dlp setup is Windows-only for now; skipping.');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src-tauri', 'libs', 'windows');
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
writeFileSync(stamp, `${RELEASE.sha256}\n`);
console.log(`Installed ${target}`);
