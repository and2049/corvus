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

// Bun's libuv shim on POSIX lacks uv_timer_init, which utp-native calls when
// webtorrent starts its µTP server — the process dies with an uncatchable
// panic. Bun on Windows links real libuv, so µTP stays enabled there.
const utpSupported = !("bun" in process.versions) || process.platform === "win32"

export function createWebTorrentClient(options: WebTorrentOptions = {}): TorrentClient {
  // NAT-PMP/UPnP mapping is useless here (torrentPort is a manually VPN-forwarded
  // port) and nat-api's PMP client throws an uncaught exception when the gateway
  // rejects the request (e.g. LAN router with no NAT-PMP daemon, VPN down).
  const opts: Record<string, unknown> = { utp: utpSupported, natPmp: false, natUpnp: false }
  if (options.torrentPort !== undefined) opts["torrentPort"] = options.torrentPort
  if (options.maxConns !== undefined) opts["maxConns"] = options.maxConns
  if (options.downloadLimit !== undefined) opts["downloadLimit"] = options.downloadLimit
  if (options.uploadLimit !== undefined) opts["uploadLimit"] = options.uploadLimit
  return new WebTorrentReal(opts) as TorrentClient
}
