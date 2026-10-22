/**
 * "Translate to <language>…" for the subtitle showing (Settings → Subtitles →
 * AI subtitle translation, off by default). Rust sends the subtitle's lines
 * to the chosen service, checks every answer and adds the result as a new
 * track (see src-tauri/src/player/subtrans); this keeps the state the
 * Subtitles view shows: progress, cancel, and an error with retry.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { language, t, type MessageKey } from '../../i18n';
import { settings } from '../../lib/ipc';
import { languageName } from '../../lib/languages';
import { formatNumber } from './format';
import { LANGUAGE_CHOICES } from './preferred-language';
import type { TrackInfo } from './tracks';

/** On or off (off by default). */
export const AI_SUBS_ENABLED_KEY = 'subtitles.ai-translate';
/** The service, its model and the target language. */
export const AI_SUBS_KEY = 'subtitles.ai';

export const AI_PROVIDERS = ['local', 'openai', 'gemini', 'claude'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface AiSubs {
  provider: AiProvider;
  /** The model per service, so switching back keeps the one picked. */
  models: Record<AiProvider, string>;
  /** The local server's address (Rust accepts only one on this PC). */
  server: string;
  /** Language key to translate into; '' for the app's language. */
  target: string;
}

export const DEFAULT_SERVER = 'http://127.0.0.1:1234/v1';
// OpenAI and Gemini start with no model: their line-ups change often, so the person picks one from the list the
// service itself returns (Choose a model); an empty one is refused with a message saying where to choose. Claude
// starts on Haiku, its cheap and fast model; Sonnet and the rest are in the same list.
export const DEFAULT_MODELS: Record<AiProvider, string> = { local: 'openai/gpt-oss-20b', openai: '', gemini: '', claude: 'claude-haiku-5-5' };
export const DEFAULT_AI_SUBS: AiSubs = { provider: 'local', models: { ...DEFAULT_MODELS }, server: DEFAULT_SERVER, target: '' };

/** The saved choices, with defaults for anything missing or odd (a hand-edited backup). */
export function parseAiSubs(value: unknown): AiSubs {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const text = (x: unknown, max: number) => (typeof x === 'string' && x.trim() && x.length <= max ? x.trim() : null);
  const saved = v.models && typeof v.models === 'object' ? (v.models as Record<string, unknown>) : {};
  const models = Object.fromEntries(AI_PROVIDERS.map((p) => [p, text(saved[p], 128) ?? DEFAULT_MODELS[p]])) as Record<AiProvider, string>;
  return {
    provider: AI_PROVIDERS.find((p) => p === v.provider) ?? DEFAULT_AI_SUBS.provider,
    models,
    server: text(v.server, 200) ?? DEFAULT_SERVER,
    target: typeof v.target === 'string' && LANGUAGE_CHOICES.includes(v.target) ? v.target : '',
  };
}

/** The language to translate into: the one chosen, else the app's own (English if it isn't offered). */
export function targetLanguage(prefs: AiSubs): string {
  if (prefs.target) return prefs.target;
  const app = language().split('-')[0] ?? 'en';
  return LANGUAGE_CHOICES.includes(app) ? app : 'en';
}

const englishNames = new Intl.DisplayNames(['en'], { type: 'language' });

/** What Rust gets: the service settings and the language (its English name is what the model reads). */
export function translateArgs(prefs: AiSubs, label: (language: string) => string) {
  const code = targetLanguage(prefs);
  return {
    config: { provider: prefs.provider, model: prefs.models[prefs.provider], server: prefs.provider === 'local' ? prefs.server : '' },
    target: { name: englishNames.of(code) ?? 'English', code },
    label: label(languageName(code)),
  };
}

export interface Translated {
  track: number | null;
  lines: number;
  /** Lines left in the original language. */
  kept: number;
  cached: boolean;
}

export type TranslateState = { kind: 'idle' } | { kind: 'running'; done: number; total: number } | { kind: 'failed'; message: string };

const ERRORS: Record<string, MessageKey> = {
  'no-subtitle': 'subtrans.error.no-subtitle',
  embedded: 'subtrans.error.embedded',
  unreadable: 'subtrans.error.unreadable',
  unsupported: 'subtrans.error.unsupported',
  'no-key': 'subtrans.error.no-key',
  denied: 'subtrans.error.denied',
  'rate-limited': 'subtrans.error.rate-limited',
  'not-local': 'subtrans.error.not-local',
  'bad-model': 'subtrans.error.bad-model',
  rejected: 'subtrans.error.rejected',
  'server-error': 'subtrans.error.server-error',
  timeout: 'subtrans.error.timeout',
  unreachable: 'subtrans.error.unreachable',
  'bad-answer': 'subtrans.error.bad-answer',
  refused: 'subtrans.error.refused',
  overloaded: 'subtrans.error.overloaded',
};

/** What went wrong, from Rust's error code; null when it was cancelled (nothing to say). */
export function errorMessage(code: unknown): string | null {
  if (code === 'cancelled') return null;
  return typeof code === 'string' && Object.hasOwn(ERRORS, code) ? t(ERRORS[code]!) : t('subtrans.error.failed');
}

/** "Translating… 40%" while it runs. */
export function progressText(done: number, total: number): string {
  if (total <= 0) return t('subtrans.player.starting');
  return t('subtrans.player.progress', { percent: `${formatNumber(Math.round((done / total) * 100), 0)}%` });
}

export function createSubtitleTranslate(host: {
  /** The state changed: the Subtitles view redraws. */
  changed(): void;
  /** Says something briefly (a toast). */
  say(text: string): void;
  /** The finished translation is this track (mpv may have listed it already). */
  added?(track: number): void;
}) {
  let state: TranslateState = { kind: 'idle' };
  let enabled = false;
  let prefs = DEFAULT_AI_SUBS;
  let selected: number | null = null;
  /** Bumped by each run and by another file: a reply for an older one is dropped. */
  let generation = 0;

  function load(): void {
    void Promise.all([settings.get(AI_SUBS_ENABLED_KEY).catch(() => undefined), settings.get(AI_SUBS_KEY).catch(() => undefined)]).then(([on, saved]) => {
      enabled = on === true;
      prefs = parseAiSubs(saved);
      host.changed();
    });
  }
  load();

  // Each run's events carry the ticket it was started with: a cancelled or overtaken run may still say
  // how far it got (its first count comes once its subtitle is read), and that isn't this run's progress.
  const unlisten = listen<{ ticket: number; done: number; total: number }>('player://translate', (e) => {
    if (state.kind !== 'running' || e.payload.ticket !== generation) return;
    state = { kind: 'running', done: e.payload.done, total: e.payload.total };
    host.changed();
  });

  async function run(): Promise<void> {
    if (selected === null) return;
    const mine = ++generation;
    state = { kind: 'running', done: 0, total: 0 };
    host.changed();
    const args = translateArgs(prefs, (name) => t('subtrans.player.track', { language: name }));
    try {
      const result = await invoke<Translated>('player_translate_subtitle', { ...args, ticket: mine });
      if (mine !== generation) return;
      state = { kind: 'idle' };
      if (result.track !== null) host.added?.(result.track);
      const name = languageName(args.target.code);
      host.say(result.kept ? t('subtrans.player.partial', { language: name }) : t('subtrans.player.done', { language: name }));
    } catch (err) {
      if (mine !== generation) return;
      const message = errorMessage(err);
      state = message ? { kind: 'failed', message } : { kind: 'idle' };
    }
    host.changed();
  }

  function cancel(): void {
    generation++;
    state = { kind: 'idle' };
    void invoke('player_translate_cancel').catch(() => {});
    host.changed();
  }

  return {
    state: () => state,
    /**
     * Whether the row shows: the feature is on and an added subtitle (not the video's own) is showing,
     * or a translation runs (its Cancel stays, whatever is picked meanwhile).
     */
    available: () => enabled && (selected !== null || state.kind === 'running'),
    /** "Spanish", for "Translate to Spanish…". */
    targetName: () => languageName(targetLanguage(prefs)),
    /** The row: starts (or retries); while running, it cancels. */
    toggle(): void {
      if (state.kind === 'running') return cancel();
      void run();
    },
    /** mpv's track list changed: notes the subtitle showing. */
    tracks(list: readonly TrackInfo[]): void {
      const shown = list.find((track) => track.kind === 'sub' && track.selected);
      const next = shown?.external ? shown.id : null;
      // An error was about the subtitle it was for.
      if (next !== selected && state.kind === 'failed') state = { kind: 'idle' };
      selected = next;
    },
    /** Another file: nothing carries over (its tracks are numbered anew); the settings are read again. */
    newFile(): void {
      if (state.kind === 'running') void invoke('player_translate_cancel').catch(() => {});
      generation++;
      state = { kind: 'idle' };
      selected = null;
      load();
    },
    dispose(): void {
      generation++;
      void unlisten.then((fn) => fn());
    },
  };
}
