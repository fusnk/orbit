/**
 * The phone remote's picker, in the page (Rust keeps and serves it, see
 * src-tauri/src/remote/picker.rs): Home's rows as Home has them, the mood
 * chips' picks, a Surprise Me pick, and a title's details. Everything comes
 * from the loaders Home and Surprise Me use, and passes the profile's
 * content limit (`allowedTitles`) as Home's rows do; Play and Add to
 * library check it again, as opening a search result does.
 */
import { invoke } from '@tauri-apps/api/core';
import { allowedTitles, verdictFor } from '../catalog/parental';
import { loadMeta, usableAddons } from '../catalog/service';
import { tmdbConnected } from '../catalog/tmdb';
import { browsableCatalogs, displayYear, runtimeLabel, type Title } from '../catalog/titles';
import { toast } from '../components/toast';
import { t } from '../i18n';
import { inLibrary, toggleLibrary } from '../library/library';
import { MAX_PICKER_MOODS, MAX_PICKER_ROWS, MAX_PICKER_TITLES, pickDetails, pickTitle, type PickerShelf, type RemoteCommand } from '../lib/remote';
import { settleWithin, withTimeout } from '../lib/timeout';
import { quickSurprise } from '../rooms/discover/surprise';
import { moodChips, type MoodChip } from '../rooms/home/chip-rows';
import { HOME_FEEDS_KNOWN, homeFeeds, type RowFeed } from '../rooms/home/feeds';

/** A row, mood or details that take longer are left out (or shown as failed), so the phone isn't left waiting. */
const LOAD_WAIT_MS = 10_000;
/** How long a request waits for Home's first draw (at startup) for its rows. */
const HOME_WAIT_MS = 8000;
/** Titles a row is filtered from: more than it shows, as some may fall to the content limit. */
const ROW_POOL = MAX_PICKER_TITLES * 2;

export type PickerCommand = Extract<RemoteCommand, { kind: 'browse' | 'mood' | 'surprise' | 'details' | 'pick' }>;

/** The titles on each shelf, by the request that filled it (Rust's numbers, so a command finds the same title). */
const shelves: Record<PickerShelf, { id: number; rows: Title[][] } | null> = { home: null, mood: null, surprise: null };
/** The mood chips the phone was offered. */
let chips: MoodChip[] = [];
/** The title whose details the phone shows, once fully loaded. */
let shown: { id: number; title: Title } | null = null;

/** Only what the profile's content limit allows, as Home's rows show. */
const allowedRow = async (titles: readonly Title[]): Promise<Title[]> => (await allowedTitles(titles.slice(0, ROW_POOL))).slice(0, MAX_PICKER_TITLES);

const toPick = (title: Title) => pickTitle({ ...title, year: displayYear(title.year) });

/** Home's rows, waiting briefly for its first draw. */
async function homeRows(): Promise<RowFeed[]> {
  const known = homeFeeds();
  if (known) return known();
  // Removed if Home doesn't draw in time, so requests while it never does don't pile up listeners.
  const stop = new AbortController();
  const drawn = new Promise<void>((resolve) => document.addEventListener(HOME_FEEDS_KNOWN, () => resolve(), { once: true, signal: stop.signal }));
  await settleWithin(drawn, HOME_WAIT_MS, undefined);
  stop.abort();
  return (await homeFeeds()?.()) ?? [];
}

/** The chips Home offers, from the same catalogs. */
async function offeredChips(): Promise<MoodChip[]> {
  const refs = browsableCatalogs(await usableAddons()).filter((ref) => ref.catalog.type === 'movie' || ref.catalog.type === 'series');
  return (await moodChips(refs, await tmdbConnected())).chips.slice(0, MAX_PICKER_MOODS);
}

/** Newer than what the shelf holds (an older request finishing last is dropped, as Rust drops it). */
const newest = (shelf: PickerShelf, id: number) => !shelves[shelf] || id >= shelves[shelf].id;

async function browse(id: number): Promise<void> {
  let rows: { title: string; titles: Title[] }[] = [];
  let offered: MoodChip[] = [];
  let failed = false;
  try {
    const [feeds, moods] = await Promise.all([homeRows(), offeredChips().catch(() => [])]);
    offered = moods;
    // A few extra, as some rows may come back empty.
    const loaded = await Promise.all(
      feeds.slice(0, MAX_PICKER_ROWS * 2).map(async (feed) => ({ title: feed.title, titles: await settleWithin(feed.load().then(allowedRow), LOAD_WAIT_MS, [] as Title[]) })),
    );
    rows = loaded.filter((row) => row.titles.length).slice(0, MAX_PICKER_ROWS);
  } catch (err) {
    console.warn('Phone remote: could not load Home’s rows', err);
    failed = true;
  }
  if (!newest('home', id)) return;
  shelves.home = { id, rows: rows.map((row) => row.titles) };
  chips = offered;
  await invoke('remote_picker_home', {
    id,
    rows: rows.map((row) => ({ title: row.title, titles: row.titles.map(toPick) })),
    moods: offered.map((chip) => ({ id: chip.chip, label: chip.label })),
    failed,
  });
}

/** A mood's row, or the surprise: one row of titles. */
async function single(shelf: 'mood' | 'surprise', id: number, load: () => Promise<{ titles: Title[]; failed: boolean }>): Promise<void> {
  let titles: Title[] = [];
  let failed: boolean;
  try {
    ({ titles, failed } = await withTimeout(load(), LOAD_WAIT_MS, 'Phone remote picks'));
  } catch (err) {
    console.warn('Phone remote: could not load picks', err);
    failed = true;
  }
  if (!newest(shelf, id)) return;
  shelves[shelf] = { id, rows: [titles] };
  await invoke('remote_picker_titles', { shelf, id, titles: titles.map(toPick), failed });
}

async function moodRow(chip: string): Promise<{ titles: Title[]; failed: boolean }> {
  const found = chips.find((c) => c.chip === chip);
  return { titles: found ? await allowedRow(await found.load()) : [], failed: false };
}

async function surprise(media: 'movie' | 'series'): Promise<{ titles: Title[]; failed: boolean }> {
  // quickSurprise only picks among titles the content limit allows.
  const { pick, failed } = await quickSurprise(media);
  return { titles: pick ? [pick] : [], failed };
}

const titleAt = (from: PickerShelf, shelf: number, row: number, index: number): Title | undefined => (shelves[from]?.id === shelf ? shelves[from].rows[row]?.[index] : undefined);

const sendDetails = (at: { id: number; title: Title }) =>
  invoke('remote_picker_details', { id: at.id, details: pickDetails({ ...at.title, year: displayYear(at.title.year) }, runtimeLabel(at.title.runtime), inLibrary(at.title.id)), failed: false });

async function details(command: Extract<PickerCommand, { kind: 'details' }>): Promise<void> {
  const title = titleAt(command.from, command.shelf, command.row, command.index);
  if (!title) return void (await invoke('remote_picker_details', { id: command.id, details: null, failed: true }));
  // The full title (a show's seasons, a runtime) when its addon answers in time; what the row had otherwise.
  const full = await settleWithin(loadMeta(title.type, title.id), LOAD_WAIT_MS, null);
  if (shown && command.id < shown.id) return;
  shown = { id: command.id, title: full ?? title };
  await sendDetails(shown);
}

async function pick(command: Extract<PickerCommand, { kind: 'pick' }>, play: (title: Title) => void): Promise<void> {
  const listed = titleAt(command.from, command.shelf, command.row, command.index);
  if (!listed) return;
  // The details' fuller copy when it's that title (a show's episodes are loaded already).
  const title = shown?.title.id === listed.id ? shown.title : listed;
  // The rows were within the limit; checked again in case it changed since.
  if ((await verdictFor(title)) === 'blocked') return toast(t('parental.blocked.toast', { name: title.name }));
  if (command.action === 'play') return play(title);
  if (!inLibrary(title.id) && !(await toggleLibrary(title))) return;
  if (shown?.title.id === title.id) await sendDetails(shown);
}

/** Runs one of the picker's commands; `play` is Orbit's own Play (the same one search results use). */
export function runPicker(command: PickerCommand, play: (title: Title) => void): Promise<void> {
  switch (command.kind) {
    case 'browse':
      return browse(command.id);
    case 'mood':
      return single('mood', command.id, () => moodRow(command.mood));
    case 'surprise':
      return single('surprise', command.id, () => surprise(command.media));
    case 'details':
      return details(command);
    case 'pick':
      return pick(command, play);
  }
}
