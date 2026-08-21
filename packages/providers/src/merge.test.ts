import { describe, expect, test } from "bun:test"
import { mergeInto, resultKey } from "./merge"
import type { TorrentResult } from "./provider"

const makeResult = (overrides: Partial<TorrentResult> & { magnet: string; title: string }): TorrentResult => ({
  size: "1.4 GB",
  sizeBytes: 1_400_000_000,
  seeders: 5,
  leechers: 2,
  provider: "test",
  trusted: false,
  alsoOn: [],
  ...overrides,
})

describe("mergeInto", () => {
  test("first insert is stored as-is", () => {
    const map = new Map<string, TorrentResult>()
    const result = makeResult({ title: "A", magnet: "magnet:?xt=urn:btih:" + "ab".repeat(20), provider: "yts" })
    mergeInto(map, result)
    expect(map.size).toBe(1)
    expect(map.get(resultKey(result))).toEqual(result)
  })

  test("same infohash from another provider merges alsoOn and max seeders", () => {
    const map = new Map<string, TorrentResult>()
    const hash = "ab".repeat(20)
    const a = makeResult({ title: "A", magnet: `magnet:?xt=urn:btih:${hash}`, provider: "yts", seeders: 10 })
    const b = makeResult({ title: "B", magnet: `magnet:?xt=urn:btih:${hash}`, provider: "knaben", seeders: 30 })
    mergeInto(map, a)
    mergeInto(map, b)
    expect(map.size).toBe(1)
    const merged = [...map.values()][0]!
    expect(merged.provider).toBe("yts")
    expect(merged.seeders).toBe(30)
    expect(merged.alsoOn).toEqual(["knaben"])
  })

  test("same infohash case variants dedupe", () => {
    const map = new Map<string, TorrentResult>()
    mergeInto(map, makeResult({ title: "A", magnet: `magnet:?xt=urn:btih:${"ab".repeat(20)}`, provider: "yts" }))
    mergeInto(
      map,
      makeResult({ title: "A", magnet: `magnet:?xt=urn:btih:${"AB".repeat(20)}`, provider: "knaben" }),
    )
    expect(map.size).toBe(1)
  })

  test("different infohashes stay separate", () => {
    const map = new Map<string, TorrentResult>()
    mergeInto(map, makeResult({ title: "A", magnet: `magnet:?xt=urn:btih:${"aa".repeat(20)}`, provider: "yts" }))
    mergeInto(map, makeResult({ title: "B", magnet: `magnet:?xt=urn:btih:${"bb".repeat(20)}`, provider: "yts" }))
    expect(map.size).toBe(2)
  })
})
