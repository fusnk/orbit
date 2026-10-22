# Changelog

All notable changes to Orbit are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Orbit uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

Orbit's first public release, for Windows 10 and 11 (64-bit). Orbit bundles no content and no content addons: it ships with Cinemeta for catalogs and metadata and OpenSubtitles for subtitles, and plays what your own addons, services, media servers and files provide.

### Added

- **Browsing:** a cinematic Home with Continue Watching and rows you can edit; Movies, TV Shows and an optional Anime tab; genre pickers, Discover filters, search with recent searches, and Surprise Me. Today on Orbit plays trailers of what's trending, one per screen, and Tonight picks three things for the time and mood you have. With your own TMDB token: trending titles, recommendations, cast pages, streaming-service pages and metadata in your language.
- **Addons:** install from a manifest URL or `stremio://` link, or import from a Stremio account. See what an addon provides before installing it, then reorder, turn off or share addons between profiles. Manifests and answers are checked, size-capped and time-limited.
- **Playback** with libmpv: sources ranked with a "Why?" breakdown and your own source rules, automatic failover, resume, Next Up and autoplay limits, picture in picture, chapters, speed, a sleep timer, picture settings (quality, decoding, HDR and smooth motion), nine player layouts (Orbit, Minimal, Streaming, Theatre, Cinema, Compact, Floating, TV and Arc), and the option to open a source in another player on your PC.
- **Subtitles and audio:** embedded, addon and local subtitles, a second subtitle, styling and accessible subtitle fonts, timing adjustment and automatic subtitle sync, a searchable transcript, and optional AI translation with your own key or a local model. Audio and subtitle choices are remembered per title. An output device, volume levelling and passthrough. Intro, recap and credits skipping from chapters and, optionally, TheIntroDB and AniSkip.
- **Library:** watchlists, custom lists and collections, history, ratings and notes, episode ratings and favourites, viewing stats, spoiler controls, and Release Radar with optional exact air times from TVmaze, new-episode alerts and episode reminders.
- **Profiles:** separate libraries, history and addons, avatars, optional PINs, and content limits by age rating.
- **Looks and Theme Studio:** nine Looks (Orbit, Crimson, Marquee, Premiere, Glass, Aurora, Couch, Afterglow and Orbit Arc) that each restyle the whole app in one tap; 16 colour themes, font pairs, wallpaper, card shape, corners and interface scale; an ambient mode for when you've stepped away; Theme Studio with live preview while you browse, a seek bar editor and filtered custom CSS; theme import and export.
- **Live TV:** M3U and Xtream Codes providers, channel groups and favourites, XMLTV guides, catch-up where the provider supports it, and channel surfing in the player.
- **Your own media:** Jellyfin and Plex libraries, video and subtitle files dropped onto the window, and Real-Debrid and TorBox cloud files.
- **Downloads:** films, episodes and whole seasons, with storage management and optional removal of watched episodes.
- **Integrations:** Stremio sign-in with optional two-way Continue Watching and watched sync, Letterboxd watchlist and diary rows, Letterboxd, Trakt and AniList imports, AniList sync of the episodes you watch, optional RPDB posters, trailers through yt-dlp, optional Discord Rich Presence, opt-in torrent playback, a phone remote on the same Wi-Fi, and Orbit Connect to control one Orbit from another.
- **Input and accessibility:** keyboard, remote and controller navigation, configurable shortcuts, a command palette (Ctrl+K), and high-contrast states that follow the system's contrast settings (increased contrast and Windows contrast themes).
- **Languages:** English, Spanish, French, Portuguese, German, Italian, Dutch, Polish, Czech, Swedish, Indonesian, Japanese, Korean, Russian, Ukrainian, Turkish, Simplified Chinese, Arabic and Hebrew (the last two right to left).
- **Backup** of settings and a profile's library, lists and history, to restore on another PC.
- **Updates:** a daily check against this repository's releases, signed downloads, and "Restart to update". Automatic checks and installing on quit can each be turned off.

### Security

- Secrets are kept in Windows Credential Manager, or encrypted with AES-256-GCM under a key held there. Only Rust can decrypt them, and the interface can never read them back.
- Addons must use HTTPS, except local ones on `127.0.0.1`. Redirects from a public host into this PC or the home network are blocked.
- The interface runs under a strict content security policy, with no HTML injection of addon text and devtools off in release builds. Addon configure pages open in your own browser, never inside Orbit.
- No telemetry or analytics. Logs and crash reports stay on your PC and are redacted. Everything Orbit talks to is listed in [docs/PRIVACY.md](docs/PRIVACY.md).

### Known limitations

- Windows only. macOS and Linux playback aren't implemented yet, and the Android TV build is still in development and not part of this release.
- The installer isn't code-signed yet, so Windows SmartScreen shows a warning on first install. See [docs/INSTALL.md](docs/INSTALL.md).
- Whether a title plays, downloads or has subtitles depends on the addons and services you add. Orbit itself provides none.

[0.1.0]: https://github.com/fusnk/orbit/releases/tag/v0.1.0
