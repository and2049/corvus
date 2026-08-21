import * as cheerio from "cheerio"
import { Effect } from "effect"
import {
  atoiDefault,
  parseHumanSize,
  ProviderError,
  fetchText,
  type Provider,
  type TorrentResult,
} from "../provider"

const X1337_MIRRORS = ["https://1337x.to", "https://1337x.st", "https://x1337x.ws"] as const

export class X1337 implements Provider {
  readonly name = "1337x"
  private readonly mirrors: readonly string[]
  private active?: string

  constructor(baseUrls?: readonly string[]) {
    const mirrors: string[] = []
    const seen = new Set<string>()
    for (const mirror of [...(baseUrls ?? []), ...X1337_MIRRORS]) {
      const base = (mirror ?? "").trim().replace(/\/+$/, "")
      if (base !== "" && !seen.has(base)) {
        seen.add(base)
        mirrors.push(base)
      }
    }
    this.mirrors = mirrors
  }

  search(query: string): Effect.Effect<readonly TorrentResult[], ProviderError> {
    const q = query.trim()
    if (q === "") return Effect.succeed([])
    return Effect.tryPromise({
      try: async (): Promise<readonly TorrentResult[]> => {
        let lastError = "no mirrors configured"
        for (const mirror of this.orderedMirrors()) {
          let body: string
          try {
            body = await fetchText(`${mirror}/search/${encodeURIComponent(q)}/1/`)
          } catch (cause) {
            lastError = String(cause)
            continue
          }
          if (isCloudflareChallenge(body)) {
            lastError = `${mirror}: blocked by cloudflare`
            continue
          }
          this.active = mirror
          return parseX1337(body, mirror)
        }
        throw new Error(lastError)
      },
      catch: (cause): ProviderError => new ProviderError({ provider: this.name, message: String(cause) }),
    })
  }

  resolveMagnet(result: TorrentResult): Effect.Effect<string, ProviderError> {
    return Effect.tryPromise({
      try: async (): Promise<string> => {
        const url = result.detailUrl
        if (url === undefined || url === "") throw new Error("1337x: no detail page for result")
        const body = await fetchText(url)
        if (isCloudflareChallenge(body)) throw new Error(`${url}: blocked by cloudflare`)
        const $ = cheerio.load(body)
        const magnet = $('a[href^="magnet:?"]').first().attr("href")
        if (magnet === undefined) throw new Error("1337x: no magnet link on detail page")
        return magnet
      },
      catch: (cause): ProviderError => new ProviderError({ provider: this.name, message: String(cause) }),
    })
  }

  private orderedMirrors(): readonly string[] {
    if (this.active === undefined) return this.mirrors
    return [this.active, ...this.mirrors.filter((mirror) => mirror !== this.active)]
  }
}

export function parseX1337(html: string, mirror: string): TorrentResult[] {
  const $ = cheerio.load(html)
  const results: TorrentResult[] = []
  $("table.table-list tbody tr").each((_, row) => {
    const $row = $(row)
    const link = $row
      .find("td.name a")
      .filter((_, el) => {
        const $el = $(el)
        return ($el.attr("href") ?? "").startsWith("/torrent/") && !$el.hasClass("icon")
      })
      .first()
    const title = link.text().trim()
    const href = link.attr("href") ?? ""
    if (title === "" || href === "") return
    const seeds = atoiDefault($row.find("td.seeds").text().trim())
    const leeches = atoiDefault($row.find("td.leeches").text().trim())
    const sizeCell = $row.find("td.size").clone()
    sizeCell.find("span").remove()
    const size = sizeCell.text().trim()
    results.push({
      title,
      size,
      sizeBytes: parseHumanSize(size),
      seeders: seeds,
      leechers: leeches,
      magnet: "",
      provider: "1337x",
      category: iconCategory($row) || undefined,
      trusted: false,
      alsoOn: [],
      detailUrl: `${mirror}${href}`,
    })
  })
  return results
}

function iconCategory($row: ReturnType<cheerio.CheerioAPI>): string {
  const cls = $row.find("td.coll-1 a.icon i").first().attr("class")
  if (cls === undefined) return ""
  for (const part of cls.split(/\s+/)) {
    if (part.startsWith("flaticon-")) return part.slice("flaticon-".length)
  }
  return ""
}

function isCloudflareChallenge(html: string): boolean {
  const title = cheerio.load(html)("title").text().toLowerCase()
  return title.includes("just a moment") || title.includes("attention required")
}
