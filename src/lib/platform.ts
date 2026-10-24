/**
 * Android (phones, tablets and TVs) runs Orbit in the system WebView, whose
 * user agent always names it. Desktop WebViews never do.
 */
export const isAndroid = typeof navigator !== 'undefined' && /\bAndroid\b/.test(navigator.userAgent);

/**
 * macOS runs Orbit in WKWebView, whose user agent names the Mac ("Macintosh").
 * There Cmd does what Ctrl does elsewhere (lib/keymap.ts) and the window has
 * its own traffic-light buttons (app/titlebar.ts).
 */
export const isMac = !isAndroid && typeof navigator !== 'undefined' && /\bMacintosh\b/.test(navigator.userAgent);
