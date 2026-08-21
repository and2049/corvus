// @ts-expect-error webtorrent ships no type declarations
import WebTorrentReal from "webtorrent"
import type { TorrentClient } from "./webtorrent-types"

export type { Torrent, TorrentClient, TorrentFile } from "./webtorrent-types"

export interface WebTorrentOptions {
  readonly torrentPort?: number
  readonly maxConns?: number
  readonly downloadLimit?: number
  readonly uploadLimit?: number
}

export function createWebTorrentClient(options: WebTorrentOptions = {}): TorrentClient {
  const opts: Record<string, unknown> = {}
  if (options.torrentPort !== undefined) opts["torrentPort"] = options.torrentPort
  if (options.maxConns !== undefined) opts["maxConns"] = options.maxConns
  if (options.downloadLimit !== undefined) opts["downloadLimit"] = options.downloadLimit
  if (options.uploadLimit !== undefined) opts["uploadLimit"] = options.uploadLimit
  return new WebTorrentReal(opts) as TorrentClient
}
