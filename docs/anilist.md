# AniList sync

Orbit's own public client ID is already set in the `CLIENT_ID` constant in `src-tauri/src/anilist.rs`. A fork registers its own application at https://anilist.co/settings/developer, sets the redirect URL to `https://anilist.co/api/v2/oauth/pin`, and replaces that ID. No client secret belongs in Orbit. With `CLIENT_ID` empty, browser sign-in reports that the build is not configured.

Orbit uses AniList's implicit OAuth flow (`response_type=token`) and its PIN page. The page displays an access token for the user to paste into Orbit. Authorization-code token exchange requires a client secret, which a distributed desktop binary cannot protect. See https://docs.anilist.co/guide/auth/ . Orbit validates the token through Viewer before saving it in the OS keychain, independently for each Orbit profile. Disconnect and profile deletion remove the keychain entry. Expired tokens and offline account checks preserve connection state so Settings can still disconnect or reconnect.

When an anime episode is marked watched, sync reads the existing AniList progress, updates only a strictly higher episode number, and sets CURRENT or COMPLETED when the known episode count is reached. Unknown totals remain CURRENT. Episode numbers exceeding the known total are skipped. Sync is enabled on connection and can be disabled. Pause watch history blocks AniList traffic from completion events. Local updates are serialized and profile, pause and enable choices are checked again immediately before the mutation. Changes made concurrently by another AniList client cannot be made atomic with AniList's API.

## Mapping and season limits

MAL IDs resolve through AniList Media(idMal:). Kitsu and IMDb IDs use the public Fribb anime-list-mini dataset: https://github.com/Fribb/anime-lists . This is a cross-service ID list rather than a fuzzy title search, so unrelated similarly named shows cannot receive progress. Orbit fetches its fixed raw GitHub URL in Rust, schema-validates it and caches it in memory for 24 hours. The cache is shared across profiles because it contains only public IDs, no accounts or viewing data.

MAL/Kitsu identify an individual anime entry: season 1 uses entry-local episode numbering (specials are skipped by the watch hook); later seasons are skipped. IMDb identifies a whole show: the dataset's TMDB season, or TVDB season if absent, must match the played season and identify exactly one AniList entry. If both numbering sources exist they must agree. Any nonzero episode offset for that IMDb show makes its mapping ineligible. Episode numbering is local to that season. Ambiguous/missing mappings are skipped, with a generic debug message containing no title, IDs or account information.

Split cours, merged seasons, specials, absolute episode numbering and numbering offsets are not guessed. The dataset includes TMDB/TVDB episode offsets, but IMDb addons do not identify which numbering convention they follow. Orbit parses those offsets and skips nonzero values rather than applying an uncertain translation. An overlong episode or ambiguous season is skipped rather than assigned to the wrong entry. IMDb numbering from an addon may differ from TMDB/TVDB; those cases require a future explicit episode mapping. Movies are importable but are not episode-scrobbled.

Import previews the mapped CURRENT/PLANNING anime count before adding anything. Entries need a unique Kitsu mapping so installed anime addons can resolve metadata and sources. Unmapped entries are skipped. Import adds library titles without altering local watched progress or the AniList list.

## Security

Only Rust contacts graphql.anilist.co, with Bearer authorization headers. GraphQL responses are typed, capped at 1 MiB and have ten-second timeouts. Public mappings are capped at 16 MiB. Redirects are disabled for every request to prevent credentials or requests being forwarded to another host. Network and API errors use fixed codes and never echo response bodies, tokens or account URLs.

Avatars are fetched in Rust only from the fixed HTTPS AniList CDN avatar path, capped at 380 KiB, limited to PNG/JPEG/WebP, and returned as data URLs. This keeps the existing CSP unchanged. The small base64 dependency is already present transitively and encodes these native-fetched avatar bytes.

The same id list and matching rules also find a MyAnimeList id for AniSkip skip times (Settings → Playback, off by default, see `src-tauri/src/skip.rs`). That lookup needs no AniList account and sends AniSkip only the MAL id and the episode number.

Real OAuth, OS keychain and live GraphQL writes require a registered client and test account; unit tests do not exercise an individual's real AniList list.
