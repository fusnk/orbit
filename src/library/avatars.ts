/**
 * Profile pictures: bundled with Orbit (Orbit's own flat illustrations, in
 * src/assets/avatars), or uploaded (see src-tauri/src/avatars.rs). A profile
 * stores only the name, e.g. "planet" or "upload-0123456789abcdef"; unknown
 * names fall back to the coloured initial.
 *
 * Bundled pictures reach the page as `<img src>` of files Vite bundles, never
 * as markup, so an SVG is a picture here and nothing more. They're drawn on a
 * transparent background: each sits on its own gradient (`avatarGradient`).
 */
import { invoke } from '@tauri-apps/api/core';
import { t, type MessageKey } from '../i18n';
import { ShownError } from '../lib/user-error';
import { listProfiles } from './profiles';

const files = import.meta.glob<string>('../assets/avatars/*.{png,svg}', { eager: true, query: '?url', import: 'default' });

const byName = new Map(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1).replace(/\.(png|svg)$/, ''), url]));

export interface AvatarCategory {
  id: string;
  names: string[];
}

/** The picker's groups, in display order; only pictures that are bundled are listed. */
export const AVATAR_CATEGORIES: AvatarCategory[] = [
  { id: 'faces', names: ['smile', 'grin', 'wink', 'laugh', 'cool', 'love', 'starstruck', 'silly', 'shy', 'shock', 'sleepy', 'grumpy'] },
  { id: 'creatures', names: ['bear', 'frog', 'bunny', 'blob', 'cat', 'fox', 'owl', 'ghost', 'octopus', 'alien', 'dino', 'penguin', 'chick', 'whale', 'jellyfish'] },
  { id: 'cinema', names: ['popcorn', 'reel', 'clapper', 'ticket', 'soda', 'glasses3d'] },
  { id: 'cosmic', names: ['star', 'sun', 'ufo', 'astronaut', 'planet', 'comet', 'rocket', 'moon', 'sparkle'] },
  { id: 'retro', names: ['robot', 'droid', 'bot', 'television', 'cassette', 'gamepad'] },
  { id: 'everyday', names: ['cactus', 'plant', 'coffee', 'headphones'] },
].map((category) => ({ ...category, names: category.names.filter((name) => byName.has(name)) }));

/** Every bundled picture, in display order. */
export const AVATARS = AVATAR_CATEGORIES.flatMap((category) => category.names);

/**
 * The bold backgrounds pictures sit on (profiles.css draws each as a
 * `gradient-<name>` class, so no style string ever reaches the page).
 */
export const AVATAR_GRADIENTS = ['sunset', 'lagoon', 'lemon', 'cherry', 'ocean', 'mint', 'grape', 'peach', 'night', 'lime'] as const;
export type AvatarGradient = (typeof AVATAR_GRADIENTS)[number];

/** Each bundled picture's background, picked so the drawing stands out on it. */
const BUNDLED_GRADIENTS: Record<string, AvatarGradient> = {
  smile: 'peach', grin: 'sunset', wink: 'sunset', laugh: 'ocean', cool: 'ocean', love: 'lagoon', starstruck: 'lemon', silly: 'cherry', shy: 'mint', shock: 'grape', sleepy: 'grape', grumpy: 'night',
  bear: 'mint', frog: 'lemon', bunny: 'cherry', blob: 'ocean', cat: 'sunset', fox: 'lagoon', owl: 'lemon', ghost: 'ocean', octopus: 'lagoon', alien: 'grape', dino: 'peach', penguin: 'lime', chick: 'ocean', whale: 'lemon', jellyfish: 'night',
  popcorn: 'ocean', reel: 'lemon', clapper: 'cherry', ticket: 'grape', soda: 'lagoon', glasses3d: 'night',
  star: 'night', sun: 'ocean', ufo: 'grape', astronaut: 'night', planet: 'grape', comet: 'sunset', rocket: 'ocean', moon: 'lagoon', sparkle: 'grape',
  robot: 'cherry', droid: 'lagoon', bot: 'peach', television: 'sunset', cassette: 'lemon', gamepad: 'ocean',
  cactus: 'peach', plant: 'lemon', coffee: 'grape', headphones: 'sunset',
};

/**
 * The background for a picture: a bundled one's own, or for anything else (an
 * upload, a TMDB character) one picked from its id, so it stays the same
 * every time it's drawn.
 */
export function avatarGradient(id: string): AvatarGradient {
  const own = BUNDLED_GRADIENTS[id];
  if (own) return own;
  // FNV-1a: a small, even spread over the palette.
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193);
  return AVATAR_GRADIENTS[(hash >>> 0) % AVATAR_GRADIENTS.length]!;
}

export function avatarUrl(name: string | null | undefined): string | undefined {
  return name ? byName.get(name) : undefined;
}

/** A bundled picture's name for screen readers, e.g. "Smiling face". */
export const avatarLabel = (name: string): string => t(`avatars.name.${name}` as MessageKey);
/** A category's heading, e.g. "Creatures". */
export const avatarCategoryLabel = (id: string): string => t(`avatars.category.${id}` as MessageKey);

/** Uploaded pictures are cropped to a square this size before saving. */
const UPLOAD_SIZE = 256;
const uploads = new Map<string, Promise<string | undefined>>();

export const isUpload = (name: string | null | undefined): name is string => !!name && /^upload-[0-9a-f]{16}$/.test(name);

/** An uploaded picture as an object URL (read once from Rust, then kept). */
export function uploadedAvatarUrl(name: string): Promise<string | undefined> {
  let url = uploads.get(name);
  if (!url) {
    url = invoke<ArrayBuffer>('avatar_get', { name })
      .then((bytes) => (bytes.byteLength ? URL.createObjectURL(new Blob([bytes])) : undefined))
      .catch(() => undefined);
    uploads.set(name, url);
  }
  return url;
}

/** Crops `file` to a centred square, shrinks it, saves it, and returns its name for the profile. */
export async function uploadAvatar(file: File): Promise<string> {
  const image = await createImageBitmap(file).catch(() => {
    throw new ShownError(t('titles.profiles.not-a-picture'));
  });
  const side = Math.min(image.width, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = UPLOAD_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new ShownError(t('titles.profiles.prepare-failed'));
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, UPLOAD_SIZE, UPLOAD_SIZE);
  image.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new ShownError(t('titles.profiles.prepare-failed'));
  const name = await invoke<string>('avatar_save', new Uint8Array(await blob.arrayBuffer()));
  uploads.set(name, Promise.resolve(URL.createObjectURL(blob)));
  forgetUnused(name);
  return name;
}

/**
 * Lets go of the uploaded pictures no profile uses (but `kept`, just saved):
 * saving one deletes their files (avatars.rs `store`), and each held its
 * blob: URL, and the image behind it, for the session.
 */
function forgetUnused(kept: string): void {
  void listProfiles()
    .then((profiles) => {
      const used = new Set(profiles.map((profile) => profile.avatar));
      for (const [name, url] of uploads) {
        if (name === kept || used.has(name)) continue;
        uploads.delete(name);
        void url.then((src) => src && URL.revokeObjectURL(src));
      }
    })
    .catch(() => {});
}

/**
 * Saves a character's still from TMDB as an upload (Rust fetches it, so it
 * keeps showing offline) and returns its name for the profile.
 */
export async function saveAvatarFromUrl(url: string): Promise<string> {
  const name = await invoke<string>('avatar_save_url', { url });
  uploads.delete(name);
  forgetUnused(name);
  return name;
}
