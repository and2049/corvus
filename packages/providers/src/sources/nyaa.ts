import { Effect } from "effect"
import { buildMagnet } from "../magnet"
import { atoiDefault, parseHumanSize, ProviderError, fetchText, type Provider, type TorrentResult } from "../provider"
import { parseRssItems } from "../xml"

const NYAA_BASE = "https://nyaa.si"

export class Nyaa implements Provider {
  readonly name = "nyaa"
  private readonly base: string

  constructor(baseUrl?: string) {
    this.base = (baseUrl ?? "").trim().replace(/\/+$/, "") || NYAA_BASE
  }

  search(query: string): Effect.Effect<readonly TorrentResult[], ProviderError> {
    const q = query.trim()
    if (q === "") return Effect.succeed([])
    return Effect.tryPromise({
      try: () => fetchText(`${this.base}/?page=rss&q=${encodeURIComponent(q)}`),
      catch: (cause): ProviderError => new ProviderError({ provider: this.name, message: String(cause) }),
    }).pipe(Effect.flatMap((body) => parseEffect(this.name, () => parseNyaa(body))))
  }
}

function parseEffect(
  provider: string,
  parse: () => TorrentResult[],
): Effect.Effect<readonly TorrentResult[], ProviderError> {
  return Effect.try({
    try: parse,
    catch: (): ProviderError => new ProviderError({ provider, message: "failed to parse feed" }),
  })
}

export function parseNyaa(xml: string): TorrentResult[] {
  const results: TorrentResult[] = []
  for (const item of parseRssItems(xml)) {
    const title = item.text("title")
    const hash = item.text("infohash")
    if (title === "" || hash === "") continue
    const size = item.text("size")
    results.push({
      title,
      size,
      sizeBytes: parseHumanSize(size),
      seeders: atoiDefault(item.text("seeders")),
      leechers: atoiDefault(item.text("leechers")),
      magnet: buildMagnet(hash, title),
      provider: "nyaa",
      trusted: item.text("trusted").toLowerCase() === "yes",
      alsoOn: [],
    })
  }
  return results
}
