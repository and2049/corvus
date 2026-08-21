import { describe, expect, test } from "bun:test"
import { parseYts, type YtsPayload } from "../sources/yts"

const payload: YtsPayload = {
  data: {
    movies: [
      {
        title_long: "The Crow (1994)",
        torrents: [
          {
            hash: "abcdef0123456789abcdef0123456789abcdef01",
            quality: "1080p",
            size: "2.2 GB",
            size_bytes: 2_200_000_000,
            seeds: 120,
            peers: 18,
          },
          {
            hash: "fedcba9876543210fedcba9876543210fedcba98",
            quality: "720p",
            size: "900 MB",
            size_bytes: 900_000_000,
            seeds: 80,
            peers: 9,
          },
        ],
      },
    ],
  },
}

describe("parseYts", () => {
  test("emits one result per torrent variant", () => {
    const results = parseYts(payload)
    expect(results.length).toBe(2)
    expect(results[0]!.title).toBe("The Crow (1994) [1080p]")
    expect(results[0]!.seeders).toBe(120)
    expect(results[0]!.leechers).toBe(18)
    expect(results[0]!.trusted).toBe(true)
    expect(results[0]!.provider).toBe("yts")
  })

  test("magnet contains hash, display name and default trackers", () => {
    const [first] = parseYts(payload)
    expect(first!.magnet).toContain("xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01")
    expect(first!.magnet).toContain("dn=The%20Crow%20(1994)%20%5B1080p%5D")
    expect(first!.magnet.match(/tr=/g)?.length).toBeGreaterThan(5)
  })

  test("handles empty payloads", () => {
    expect(parseYts({})).toEqual([])
    expect(parseYts({ data: {} })).toEqual([])
  })
})
