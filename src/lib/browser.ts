import { invoke } from '@tauri-apps/api/core';

/** Opens one of the sites Rust allows (TMDB, Letterboxd, the debrid key pages, GitHub) in the person's browser. */
export const openInBrowser = (url: string) => invoke('open_external', { url });

/** Opens an addon's configure page (any public https host) in the person's browser. */
export const openAddonConfigure = (url: string) => invoke('open_addon_configure', { url });
