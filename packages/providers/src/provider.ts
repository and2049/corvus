import { Data, type Effect } from "effect"

export interface TorrentResult {
  readonly title: string
  readonly size: string
  readonly sizeBytes: number
  readonly seeders: number
  readonly leechers: number
  readonly magnet: string
  readonly provider: string
  readonly category?: string
  readonly trusted: boolean
  readonly alsoOn: readonly string[]
  readonly detailUrl?: string
}

export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly provider: string
  readonly message: string
}> {}

export interface Provider {
  readonly name: string
  search(query: string): Effect.Effect<readonly TorrentResult[], ProviderError>
  resolveMagnet?(result: TorrentResult): Effect.Effect<string, ProviderError>
}

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

export interface FetchTextOptions {
  readonly timeoutMs?: number
  readonly maxBytes?: number
}

export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  })
  const host = new URL(url).host
  if (res.status === 403 || res.status === 429 || res.status === 503) {
    throw new Error(`blocked by ${host} (HTTP ${res.status})`)
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${host}`)
  }
  const reader = res.body?.getReader()
  if (!reader) {
    return res.text()
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      throw new Error(`response from ${host} exceeds ${maxBytes} bytes`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString("utf8")
}

const SIZE_RE = /^\s*([\d.,]+)\s*([kmgt]?i?b?)\s*$/i

export function parseHumanSize(input: string): number {
  const match = SIZE_RE.exec(input)
  if (!match) return 0
  const value = Number(match[1]!.replace(/,/g, ""))
  if (!Number.isFinite(value)) return 0
  const unit = match[2]!.toLowerCase()
  const power = unit.startsWith("t") ? 4 : unit.startsWith("g") ? 3 : unit.startsWith("m") ? 2 : unit.startsWith("k") ? 1 : 0
  const base = unit.includes("i") ? 1024 : 1000
  return Math.round(value * Math.pow(base, power))
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1)
  const value = bytes / Math.pow(1000, power)
  const digits = value >= 100 || power === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[power]!}`
}

export function atoiDefault(input: string): number {
  const parsed = Number.parseInt(input.replace(/[^\d-]/g, ""), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export function humanSizeBinary(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
  let unit = 0
  let value = bytes
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${units[unit]!}`
}

export function matchesQuery(title: string, query: string): boolean {
  const lowerTitle = title.toLowerCase()
  for (const token of query.toLowerCase().split(/\s+/)) {
    if (token !== "" && !lowerTitle.includes(token)) return false
  }
  return true
}
