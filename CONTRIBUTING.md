# Contributing to Orbit

Thanks for helping improve Orbit. It is a desktop client for the open Stremio addon protocol, and it bundles no content or content addons.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) before making changes. Security comes first, followed by correctness, reliable playback, consistent input behavior and maintainable code.

## Report a bug

Open an issue with your Orbit version, operating system, steps to reproduce, expected result and what actually happened. Include a visible error or a small screenshot if it helps.

Remove API keys, account details, private URLs and personal media data from anything you share. For playback issues, say whether the source is an addon, Live TV, your media server, a local file or debrid cloud. Do not post credential-bearing stream URLs.

For a security issue, avoid publishing exploit details or secrets in a public issue. Report it privately as described in [SECURITY.md](SECURITY.md).

## Suggest a change

Describe the problem you want to solve and a concrete example. For larger features or new dependencies, discuss the approach before investing in an implementation. Keep changes focused and explain any behavior change.

## Set up development

Follow [Build from source](README.md#build-from-source) for pnpm, Rust, Windows build tools, WebView2, libmpv and yt-dlp setup. Windows is the current playback platform.

Create a feature branch and keep your pull request small enough to review. Do not include build output, local account data or credentials.

## Find the right place

| Path | Responsibility |
| --- | --- |
| `src/rooms/` | Views and user interactions |
| `src/components/` | Shared interface components |
| `src/addons/` | Addon schemas, routing and aggregation |
| `src/lib/` | Reusable frontend logic |
| `src/theme/` | Looks, theme tokens and layout logic |
| `src/i18n/` | Localized messages |
| `src-tauri/src/` | Native playback, networking, storage, secrets and OS integration |
| `examples/addon/` | Public-domain / Creative Commons playback example |
| `scripts/` | Native dependency setup |

Keep business logic out of view components when it can be shared. Read existing code before changing it, use the project's naming and style, and avoid unrelated refactors.

## Development rules

- Validate untrusted responses, keep request limits and timeouts, and build interface text with safe DOM helpers rather than HTML injection.
- Keep secrets in Rust and the OS keychain or encrypted vault. Never log tokens or put private URLs in reports.
- Treat mpv events as the source of playback state and never block its callbacks.
- Keep focus separate from activation; keyboard, remote and controller input must stay consistent.
- Preserve configured hotkeys and view scroll position.
- Add tests for new logic and meaningful regressions. Fix the cause of a failure instead of hiding it locally.
- Add user-facing messages to every locale in `src/i18n/locales` (19 today; see [docs/TRANSLATING.md](docs/TRANSLATING.md)). Check right-to-left behavior (Arabic, Hebrew) when changing layouts.

## Checks before a pull request

Run lint for the files you changed:

```sh
pnpm run lint src/path/to/changed-file.ts
```

Markdown is not covered by the repository's ESLint configuration; review documentation links and instructions separately.

After TypeScript changes, run:

```sh
pnpm run typecheck
```

After TypeScript logic changes, also run:

```sh
pnpm test
```

After Rust changes, run:

```sh
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml
```

Do not leave warnings or errors introduced by your change unresolved. If a check fails in untouched code, record the baseline failure rather than changing unrelated files. Manually check affected screens and keyboard/controller behavior for interface changes, and state what you could not test.

In the pull request, explain the problem, the resulting behavior, checks you ran and any limitations. Include screenshots for visible changes, with private information removed.

## License

Contributions to Orbit are made under the project's [GPL-3.0-or-later license](LICENSE). Keep third-party license notices and explain the license of any new asset or dependency.
