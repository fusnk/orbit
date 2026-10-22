/** English strings for automatic source picking (autoplay limits, uncached sources, air dates): the source every translation follows. */
export const sources = {
  // Settings → Playback → Autoplay limits (per profile)
  'sources.limits.heading': 'Autoplay limits',
  'sources.limits.any': 'Any',
  'sources.limits.min-quality': 'Autoplay won’t start below',
  'sources.limits.min-quality-hint': 'Play and the next episode only start sources at least this good (sources that don’t say aren’t). If none fits, the best one plays and Orbit tells you. The source list still shows everything. For this profile.',
  'sources.limits.max-quality': 'Autoplay won’t start above',
  'sources.limits.max-quality-hint': 'Play and the next episode don’t start sources above this, unless nothing else is found. Unlike “Highest quality to prefer”, it doesn’t reorder the source list. For this profile.',
  'sources.limits.max-size': 'Autoplay won’t start files bigger than',
  'sources.limits.max-size-hint': 'For slow connections or data caps: Play and the next episode skip bigger files. Sources that don’t give their size aren’t affected. For this profile.',
  // Toasts when a source is picked automatically
  'sources.autoplay.outside-limits': 'Nothing fits your autoplay limits, so the best source is playing.',
  'sources.autoplay.only-uncached': 'Every source found is still downloading to your debrid service. Choose one to start it.',
  // Quiet tags in the source list
  'sources.note.uncached': 'Not cached',
  'sources.note.uncached-hint': 'Still downloading to your debrid service: never started automatically',
  'sources.note.outside-limits': 'Outside autoplay limits',
  'sources.note.outside-limits-hint': 'Play and the next episode pass over it (Settings → Addons & Sources → Source preferences → Autoplay limits)',
  // The Next Up card, for an episode whose air date isn't confirmed
  'sources.next-up.unaired': 'Next up · air date not confirmed',
};
