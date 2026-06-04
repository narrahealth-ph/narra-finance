/**
 * Shared in-process cache for Google Sheets API responses.
 * Module-level map survives across requests in the same server process,
 * so both /api/reports and /api/mrr/history share the same cached values.
 */

const _cache = new Map<string, { data: any; ts: number }>()
const CACHE_TTL = 90_000 // 90 seconds

export async function cachedSheet(key: string, fetcher: () => Promise<any>): Promise<any> {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data
  const data = await fetcher()
  _cache.set(key, { data, ts: Date.now() })
  return data
}

export function clearSheetCache(key?: string) {
  if (key) _cache.delete(key)
  else _cache.clear()
}
