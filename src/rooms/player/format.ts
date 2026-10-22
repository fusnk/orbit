import { locale, t } from '../../i18n';

/** "4:05", "1:02:09": no leading zero hours, seconds always two digits. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

/** "S1 · E2 · Pilot", or "S1 · E2" for an episode without a name. */
export function episodeLine(season: number, number: number, title: string): string {
  const numbers = { season: String(season), episode: String(number) };
  return title.trim() ? t('player.episode.short-title', { ...numbers, title }) : t('player.episode.short', numbers);
}

/** A number in the interface's language ("44.1", "44,1"), without thousands separators; `digits` fixes the decimals. */
export function formatNumber(n: number, digits?: number): string {
  return n.toLocaleString(locale(), { useGrouping: false, ...(digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits }) });
}

/**
 * Seconds as typed: "1.5", "1,5", "-2", "−0.3 s", "+4". Either decimal mark
 * works, whatever the language (there are no thousands at this size); a
 * unit after the number is ignored. Null when it isn't a number.
 */
export function parseSeconds(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(/[−–]/g, '-')
    .replace(/\s+/g, '')
    .replace(/\p{L}+\.?$/u, '')
    .replace(',', '.');
  return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(cleaned) ? Number(cleaned) : null;
}

/**
 * The quality badge for a video's height. Thresholds sit below the nominal
 * sizes because widescreen releases are often cropped (a 1080p film at 2.39:1
 * is ~800 pixels tall), so the badge follows the release's class, not exact rows.
 */
export function qualityLabel(height: number | null | undefined): string | null {
  if (!height || height <= 0) return null;
  if (height >= 1500) return '4K';
  if (height >= 780) return '1080p';
  if (height >= 520) return '720p';
  return 'SD';
}

/**
 * Rows for the info panel from mpv's raw properties (see INFO_PROPERTIES in
 * src-tauri/src/player/mod.rs). Missing values are left out.
 */
export function formatInfo(raw: Readonly<Record<string, string>>, known: { addon: string; file?: string | undefined }): [string, string][] {
  const num = (key: string) => {
    const n = Number(raw[key]);
    return raw[key] !== undefined && Number.isFinite(n) ? n : null;
  };
  const rows: [string, string][] = [[t('player.info.source'), known.addon]];
  if (known.file) rows.push([t('player.info.file'), known.file]);

  const width = num('width');
  const height = num('height');
  const fps = num('container-fps');
  const video = [raw['video-format']?.toUpperCase(), width && height ? `${width}×${height}` : null, fps ? t('player.info.fps', { value: formatNumber(Math.round(fps * 1000) / 1000) }) : null].filter(Boolean).join(' · ');
  if (video) rows.push([t('player.info.video'), video]);

  const gamma = raw['video-params/gamma'];
  if (gamma) rows.push([t('player.info.dynamic-range'), gamma === 'pq' ? 'HDR10 (PQ)' : gamma === 'hlg' ? 'HLG' : 'SDR']);

  const hwdec = raw['hwdec-current'];
  if (hwdec !== undefined) rows.push([t('player.info.decoding'), !hwdec || hwdec === 'no' ? t('player.info.software') : t('player.info.hardware', { name: hwdec })]);

  const rate = num('audio-params/samplerate');
  const audio = [raw['audio-codec-name']?.toUpperCase(), raw['audio-params/hr-channels'], rate ? t('player.info.khz', { value: formatNumber(rate / 1000) }) : null].filter(Boolean).join(' · ');
  if (audio) rows.push([t('player.info.audio'), audio]);

  if (raw['file-format']) rows.push([t('player.info.container'), raw['file-format']]);

  const vbit = num('video-bitrate');
  const abit = num('audio-bitrate');
  const bitrate = [vbit ? t('player.info.video-bitrate', { value: formatNumber(vbit / 1e6, 1) }) : null, abit ? t('player.info.audio-bitrate', { value: formatNumber(Math.round(abit / 1e3)) }) : null].filter(Boolean).join(' · ');
  if (bitrate) rows.push([t('player.info.bitrate'), bitrate]);

  const cached = num('demuxer-cache-duration');
  if (cached !== null) rows.push([t('player.info.buffered'), t('player.info.seconds', { value: formatNumber(Math.round(cached)) })]);
  const dropped = num('frame-drop-count');
  const decoderDropped = num('decoder-frame-drop-count');
  const counts = [dropped, decoderDropped].filter((value): value is number => value !== null && value >= 0 && Number.isInteger(value));
  if (counts.length) rows.push([t('trybox.info.dropped'), counts.map((value) => formatNumber(value)).join(' / ')]);
  const measuredFps = num('estimated-vf-fps');
  if (measuredFps !== null && measuredFps > 0) rows.push([t('trybox.info.fps'), formatNumber(measuredFps, 2)]);
  return rows;
}
