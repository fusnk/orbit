import { describe, expect, it } from 'vitest';
import { AUTO_DEVICE, deviceChoices, deviceMissing, parseAudioDevice } from './audio-device';

const headphones = { name: 'wasapi/{headphones}', description: 'Headphones (USB)' };
const speakers = { name: 'wasapi/{speakers}', description: '' };

describe('output device', () => {
  it('reads a saved choice, or the system default', () => {
    expect(parseAudioDevice('wasapi/{headphones}')).toBe('wasapi/{headphones}');
    for (const bad of [undefined, null, '', 42, 'a\nb', 'x'.repeat(513)]) expect(parseAudioDevice(bad)).toBe(AUTO_DEVICE);
  });

  it('says when the chosen device is unplugged (Rust plays on the default meanwhile)', () => {
    expect(deviceMissing('wasapi/{headphones}', [headphones, speakers])).toBe(false);
    expect(deviceMissing('wasapi/{headphones}', [speakers])).toBe(true);
    expect(deviceMissing(AUTO_DEVICE, [])).toBe(false);
  });

  it('lists the system default first, then each device by its name', () => {
    expect(deviceChoices([headphones, speakers], 'System default')).toEqual([
      { name: AUTO_DEVICE, label: 'System default' },
      { name: 'wasapi/{headphones}', label: 'Headphones (USB)' },
      { name: 'wasapi/{speakers}', label: 'wasapi/{speakers}' },
    ]);
  });
});
