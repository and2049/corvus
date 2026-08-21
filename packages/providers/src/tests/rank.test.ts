import { describe, expect, test } from "bun:test"
import { normalizeTitle, rankResults, relevance, scoreResult } from "../rank"
import type { TorrentResult } from "../provider"

function result(title: string, seeders: number, sizeBytes = 0, extra: Partial<TorrentResult> = {}): TorrentResult {
  return {
    title,
    size: "",
    sizeBytes,
    seeders,
    leechers: 0,
    magnet: `magnet:?xt=urn:btih:${"ab".repeat(20)}`,
    provider: "test",
    trusted: false,
    alsoOn: [],
    ...extra,
  }
}

describe("normalizeTitle", () => {
  test("strips brackets, extensions and punctuation", () => {
    expect(normalizeTitle("[SubsPlease] Sousou no Frieren - 28 (1080p) [ABCD1234].mkv")).toBe(
      "sousou no frieren 28 1080p",
    )
  })
})

describe("relevance", () => {
  test("full match scores 1, partial scores the fraction, none scores 0", () => {
    expect(relevance("f1 movie", "F1 The Movie 2025 1080p WEB-DL")).toBe(1)
    expect(relevance("f1 movie", "F1 (2025) 2160p x265 YTS")).toBe(0.5)
    expect(relevance("f1 movie", "Jujutsu Kaisen - 50 (1080p)")).toBe(0)
  })

  test("empty query is treated as fully relevant", () => {
    expect(relevance("", "anything")).toBe(1)
  })

  test("does not count release-noise tokens as title words", () => {
    expect(relevance("1080p", "Some Movie 1080p")).toBe(0)
  })
})

describe("rankResults", () => {
  const f1Results = [
    result("F1 The Movie 2025 1080p WEB-DL HEVC x265 5.1 BONE", 956),
    result("Jujutsu Kaisen - 50 (1080p) [F12C66EE].mkv", 519),
    result("One Piece - 1169 (1080p) [F1E2F6BA].mkv", 420),
    result("F1 (2025) 2160p WEBRip 5.1 10Bit x265 -YTS", 315),
    result("F1 (2025) 1080p WEBRip 10Bit x265 -YTS", 212),
  ]

  test("ranks relevant matches above high-seeder unrelated ones and hides non-matches", () => {
    const { visible, hidden } = rankResults(f1Results, "f1 movie", { hideNonMatches: true })
    expect(visible[0]!.title).toContain("F1 The Movie")
    expect(visible.map((r) => r.title).some((t) => t.includes("F1 (2025)"))).toBe(true)
    expect(hidden.map((r) => r.title)).toEqual([
      "Jujutsu Kaisen - 50 (1080p) [F12C66EE].mkv",
      "One Piece - 1169 (1080p) [F1E2F6BA].mkv",
    ])
    expect(visible.some((r) => r.title.includes("Jujutsu"))).toBe(false)
  })

  test("full match outranks partial match regardless of seeders", () => {
    const { visible } = rankResults(f1Results, "f1 movie", { hideNonMatches: true })
    const fullIdx = visible.findIndex((r) => r.title.includes("The Movie"))
    const partialIdx = visible.findIndex((r) => r.title.includes("F1 (2025)"))
    expect(fullIdx).toBeLessThan(partialIdx)
  })

  test("without hideNonMatches nothing is hidden", () => {
    const { visible, hidden } = rankResults(f1Results, "f1 movie", { hideNonMatches: false })
    expect(hidden).toEqual([])
    expect(visible.length).toBe(f1Results.length)
  })

  test("seeders mode sorts by raw seeders", () => {
    const { visible } = rankResults(f1Results, "f1 movie", { mode: "seeders", hideNonMatches: false })
    expect(visible[0]!.seeders).toBe(956)
    expect(visible[1]!.seeders).toBe(519)
  })

  test("size mode sorts by size", () => {
    const items = [result("a", 10, 1_000), result("b", 10, 5_000), result("c", 10, 3_000)]
    const { visible } = rankResults(items, "a b c", { mode: "size" })
    expect(visible.map((r) => r.sizeBytes)).toEqual([5_000, 3_000, 1_000])
  })
})

describe("scoreResult", () => {
  test("dead torrents sink and CAM is penalized", () => {
    expect(scoreResult(result("Movie 1080p", 0))).toBeLessThan(scoreResult(result("Movie 1080p", 100)))
    expect(scoreResult(result("Movie CAM", 100))).toBeLessThan(scoreResult(result("Movie 1080p", 100)))
  })
})
