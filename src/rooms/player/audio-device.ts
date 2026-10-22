/**
 * Settings → Audio → Output device, and the player's Audio view: which sound
 * output plays. Saved per profile; Rust plays on it only while it's connected,
 * and on the system default otherwise (see src-tauri/src/player/outputs.rs).
 */
import { invoke } from '@tauri-apps/api/core';

export const AUDIO_DEVICE_PREFIX = 'player.audio-device';
/** mpv's name for the system default, which follows the system when it changes. */
export const AUTO_DEVICE = 'auto';
const MAX_NAME = 512;

export interface AudioDevice {
  name: string;
  description: string;
}

/** The outputs mpv lists, and the one it plays on now. */
export interface AudioOutputs {
  devices: AudioDevice[];
  active: string;
}

const hasControl = (text: string) => [...text].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** A saved choice, or the system default. */
export function parseAudioDevice(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME && !hasControl(value) ? value : AUTO_DEVICE;
}

/** The chosen device isn't connected now: the sound plays on the system default until it is. */
export const deviceMissing = (wanted: string, devices: readonly AudioDevice[]): boolean => wanted !== AUTO_DEVICE && !devices.some((d) => d.name === wanted);

/** What to list: the system default first, then each device mpv found. */
export function deviceChoices(devices: readonly AudioDevice[], defaultLabel: string): { name: string; label: string }[] {
  return [{ name: AUTO_DEVICE, label: defaultLabel }, ...devices.map((d) => ({ name: d.name, label: d.description || d.name }))];
}

export const listAudioDevices = (): Promise<AudioOutputs> => invoke<AudioOutputs>('player_audio_devices');
export const sendAudioDevice = (device: string): Promise<void> => invoke<void>('player_set_audio_device', { device });
