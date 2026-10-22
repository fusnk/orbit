import { describe, expect, it } from 'vitest';
import {
  accountsSummary,
  addonsSummary,
  appearanceSummary,
  cleanName,
  connectedServices,
  downloadsSummary,
  generalSummary,
  homeLibrarySummary,
  pictureSoundSummary,
  playbackSummary,
  playerSummary,
  shortcutsSummary,
  subtitlesSummary,
} from './nav-summary';

describe('Settings sidebar summaries', () => {
  it('say the language and scale under General', () => {
    expect(generalSummary({ language: 'English', scale: 110 })).toBe('English · 110% scale');
  });

  it('name the theme, fonts and banner under Appearance', () => {
    expect(appearanceSummary({ theme: 'Crimson', fonts: 'Inter', banner: 'Cinematic' })).toBe('Crimson · Inter · Cinematic banner');
  });

  it('say when titles count as watched and whether spoilers are hidden', () => {
    expect(homeLibrarySummary({ watchedAt: 0.9, spoilersHidden: true })).toBe('Watched at 90% · Spoilers hidden');
    expect(homeLibrarySummary({ watchedAt: 0.85, spoilersHidden: false })).toBe('Watched at 85% · Spoilers shown');
  });

  it('give autoplay under Playback, not the quality or torrents (those rows moved to Source preferences)', () => {
    const line = playbackSummary({ autoplay: 'Ask' });
    expect(line).toBe('Autoplay: Ask');
    expect(line).not.toMatch(/Torrents|4K/);
  });

  it('name the player layout', () => {
    expect(playerSummary({ layout: 'Theater' })).toBe('Theater layout');
  });

  it('give the subtitle languages, font and size', () => {
    expect(subtitlesSummary({ languages: ['English'], font: 'Lexend', size: 1 })).toBe('English · Lexend');
    expect(subtitlesSummary({ languages: ['English', 'French', 'German'], size: 1.2 })).toBe('English + 2 more · 120% size');
    expect(subtitlesSummary({ languages: [], size: 1 })).toBe('The video’s default');
  });

  it('mention HDR only when it is on', () => {
    expect(pictureSoundSummary({ quality: 'Balanced', hdr: false })).toBe('Balanced');
    expect(pictureSoundSummary({ quality: 'High', hdr: true })).toBe('High · HDR');
  });

  it('name the first addon and count the rest', () => {
    expect(addonsSummary([])).toBe('No addons');
    expect(addonsSummary(['Open Films'])).toBe('Open Films');
    expect(addonsSummary(['Open Films', 'Cinemeta', 'OpenSubtitles v3', 'A', 'B'])).toBe('Open Films + 4 more');
  });

  it('keep addon names (from manifests) to one short plain line', () => {
    expect(cleanName('  Open Films\n\tPro  ')).toBe('Open Films Pro');
    // Direction overrides could flip the rest of the line.
    expect(cleanName('Evil\u202eoiv')).toBe('Evil oiv');
    expect(cleanName('x'.repeat(60))).toHaveLength(40);
    expect(addonsSummary(['   ', 'Real'])).toBe('Real');
  });

  it('list connected services by name, or say none are', () => {
    expect(accountsSummary([])).toBe('Nothing connected yet');
    expect(accountsSummary(['Stremio', 'Plex', 'Real-Debrid'])).toBe('Stremio · Plex · Real-Debrid');
  });

  it('count every account the Accounts page connects, AniList included', () => {
    const none = { stremio: false, jellyfin: false, plex: false, cloud: [], letterboxd: false, anilist: false };
    expect(connectedServices(none)).toEqual([]);
    expect(connectedServices({ ...none, anilist: true })).toEqual(['AniList']);
    expect(connectedServices({ stremio: true, jellyfin: true, plex: true, cloud: ['TorBox'], letterboxd: true, anilist: true })).toEqual(['Stremio', 'AniList', 'Jellyfin', 'Plex', 'TorBox', 'Letterboxd']);
  });

  it('count downloads done and in progress', () => {
    expect(downloadsSummary({ done: 0, active: 0 })).toBe('No downloads yet');
    expect(downloadsSummary({ done: 3, active: 0 })).toBe('3 downloaded');
    expect(downloadsSummary({ done: 0, active: 1 })).toBe('1 in progress');
    expect(downloadsSummary({ done: 12, active: 2 })).toBe('12 downloaded · 2 in progress');
  });

  it('count shortcuts', () => {
    expect(shortcutsSummary(1)).toBe('1 shortcut');
    expect(shortcutsSummary(23)).toBe('23 shortcuts');
  });
});
