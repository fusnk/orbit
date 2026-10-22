# Installing Orbit

Orbit's first release runs on Windows. This page covers installing, updating and removing it, and what the other platforms are waiting on. Orbit bundles no content and no content addons: once it's installed, add an addon or connect a media server to play something (see [Adding addons](../README.md#adding-addons)).

## Windows

**Needs:** Windows 10 or 11, 64-bit, and Microsoft Edge WebView2 (already part of Windows 11 and of an up-to-date Windows 10; the installer fetches it if it's missing).

1. Open the [Releases](https://github.com/fusnk/orbit/releases) page and download the latest `Orbit_x.y.z_x64-setup.exe`.
2. Run the installer. Orbit isn't code-signed yet, so Windows SmartScreen may show **Windows protected your PC**. Click **More info**, check that the file name is the one you downloaded from the Releases page, then **Run anyway**. The warning means Windows doesn't know the publisher, not that it found anything; see [Why the SmartScreen warning](#why-the-smartscreen-warning).
3. Start Orbit from the Start menu. The welcome screen walks you through a Look, your accounts and optional extras. Everything it asks for can be skipped and set up later in Settings.

### Updating

Once a day, Orbit checks the Releases page for a newer version, downloads it in the background and checks its signature. Then it shows **Restart to update**. With **Update automatically** on, the update installs when you quit Orbit instead.

Both are in Settings → General → About Orbit, where **Check for updates** also works at any time. You can turn the daily check off there; downloading a new installer by hand works the same way as the first install.

### Where Orbit keeps your things

- `%APPDATA%\io.github.fusnk.orbit`: the database (your library, history, lists, settings and profiles), avatars, wallpaper and theme images.
- `%LOCALAPPDATA%\io.github.fusnk.orbit`: caches, logs and Orbit's copy of yt-dlp.
- `Videos\Orbit`: downloads, unless you picked another folder in Settings → Downloads. Give Orbit a folder of its own there, not an existing Plex, Jellyfin or Kodi library: Orbit writes poster and logo files into title folders and removes them again.
- Windows Credential Manager: your tokens and keys, under `io.github.fusnk.orbit`.

To move to another PC, use Settings → General → Backup & help → **Export a backup**, then **Restore** it on the new one. A backup holds your settings and a profile's library, lists and history. Addons, PINs and keys aren't in it; you add those again. Switches that send something off the PC (Discord, TVmaze, AniSkip, AI subtitle translation, torrents, background trailers, update checks) aren't in it either: each PC keeps its own.

### Uninstalling

Use **Apps → Installed apps** in Windows Settings (or **Add or remove programs** on Windows 10) and remove Orbit. If the uninstaller offers to delete Orbit's data, say no to keep your library and settings for a later reinstall, or yes to remove them. To be sure everything is gone, check that the folders above and the Credential Manager entries are deleted. Data you sent to a service you connected, such as your Stremio or AniList account, stays with that service.

### Why the SmartScreen warning

Windows warns about installers from publishers it doesn't know. Orbit's installer isn't signed with a code-signing certificate yet, because those cost money every year. The warning fades as a version builds download reputation, and updates installed through Orbit itself are checked against Orbit's own update signature instead. Download Orbit only from this repository's Releases page.

## macOS

No build yet. Orbit's interface and Rust code compile on macOS, but playback (the libmpv video surface) isn't implemented there.

## Linux

No build yet. There is early groundwork for playback through GTK and OpenGL, described in [linux.md](linux.md), but it hasn't been tested on a Linux desktop and there are no installers.

## Android TV

In development. A complete playback session works on the Google TV emulator with a native player, but it hasn't been tried on a real TV and there are no signed builds yet. [android-tv.md](android-tv.md) tracks where it stands.

## Building it yourself

See [Build from source](../README.md#build-from-source) in the README for the Windows development setup.
