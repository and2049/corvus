import { infoHashFromMagnet } from "@corvus/providers"
import { createWebTorrentClient, type Torrent, type TorrentClient } from "./webtorrent"

export interface DownloadSnapshot {
  readonly key: string
  readonly name: string
  readonly state: "fetching" | "downloading" | "done" | "error"
  readonly progress: number
  readonly downloadedBytes: number
  readonly totalBytes: number
  readonly downloadSpeed: number
  readonly uploadSpeed: number
  readonly peers: number
  readonly etaSeconds: number | undefined
  readonly error?: string
}

export interface TorrentLike {
  readonly infoHash: string
  name: string
  readonly progress: number
  readonly downloaded: number
  readonly length: number
  readonly downloadSpeed: number
  readonly uploadSpeed: number
  readonly numPeers: number
  readonly timeRemaining: number
  readonly done: boolean
}

export function snapshotFrom(key: string, torrent: TorrentLike): DownloadSnapshot {
  const eta =
    Number.isFinite(torrent.timeRemaining) && torrent.timeRemaining > 0
      ? Math.round(torrent.timeRemaining / 1000)
      : undefined
  return {
    key,
    name: torrent.name !== "" ? torrent.name : key,
    state: torrent.done ? "done" : torrent.progress > 0 || torrent.downloaded > 0 ? "downloading" : "fetching",
    progress: Math.min(Math.max(torrent.progress, 0), 1),
    downloadedBytes: torrent.downloaded,
    totalBytes: torrent.length,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    peers: torrent.numPeers,
    etaSeconds: eta,
  }
}

interface Entry {
  magnet: string
  snapshot: DownloadSnapshot
  torrent?: Torrent
}

export interface EngineOptions {
  readonly downloadDir: string
  readonly seedAfterComplete?: boolean
}

export class Engine {
  private readonly client: TorrentClient
  private readonly entries = new Map<string, Entry>()
  private readonly seedAfterComplete: boolean

  constructor(
    private readonly options: EngineOptions,
    client: TorrentClient = createWebTorrentClient(),
  ) {
    this.client = client
    this.seedAfterComplete = options.seedAfterComplete ?? false
  }

  add(magnet: string): string {
    const key = infoHashFromMagnet(magnet) ?? magnet
    if (this.entries.has(key)) return key
    this.entries.set(key, { magnet, snapshot: emptySnapshot(key) })
    let torrent: Torrent
    try {
      torrent = this.client.add(magnet, { path: this.options.downloadDir })
    } catch (error) {
      this.entries.set(key, { magnet, snapshot: errorSnapshot(key, String(error)) })
      return key
    }
    const entry = this.entries.get(key)!
    entry.torrent = torrent
    torrent.on("download", () => this.refresh(key, torrent))
    torrent.on("done", () => {
      this.refresh(key, torrent)
      if (!this.seedAfterComplete) {
        torrent.destroy()
        const current = this.entries.get(key)
        if (current !== undefined) {
          this.entries.set(key, {
            ...current,
            torrent: undefined,
            snapshot: { ...current.snapshot, state: "done", progress: 1 },
          })
        }
      }
    })
    torrent.on("error", (err: Error) => {
      entry.torrent = undefined
      this.entries.set(key, { ...entry, torrent: undefined, snapshot: errorSnapshot(key, String(err)) })
    })
    return key
  }

  async remove(key: string): Promise<void> {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    const torrent = entry.torrent
    if (torrent !== undefined) {
      await new Promise<void>((resolve) => torrent.destroy({}, () => resolve()))
    }
    this.entries.delete(key)
  }

  snapshots(): DownloadSnapshot[] {
    for (const [key, entry] of this.entries) {
      if (entry.torrent !== undefined) this.refresh(key, entry.torrent)
    }
    return [...this.entries.values()].map((entry) => entry.snapshot)
  }

  keys(): string[] {
    return [...this.entries.keys()]
  }

  magnets(): string[] {
    return [...this.entries.values()].map((entry) => entry.magnet)
  }

  async shutdown(): Promise<void> {
    await new Promise<void>((resolve) => {
      const result = this.client.destroy(() => resolve())
      if (result instanceof Promise) void result.then(() => resolve(), () => resolve())
    })
  }

  private refresh(key: string, torrent: Torrent): void {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    this.entries.set(key, { ...entry, snapshot: snapshotFrom(key, torrent) })
  }
}

function emptySnapshot(key: string): DownloadSnapshot {
  return {
    key,
    name: key,
    state: "fetching",
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    peers: 0,
    etaSeconds: undefined,
  }
}

function errorSnapshot(key: string, message: string): DownloadSnapshot {
  return { ...emptySnapshot(key), state: "error", error: message }
}
