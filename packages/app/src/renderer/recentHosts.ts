/**
 * Prepend a just-used host to a most-recent-first list: trims, ignores empties, dedupes
 * case-insensitively (so a re-used hostname doesn't pile up), and caps at `max` (default 10).
 * Pure — the Add Camera form persists the result so previously-used IPs stay one click away.
 */
export function pushRecentHost(list: string[], host: string, max = 10): string[] {
  const h = host.trim();
  if (!h) return list;
  const rest = list.filter((x) => x.toLowerCase() !== h.toLowerCase());
  return [h, ...rest].slice(0, max);
}
