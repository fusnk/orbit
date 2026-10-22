# Privacy

Orbit has no accounts of its own, no ads, no analytics and no telemetry. Nobody behind Orbit receives anything about you or what you watch.

Your library, history, lists and settings are stored on your PC. Logs and crash reports stay on your PC too; you only share them if you attach them to a bug report yourself.

Orbit does talk to other services, because that's how it finds things to show and play. This page lists every one of them, what it is sent, and whether it's on unless you turn it off. Nothing about a local file you drop onto Orbit goes to the network.

## Always on (until you remove or turn off the feature)

| Service | When | What it receives |
| --- | --- | --- |
| Cinemeta (`v3-cinemeta.strem.io`) | Browsing and title pages. Built in; you can turn it off on the Addons page. | Catalog requests and title ids (IMDb ids). |
| OpenSubtitles addon (`opensubtitles-v3.strem.io`) | When the player looks for subtitles. Built in; you can turn it off. | The title id and its season and episode, plus the playing file's name, size and hash when the source provides them (so it can match subtitles to that exact release). Any other subtitle addon you install receives the same. |
| Artwork hosts (for example `images.metahub.space`, `image.tmdb.org`, or an addon's own image server) | When a poster or background is shown. | A normal image request, so the host sees your IP address. |
| GitHub (`github.com`) | Once a day, to check for an Orbit update, and when you press **Check for updates**. Turn the daily check off with **Check for updates automatically** in Orbit's settings. | A request for the latest release file. |
| TheIntroDB (`api.theintrodb.org`) | When you play something, to find intro, recap and credits times. Turn it off in Settings → Playback → **Look up intro and credit times online**. | The title's IMDb id and the season and episode numbers. |

## Only when you add or turn them on

| Service | What it receives |
| --- | --- |
| Addons you install | Whatever the addon protocol asks: catalog requests, title ids, searches you type. Each addon is run by a third party with its own privacy rules. |
| TMDB (`api.themoviedb.org`), with your own token | Title and person ids, searches, your region and language. With TMDB on, Discover's award rows also ask Wikidata (`query.wikidata.org`) a fixed query that contains nothing about you. |
| Stremio (`api.strem.io`) | Your Stremio sign-in. With sync on: Continue Watching progress and watched marks. |
| Jellyfin or Plex (your own server, plus `plex.tv` for Plex sign-in) | Your sign-in and what you browse and play on it. |
| Real-Debrid (`api.real-debrid.com`) and TorBox (`api.torbox.app`) | Your API key and the files you open. |
| IPTV providers | Your provider login and the channels and guides you open. |
| AniList (`graphql.anilist.co`) | Your AniList sign-in and episode progress for anime you mark watched. Without signing in, when you pick a profile picture from an anime, Orbit asks AniList for that anime's characters (only its AniList id) and loads their pictures from `s4.anilist.co`. Orbit also downloads a public anime id list from `raw.githubusercontent.com` (no personal data). |
| AniSkip (`api.aniskip.com`), off by default | A MyAnimeList id and an episode number. |
| TVmaze (`api.tvmaze.com`), off by default | A show's IMDb or TheTVDB id. |
| RPDB (`api.ratingposterdb.com`), with your key | Your key and the IMDb ids of posters shown. |
| Letterboxd (`letterboxd.com`) | The public username you enter, to read its public watchlist and diary. Discover's Letterboxd rows read public lists from the same site; those requests carry nothing about you. |
| AI subtitle translation, off by default | The subtitle text you translate, sent with your own key to the service you pick: OpenAI, Google Gemini or Anthropic Claude. A local server on this PC (for example LM Studio or Ollama) keeps the text on your PC. |
| Trailers and Today on Orbit | YouTube, through yt-dlp, when you play a trailer, open Today on Orbit, or have background trailers on (off by default). yt-dlp also updates itself from GitHub about once a week while you use trailers. |
| Torrent playback, off by default | Torrent trackers and peers, who can see your IP address. |
| Discord Rich Presence, off by default | Orbit talks only to the Discord app on your PC. Discord then shows what you're watching to your Discord friends. |
| Phone remote and Orbit Connect, off by default | Only devices on your home network. Nothing leaves your network. |
| Links that open in your browser | "Open on TMDB", "Open on IMDb", "Open on Letterboxd", an addon's configure page, a debrid sign-up page and this repository open in your own browser, which then talks to that site like any other. |

## Your keys and passwords

Tokens, keys and passwords are kept in Windows Credential Manager, or encrypted with a key kept there. Orbit sends each one only to the service it belongs to, never in a link it builds (except TorBox and RPDB, whose APIs require it; those requests are made only by Orbit's native code, over HTTPS, and never logged).

## Where your data lives, and removing it

On Windows, Orbit keeps its files in:

- `%APPDATA%\io.github.fusnk.orbit`: the database (library, history, settings, profiles), avatars, wallpaper and theme images.
- `%LOCALAPPDATA%\io.github.fusnk.orbit`: caches, logs and Orbit's copy of yt-dlp.
- `Videos\Orbit`: downloads, unless you picked another folder.
- Windows Credential Manager: entries for `io.github.fusnk.orbit`.

Uninstalling Orbit and deleting these removes everything Orbit stored on your PC. Data you sent to a service you connected (for example your Stremio or AniList account) stays with that service.
