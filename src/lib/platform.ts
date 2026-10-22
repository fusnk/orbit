/**
 * Android (phones, tablets and TVs) runs Orbit in the system WebView, whose
 * user agent always names it. Desktop WebViews never do.
 */
export const isAndroid = typeof navigator !== 'undefined' && /\bAndroid\b/.test(navigator.userAgent);
