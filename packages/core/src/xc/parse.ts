/** Parse an XC protocol response body into a flat key→value map. */
export function parseXcBody(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sepIdx = findSeparator(line);
    if (sepIdx < 0) continue;
    const key = line.slice(0, sepIdx).trim();
    const value = line.slice(sepIdx + 2).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** Index of the first ':=' or '==' separator, or -1. */
function findSeparator(line: string): number {
  const a = line.indexOf(':=');
  const b = line.indexOf('==');
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}
