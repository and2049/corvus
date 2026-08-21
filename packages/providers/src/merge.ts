import { infoHashFromMagnet } from "./magnet"
import type { TorrentResult } from "./provider"

export function resultKey(result: TorrentResult): string {
  return infoHashFromMagnet(result.magnet) ?? `${result.provider}:${result.title.toLowerCase()}`
}

export function mergeResult(existing: TorrentResult, incoming: TorrentResult): TorrentResult {
  const providers = new Set<string>([existing.provider, ...existing.alsoOn, incoming.provider, ...incoming.alsoOn])
  providers.delete(existing.provider)
  return {
    ...existing,
    size: existing.size || incoming.size,
    sizeBytes: existing.sizeBytes || incoming.sizeBytes,
    seeders: Math.max(existing.seeders, incoming.seeders),
    leechers: Math.max(existing.leechers, incoming.leechers),
    magnet: existing.magnet || incoming.magnet,
    category: existing.category || incoming.category,
    trusted: existing.trusted || incoming.trusted,
    alsoOn: [...providers],
  }
}

export function mergeInto(map: Map<string, TorrentResult>, incoming: TorrentResult): void {
  const key = resultKey(incoming)
  const existing = map.get(key)
  map.set(key, existing ? mergeResult(existing, incoming) : incoming)
}
