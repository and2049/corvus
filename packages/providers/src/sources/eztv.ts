import * as cheerio from "cheerio"
import { Effect } from "effect"
import {
  atoiDefault,
  matchesQuery,
  parseHumanSize,
  ProviderError,
  fetchText,
  type Provider,
  type TorrentResult,
} from "../provider"

const EZTV_BASE = "https://eztv.re"

export class Eztv implements Provider {
  readonly name = "eztv"
  private readonly base: string

  constructor(baseUrl?: string) {
    this.base = (baseUrl ?? "").trim().replace(/\/+$/, "") || EZTV_BASE
  }

  search(query: string): Effect.Effect<readonly TorrentResult[], ProviderError> {
    const q = query.trim()
    if (q === "") return Effect.succeed([])
    const slug = q.replace(/\s+/g, "-")
    return Effect.tryPromise({
      try: () => fetchText(`${this.base}/search/${encodeURIComponent(slug)}`),
      catch: (cause): ProviderError => new ProviderError({ provider: this.name, message: String(cause) }),
    }).pipe(
      Effect.flatMap((body) =>
        Effect.try({
          try: () => parseEztv(body, q),
          catch: (): ProviderError => new ProviderError({ provider: this.name, message: "failed to parse HTML" }),
        }),
      ),
    )
  }
}

export function parseEztv(html: string, query: string): TorrentResult[] {
  const $ = cheerio.load(html)
  const results: TorrentResult[] = []
  $(
    "table.forum_header_border tr.forum_header_border, table.forum_header_border tr[name='hover']",
  ).each((_, row) => {
    const $row = $(row)
    const title = $row.find("td a.epinfo").text().trim()
    const magnet = $row.find("td a.magnet").attr("href") ?? ""
    if (title === "" || !magnet.startsWith("magnet:")) return
    if (!matchesQuery(title, query)) return
    const cells = $row.find("td")
    const size = cells.eq(3).text().trim()
    results.push({
      title,
      size,
      sizeBytes: parseHumanSize(size),
      seeders: atoiDefault(cells.eq(5).text().trim()),
      leechers: 0,
      magnet,
      provider: "eztv",
      trusted: false,
      alsoOn: [],
    })
  })
  return results
}
