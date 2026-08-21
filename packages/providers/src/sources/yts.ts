import { Effect, pipe } from "effect"
import { buildMagnet } from "../magnet"
import { ProviderError, fetchText, type Provider, type TorrentResult } from "../provider"

const YTS_MIRRORS = ["https://yts.mx", "https://yts.rs", "https://yts.lt", "https://yts.am"] as const

interface YtsTorrent {
  readonly hash: string
  readonly quality: string
  readonly size: string
  readonly size_bytes: number
  readonly seeds: number
  readonly peers: number
}

interface YtsMovie {
  readonly title_long: string
  readonly torrents: readonly YtsTorrent[]
}

export interface YtsPayload {
  readonly data?: { readonly movies?: readonly YtsMovie[] }
}

export function parseYts(payload: YtsPayload): TorrentResult[] {
  const results: TorrentResult[] = []
  for (const movie of payload.data?.movies ?? []) {
    for (const torrent of movie.torrents ?? []) {
      const title = `${movie.title_long} [${torrent.quality}]`
      results.push({
        title,
        size: torrent.size,
        sizeBytes: torrent.size_bytes,
        seeders: torrent.seeds,
        leechers: torrent.peers,
        magnet: buildMagnet(torrent.hash, title),
        provider: "yts",
        trusted: true,
        alsoOn: [],
      })
    }
  }
  return results
}

export class Yts implements Provider {
  readonly name = "yts"
  private readonly bases: readonly string[]
  private active?: string

  constructor(baseUrl?: string) {
    const bases: string[] = []
    const seen = new Set<string>()
    for (const base of [trimTrailingSlash(baseUrl), ...YTS_MIRRORS]) {
      if (base !== "" && !seen.has(base)) {
        seen.add(base)
        bases.push(base)
      }
    }
    this.bases = bases
  }

  search(query: string): Effect.Effect<readonly TorrentResult[], ProviderError> {
    if (this.bases.length === 0) return Effect.succeed([])
    return Effect.firstSuccessOf(this.orderedBases().map((base) => this.searchBase(base, query)))
  }

  private readonly searchBase = (base: string, query: string): Effect.Effect<readonly TorrentResult[], ProviderError> =>
    pipe(
      Effect.tryPromise({
        try: () => fetchText(`${base}/api/v2/list_movies.json?query_term=${encodeURIComponent(query)}&limit=50`),
        catch: (cause): ProviderError => new ProviderError({ provider: this.name, message: String(cause) }),
      }),
      Effect.flatMap((body) =>
        pipe(
          Effect.try({
            try: () => parseYts(JSON.parse(body) as YtsPayload),
            catch: (): ProviderError => new ProviderError({ provider: this.name, message: "invalid JSON response" }),
          }),
          Effect.tap(() => Effect.sync(() => (this.active = base))),
        ),
      ),
    )

  private orderedBases(): readonly string[] {
    if (!this.active) return this.bases
    return [this.active, ...this.bases.filter((base) => base !== this.active)]
  }
}

function trimTrailingSlash(url: string | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "")
}
