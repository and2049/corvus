import { buildMagnet } from "@corvus/providers"
// @ts-expect-error parse-torrent ships no type declarations
import parseTorrent from "parse-torrent"

const MAX_TORRENT_BYTES = 8 * 1024 * 1024

/** A local .torrent path or an http(s) URL (assumed to serve a .torrent). */
export function looksLikeTorrentInput(raw: string): boolean {
  const text = raw.trim()
  if (/^https?:\/\//i.test(text)) return true
  return text.toLowerCase().endsWith(".torrent")
}

/**
 * Resolves a .torrent file path or URL to an equivalent magnet URI, so
 * torrent-file adds ride the existing magnet pipeline (engine keying by
 * infohash, downloads.json persistence, restart resume) unchanged. Metadata
 * is re-fetched from the swarm, which the embedded tracker list makes cheap.
 */
export async function magnetFromTorrentInput(raw: string): Promise<string | undefined> {
  const bytes = await readTorrentBytes(raw.trim())
  if (bytes === undefined) return undefined
  return magnetFromTorrentBytes(bytes)
}

export async function magnetFromTorrentBytes(bytes: Uint8Array): Promise<string | undefined> {
  try {
    const parsed = (await parseTorrent(Buffer.from(bytes))) as {
      infoHash?: unknown
      name?: unknown
      announce?: unknown
    }
    if (typeof parsed.infoHash !== "string" || parsed.infoHash === "") return undefined
    const name = typeof parsed.name === "string" ? parsed.name : ""
    const announce = Array.isArray(parsed.announce)
      ? parsed.announce.filter((tracker): tracker is string => typeof tracker === "string")
      : []
    return buildMagnet(parsed.infoHash, name, announce)
  } catch {
    return undefined
  }
}

async function readTorrentBytes(source: string): Promise<Uint8Array | undefined> {
  if (/^https?:\/\//i.test(source)) {
    try {
      const response = await fetch(source, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) return undefined
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength > MAX_TORRENT_BYTES) return undefined
      return new Uint8Array(buffer)
    } catch {
      return undefined
    }
  }
  try {
    const file = Bun.file(source)
    if (!(await file.exists()) || file.size > MAX_TORRENT_BYTES) return undefined
    return new Uint8Array(await file.arrayBuffer())
  } catch {
    return undefined
  }
}
