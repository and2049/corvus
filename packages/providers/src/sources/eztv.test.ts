import { describe, expect, test } from "bun:test"
import { parseEztv } from "./eztv"

const html = `
<table class="forum_header_border">
  <tr class="forum_header_border">
    <td><a href="/show/1" class="epinfo">Some Show S01E01</a></td>
    <td></td>
    <td></td>
    <td>350.5 MB</td>
    <td></td>
    <td>230</td>
    <td><a href="magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01" class="magnet">magnet</a></td>
  </tr>
  <tr name="hover">
    <td><a href="/show/1" class="epinfo">Unrelated Cooking Show S02E05</a></td>
    <td></td>
    <td></td>
    <td>1.2 GB</td>
    <td></td>
    <td>50</td>
    <td><a href="magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98" class="magnet">magnet</a></td>
  </tr>
  <tr class="forum_header_border">
    <td><a href="/show/2" class="epinfo">No magnet row</a></td>
    <td></td>
    <td></td>
    <td>10 MB</td>
    <td></td>
    <td>5</td>
  </tr>
</table>
`

describe("parseEztv", () => {
  test("parses matching rows and drops unrelated ones", () => {
    const results = parseEztv(html, "some show")
    expect(results.length).toBe(1)
    const first = results[0]!
    expect(first.title).toBe("Some Show S01E01")
    expect(first.size).toBe("350.5 MB")
    expect(first.seeders).toBe(230)
    expect(first.magnet).toContain("urn:btih:abcdef")
    expect(first.provider).toBe("eztv")
  })

  test("every token of the query must appear in the title", () => {
    expect(parseEztv(html, "some show s01e01").length).toBe(1)
    expect(parseEztv(html, "some show missing-token").length).toBe(0)
  })
})
