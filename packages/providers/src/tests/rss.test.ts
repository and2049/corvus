import { describe, expect, test } from "bun:test"
import { parseRssFeed, renderSearchURL } from "../sources/rss"

const torznabXml = `
<rss xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <item>
      <title>Release.Name.2024.1080p</title>
      <guid>https://indexer.example/download/1</guid>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <enclosure url="magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01" length="2147483648" type="application/x-bittorrent" />
      <torznab:attr name="seeders" value="95" />
      <torznab:attr name="peers" value="10" />
      <torznab:attr name="category" value="2000" />
      <torznab:attr name="verified" value="1" />
    </item>
    <item>
      <title>Adult.Release.2024</title>
      <link>magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98</link>
      <category>6000</category>
      <torznab:attr name="seeders" value="7" />
      <torznab:attr name="size" value="1073741824" />
    </item>
    <item>
      <title>Hash.Only.Release</title>
      <torznab:attr name="infohash" value="ABCDEF0123456789ABCDEF0123456789ABCDEF02" />
      <torznab:attr name="seeders" value="3" />
    </item>
    <item>
      <title>No magnet no hash</title>
    </item>
  </channel>
</rss>
`

describe("renderSearchURL", () => {
  test("supports {query} and %s templates", () => {
    expect(renderSearchURL("https://x.example/api?t=search&q={query}", "a b")).toBe(
      "https://x.example/api?t=search&q=a%20b",
    )
    expect(renderSearchURL("https://x.example/search/%s/0/", "a b")).toBe("https://x.example/search/a%20b/0/")
  })

  test("returns the template untouched without a placeholder", () => {
    expect(renderSearchURL("https://x.example/feed", "q")).toBe("https://x.example/feed")
  })
})

describe("parseRssFeed", () => {
  const results = parseRssFeed(torznabXml, "my-indexer")

  test("parses torznab attrs into results", () => {
    expect(results.length).toBe(3)
    const [first] = results
    expect(first!.provider).toBe("my-indexer")
    expect(first!.title).toBe("Release.Name.2024.1080p")
    expect(first!.seeders).toBe(95)
    expect(first!.leechers).toBe(10)
    expect(first!.sizeBytes).toBe(2_147_483_648)
    expect(first!.size).toBe("2.0 GiB")
    expect(first!.trusted).toBe(true)
    expect(first!.magnet).toContain("urn:btih:abcdef")
  })

  test("numeric 6000-6999 categories normalize to XXX", () => {
    const adult = results.find((r) => r.title === "Adult.Release.2024")
    expect(adult?.category).toBe("XXX")
  })

  test("builds a magnet from an infohash attr when none is present", () => {
    const hashOnly = results.find((r) => r.title === "Hash.Only.Release")
    expect(hashOnly?.magnet).toContain("xt=urn:btih:abcdef0123456789abcdef0123456789abcdef02")
  })

  test("skips items without any magnet source", () => {
    expect(results.some((r) => r.title === "No magnet no hash")).toBe(false)
  })
})
