/**
 * "Your {year} in Orbit" (My Library → Stats): a card with the year's top
 * titles, totals, top genre and a fun fact, drawn on a canvas so it can be
 * saved as a PNG to Pictures\Orbit.
 *
 * Posters come from addons on other hosts; drawing those straight onto the
 * canvas would taint it and block the export. So, as for the ambient glow,
 * Rust fetches their bytes (`art_fetch`, under the addon network rules) and
 * the canvas draws them from same-origin blobs. A poster that can't be had
 * is drawn as a coloured tile with the title's initials.
 */
import { invoke } from '@tauri-apps/api/core';
import { fallbackHue, type Title } from '../../catalog/titles';
import { openDrawer } from '../../components/drawer';
import { toast } from '../../components/toast';
import { isRtl, locale, t, tn } from '../../i18n';
import { clockFormat } from '../../lib/clock';
import { h } from '../../lib/dom';
import type { WatchStats } from '../../library/stats';

/** Hours with one decimal under 10 ("2.5"), whole above. */
export const hoursOf = (minutes: number) => {
  const hours = minutes / 60;
  return hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours);
};
const weekdayName = new Intl.DateTimeFormat(locale(), { weekday: 'long' });

/** 0 (Sunday) to 6 as a name: 4 January 2026 was a Sunday. */
export const weekday = (day: number) => weekdayName.format(new Date(2026, 0, 4 + day));
export const hourLabel = (hour: number) => clockFormat(true).format(new Date(2026, 0, 1, hour));

const WIDTH = 1080;
const HEIGHT = 1350;
const MARGIN = 80;
const POSTERS = 5;

export function openYearReview(year: number, stats: WatchStats): void {
  const canvas = h('canvas', { class: 'review-canvas', width: String(WIDTH), height: String(HEIGHT), role: 'img', 'aria-label': summary(year, stats) });
  const save = h('button', { class: 'button primary', disabled: true }, t('insights.review.save'));
  const done = h('button', { class: 'button glass' }, t('titles.common.done'));
  const content = h(
    'div',
    { class: 'year-review' },
    h('h2', { class: 'review-title' }, t('insights.review.title', { year: String(year) })),
    h('p', { class: 'muted' }, t('insights.review.body')),
    canvas,
    h('div', { class: 'review-actions' }, done, save),
  );
  const close = openDrawer(content, t('insights.review.title', { year: String(year) }));
  done.addEventListener('click', close);

  const drawn = drawCard(canvas, year, stats)
    .then(() => (save.disabled = false))
    .catch((err: unknown) => console.error('Could not draw the year in review', err));
  save.addEventListener('click', () => {
    save.disabled = true;
    void drawn
      .then(() => saveCard(canvas, year))
      .then(() => toast(t('insights.review.saved')))
      .catch((err: unknown) => {
        console.error('Could not save the year in review', err);
        toast(t('insights.review.save-failed'));
      })
      .finally(() => (save.disabled = false));
  });
}

/** What the card says, for screen readers. */
function summary(year: number, stats: WatchStats): string {
  return [
    t('insights.review.title', { year: String(year) }),
    tn('insights.review.movies', stats.movies),
    tn('insights.review.episodes', stats.episodes),
    tn('insights.review.hours', hoursOf(stats.minutes)),
    stats.genres[0] ? t('insights.review.top-genre-is', { genre: stats.genres[0].genre }) : '',
    funFact(stats),
  ]
    .filter(Boolean)
    .join('. ');
}

function funFact(stats: WatchStats): string {
  const days = Math.floor(stats.minutes / (24 * 60));
  if (days >= 2) return tn('insights.review.fact-days', days);
  if (stats.streak >= 3) return tn('insights.review.fact-streak', stats.streak);
  if (stats.busiestHour !== null && (stats.busiestHour >= 22 || stats.busiestHour < 4)) return t('insights.review.fact-night', { hour: hourLabel(stats.busiestHour) });
  if (stats.busiestWeekday !== null) return t('insights.review.fact-weekday', { day: weekday(stats.busiestWeekday) });
  return tn('insights.review.fact-active', stats.days);
}

async function saveCard(canvas: HTMLCanvasElement, year: number): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('no image');
  // Raw bytes (not JSON); the year names the file, which Rust picks.
  await invoke<string>('review_save', new Uint8Array(await blob.arrayBuffer()), { headers: { 'orbit-year': String(year) } });
}

async function poster(title: Title): Promise<ImageBitmap | null> {
  if (!title.poster) return null;
  try {
    const bytes = await invoke<ArrayBuffer>('art_fetch', { url: title.poster });
    return await createImageBitmap(new Blob([bytes]));
  } catch {
    return null;
  }
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /\p{L}|\p{N}/u.test(w))
    .slice(0, 2)
    .map((w) => [...w][0]!.toLocaleUpperCase(locale()))
    .join('');

async function drawCard(canvas: HTMLCanvasElement, year: number, stats: WatchStats): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  await document.fonts.ready;
  const font = getComputedStyle(document.body).fontFamily;
  const top = stats.top.slice(0, POSTERS);
  const images = await Promise.all(top.map((entry) => poster(entry.title)));
  const hue = top[0] ? fallbackHue(top[0].title.id) : 220;

  // Background: a deep two-tone gradient in the top title's hue.
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, `hsl(${hue} 45% 18%)`);
  bg.addColorStop(1, `hsl(${(hue + 50) % 360} 50% 6%)`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const glow = ctx.createRadialGradient(WIDTH * 0.8, 120, 0, WIDTH * 0.8, 120, 700);
  glow.addColorStop(0, `hsl(${hue} 70% 55% / 0.35)`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.direction = isRtl() ? 'rtl' : 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const text = (value: string, y: number, size: number, weight: number, alpha = 1, maxWidth = WIDTH - 2 * MARGIN) => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = `rgb(255 255 255 / ${alpha})`;
    ctx.fillText(value, WIDTH / 2, y, maxWidth);
  };

  text(t('insights.review.eyebrow').toLocaleUpperCase(locale()), 130, 28, 700, 0.6);
  let y = wrap(ctx, t('insights.review.title', { year: String(year) }), 210, 76, 800, font, 2) + 40;

  // The top titles' posters, most watched first (from the right in right-to-left languages).
  const gap = 24;
  const width = Math.min(240, (WIDTH - 2 * MARGIN - gap * (POSTERS - 1)) / Math.max(top.length, 3));
  const height = width * 1.5;
  const row = top.length * width + (top.length - 1) * gap;
  top.forEach((entry, i) => {
    const slot = isRtl() ? top.length - 1 - i : i;
    const x = (WIDTH - row) / 2 + slot * (width + gap);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 18);
    ctx.clip();
    const image = images[i];
    if (image) ctx.drawImage(image, x, y, width, height);
    else {
      ctx.fillStyle = `hsl(${fallbackHue(entry.title.id)} 35% 30%)`;
      ctx.fillRect(x, y, width, height);
      ctx.font = `800 ${Math.round(width / 3)}px ${font}`;
      ctx.fillStyle = 'rgb(255 255 255 / 0.85)';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials(entry.title.name), x + width / 2, y + height / 2, width - 16);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  });
  images.forEach((image) => image?.close());
  y += height + 70;
  if (top[0]) {
    text(t('insights.review.most-watched'), y, 26, 600, 0.6);
    text(top[0].title.name, y + 50, 40, 800);
    y += 120;
  }

  // Totals in three columns.
  const hours = hoursOf(stats.minutes);
  const totals = [
    { value: stats.movies, label: tn('insights.stats.movies', stats.movies) },
    { value: stats.episodes, label: tn('insights.stats.episodes', stats.episodes) },
    { value: hours, label: tn('insights.stats.hours', hours) },
  ];
  const column = (WIDTH - 2 * MARGIN) / 3;
  totals.forEach((total, i) => {
    const slot = isRtl() ? 2 - i : i;
    const x = MARGIN + column * slot + column / 2;
    ctx.font = `800 84px ${font}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(total.value.toLocaleString(locale()), x, y + 60, column - 20);
    ctx.font = `600 26px ${font}`;
    ctx.fillStyle = 'rgb(255 255 255 / 0.65)';
    ctx.fillText(total.label, x, y + 105, column - 20);
  });
  y += 180;

  if (stats.genres[0]) {
    text(t('insights.review.top-genre'), y, 26, 600, 0.6);
    text(stats.genres[0].genre, y + 50, 44, 800);
    y += 110;
  }
  wrap(ctx, funFact(stats), y, 32, 600, font, 2, 0.85);

  text(t('insights.review.footer'), HEIGHT - 60, 24, 700, 0.45);
}

/** Centred text over up to `lines` lines; returns the y below it. */
function wrap(ctx: CanvasRenderingContext2D, value: string, y: number, size: number, weight: number, font: string, lines: number, alpha = 1): number {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = `rgb(255 255 255 / ${alpha})`;
  const maxWidth = WIDTH - 2 * MARGIN;
  const out: string[] = [];
  let line = '';
  for (const word of value.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  const shown = out.slice(0, lines);
  shown.forEach((l, i) => ctx.fillText(l, WIDTH / 2, y + i * size * 1.2, maxWidth));
  return y + (shown.length - 1) * size * 1.2;
}
