import { describe, expect, test } from "bun:test"
import { parseX1337 } from "./x1337"

const html = `
<title>Some Page</title>
<table class="table-list">
  <tbody>
    <tr>
      <td class="coll-1 name">
        <a href="/torrent/456789/some-movie-2024" class="icon"><i class="flaticon-movie"></i></a>
        <a href="/torrent/456789/some-movie-2024">Some Movie 2024 1080p BluRay</a>
      </td>
      <td class="size"><span>1.4 GB</span>2.2 GB</td>
      <td class="seeds">120</td>
      <td class="leeches">18</td>
    </tr>
    <tr>
      <td class="coll-1 name">
        <a href="/torrent/456790/xxx-thing" class="icon"><i class="flaticon-xxx"></i></a>
        <a href="/torrent/456790/xxx-thing">Adult Thing 2024</a>
      </td>
      <td class="size"><span>900 MB</span>900 MB</td>
      <td class="seeds">40</td>
      <td class="leeches">2</td>
    </tr>
    <tr>
      <td class="coll-1 name">no link here</td>
    </tr>
  </tbody>
</table>
`

describe("parseX1337", () => {
  test("parses rows with detail urls and categories", () => {
    const results = parseX1337(html, "https://1337x.to")
    expect(results.length).toBe(2)

    const [first, second] = results
    expect(first!.title).toBe("Some Movie 2024 1080p BluRay")
    expect(first!.detailUrl).toBe("https://1337x.to/torrent/456789/some-movie-2024")
    expect(first!.category).toBe("movie")
    expect(first!.seeders).toBe(120)
    expect(first!.leechers).toBe(18)
    expect(first!.size).toBe("2.2 GB")
    expect(first!.magnet).toBe("")

    expect(second!.category).toBe("xxx")
  })
})
