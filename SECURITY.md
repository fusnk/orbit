# Security policy

## Supported versions

Orbit is in early development. Only the latest release gets security fixes, and fixes reach installed copies through Orbit's signed updates.

## Reporting a vulnerability

Please report security problems privately, not in a public issue, discussion or pull request.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and select **Report a vulnerability**. Only you and the maintainer see the report, and the fix can be prepared in private before anything is published.

Include:

- the Orbit version and your Windows version;
- what an attacker can do, and what they need first (for example, a malicious addon the person installed, a hostile IPTV provider or someone on the same network);
- steps or a minimal proof of concept. A small test addon is ideal.

Don't include real tokens, API keys, private addon URLs or personal media details. If you need to show a secret leaking, use a made-up one.

Orbit is maintained by one person in their spare time. You'll get a reply as soon as possible and updates while a fix is in progress. Once the fix is released, you'll be credited in the release notes unless you'd rather not be.

## Scope

In scope: anything in this repository, including the Rust side (`src-tauri/`), the interface (`src/`), the updater and the release workflow. Orbit treats addon responses, IPTV playlists and guides, and media-server responses as untrusted input. A way for any of them to run code, read stored secrets, reach this machine or the home network, or bypass the content security policy is a vulnerability.

Out of scope: problems in third-party addons, services or media servers themselves, and the limits Orbit already documents. One example is mpv and FFmpeg following HTTP redirects for streams (see "Accepted limit" in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)). For problems in libmpv, FFmpeg or yt-dlp, please also report them to those projects.
