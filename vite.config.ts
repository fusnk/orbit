import { configDefaults, defineConfig } from 'vitest/config';

// Tauri expects a fixed dev port and serves the built files from `dist/`.
export default defineConfig({
  test: {
    // tests/ui holds the Playwright layout tests (`pnpm test:ui`), which run in a real browser.
    exclude: [...configDefaults.exclude, '.claude/**', 'tests/ui/**'],
    // The contrast tests read these stylesheets as text (?raw); Vitest blanks CSS it isn't told to process.
    // (The see-all tile test reads every stylesheet, so any read as text is kept.)
    css: { include: [/\/theme\/tokens\.css/, /\/theme\/glass\.css/, /\/remote\/page\/remote\.css/, /\.css\?raw$/] },
    // A file's first import transforms the whole module graph (i18n and all its locales), which can take
    // seconds on a busy machine; the defaults (5 s per test, 10 s per hook) turned that into false failures.
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    watch: { ignored: ['**/src-tauri/**', '**/.claude/**'] },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    // Fonts stay files: the CSP's font-src is 'self', so a small subset inlined as a data: URL would be blocked.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
  },
});
