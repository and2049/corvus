export const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://open.tracker.cl:1337/announce",
  "udp://tracker1.bt.moack.co.kr:80/announce",
  "udp://tracker.moeking.me:6969/announce",
  "udp://p4p.arenabg.com:1337/announce",
  "udp://opentracker.i2p.rocks:6969/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://tracker.bittor.pw:1337/announce",
  "https://tracker.tamersunion.org:443/announce",
] as const

export function buildMagnet(infoHash: string, displayName: string, trackers: readonly string[] = DEFAULT_TRACKERS): string {
  let magnet = `magnet:?xt=urn:btih:${infoHash.toLowerCase()}`
  if (displayName !== "") {
    magnet += `&dn=${encodeURIComponent(displayName)}`
  }
  for (const tracker of trackers) {
    magnet += `&tr=${encodeURIComponent(tracker)}`
  }
  return magnet
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
const BTIH_RE = /urn:btih:([A-Za-z2-7]{32}|[A-Fa-f0-9]{40})/

function base32ToHex(input: string): string | undefined {
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of input) {
    const index = BASE32_ALPHABET.indexOf(ch.toUpperCase())
    if (index < 0) return undefined
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("")
}

export function infoHashFromMagnet(magnet: string): string | undefined {
  const match = BTIH_RE.exec(magnet)
  if (!match) return undefined
  const raw = match[1]!
  if (raw.length === 40) return raw.toLowerCase()
  return base32ToHex(raw)
}

export interface ParsedMagnet {
  readonly infoHash: string
  readonly displayName: string
  readonly trackers: readonly string[]
  readonly params: readonly (readonly [string, string])[]
}

export function parseMagnet(magnet: string): ParsedMagnet | undefined {
  if (!magnet.startsWith("magnet:?")) return undefined
  let infoHash = ""
  let displayName = ""
  const trackers: string[] = []
  const params: [string, string][] = []
  for (const [key, value] of new URLSearchParams(magnet.slice("magnet:?".length))) {
    if (key === "xt" && infoHash === "") {
      const match = /^urn:btih:(.+)$/i.exec(value)
      if (match) {
        const normalized = normalizeBtih(match[1]!)
        if (normalized === undefined) return undefined
        infoHash = normalized
        continue
      }
    }
    if (key === "dn") {
      displayName = value
    } else if (key === "tr") {
      trackers.push(value)
    } else {
      params.push([key, value])
    }
  }
  if (infoHash === "") return undefined
  return { infoHash, displayName, trackers, params }
}

function normalizeBtih(raw: string): string | undefined {
  if (raw.length === 40 && /^[A-Fa-f0-9]{40}$/.test(raw)) return raw.toLowerCase()
  if (raw.length === 32) return base32ToHex(raw)
  return undefined
}

const MAX_MERGED_TRACKERS = 64

function trackerKey(tracker: string): string {
  const trimmed = tracker.trim()
  return trimmed.toLowerCase().replace(/\/+$/, "")
}

export function unionTrackers(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of [a, b]) {
    for (const tracker of list) {
      const key = trackerKey(tracker)
      if (key === "" || seen.has(key)) continue
      seen.add(key)
      out.push(tracker.trim())
    }
  }
  out.sort()
  return out.length > MAX_MERGED_TRACKERS ? out.slice(0, MAX_MERGED_TRACKERS) : out
}

export function unionMagnet(keepMagnet: string, otherMagnet: string): string {
  const keep = parseMagnet(keepMagnet)
  const other = parseMagnet(otherMagnet)
  if (!keep || !other) return keepMagnet
  const merged = unionTrackers(keep.trackers, other.trackers)
  if (merged.length === unionTrackers(keep.trackers, []).length) return keepMagnet
  let magnet = `magnet:?xt=urn:btih:${keep.infoHash}`
  if (keep.displayName !== "") magnet += `&dn=${encodeURIComponent(keep.displayName)}`
  for (const [key, value] of keep.params) magnet += `&${key}=${encodeURIComponent(value)}`
  for (const tracker of merged) magnet += `&tr=${encodeURIComponent(tracker)}`
  return magnet
}
