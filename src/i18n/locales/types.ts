/**
 * A translation of one area's English strings: every English key, plus any
 * extra plural forms the language needs (e.g. Polish 'x.few' and 'x.many'
 * beside 'x.one' and 'x.other'; see `tn` in src/i18n).
 */
export type Catalog<T> = Record<keyof T, string> & Record<string, string>;
