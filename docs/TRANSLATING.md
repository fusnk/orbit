# Translating Orbit

Thanks for helping Orbit speak your language. You don't need to build the app to fix a translation; you need Node.js and pnpm to run the checks (see [Build from source](../README.md#build-from-source)).

## How the strings are organised

- Every piece of interface text has a key, like `alerts.panel.mark-read`.
- English is the source. It lives in `src/i18n/locales/en/`, one file per area of the app (`alerts.ts`, `player.ts`, `settings.ts` and so on).
- Each language has a folder with the same file names, for example `src/i18n/locales/fr/alerts.ts`, holding the same keys.
- If a translation is missing a string, Orbit shows the English one.

Orbit currently has 19 languages: English, Spanish, French, Portuguese, German, Italian, Dutch, Polish, Czech, Swedish, Indonesian, Japanese, Korean, Russian, Ukrainian, Turkish, Simplified Chinese, Arabic and Hebrew. The list is `LANGUAGES` in `src/i18n/index.ts`.

## Fix a translation

1. Find the English text in `src/i18n/locales/en/` to get its key.
2. Open the same file in your language's folder and change the text for that key. Don't change the key.
3. Run the checks below and open a pull request.

## Rules the tests check

The tests in `src/i18n/catalogs.test.ts` check every language. A translation must:

- **Keep every placeholder.** `{count}`, `{title}`, `{season}` and the like must appear exactly as in English (you can move them around in the sentence, but not rename, translate or drop them).
- **Have every plural form your language uses.** Counted strings come as `key.one` and `key.other`. Languages with more forms also need `key.zero`, `key.two`, `key.few` or `key.many`, following your language's rules in `Intl.PluralRules` (for example Polish, Czech, Russian and Ukrainian use `few` and `many`; Arabic uses all six). Don't add forms your language never uses.
- **Have no empty strings.**
- **Translate every sentence.** A string left identical to the English fails the test. A few things stay in English everywhere: key names (`settings.keys.*`), award names (`explore.award.*`) and the TMDB token field names (`integrations.tmdb.field-*`). If your language really does use the English word for something, add the key to `KEPT_IN_ENGLISH` in the test, with your language's code.
- **Not add keys English doesn't have**, except the extra plural forms above.

## Add a new string (for developers)

Add the English text to the right file in `src/i18n/locales/en/`, then add the same key to that file in every other language folder. The type check and the tests fail until every language has it.

## Add a new language

1. Copy an existing translation folder, for example `src/i18n/locales/es/`, to `src/i18n/locales/<code>/`, using the language's two-letter code. Translate every file.
2. In the new `index.ts`, rename the exported constant to your code (for example `export const fi: Record<MessageKey, string> = { ... }`).
3. In `src/i18n/index.ts`:
   - add the language to `LANGUAGES`, with its code, its name written in that language, and its BCP 47 tag (for example `fi-FI`). Add `rtl: true` for a right-to-left language. Add a `tmdb` tag only if TMDB needs a different one.
   - add a line for it to `LOADERS`.
4. In `src/i18n/catalogs.test.ts`, import the new catalog and add it to `TRANSLATIONS`.
5. Run the checks, then try the language in the app (Settings → General → Language). For a right-to-left language, check that layouts mirror correctly.

## Checks

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test src/i18n
pnpm run typecheck
pnpm run lint src/i18n
```

`pnpm test src/i18n` runs only the language tests. When a test fails, it prints the keys that need attention.

## Style tips

- Write the way a good streaming app in your language does: short, friendly and plain.
- Keep the same tone as the English, and the same punctuation style your language normally uses (for example « » quotes in French).
- Product and service names (Orbit, TMDB, Jellyfin, Plex, Real-Debrid, TorBox) stay as they are.
- If you're not sure what a string means, the comment above it in the English file usually says where it appears. You can also ask in your pull request.
