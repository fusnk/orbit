import { describe, expect, it } from 'vitest';
import { createHostHealth, HOST_WINDOW_MS, hostOf } from './host-health';

describe('hostOf', () => {
  it('is the host name only, never the path or query', () => {
    expect(hostOf('https://CDN.Example.com:8443/dl/SECRETKEY/file.mkv?token=abc', 'Addon')).toBe('cdn.example.com');
  });

  it('falls back to the addon for magnets and odd addresses', () => {
    expect(hostOf('magnet:?xt=urn:btih:abc', 'Addon A')).toBe('addon:Addon A');
    expect(hostOf('https://', 'Odd')).toBe('addon:Odd');
  });
});

describe('host health', () => {
  const clock = () => {
    let now = 1_000_000;
    return { now: () => now, advance: (ms: number) => (now += ms) };
  };

  it('ranks a host lower after two failures in the window', () => {
    const time = clock();
    const health = createHostHealth(time.now);
    health.failed('cdn.example');
    expect(health.unhealthy('cdn.example')).toBe(false);
    health.failed('cdn.example');
    expect(health.unhealthy('cdn.example')).toBe(true);
    expect(health.unhealthy('other.example')).toBe(false);
  });

  it('forgives a host as soon as it plays', () => {
    const health = createHostHealth(clock().now);
    health.failed('cdn.example');
    health.failed('cdn.example');
    health.succeeded('cdn.example');
    expect(health.unhealthy('cdn.example')).toBe(false);
    expect(health.empty()).toBe(true);
    // Failures after the success count from zero again.
    health.failed('cdn.example');
    expect(health.unhealthy('cdn.example')).toBe(false);
  });

  it('forgets failures older than the window', () => {
    const time = clock();
    const health = createHostHealth(time.now);
    health.failed('cdn.example');
    time.advance(HOST_WINDOW_MS - 1000);
    health.failed('cdn.example');
    expect(health.unhealthy('cdn.example')).toBe(true);
    time.advance(2000);
    expect(health.unhealthy('cdn.example')).toBe(false);
    time.advance(HOST_WINDOW_MS);
    expect(health.unhealthy('cdn.example')).toBe(false);
    expect(health.empty()).toBe(true);
  });
});
