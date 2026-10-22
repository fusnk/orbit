/**
 * An email address shown on screen with most of its name hidden ("g•••@gmail.com"), so a
 * screenshot or a stream of Settings doesn't give it away. Anything that isn't an address
 * comes back as it is.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  return `${email[0]}•••${email.slice(at)}`;
}
