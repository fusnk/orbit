/** "Top 10 Movies Today" → ["Top 10", "Movies Today"]; null for headings that don't lead with it. */
export function splitTopTen(title: string): [string, string] | null {
  const match = /^(top\s*10)\s+(\S.*)$/iu.exec(title.trim());
  return match ? [match[1]!, match[2]!] : null;
}
