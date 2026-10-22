## What changes

<!-- The problem, and what the person sees now. Screenshots for visible changes, with private information removed. -->

## Checks

<!-- From docs/DEVELOPMENT.md. Tick what you ran; say why for anything left out. -->

- [ ] `pnpm run lint` on the files I changed
- [ ] `pnpm run typecheck` (TypeScript changes)
- [ ] `pnpm test` (TypeScript logic changes)
- [ ] `cargo check`, `cargo test` and `cargo clippy --all-targets` with `--manifest-path src-tauri/Cargo.toml` (Rust changes)
- [ ] New interface text is in every locale in `src/i18n/locales`
- [ ] No new warnings or errors; a check that already failed on untouched files is named here
- [ ] No API keys, tokens, private URLs or personal data in the code, logs or screenshots

## Not tested

<!-- What you couldn't try (a platform, a controller, a service you don't use). -->
