# Automated bug hunting

Orbit treats addon, subtitle, playlist and media-server data as untrusted. Unit
tests cover known examples; property tests generate many variations; fuzzers
mutate byte inputs to find parser crashes and broken invariants. None of these
tests use your account, real provider URLs or a running player.

## Everyday checks

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm test
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Windows checks need the existing `pnpm run setup:libmpv` and
`pnpm run setup:ytdlp` resources. Linux checks need the packages documented in
[linux.md](linux.md).

`fast-check` is a development-only TypeScript dependency: it generates inputs
and shrinks failures into small counterexamples. `proptest` does the same for
Rust under ordinary `cargo test`, including on Windows, where libFuzzer is not
supported. Neither ships in Orbit. Tests use bounded case/input sizes so routine
checks finish predictably. A failing property prints its replay seed and shrunk
input; preserve those in a focused regression test before changing application
code. Never copy a user's private URL or token into a fixture.

## Native fuzzing on Linux or WSL2

Use a Linux checkout in WSL2's filesystem rather than a Windows-mounted path.
Install Rust and the usual Linux build packages, then:

```sh
rustup toolchain install nightly
cargo install cargo-fuzz --locked
cd src-tauri
cargo +nightly fuzz list
# Substitute a target printed by the preceding command.
cargo +nightly fuzz run TARGET -- -max_total_time=300 -max_len=65536 -rss_limit_mb=2048 -timeout=10
```

The separate `fuzz/` package is not part of Orbit's normal workspace/build.
Harnesses call production parsing logic through narrow hooks rather than
reimplementing parsers. Inputs and parsed-output counts are capped; the libFuzzer
RSS limit bounds process memory and the timeout catches excessively slow inputs.
Property tests alone do not prove either resource bound.

Crashes land in `src-tauri/fuzz/artifacts/TARGET/`. Replay a saved input:

```sh
cargo +nightly fuzz run TARGET fuzz/artifacts/TARGET/CRASH_FILE
cargo +nightly fuzz tmin TARGET fuzz/artifacts/TARGET/CRASH_FILE
```

Only synthetic test inputs belong in the corpus or uploaded artifacts. Fuzzing
never fetches remote services, starts mpv, reads secrets or performs downloads.

## Target coverage

| Target | Production logic exercised |
| --- | --- |
| `m3u` | IPTV playlist parsing and channel-count limits |
| `xmltv` | XMLTV dates/programmes, raw XML and gzip; inflation capped at 256 KiB in the harness |
| `subtitles` | Transcript SRT/VTT/ASS, pasted subtitles, ALL-CAPS, SDH removal and subtitle-sync parsing |
| `addon_urls` | Addon URL/path construction and private-host/IP checks |
| `torrents` | Torrent/metainfo and torrent input validation |
| `downloads` | Download/file-name checks |
| `xtream` | Xtream live/VOD custom response handling |
| `media_servers` | Jellyfin/Plex custom response handling |
| `anilist` | AniList custom response/mapping handling |
| `tmdb` | TMDB custom response handling |
| `imports` | ZIP/CSV, Letterboxd, backups, collections and awards imports |
| `debrid` | Debrid custom response handling |

All targets cap input at 64 KiB. Ordinary Rust property tests exercise the same
entry point using bounded random bytes and structured malformed inputs.
TypeScript properties cover ranking/stream traits, arbitrary-JSON addon schemas,
CSS network-function rejection, Release Radar dates, spoiler rules and hero
deduplication. Use `pnpm test` to run them alongside example-based tests.

## CI security checks

A separate blocking security
job installs `cargo-audit` and `cargo-deny` with `--locked`, caching their isolated
installation directory. It audits `src-tauri/Cargo.lock` against RustSec and runs
`cargo deny check licenses advisories`. Both tools can also be run locally:

```sh
cargo install cargo-audit --locked
cargo install cargo-deny --locked
cargo audit --file src-tauri/Cargo.lock
cargo deny --manifest-path src-tauri/Cargo.toml check --config deny.toml licenses advisories
```

The root `deny.toml` allows the project's GPL-3.0 terms and selected compatible
dependency licences found in the locked graph. Dual-licensed crates can use the
permissive alternative. It does not allow all licences, and ignores only the
advisory IDs listed in it, each with its reason (`.cargo/audit.toml` repeats the
one `cargo audit` needs).
Unknown licences and vulnerabilities require investigation; do not suppress
them just to make CI green. This is a dependency policy check, not a legal review
of separately bundled libmpv/yt-dlp binaries.

Every Monday at 04:23 UTC, and on manual workflow dispatch, the non-blocking
Ubuntu fuzz job discovers all registered targets and runs each for about five
minutes, with a 2 GiB RSS limit and ten-second per-input timeout. A failed target
does not prevent the other targets from running. Crash artifacts and the target
inventory are uploaded for fourteen days, including after failure. Check the
job itself for build failures: an empty crash directory does not prove fuzzing
ran successfully.

## References

- [Rust Fuzz Book](https://rust-fuzz.github.io/book/cargo-fuzz/guide.html)
- [RustSec](https://rustsec.org/)
- [cargo-deny licence configuration](https://embarkstudios.github.io/cargo-deny/checks/licenses/cfg.html)
