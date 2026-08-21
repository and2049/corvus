import { describe, expect, test } from "bun:test"
import { parseKnaben } from "./knaben"

const html = `
<table>
  <tbody>
    <tr data-id="1">
      <td><a href="/browse/100/1">Movies</a></td>
      <td><a href="/torrent/1">Some Movie 2023 1080p</a></td>
      <td>2.2 GB</td>
      <td>2023-01-01</td>
      <td>120</td>
      <td>18</td>
      <td><a title="Some Movie 2023 1080p" href="magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=x">magnet</a></td>
    </tr>
    <tr data-id="2">
      <td><a href="/browse/200/1">TV</a></td>
      <td>Some Show S01 720p</td>
      <td>900 MB</td>
      <td>2023-02-02</td>
      <td>45</td>
      <td>3</td>
      <td><a href="magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98&dn=y">magnet</a></td>
    </tr>
    <tr data-id="3">
      <td>no magnet here</td>
      <td>Broken row</td>
    </tr>
  </tbody>
</table>
`

describe("parseKnaben", () => {
  test("parses rows with magnet links", () => {
    const results = parseKnaben(html)
    expect(results.length).toBe(2)

    const [first, second] = results
    expect(first!.title).toBe("Some Movie 2023 1080p")
    expect(first!.category).toBe("Movies")
    expect(first!.size).toBe("2.2 GB")
    expect(first!.sizeBytes).toBe(2_200_000_000)
    expect(first!.seeders).toBe(120)
    expect(first!.leechers).toBe(18)
    expect(first!.magnet).toContain("urn:btih:abcdef0123456789abcdef0123456789abcdef01")

    expect(second!.title).toBe("Some Show S01 720p")
    expect(second!.category).toBe("TV")
    expect(second!.seeders).toBe(45)
  })

  test("skips rows without magnet or title", () => {
    expect(parseKnaben("<table><tr data-id=\"9\"><td>nothing</td></tr></table>")).toEqual([])
  })
})
