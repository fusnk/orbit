<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/orbit-wordmark-light-text.svg">
    <img src="docs/assets/orbit-wordmark-dark-text.svg" height="72" alt="Orbit">
  </picture>
</p>

Your movies, shows, anime and live TV in one beautiful app, made your way. For Windows (Android TV is in development), built with Tauri 2, TypeScript, Rust and libmpv.

**Orbit bundles no content and no content addons.** Cinemeta provides built-in catalogs and metadata; playable media comes from addons, services, local files or media servers you connect yourself. You are responsible for having permission to access what you play.

Orbit is an independent project. It is not affiliated with, endorsed by or sponsored by [Stremio](https://www.stremio.com); it works with addons that follow the open addon protocol. Looking for the official Stremio app? [Download it from stremio.com](https://www.stremio.com/downloads).

**Orbit is a free, non-commercial project.** It has no ads, no subscriptions, no paid features and no tracking, and nobody makes money from it. It's built and shared for the love of a good watch night.

Orbit is in early development. Windows is the current playback platform; macOS and Linux playback are not implemented yet, and the Android TV build is still being worked on.

## Features

- **Browse your way:** a cinematic Home with Continue Watching and rows you can edit, Movies, TV Shows and an optional Anime tab, genre pickers, addon search, Discover filters and Surprise Me. Today on Orbit plays trailers of what's trending, one per screen, and Tonight suggests three things for the time and mood you have. With your own TMDB token you also get trending titles, recommendations, cast pages, streaming-service pages and metadata in your language.
- **Addons:** install an addon from its manifest URL or a `stremio://` link, review what it provides, then enable, reorder and inspect your addons. You can also import addons from a Stremio account and share addons between profiles.
- **Looks and themes:** nine Looks (Orbit, Crimson, Marquee, Premiere, Glass, Aurora, Couch, Afterglow and Orbit Arc) each restyle the whole app in one tap: colours, type, where the menu sits, the banner, the cards and the player. Underneath are 16 colour themes, font pairs, wallpaper, poster sizes, corners, interface scale and an ambient mode, and you can import or export your theme.
- **Theme Studio:** a panel that stays open while you browse, so every change shows on real pages. Edit the colours and layout, move the menu, restyle the seek bar and write filtered custom CSS, with undo and redo before you save.
- **Playback:** sources ranked with a "Why?" breakdown and your own source rules, source switching and automatic failover, resume, speed, sleep timer, chapters, episode navigation, Next Up and autoplay limits, picture in picture, and nine player layouts (Orbit, Minimal, Streaming, Theatre, Cinema, Compact, Floating, TV and Arc). Picture settings cover quality, decoding, HDR and smooth motion. Sources can also open in an external player.
- **Subtitles and sound:** embedded, addon and local subtitles, a second subtitle, styling and accessible subtitle fonts, timing adjustment and automatic sync, a searchable transcript, and optional AI translation with your own key or a local model. Audio tracks, an output device, volume levelling and passthrough. Intro, recap and credits skipping from chapters and optional TheIntroDB data, plus optional AniSkip data for anime.
- **Library and Release Radar:** watchlists, custom lists and collections, history, ratings and notes, episode ratings and favourites, viewing statistics and spoiler controls. Release Radar shows upcoming episodes and film releases, with optional new-episode alerts and reminders.
- **Profiles:** separate libraries, lists, history and addons per profile, avatars, optional PINs and content limits by age rating.
- **Downloads:** queue films or episodes, download a season, and keep upcoming episodes of selected shows downloaded. Manage storage and optionally remove watched episodes. What can be downloaded depends on the source.
- **Live TV:** connect M3U or Xtream Codes providers, browse channel groups and favourites, surf channels in the player, and use XMLTV guides and provider-supported catch-up.
- **Your media servers:** connect Jellyfin or Plex, browse your libraries and play your own media in Orbit. Local video and subtitle files play too: drop them onto the window.
- **Debrid My cloud:** browse files from connected Real-Debrid and TorBox accounts, filter by provider or status, and play or download ready files.
- **Stremio sync:** import account addons and optionally sync Continue Watching and watched marks in both directions.
- **More integrations:** public Letterboxd watchlist and diary rows, Letterboxd and Trakt export imports, AniList progress, optional RPDB posters, optional Discord Rich Presence, trailers through yt-dlp and opt-in torrent playback.
- **Remote control:** a phone remote over your home Wi-Fi, and Orbit Connect to control one Orbit from another.
- **Input and accessibility:** keyboard, remote and controller navigation everywhere, configurable shortcuts, a command palette (Ctrl+K), and contrast that follows your system's settings.
- **Languages:** 19 interface languages, including Arabic and Hebrew right to left.
- **Backup:** export settings and a profile's library, lists and history, then restore them on another PC.

Features that depend on addons, external accounts or metadata services need those services configured. A catalog listing does not guarantee a playable source.

## Install

The full guide, including where Orbit keeps its files and how to uninstall, is in [docs/INSTALL.md](docs/INSTALL.md).

### Windows

Orbit runs on Windows 10 and 11 (64-bit).

1. Open this repository's [Releases](https://github.com/fusnk/orbit/releases) and download the latest `Orbit_x.y.z_x64-setup.exe`.
2. Run the installer. The installer isn't code-signed yet, so Windows SmartScreen may show **Windows protected your PC**. Select **More info**, check that the file is the one you downloaded from this repository's Releases page, then select **Run anyway**.
3. Orbit needs Microsoft Edge WebView2, which Windows 11 and up-to-date Windows 10 already include. If it's missing, the installer downloads it.

Orbit checks for updates once a day and asks before installing one. Updates are signed, and Orbit checks the signature before it installs anything. You can turn automatic checks off in Settings → General → About Orbit.

### macOS, Linux and Android TV

There are no macOS, Linux or Android TV builds yet. Playback isn't implemented on macOS, Linux has early groundwork only (see [docs/linux.md](docs/linux.md)), and the Android TV build is still in development (see [docs/android-tv.md](docs/android-tv.md)).

### First launch

The welcome screen walks you through a look, your accounts and optional extras. Everything it asks for can be skipped and set up later in Settings. Browsing works straight away; to play something, add an addon or connect a media server (see below).

## Adding addons

Orbit plays nothing by itself. Addons are small web services, made and run by third parties, that tell Orbit about catalogs, streams or subtitles. Orbit doesn't make, check or endorse any of them, so only install addons you trust, and only play what you have permission to access.

- **From a link:** copy the addon's manifest URL (it ends in `manifest.json`) or a `stremio://` link from the addon's own page. Open **Addons** in the sidebar, paste it in the install field, review what the addon says it provides, and install it.
- **From a Stremio account:** in **Settings → Accounts & Services → Stremio**, sign in and choose **Import addons…** to pick which of your account's addons to copy into the current profile.
- **To try playback legally:** run the public-domain example addon from a source checkout (see [Build from source](#build-from-source)) and install `http://127.0.0.1:7000/manifest.json`.

Each profile has its own addons. On the **Addons** page you can reorder them, turn one off or remove it.

## FAQ

**Why are there no streams for a title?**
Cinemeta, the built-in catalog, provides details and artwork but no video. You need an addon that offers streams for that title, or your own media through Jellyfin, Plex, local files or a debrid account. If you have one, the title page shows each addon's status: it may have timed out or have nothing for that title.

**Is Orbit legal?**
Orbit is a media player and an addon client, like a web browser. It includes no content, no streams and no content addons. What you play depends on the addons and services you add yourself, and you're responsible for having permission to access it where you live.

**Does Orbit collect data about me?**
No. Orbit has no accounts of its own, no analytics and no telemetry. Crash reports and logs stay on your PC. Orbit does contact services you use: the built-in Cinemeta and OpenSubtitles addons, addons you install, GitHub for the daily update check, and TheIntroDB for skip times when you play something (turn it off with **Look up intro and credit times online** in Settings → Playback). See [Privacy and security](#privacy-and-security) and [the full list](docs/PRIVACY.md).

**Why does Windows show a SmartScreen warning?**
The installer isn't code-signed yet, and signing certificates cost money. The warning means Windows doesn't know the publisher, not that it found anything. Download Orbit only from this repository's Releases page.

**How do updates work?**
Once a day, Orbit checks this repository's latest release. If there's a newer version, Orbit downloads it in the background and checks its signature. Then it shows **Restart to update**. With **Update automatically** on, the update installs when you quit Orbit instead. You can turn off the daily check in Settings → General → About Orbit; **Check for updates** still works.

**Where are my settings and library stored?**
On your PC, in Orbit's app-data folder (the exact folders are in [docs/INSTALL.md](docs/INSTALL.md)). To move them to another PC, use Settings → General → Backup & help.

**Which languages does Orbit speak?**
English, Spanish, French, Portuguese, German, Italian, Dutch, Polish, Czech, Swedish, Indonesian, Japanese, Korean, Russian, Ukrainian, Turkish, Simplified Chinese, Arabic and Hebrew. Orbit follows your system language and you can change it in Settings → General. Translations are community work; see [docs/TRANSLATING.md](docs/TRANSLATING.md) to fix one.

## Build from source

The supported development path is Windows. Install:

- [Node.js](https://nodejs.org) 24 LTS (what CI uses) or 22.13+, and [pnpm](https://pnpm.io/installation) 12 (CI pins 12.6.0).
- [Rust](https://rustup.rs), with a toolchain meeting the crate's minimum Rust version of 1.88.
- Microsoft Visual Studio C++ Build Tools and WebView2; see [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows).

Clone the repository and install dependencies:

```sh
git clone https://github.com/fusnk/orbit.git
cd orbit
pnpm install --frozen-lockfile
pnpm run setup:libmpv
pnpm run setup:ytdlp
pnpm tauri dev
```

The setup scripts download pinned, checksum-verified Windows builds of libmpv (from Orbit's mirror of the mpv-winbuild release it uses) and yt-dlp. libmpv plays video; yt-dlp resolves trailers. Both are bundled as resources by the Windows Tauri configuration. These scripts do not provide macOS or Linux binaries.

To build the frontend or a Windows desktop bundle:

```sh
pnpm run build
pnpm tauri build
```

Tauri writes desktop build output under `src-tauri/target/release/`, including installer bundles in `bundle/`. Production signing and distribution are separate release steps.

For a local playback example, run:

```sh
node examples/addon/server.js
```

Install `http://127.0.0.1:7000/manifest.json` on the **Addons** page. The example supplies public-domain and Creative Commons films.

## Privacy and security

Your library and settings are stored locally. Connecting an addon or external service sends requests to that service; optional Stremio sync sends watch progress and watched marks to your Stremio account. Torrent peers can see your IP address when torrent playback is enabled.

- Small secrets such as tokens use the OS keychain. Credential-bearing addon URLs and other larger secrets are encrypted in SQLite with AES-256-GCM using a key held in the keychain. Decryption stays in Rust, so the interface cannot read stored secrets back.
- Addon responses are untrusted: schemas, response-size limits and timeouts constrain them, and addon text is not injected as HTML.
- Addons require HTTPS, except local addons at `127.0.0.1`. IPTV may use HTTP; your own Jellyfin or Plex server may also use HTTP and LAN addresses. HTTP connections are labeled **Not secure**. Public-to-local redirects are blocked to stop remote services from reaching your machine or home network.
- Jellyfin and Plex tokens stay in Rust and use headers. Server artwork passes through dedicated Rust protocols. Plex server identity is checked before its token is sent.
- TorBox's download-link API requires a key in its query string. That request is built only in Rust, uses HTTPS to the fixed TorBox API host with redirects disabled, and is not logged or exposed to the interface.
- Optional exact air times come from TVmaze (off by default). Only a show's IMDb or TheTVDB id is sent, from Rust, to the fixed `api.tvmaze.com` host over HTTPS with redirects disabled.
- A strict content security policy limits the interface. Custom theme CSS is filtered, and torrent playback is off by default.

See [SECURITY.md](SECURITY.md) to report a vulnerability. Keep tokens, private URLs and personal data out of screenshots and issue reports.

## Troubleshooting

**No playable sources:** catalogs supply metadata, not streams. Check that a suitable source addon or media service is connected and enabled. Try another source and inspect any provider error.

**Player cannot load libmpv:** rerun `pnpm run setup:libmpv` when building from source. Keep the bundled DLL with the installed application; a frontend-only Vite build does not include a native player.

**Trailers fail:** source builds need `pnpm run setup:ytdlp`. Orbit uses an app-data copy that can update itself because YouTube changes frequently. Check connectivity and retry later if YouTube is unavailable.

**TorBox playback blocked by Malwarebytes:** Malwarebytes may block a TorBox CDN host such as `*.tb-cdn.io`. Check its detection history to confirm which application and host were blocked. If you trust that connection, add the installed Orbit executable as an application exclusion / allow-list entry for internet connections, following [Malwarebytes' Allow list instructions](https://help.malwarebytes.com/hc/en-us/articles/31589453538075-Add-or-remove-items-from-Malwarebytes-Allow-list). An application exclusion allows that app's connections more broadly; do not disable protection globally. The wildcard here describes CDN subdomains, not a required wildcard entry in Malwarebytes.

**IPTV guide or catch-up missing:** confirm the provider's guide URL and account status. Guide coverage and catch-up depend on what the provider supplies.

For a reproducible bug, include your Orbit version, OS, steps and the visible error, with any credentials or private media details removed. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Bug reports, focused fixes, tests and translations are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Orbit is free software under the [GNU General Public License v3.0 or later](LICENSE) (`GPL-3.0-or-later`). It includes alass-core, which is GPL-3.0 only, so the program as distributed is under GPL-3.0.

[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) lists the licences of the Rust crates, npm packages, fonts, libmpv/FFmpeg (LGPL) and yt-dlp that Orbit is built from or ships with, and where to get the source of the bundled libmpv build. That build, with the complete source of every library inside it, is kept in Orbit's own mirror, [fusnk/orbit-libmpv](https://github.com/fusnk/orbit-libmpv/releases/tag/libmpv-20260929-b4b5d69a44), so it stays available for as long as Orbit does. The installed app includes it; open it from Settings → General → About Orbit → **Open-source licences**. Regenerate it with `pnpm run notices` after changing dependencies.

## Credits

- [Stremio](https://github.com/Stremio/stremio-addon-sdk) for the open addon protocol and SDK; Cinemeta for catalogs and metadata.
- [Tauri](https://tauri.app), [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org), [Rust](https://www.rust-lang.org) and [Valibot](https://valibot.dev) for the application foundation.
- [mpv / libmpv](https://mpv.io) for playback; the setup script downloads an LGPL Windows build from [mpv-winbuild](https://github.com/zhongfly/mpv-winbuild), mirrored with its complete source at [fusnk/orbit-libmpv](https://github.com/fusnk/orbit-libmpv).
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense) for trailer resolution and [alass](https://github.com/kaegi/alass) for subtitle alignment.
- [TMDB](https://www.themoviedb.org), [TheIntroDB](https://theintrodb.org) and [AniSkip](https://aniskip.com) for optional metadata and skip-time integrations; [TVmaze](https://www.tvmaze.com) for optional exact air times.
- Manrope, Bebas Neue, JetBrains Mono, Inter, Fraunces, Plus Jakarta Sans, IBM Plex Sans, IBM Plex Sans Arabic, Space Grotesk and Montserrat, packaged by [Fontsource](https://fontsource.org) under the [SIL Open Font License](https://openfontlicense.org).
- Atkinson Hyperlegible (Braille Institute), Lexend, OpenDyslexic and Arimo Bold ([The Arimo Project Authors](https://github.com/googlefonts/Arimo)) for subtitles, under the SIL Open Font License; their licences ship in `public/fonts/`.
- [Stremio Core](https://github.com/Stremio/stremio-core), [Jellyfin Desktop](https://github.com/jellyfin/jellyfin-desktop) and [MaxVideoPlayer](https://github.com/MaxMB15/MaxVideoPlayer) as reference projects.

Orbit is independent and is not affiliated with or endorsed by the services it supports. Third-party names and logos belong to their respective owners.
