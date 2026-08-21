import { infoHashFromMagnet, unionMagnet } from "./magnet"
import type { TorrentResult } from "./provider"

export function resultKey(result: TorrentResult): string {
  return infoHashFromMagnet(result.magnet) ?? `${result.provider}:${result.title.toLowerCase()}`
}

export function betterKeeper(a: TorrentResult, b: TorrentResult): boolean {
  if (a.seeders !== b.seeders) return a.seeders > b.seeders
  if (a.title.length !== b.title.length) return a.title.length > b.title.length
  if (a.provider !== b.provider) return a.provider < b.provider
  return a.title < b.title
}

function mergedSources(keep: TorrentResult, other: TorrentResult): readonly string[] {
  const set = new Set<string>([...keep.alsoOn, ...other.alsoOn, other.provider])
  set.delete(keep.provider)
  set.delete("")
  return [...set].sort()
}

export function mergeResult(keep: TorrentResult, other: TorrentResult): TorrentResult {
  let sizeBytes = keep.sizeBytes
  let size = keep.size
  if (sizeBytes <= 0 && other.sizeBytes > 0) {
    sizeBytes = other.sizeBytes
    size = other.size
  }
  if (size.trim() === "") size = other.size
  return {
    ...keep,
    size,
    sizeBytes,
    seeders: Math.max(keep.seeders, other.seeders),
    leechers: Math.max(keep.leechers, other.leechers),
    magnet: keep.magnet === "" ? other.magnet : unionMagnet(keep.magnet, other.magnet),
    category: keep.category || other.category,
    detailUrl: keep.detailUrl || other.detailUrl,
    trusted: keep.trusted || other.trusted,
    alsoOn: mergedSources(keep, other),
  }
}

export function mergeAll(results: readonly TorrentResult[]): TorrentResult[] {
  const out: TorrentResult[] = []
  const at = new Map<string, number>()
  for (const result of results) {
    const hash = infoHashFromMagnet(result.magnet)
    if (hash === undefined) {
      out.push(result)
      continue
    }
    const index = at.get(hash)
    if (index === undefined) {
      at.set(hash, out.length)
      out.push(result)
      continue
    }
    const existing = out[index]!
    const [keep, other] = betterKeeper(result, existing) ? [result, existing] : [existing, result]
    out[index] = mergeResult(keep, other)
  }
  return out
}

export function mergeInto(map: Map<string, TorrentResult>, incoming: TorrentResult): void {
  const key = resultKey(incoming)
  const existing = map.get(key)
  if (existing === undefined) {
    map.set(key, incoming)
    return
  }
  const [keep, other] = betterKeeper(incoming, existing) ? [incoming, existing] : [existing, incoming]
  map.set(key, mergeResult(keep, other))
}
