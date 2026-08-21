import * as cheerio from "cheerio"
import { Effect, pipe } from "effect"
import { atoiDefault, parseHumanSize, ProviderError, fetchText, type Provider, type TorrentResult } from "../provider"

const KNABEN_WEB = "https://knaben.org"

export class Knaben implements Provider {
  readonly name = "knaben"
  private readonly base: string

  constructor(baseUrl?: string) {
    let base = (baseUrl ?? "").trim().replace(/\/+$/, "")
    if (base === "" || base.includes("api.knaben") || base.includes("knaben.eu")) {
      base = KNABEN_WEB
    }
    this.base = base
  }

  search(query: string): Effect.Effect<readonly TorrentResult[], ProviderError> {
    const q = query.trim()
    if (q === "") return Effect.succeed([])
    return pipe(
      Effect.tryPromise({
        try: () => fetchText(`${this.base}/search/${encodeURIComponent(q)}/0/1/seeders`),
        catch: (cause): ProviderError => new ProviderError({ provider: this.name, message: String(cause) }),
      }),
      Effect.flatMap((body) =>
        pipe(
          Effect.try({
            try: () => parseKnaben(body),
            catch: (): ProviderError => new ProviderError({ provider: this.name, message: "failed to parse HTML" }),
          }),
        ),
      ),
    )
  }
}

export function parseKnaben(html: string): TorrentResult[] {
  const $ = cheerio.load(html)
  const results: TorrentResult[] = []
  $("tr[data-id]").each((_, row) => {
    const $row = $(row)
    const magnet = $row.find('a[href^="magnet:"]').first().attr("href")
    if (!magnet) return
    const cells = $row.find("td")
    const cell = (index: number): string => cells.eq(index).text().trim()
    let title = ($row.find('a[href^="magnet:"]').first().attr("title") ?? "").trim()
    if (title === "") title = cell(1)
    if (title === "") return
    const size = cell(2)
    const category = cells.first().find('a[href^="/browse/"]').first().text().trim()
    results.push({
      title,
      size,
      sizeBytes: parseHumanSize(size),
      seeders: atoiDefault(cell(4)),
      leechers: atoiDefault(cell(5)),
      magnet,
      provider: "knaben",
      category: category === "" ? undefined : category,
      trusted: false,
      alsoOn: [],
    })
  })
  return results
}
