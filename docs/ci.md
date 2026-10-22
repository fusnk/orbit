# CI and release builds

`ci.yml` runs on pull requests into main and on every push. The Windows job
runs typecheck, lint, Vitest, `cargo check`, `cargo test` and Clippy, caching
pnpm's store and Cargo's build output. Both setup scripts run first because the
Windows Tauri config bundles libmpv and yt-dlp; they check their pinned
downloads against SHA-256 sums. A separate Ubuntu 24.04 job installs GTK3,
WebKitGTK 4.1, app-indicator, librsvg, mpv and GL/EGL, then runs the Rust
check, tests and Clippy (it's allowed to fail while Linux is groundwork, and
doesn't launch the app). A macOS job runs `cargo check` and Clippy, so the
macOS-only code (the Dock icon, the menu bar) at least builds; it's allowed to
fail too, as macOS playback isn't done. An Ubuntu job runs the layout tests
(`pnpm test:ui`, Playwright in Chromium) and uploads `test-results/` with a
screenshot of each failing test; it's allowed to fail for now, until the tests
have proven steady on CI's machines. Two more Ubuntu jobs run `cargo audit` and
`cargo deny` over dependencies, and fuzz every registered fuzz target.
Another regenerates `THIRD-PARTY-NOTICES.txt` (`pnpm run notices`, after
`cargo fetch`) and fails if the committed file differs, so a dependency change
can't ship without its licence.

Pull-request CI only has `contents: read` and gets no signing secrets.

Every action is pinned to a full commit SHA, with its version in a comment, so a
tag moved upstream can't change what CI or the release runs. Dependabot
(`.github/dependabot.yml`) proposes the bumps weekly. The two
`dtolnay/rust-toolchain` pins follow its `stable` and `nightly` branches, so
they are moved by hand.

## Releases

Bump the version in `package.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml` (and `Cargo.lock`), then tag that commit `v<version>`.
`release.yml` refuses mismatched versions, builds the NSIS installer
and attaches it to a **draft** release with generated notes. It never
publishes the draft: install it on a clean Windows machine, check playback and
trailers, then publish by hand. Updater signing is covered in
[RELEASING.md](RELEASING.md).

Only Windows is built. The TODO notes at the top of `release.yml` say what
macOS and Linux need before they can be added.

## First run on a new fork

- Actions are enabled and the release job can use `contents: write`.
- The pinned pnpm version installs the frozen lockfile.
- Both upstream binary downloads are still up and match their checksums.
- The issue forms (bug report, feature request, translation fix) show their
  required fields, and the bug report its privacy checkbox.
