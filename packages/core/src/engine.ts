import { infoHashFromMagnet } from "@corvus/providers"
import { createWebTorrentClient, type Torrent, type TorrentClient } from "./webtorrent"

export interface FileSnapshot {
  readonly name: string
  readonly path: string
  readonly length: number
  readonly selected: boolean
}

export interface DownloadSnapshot {
  readonly key: string
  readonly name: string
  readonly state: "fetching" | "downloading" | "paused" | "done" | "error"
  readonly progress: number
  readonly downloadedBytes: number
  readonly totalBytes: number
  readonly downloadSpeed: number
  readonly uploadSpeed: number
  readonly peers: number
  readonly etaSeconds: number | undefined
  readonly error?: string
  readonly files: readonly FileSnapshot[]
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
  readonly paused: boolean
}

export function snapshotFrom(key: string, torrent: TorrentLike): DownloadSnapshot {
  const eta =
    Number.isFinite(torrent.timeRemaining) && torrent.timeRemaining > 0
      ? Math.round(torrent.timeRemaining / 1000)
      : undefined
  return {
    key,
    name: torrent.name !== "" ? torrent.name : key,
    state: torrent.done
      ? "done"
      : torrent.paused
        ? "paused"
        : torrent.progress > 0 || torrent.downloaded > 0
          ? "downloading"
          : "fetching",
    progress: Math.min(Math.max(torrent.progress, 0), 1),
    downloadedBytes: torrent.downloaded,
    totalBytes: torrent.length,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    peers: torrent.numPeers,
    etaSeconds: eta,
    files: [],
  }
}

interface Entry {
  magnet: string
  snapshot: DownloadSnapshot
  torrent?: Torrent
  selection: boolean[] | undefined
}

export interface EngineOptions {
  readonly downloadDir: string
  readonly seedAfterComplete?: boolean
  readonly torrentPort?: number
  readonly maxConns?: number
}

export class Engine {
  private readonly client: TorrentClient
  private readonly entries = new Map<string, Entry>()
  private seedAfterComplete: boolean
  private lastClientError: string | undefined

  constructor(
    private readonly options: EngineOptions,
    client: TorrentClient = createWebTorrentClient({
      torrentPort: options.torrentPort,
      maxConns: options.maxConns,
    }),
  ) {
    this.client = client
    this.seedAfterComplete = options.seedAfterComplete ?? false
    this.client.on("error", (err: Error) => {
      this.lastClientError = String(err)
    })
  }

  clientError(): string | undefined {
    return this.lastClientError
  }

  setSeedAfterComplete(value: boolean): void {
    this.seedAfterComplete = value
  }

  add(magnet: string): string {
    const key = infoHashFromMagnet(magnet) ?? magnet
    if (this.entries.has(key)) return key
    const entry: Entry = { magnet, snapshot: emptySnapshot(key), selection: undefined }
    this.entries.set(key, entry)
    let torrent: Torrent
    try {
      torrent = this.client.add(magnet, { path: this.options.downloadDir })
    } catch (error) {
      entry.snapshot = errorSnapshot(key, String(error))
      return key
    }
    entry.torrent = torrent
    torrent.on("download", () => this.refresh(key, torrent))
    torrent.on("info", () => {
      const current = this.entries.get(key)
      if (current === undefined) return
      if (current.selection === undefined) current.selection = torrent.files.map(() => true)
      this.refresh(key, torrent)
    })
    torrent.on("done", () => {
      this.refresh(key, torrent)
      if (!this.seedAfterComplete) {
        torrent.destroy()
        const current = this.entries.get(key)
        if (current !== undefined) {
          current.torrent = undefined
          current.snapshot = { ...current.snapshot, state: "done", progress: 1 }
        }
      }
    })
    torrent.on("error", (err: Error) => {
      const current = this.entries.get(key)
      if (current === undefined) return
      // A duplicate-add error is fired on the ORIGINAL (healthy) torrent; ignore it
      // so a redundant add never destroys a working download.
      if (String(err).toLowerCase().includes("duplicate")) return
      current.torrent = undefined
      current.snapshot = errorSnapshot(key, String(err))
    })
    return key
  }

  pause(key: string): void {
    const entry = this.entries.get(key)
    if (entry?.torrent === undefined || entry.snapshot.state === "done") return
    entry.torrent.pause()
    this.refresh(key, entry.torrent)
  }

  resume(key: string): void {
    const entry = this.entries.get(key)
    if (entry?.torrent === undefined || entry.snapshot.state === "done") return
    entry.torrent.resume()
    this.refresh(key, entry.torrent)
  }

  toggleFile(key: string, index: number): void {
    const entry = this.entries.get(key)
    if (entry?.torrent === undefined || entry.selection === undefined) return
    const file = entry.torrent.files[index]
    if (file === undefined) return
    if (entry.selection[index]!) {
      entry.selection[index] = false
      file.deselect()
    } else {
      entry.selection[index] = true
      file.select()
    }
    this.refresh(key, entry.torrent)
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
    const base = snapshotFrom(key, torrent)
    entry.snapshot =
      entry.selection === undefined
        ? base
        : {
            ...base,
            files: torrent.files.map((file, index) => ({
              name: file.name,
              path: file.path,
              length: file.length,
              selected: entry.selection![index] ?? true,
            })),
          }
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
    files: [],
  }
}

function errorSnapshot(key: string, message: string): DownloadSnapshot {
  return { ...emptySnapshot(key), state: "error", error: message }
}
