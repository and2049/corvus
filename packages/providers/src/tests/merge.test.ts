import { describe, expect, test } from "bun:test"
import { mergeInto, resultKey } from "../merge"
import type { TorrentResult } from "../provider"

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
    expect(merged.provider).toBe("knaben")
    expect(merged.seeders).toBe(30)
    expect(merged.alsoOn).toEqual(["yts"])
  })

  test("keeper choice is independent of arrival order", () => {
    const mapA = new Map<string, TorrentResult>()
    const mapB = new Map<string, TorrentResult>()
    const hash = "ab".repeat(20)
    const a = makeResult({ title: "A long title", magnet: `magnet:?xt=urn:btih:${hash}`, provider: "yts", seeders: 10 })
    const b = makeResult({ title: "B", magnet: `magnet:?xt=urn:btih:${hash}`, provider: "knaben", seeders: 10 })
    mergeInto(mapA, a)
    mergeInto(mapA, b)
    mergeInto(mapB, b)
    mergeInto(mapB, a)
    expect([...mapA.values()][0]!.provider).toBe([...mapB.values()][0]!.provider)
  })

  test("merging unions trackers into the magnet", () => {
    const map = new Map<string, TorrentResult>()
    const hash = "ab".repeat(20)
    mergeInto(
      map,
      makeResult({
        title: "A",
        magnet: `magnet:?xt=urn:btih:${hash}&tr=${encodeURIComponent("udp://a.example/announce")}`,
        provider: "yts",
      }),
    )
    mergeInto(
      map,
      makeResult({
        title: "A",
        magnet: `magnet:?xt=urn:btih:${hash}&tr=${encodeURIComponent("udp://b.example/announce")}`,
        provider: "knaben",
      }),
    )
    const merged = [...map.values()][0]!
    expect(merged.magnet).toContain("udp%3A%2F%2Fa.example%2Fannounce")
    expect(merged.magnet).toContain("udp%3A%2F%2Fb.example%2Fannounce")
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
