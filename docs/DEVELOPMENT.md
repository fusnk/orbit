# Development guide

The rules Orbit is built to. Read this before changing code; [CONTRIBUTING.md](../CONTRIBUTING.md) covers reporting bugs and opening pull requests.

## Before you open a pull request
- Run `pnpm run lint` on the files you changed.
- Run `pnpm run typecheck` (`tsc --noEmit`) after TypeScript changes.
- Run `cargo check --manifest-path src-tauri/Cargo.toml` after Rust shell changes.
- Run `pnpm test` (Vitest) after TypeScript logic changes.
- Run `cargo test` and `cargo clippy --all-targets` (`--manifest-path src-tauri/Cargo.toml`) after Rust changes.
- Leave no new warnings or errors.
- If a repo-wide check already fails on files you didn't touch, say so in the pull request rather than reformatting them.

## Project Snapshot
Orbit is a cross-platform desktop client for the open Stremio addon protocol, built with Tauri 2, vanilla TypeScript + Vite, Rust, and libmpv. It bundles no content and no content addons.

The frontend owns the interface and user interactions. Rust owns native integrations, playback, OS behavior, secrets, and performance-sensitive work.

## Core Priorities
1. Security — addon responses are untrusted input.
2. Correctness and reliability.
3. Smooth playback and responsive navigation.
4. Consistent behavior across Windows, macOS, Linux, and keyboard/controller input.
5. Simple, lightweight, maintainable code.

When trade-offs are required, prefer predictable behavior over clever or temporary solutions.

## Architecture
- `src/` — TypeScript frontend.
- `src/rooms/` — top-level views (Home, Discover, Library, Addons, Settings, …).
- `src/components/` — reusable UI pieces.
- `src/addons/` — addon protocol: manifest validation, routing, parallel aggregation.
- `src/lib/` — framework-independent utilities.
- `src/theme/` — design tokens and theme engine.
- `src-tauri/src/` — native commands, playback, window management, keychain, platform code.
- `src/lib/ranking-fallback.ts` and `src/lib/stream-traits.ts` — stream parsing and ranking (TypeScript).
- `examples/addon/` — public-domain test addon (Node.js).

Keep business logic out of UI components when it can be a reusable module.

## Security Rules
- Schema-validate every addon/manifest response; cap response sizes; enforce timeouts.
- Never `eval`, `innerHTML`, or otherwise inject addon-provided content without sanitizing.
- `https` only for addons, except `127.0.0.1` for local ones. IPTV providers are an exception: plain `http` is allowed there (shown as "Not secure") because most providers offer nothing else. For both, a redirect may never move from a public host into this machine or the LAN.
- The person's own media server (Jellyfin or Plex) is the other exception: `http` and LAN/localhost addresses are allowed (shown as "Not secure" over http), because it usually lives on the home network without a certificate. The same redirect rule applies, its tokens stay in Rust (sent as headers, never in a URL), and its images reach the page only through Rust's `jellyfin-art` / `plex-art` protocols. Plex addresses come from plex.tv; Orbit sends a server's token only to an address that first answered `/identity` as that server.
- AniSkip (opt-in, off by default) is asked for anime skip times only from Rust, at the fixed host `api.aniskip.com` over https with redirects off, a timeout and a size cap, and its answer is schema-checked as untrusted. It receives only a MyAnimeList id and an episode number (the MAL id comes from AniList's public id list, already used for sync), never the title's other ids, the file or the person, so turning it on reveals only which anime episode is playing to a service the person chose.
- The profile picture picker's anime characters come from AniList's public API through Rust only (`anilist_characters`): no token, sent only the AniList id mapped from the TMDB title through the same public id list as sync, same host/redirect/timeout/size rules; the answer is schema-checked and picture URLs must be AniList's character CDN (`s4.anilist.co/file/anilistcdn/character/…`), which is also the only non-TMDB host `avatar_save_url` fetches from.
- AI subtitle translation (opt-in) sends subtitle text only to fixed hosts (`api.openai.com`, `generativelanguage.googleapis.com`, `api.anthropic.com`, over https) or to a local model server on `127.0.0.1` / `localhost` / `::1` (any port). Never to an address the page supplies, so text and keys can't go anywhere the person didn't pick. Keys are stored per profile in the keychain and sent only as a header, never in a URL. The model's answers are untrusted: each batch must return exactly the ids it was sent, with no timestamps, and the text is cleaned to plain lines with `<i>`/`<b>`/`<u>`. A batch that fails twice keeps its original lines.
- Orbit Connect pairs by numeric comparison, never a typed code (a code's proof can be cracked offline by whatever answers in the other device's place). Each device has a long-term X25519 key in the keychain and a fresh one per pairing; the receiver commits to its nonce (HMAC keyed by the nonce over the transcript: both ids, long-term and fresh keys) before the sender reveals its own, then both show a 6-digit number from the transcript and both nonces, and the pair is kept only once the person confirms on both and each side's confirmation proof checks out. The secret is HKDF over fresh–fresh and long-term–long-term X25519. The other device's long-term key is stored with the pair and pinned: another key under a paired id is a different device, and can't re-pair under it. Pairings made with the old code are kept only to show "pair again"; their secrets aren't used. Details in `src-tauri/src/connect/auth.rs`.
- Keep a strict CSP. Addon configure pages open in the person's own browser (`open_addon_configure`, only `https` on a public host, no user name or password in the URL), never in an Orbit webview: the browser keeps the addon's page entirely apart from Orbit, so it can't reach Orbit's IPC, storage or keychain, and the person signs in to debrid services there with the browser's own protections.
- Secrets are protected by the OS keychain and never appear in plaintext in SQLite, logs, bug reports, or URLs Orbit builds.
  - Small secrets (API keys, tokens) are stored in the keychain directly.
  - Larger or per-record secrets (e.g. addon transport URLs, which often embed credentials) are encrypted with AES-256-GCM under one random data key kept in the keychain; SQLite stores only nonce + ciphertext.
  - Use a fresh random 96-bit nonce for every encryption, and bind each ciphertext to its row via associated data (e.g. the row's id) so rows can't be swapped.
  - Decryption happens in Rust only; the WebView can write or delete secrets but never read them back.
  - One exception to "never in URLs Orbit builds": TorBox's download-link request (`/torrents/requestdl`) only accepts the API key as a query parameter. That URL is built in Rust only, sent only to `api.torbox.app` over https with redirects off, never logged or put in an error, and its answer (the CDN link) goes straight to mpv or the downloader. Any other provider endpoint takes the key as a Bearer header.
  - A second exception: RPDB (ratingposterdb.com) poster images only accept the API key in the URL path (`/{key}/imdb/{style}/{id}.jpg`). That URL is built in Rust only (`rpdb.rs`), sent only to `api.ratingposterdb.com` over https with redirects off, never logged or put in an error, and never reaches the page: the page asks the `rpdb-art` protocol for `{style}_{imdbId}` and Rust answers with the image (capped in size, JPEG/PNG/WebP only, cached on disk).
- Exact air times (opt-in, off by default) come from TVmaze through Rust only (`tvmaze.rs`): the fixed host `api.tvmaze.com` over https, redirects off (the lookup's redirect is read, never followed, and must point at TVmaze's own `/shows/{id}`), timeout, size cap, schema-checked answers. Only the show's IMDb or TheTVDB id is sent; no key. Rust checks the setting too.
- Custom CSS (Theme Studio → Code) is off by default: there is none until the person writes it or imports a theme that carries it, and holding Shift for about a second as Orbit starts keeps it off for that session (safe mode). It is CSS only, applied as a constructed stylesheet (no `<style>` element, no inline styles, so the CSP stays as it is), and every declaration that would load anything other than a `data:` picture is dropped (`src/theme/custom-css.ts`): `img-src` has to allow `https:` for posters, so a `url()` could otherwise be a tracking pixel the moment a shared theme is applied. There is no custom JavaScript.
- Accepted limit: mpv/ffmpeg follow HTTP redirects on their own, including from a public host into the LAN, for addon streams and live IPTV, and they resend headers handed to them (e.g. a Jellyfin/Plex token) on a cross-host redirect. ffmpeg has no same-origin option, and routing all playback through a checked relay would cost performance and complexity, so this is accepted: Orbit's own Rust fetches enforce the redirect rule, VOD goes through the checked relay, and mpv runs with `ytdl=no`, `config=no`, `load-scripts=no` and a protocol whitelist.
- Accepted limit: torrent trackers named in an addon's magnet are contacted by librqbit, which does its own DNS lookups. Orbit drops trackers whose address is on this machine or the LAN (`torrent::tracker_ok`), but a tracker *name* that only resolves into the LAN can't be caught without resolving it ourselves and pinning the address, which librqbit doesn't allow; the announce is a plain GET with tracker parameters.
- Accepted limit: yt-dlp ships at a pinned version and SHA-256 (`scripts/setup-ytdlp.mjs`), but Orbit runs it from a copy in its data folder and lets it update itself (`yt-dlp -U`) about once a week while trailers are used (`trailer.rs`). After that, the yt-dlp that runs is whatever its maintainers released last, checked by yt-dlp against its own release's checksums, not against Orbit's pin. Accepted because YouTube changes often and an old yt-dlp soon stops finding trailers; yt-dlp is only ever given an 11-character YouTube id, never a URL or an option from outside.
- Accepted limit: the external player (Settings → Player → External player) is given the stream address as it is, addresses on this machine or the LAN included, and runs with the person's own configuration, scripts and plugins. `external.rs` checks only that the address is http(s) and passes it as the one argument; Orbit's own mpv runs with `config=no`, `load-scripts=no` and a protocol whitelist, another player doesn't. Accepted because it's a program the person chose and set up, started only when they ask, and Orbit can't restrict another program; Orbit's own player would open the same address (next point).
- Accepted limit: an addon's stream address may point straight at this machine or the LAN (`http://192.168.1.1/…`); `player::check_stream_url` only requires http(s). IPTV checks this (`may_open` in `iptv/mod.rs`: a stream on this machine or the LAN only if the playlist is there too), addon streams don't, because Orbit's own torrent streaming server answers on `127.0.0.1` (`torrent.rs`) and local addons serve streams from this machine or the home network. What goes out is mpv's request for the address the addon gave.
- Accepted limit: IPTV channel logos (`tvg-logo`, Xtream's `stream_icon`) are loaded by the page as `<img>` (`src/live/surf.ts`, `src/rooms/live/guide-grid.ts`), not through Rust, so they aren't checked against this machine or the LAN: a provider can make the page request a picture from an `https` address on the home network (the CSP's `img-src` allows `https:`, so `http` logos don't load at all). Accepted because it's a plain image request whose answer is shown only if it is a picture, and fetching hundreds of logos through Rust would cost a request each for little gain.
- Profile PINs are stored in the keychain only as salted PBKDF2-HMAC-SHA256 hashes (600,000 iterations, constant-time compare); plain PINs from older versions are hashed at startup or on their next right entry. Wrong PINs share one persisted lockout per profile. A 4-digit PIN has only 10,000 values, so the hash slows offline guessing rather than preventing it; the lockout is what stops guessing in Orbit.
- Accepted limit: parental controls (content limits, PINs, the PIN lockout) are only as strong as the OS account they run under. Anyone signed in to the same Windows/macOS/Linux user can delete or reset Orbit's database (or reinstall it) and start with no profiles, limits or lockouts, or read the keychain entries. Orbit can't protect its own files from the account that owns them without OS-level protection it doesn't have, so this is accepted: a child who shouldn't do that needs their own OS account (with the OS's own parental controls).
- Explain the *why* behind any hardening decision.

## Playback
- Treat mpv as the source of truth for playback state.
- Sync the UI through mpv events, not assumptions.
- Never block inside mpv callbacks.
- Keep platform-specific window logic separate from general playback logic.

## Navigation and Input
- Focus and activation are separate actions.
- Keyboard, remote, and gamepad navigation must behave consistently.
- Focusing an input must not start editing it; inputs become editable only on explicit activation.
- Preserve the user's configured hotkeys.
- Remember scroll position per view.

## Maintainability
- Read the relevant files before changing anything.
- Reuse shared logic instead of duplicating it.
- Keep components small and focused; isolate platform-specific code.
- Fix root causes, not local workarounds.
- Explain any new dependency before adding it.
- No unrelated refactors.

## Reference Repositories
Use these to understand established patterns. Do not copy large implementations or introduce incompatible architecture.
- Stremio protocol and behavior: https://github.com/Stremio/stremio-core
- Addon SDK / protocol docs: https://github.com/Stremio/stremio-addon-sdk
- mpv lifecycle and desktop playback: https://github.com/jellyfin/jellyfin-desktop
- Tauri + libmpv integration: https://github.com/MaxMB15/MaxVideoPlayer
- Feature inspiration: Harbor (MIT; see THIRD-PARTY-NOTICES.txt if any of its code is reused)

## Working Rules
- Keep a change to what it sets out to do.
- Follow existing naming and code style.
- Preserve backward compatibility unless asked otherwise.
- Do not silently change user-facing behavior.
- Comment only non-obvious decisions.
- Never expose secrets, tokens, private URLs, or user data.
