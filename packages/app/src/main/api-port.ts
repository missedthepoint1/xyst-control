export function resolveApiPort(): number {
  const raw = process.env.XYST_API_PORT;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 8088;
}
