import { describe, expect, test } from "bun:test"
import { parseNyaa } from "./nyaa"

const xml = `
<rss xmlns:nyaa="https://nyaa.si/xmlns/nyaa">
  <channel>
    <item>
      <title>Great Anime S01 [1080p]</title>
      <link>https://nyaa.si/view/1</link>
      <nyaa:seeders>88</nyaa:seeders>
      <nyaa:leechers>4</nyaa:leechers>
      <nyaa:size>1.4 GiB</nyaa:size>
      <nyaa:infoHash>abcdef0123456789abcdef0123456789abcdef01</nyaa:infoHash>
      <nyaa:trusted>yes</nyaa:trusted>
    </item>
    <item>
      <title>No hash entry</title>
      <link>https://nyaa.si/view/2</link>
    </item>
    <item>
      <title>Another Anime S02 [720p]</title>
      <nyaa:seeders>12</nyaa:seeders>
      <nyaa:leechers>1</nyaa:leechers>
      <nyaa:size>700 MiB</nyaa:size>
      <nyaa:infoHash>FEDCBA9876543210FEDCBA9876543210FEDCBA98</nyaa:infoHash>
      <nyaa:trusted>No</nyaa:trusted>
    </item>
  </channel>
</rss>
`

describe("parseNyaa", () => {
  test("parses namespaced feed items", () => {
    const results = parseNyaa(xml)
    expect(results.length).toBe(2)

    const [first, second] = results
    expect(first!.title).toBe("Great Anime S01 [1080p]")
    expect(first!.seeders).toBe(88)
    expect(first!.leechers).toBe(4)
    expect(first!.sizeBytes).toBe(1_503_238_554)
    expect(first!.trusted).toBe(true)
    expect(first!.magnet).toContain("xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01")

    expect(second!.trusted).toBe(false)
    expect(second!.magnet).toContain("xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98")
  })

  test("skips items without an infohash", () => {
    expect(parseNyaa("<rss><channel><item><title>x</title></item></channel></rss>")).toEqual([])
  })
})
