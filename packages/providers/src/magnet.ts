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
