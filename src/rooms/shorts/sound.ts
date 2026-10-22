/**
 * Whether Shorts' trailers play with sound (off until the speaker button
 * turns it on), remembered per profile like Discover's filters.
 */
import { profileSetting } from '../../library/profiles';
import { settings } from '../../lib/ipc';

const SOUND_KEY = 'shorts.sound';

export async function loadShortsSound(): Promise<boolean> {
  return (await profileSetting(SOUND_KEY)).value === true;
}

export async function saveShortsSound(on: boolean): Promise<void> {
  await settings.set((await profileSetting(SOUND_KEY)).key, on);
}
