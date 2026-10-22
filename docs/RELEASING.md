# Releasing Orbit

Orbit updates itself from GitHub Releases. A release build checks
`https://github.com/fusnk/orbit/releases/latest/download/latest.json` at most
once a day (and when you press Settings → General → About Orbit → Check for
updates), downloads a newer installer in the background, checks its signature
against the public key built into Orbit, and installs only when the person
clicks **Restart to update** (or, with **Update automatically** on, when they
quit Orbit).

Development builds (`pnpm tauri dev`) never check. Neither does any build while
`src-tauri/tauri.conf.json` still holds the placeholder key.

> **The repository must be public for updates to work.** Release files of a
> private repository can't be downloaded without signing in, so the check fails
> (quietly) until the repository, or at least its releases, are public.

## One-time setup: the update signing key

The key pair proves an update came from you. Anyone with the private key can
ship an update every Orbit install will accept, so guard it like a password.
If you lose it, existing installs can never update again (they'd need a manual
reinstall), so keep a backup.

1. Generate the key pair on your own PC (not in CI, not in the repo):

   ```sh
   pnpm tauri signer generate -w "$HOME/.tauri/orbit-updater.key"
   ```

   Choose a strong password when asked. This writes two files:
   `orbit-updater.key` (private) and `orbit-updater.key.pub` (public).

2. Store the private key and its password safely:
   - In your password manager: a new entry holding the full contents of
     `orbit-updater.key` and the password.
   - As secrets of the `release` environment (repo → Settings → Environments →
     New environment, named `release`). Under **Deployment branches and tags**
     allow only tags matching `v*`, and turn on **Required reviewers** with
     yourself as the reviewer. Then add, under **Environment secrets**:
     - `TAURI_SIGNING_PRIVATE_KEY`: the full contents of `orbit-updater.key`
     - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password

     Not as repository secrets (Settings → Secrets and variables → Actions):
     any workflow on any branch can read those, so anyone who can push could
     read the key and sign an update. Environment secrets reach only jobs that
     pass the environment's tag and reviewer rules. If copies already exist as
     repository secrets, delete them.
   - Never commit the private key, paste it in an issue or chat, or put it in
     `tauri.conf.json`.

3. Paste the **public** key into `src-tauri/tauri.conf.json`, replacing the
   placeholder in `plugins.updater.pubkey` with the whole contents of
   `orbit-updater.key.pub` (one long base64 line). Commit that change; the
   public key isn't secret.

The release workflow refuses to run until both the public key and the
`TAURI_SIGNING_PRIVATE_KEY` secret of the `release` environment are in place.

## Each release

1. **Bump the version** in all three places (the workflow checks they match
   the tag): `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml` (then run `cargo check --manifest-path
   src-tauri/Cargo.toml` so `Cargo.lock` updates too). Use plain semver, e.g.
   `0.2.0`; Orbit only updates to a higher version.

2. **Commit and push** to `main`, and wait for CI to pass.

3. **Tag and push the tag**:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

   The **Release** workflow (`.github/workflows/release.yml`) then:
   - fetches libmpv and yt-dlp from their pinned URLs, checking each SHA-256
     (`scripts/setup-libmpv.mjs`, `scripts/setup-ytdlp.mjs`), exactly as a
     local build does; no binaries live in the repo;
   - builds the NSIS installer (`-setup.exe`);
   - signs the update artifacts with your private key (the `.sig` files);
   - writes `latest.json` (pointing at the NSIS installer);
   - creates a **draft** release with all of it and GitHub's generated notes.

4. **Review the draft** (repo → Releases):
   - Download the `-setup.exe`, install it on a test PC or VM, and check that
     Orbit starts and plays something.
   - The **What's new** note Orbit shows after updating comes from the `notes`
     field of `latest.json`, which holds the release notes as they were when
     the workflow ran. Editing the release text afterwards doesn't change it;
     to change the note, download `latest.json`, edit `notes`, and upload it
     again in place of the old one. Keep it short; Orbit shows it as plain
     text (Markdown, links and HTML are stripped).

5. **Publish** the release. From then on `releases/latest/download/latest.json`
   points at it, and installs pick it up within a day (or at once with Check
   for updates).

If something is wrong, delete the draft and the tag (`git push --delete origin
v0.2.0`), fix it, and tag again.

## Windows SmartScreen and code signing

The installer isn't Authenticode-signed yet, so Windows SmartScreen warns
"Windows protected your PC" on first download; users click **More info → Run
anyway**. The warning fades as a file builds download reputation, but each new
version starts over. Updates installed through Orbit itself are checked against
the updater signature instead, and usually don't trigger SmartScreen (Orbit
downloads them itself, so they aren't marked as coming from a browser).

Ways to remove the warning later (none is set up, and none is needed to
release):

- **Azure Trusted Signing**: Microsoft's own signing service, billed monthly;
  it needs an identity check (individuals in some countries, or a registered
  business).
- **An OV or EV code-signing certificate** from a certificate authority, now
  issued on a hardware token or cloud HSM. EV used to skip SmartScreen
  reputation entirely; today both build reputation.
- **SignPath Foundation**: free signing for qualifying open-source projects
  once the repository is public.

Whichever you pick, Tauri's `bundle.windows.signCommand` (or
`certificateThumbprint`) plus GitHub secrets is where it plugs into the
workflow; see the TODO at the top of `release.yml`.

## Hardening to turn on later

`plugins.updater.requireSignedVersion` makes Orbit reject an update whose
signature wasn't made for the announced version (it stops a tampered
`latest.json` from pairing a new version number with an older signed
installer). It needs signatures that record the version, which the Tauri CLI
in use (2.11) doesn't write yet. Once a newer CLI does, every `.sig` will
contain `version:` in its trusted comment; then turn the option on.

## README screenshots

Before the first public release, add these to `docs/screenshots/` (PNG, 1280 × 800,
Orbit's default window size) and show them in the README. The default Orbit Look
is the base; where another Look is named, switch to it in Settings → Appearance → Looks
first, and switch back after.

1. `home.png`: the featured banner, Continue Watching and two or three catalog rows (Orbit Look).
2. `looks.png`: Settings → Appearance → Looks, with all nine Look cards in view and one pressed.
3. `theme-studio.png`: Theme Studio docked beside Home, with the Look tab's colour controls visible (Afterglow or Premiere Look, so the panel is clearly restyling a page).
4. `player.png`: the player with controls showing and the subtitle or episode panel open (Orbit layout).
5. `player-arc.png`: the same scene in the Orbit Arc Look, which changes only the controls.
6. `title.png`: a title page in the Showcase layout (Crimson or Marquee Look) with its episode list.
7. `release-radar.png`: upcoming episodes and films.
8. `live-tv.png`: channel groups and the guide, from a free public playlist of free-to-air channels (never a paid provider), with its address out of frame.
9. `addons.png`: the Installed tab with only Cinemeta, OpenSubtitles and the example addon.
10. `couch.png`: Home in the Couch Look, at 150 % scale, for the "readable from the sofa" claim.

Use only the public-domain example addon (`examples/addon/`), Cinemeta artwork or
your own media, on a profile with no accounts, tokens or private server names on
screen. Don't show third-party stream addons, source lists or IPTV channels.
