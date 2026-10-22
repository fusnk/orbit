/** English strings for Jellyfin (your own media server): the source every translation follows. */
export const jellyfin = {
  // Settings → Integrations → Jellyfin
  'jellyfin.settings.intro': 'Play from your own Jellyfin server. Movies and episodes it has get a Jellyfin source, and its rows can go on Home. Orbit keeps a sign-in token from the server, never your password.',
  'jellyfin.settings.server': 'Server address',
  'jellyfin.settings.server-placeholder': 'http://192.168.1.10:8096',
  'jellyfin.settings.username': 'Username',
  'jellyfin.settings.password': 'Password',
  'jellyfin.settings.fields-hint': 'The address you open Jellyfin at in a browser. Needs Jellyfin 10.9 or newer.',
  'jellyfin.settings.connect': 'Connect',
  'jellyfin.settings.connecting': 'Connecting…',
  'jellyfin.settings.server-label': 'Server',
  'jellyfin.settings.connected-as': 'Connected as {user} on {server}',
  'jellyfin.settings.connected': 'Connected to {server}.',
  'jellyfin.settings.connected-first': 'Connected to {server}. “Recently added” is now on Home; add more Jellyfin rows in Settings → Home & Library → Home rows.',
  'jellyfin.settings.disconnect': 'Disconnect',
  'jellyfin.settings.disconnected': 'Disconnected, and signed out of the server.',
  'jellyfin.settings.insecure': 'Not secure',
  'jellyfin.settings.insecure-title': 'This server uses plain http, so your sign-in and videos travel unencrypted. Fine at home; use https over the internet.',
  // Home rows
  'jellyfin.rows.kind': 'Jellyfin',
  'jellyfin.rows.resume': 'Continue watching',
  'jellyfin.rows.latest': 'Recently added',
  'jellyfin.rows.label': 'Jellyfin: {row}',
  'jellyfin.rows.not-connected': 'Connect a Jellyfin server in Settings → Accounts & Services first.',
  'jellyfin.rows.libraries-failed': 'Couldn’t load the server’s libraries.',
  // The source picker
  'jellyfin.source.origin': 'Jellyfin · {server}',
};
