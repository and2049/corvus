export interface TorrentFile {
  readonly name: string
  readonly path: string
  readonly length: number
  select(priority?: number): void
  deselect(): void
}

export interface Torrent {
  readonly infoHash: string
  name: string
  readonly progress: number
  readonly downloaded: number
  readonly uploaded: number
  readonly length: number
  readonly downloadSpeed: number
  readonly uploadSpeed: number
  readonly numPeers: number
  readonly timeRemaining: number
  readonly done: boolean
  readonly paused: boolean
  readonly files: readonly TorrentFile[]
  on(event: string, cb: (...args: never[]) => void): void
  destroy(opts?: { destroyStore?: boolean }, cb?: () => void): void
  pause(): void
  resume(): void
}

export interface TorrentClient {
  processing: boolean
  destroyed: boolean
  add(
    torrentId: string | Record<string, unknown>,
    opts?: Record<string, unknown>,
    ontorrent?: (torrent: Torrent) => void,
  ): Torrent
  // webtorrent v3 returns a Promise here, not a Torrent - do not use it synchronously
  get(torrentId: string | Record<string, unknown>): Promise<Torrent | null>
  remove(torrentId: string | Torrent, opts?: { destroyStore?: boolean }, cb?: () => void): void
  on(event: string, cb: (...args: never[]) => void): void
  destroy(cb?: (err?: Error) => void): Promise<void> | void
  throttleDownload(rate: number): number
  throttleUpload(rate: number): number
}
