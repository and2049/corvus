// @ts-expect-error webtorrent ships no type declarations
import WebTorrentReal from "webtorrent"
import type { TorrentClient } from "./webtorrent-types"

export type { Torrent, TorrentClient, TorrentFile } from "./webtorrent-types"

export function createWebTorrentClient(): TorrentClient {
  return new WebTorrentReal() as TorrentClient
}
