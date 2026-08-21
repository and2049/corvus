import { Effect } from "effect"
import { buildMagnet } from "../magnet"
import {
  atoiDefault,
  humanSizeBinary,
  ProviderError,
  fetchText,
  type Provider,
  type TorrentResult,
} from "../provider"
import { parseRssItems, type RssItem } from "../xml"

export class Rss implements Provider {
  readonly name: string
  private readonly searchUrl: string

  constructor(name: string, searchUrl?: string) {
    this.name = name
    this.searchUrl = (searchUrl ?? "").trim()
  }

  search(query: string): Effect.Effect<readonly TorrentResult[], ProviderError> {
    if (this.searchUrl === "") {
      return Effect.fail(new ProviderError({ provider: this.name, message: "missing search_url" }))
    }
    const q = query.trim()
    if (q === "") return Effect.succeed([])
    return Effect.tryPromise({
      try: () => fetchText(renderSearchURL(this.searchUrl, q)),
      catch: (cause): ProviderError => new ProviderError({ provider: this.name, message: String(cause) }),
    }).pipe(
      Effect.flatMap((body) =>
        Effect.try({
          try: () => parseRssFeed(body, this.name),
          catch: (): ProviderError => new ProviderError({ provider: this.name, message: "failed to parse feed" }),
        }),
      ),
    )
  }
}

export function renderSearchURL(template: string, query: string): string {
  const escaped = encodeURIComponent(query)
  if (template.includes("{query}")) return template.replaceAll("{query}", escaped)
  if (template.includes("%s")) return template.replace("%s", escaped)
  return template
}

interface Attrs {
  first(...names: readonly string[]): string
  all(...names: readonly string[]): readonly string[]
  int(...names: readonly string[]): number
  bool(...names: readonly string[]): boolean
}

function makeAttrs(item: RssItem): Attrs {
  const first = (...names: readonly string[]): string => {
    for (const want of names) {
      for (const attr of item.attrs("attr")) {
        const name = attr["name"]
        if (name !== undefined && name.toLowerCase() === want) return (attr["value"] ?? "").trim()
      }
    }
    return ""
  }
  return {
    first,
    all: (...names: readonly string[]): readonly string[] => {
      const out: string[] = []
      for (const attr of item.attrs("attr")) {
        const name = (attr["name"] ?? "").toLowerCase()
        if (names.includes(name)) out.push((attr["value"] ?? "").trim())
      }
      return out
    },
    int: (...names: readonly string[]): number => atoiDefault(first(...names)),
    bool: (...names: readonly string[]): boolean => {
      const value = first(...names).toLowerCase()
      return value === "1" || value === "true" || value === "yes"
    },
  }
}

export function parseRssFeed(xml: string, providerName: string): TorrentResult[] {
  const results: TorrentResult[] = []
  for (const item of parseRssItems(xml)) {
    const result = resultFromItem(item, providerName)
    if (result !== undefined) results.push(result)
  }
  return results
}

function resultFromItem(item: RssItem, providerName: string): TorrentResult | undefined {
  const title = item.text("title")
  if (title === "") return undefined
  const attrs = makeAttrs(item)
  let magnet = firstMagnet(item)
  if (magnet === "") {
    const hash = attrs.first("infohash", "info_hash", "hash")
    if (hash !== "") magnet = buildMagnet(hash, title)
  }
  if (magnet === "") return undefined

  let sizeBytes = Number.parseInt(attrs.first("size", "length"), 10)
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    sizeBytes = enclosureLength(item)
  }
  let size = attrs.first("size_text", "filesize")
  if (size === "" && sizeBytes > 0) size = humanSizeBinary(sizeBytes)

  return {
    title,
    size,
    sizeBytes,
    seeders: attrs.int("seeders", "seeds"),
    leechers: attrs.int("leechers", "peers"),
    magnet,
    provider: providerName,
    trusted: attrs.bool("trusted", "verified"),
    category: rssCategory(item, attrs),
    alsoOn: [],
  }
}

function firstMagnet(item: RssItem): string {
  for (const value of [item.text("link"), item.text("guid")]) {
    if (value.startsWith("magnet:?")) return value
  }
  for (const enclosure of item.attrs("enclosure")) {
    const url = (enclosure["url"] ?? "").trim()
    if (url.startsWith("magnet:?")) return url
  }
  return ""
}

function enclosureLength(item: RssItem): number {
  for (const enclosure of item.attrs("enclosure")) {
    const length = Number.parseInt((enclosure["length"] ?? "").trim(), 10)
    if (Number.isFinite(length) && length > 0) return length
  }
  return 0
}

function rssCategory(item: RssItem, attrs: Attrs): string | undefined {
  const values = [...attrs.all("category", "cat"), ...item.all("category")]
  let label = ""
  for (const raw of values) {
    const value = raw.trim()
    if (/^\d+$/.test(value)) {
      const n = Number.parseInt(value, 10)
      if (n >= 6000 && n < 7000) return "XXX"
      continue
    }
    if (ADULT_CATEGORY_LABELS.has(value.toLowerCase())) return "XXX"
    if (value !== "" && label === "") label = value
  }
  return label === "" ? undefined : label
}

const ADULT_CATEGORY_LABELS = new Set(["xxx", "porn", "adult"])
