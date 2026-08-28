import { rm } from "node:fs/promises"
import path from "node:path"
import { infoHashFromMagnet } from "@corvus/providers"
import { createWebTorrentClient, type Torrent, type TorrentClient, type Wire } from "./webtorrent"

export interface FileSnapshot {
  readonly name: string
  readonly path: string
  readonly length: number
  readonly selected: boolean
  readonly progress: number
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
  readonly uploadedBytes: number
  readonly ratio: number
  readonly seeding: boolean
  readonly sequential: boolean
  readonly etaSeconds: number | undefined
  readonly fetchingSeconds: number | undefined
  readonly error?: string
  readonly files: readonly FileSnapshot[]
  readonly queuePosition?: number
  readonly location?: string
}

export interface TorrentLike {
  readonly infoHash: string
  name?: string
  readonly progress: number
  readonly downloaded: number
  readonly length: number
  readonly downloadSpeed: number
  readonly numPeers: number
  readonly timeRemaining: number
  readonly done: boolean
  readonly paused: boolean
  readonly pieces: readonly unknown[]
  readonly bitfield?: { get(index: number): boolean }
  select(start: number, end: number, priority?: number): void
  deselect(start: number, end: number): void
}

export function snapshotFrom(key: string, torrent: TorrentLike): DownloadSnapshot {
  const eta =
    Number.isFinite(torrent.timeRemaining) && torrent.timeRemaining > 0
      ? Math.round(torrent.timeRemaining / 1000)
      : undefined
  return {
    key,
    name: typeof torrent.name === "string" && torrent.name !== "" ? torrent.name : key,
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
    // Upload stats are counted by the engine from wire piece events; webtorrent's
    // own uploadSpeed/uploaded count raw socket bytes (protocol chatter included).
    uploadSpeed: 0,
    peers: torrent.numPeers,
    uploadedBytes: 0,
    ratio: 0,
    seeding: false,
    sequential: false,
    etaSeconds: eta,
    fetchingSeconds: undefined,
    files: [],
  }
}

interface Entry {
  magnet: string
  snapshot: DownloadSnapshot
  addedAt: number
  torrent?: Torrent
  deselected: ReadonlySet<number>
  seed: boolean
  sequential: boolean
  seqWindow?: { from: number; to: number }
  uploadedBytes: number
  uploadSample: { at: number; bytes: number; speed: number }
}

export interface EngineOptions {
  readonly downloadDir: string
  readonly seedAfterComplete?: boolean
  readonly torrentPort?: number
  readonly maxConns?: number
  readonly downloadLimit?: number
  readonly uploadLimit?: number
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
      downloadLimit: options.downloadLimit,
      uploadLimit: options.uploadLimit,
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

  // Rates in bytes/second; undefined disables the limit. Applies to the whole
  // client (every peer of every torrent, including ones added later).
  setLimits(download: number | undefined, upload: number | undefined): void {
    this.client.throttleDownload(download ?? -1)
    this.client.throttleUpload(upload ?? -1)
  }

  add(magnet: string, opts?: { deselected?: readonly number[]; seed?: boolean; sequential?: boolean }): string {
    const key = infoHashFromMagnet(magnet) ?? magnet
    if (this.entries.has(key)) return key
    const entry: Entry = {
      magnet,
      snapshot: emptySnapshot(key),
      addedAt: Date.now(),
      deselected: new Set(opts?.deselected ?? []),
      seed: opts?.seed ?? this.seedAfterComplete,
      sequential: opts?.sequential ?? false,
      uploadedBytes: 0,
      uploadSample: { at: Date.now(), bytes: 0, speed: 0 },
    }
    this.entries.set(key, entry)
    this.attach(key, entry)
    return key
  }

  private attach(key: string, entry: Entry): void {
    let torrent: Torrent
    try {
      torrent = this.client.add(entry.magnet, { path: this.options.downloadDir })
    } catch (error) {
      entry.snapshot = errorSnapshot(key, String(error))
      return
    }
    entry.torrent = torrent
    torrent.on("wire", (wire: Wire) => gateWire(entry, wire))
    torrent.on("download", () => {
      const current = this.entries.get(key)
      if (current?.sequential === true) this.applySequentialWindow(current)
      this.refresh(key, torrent)
    })
    torrent.on("info", () => {
      const current = this.entries.get(key)
      if (current === undefined) return
      for (const index of current.deselected) torrent.files[index]?.deselect()
      if (current.sequential) this.applySequentialWindow(current)
      this.refresh(key, torrent)
    })
    torrent.on("done", () => {
      this.refresh(key, torrent)
      const current = this.entries.get(key)
      if (current === undefined) return
      if (current.seed) return
      torrent.destroy()
      current.torrent = undefined
      current.snapshot = { ...current.snapshot, state: "done", progress: 1 }
    })
    torrent.on("error", (err: Error) => {
      const current = this.entries.get(key)
      if (current === undefined) return
      // A duplicate-add error is fired on the ORIGINAL (healthy) torrent; ignore it
      // so a redundant add never destroys a working download.
      if (String(err).toLowerCase().includes("duplicate")) return
      current.snapshot = errorSnapshot(key, String(err))
      current.torrent = undefined
      torrent.destroy()
    })
  }

  async retry(key: string): Promise<void> {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    if (entry.snapshot.state !== "error" && entry.snapshot.state !== "fetching") return
    const torrent = entry.torrent
    if (torrent !== undefined) {
      await new Promise<void>((resolve) => torrent.destroy({}, () => resolve()))
      entry.torrent = undefined
    }
    entry.snapshot = emptySnapshot(key)
    entry.addedAt = Date.now()
    this.attach(key, entry)
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

  // Sequential download: replaces the whole-torrent selection with a sliding
  // window of SEQ_WINDOW pieces starting at the first incomplete piece, so the
  // swarm fetches pieces in order (streaming-friendly). File-level selection is
  // not supported while sequential mode is on.
  setSequential(key: string, value: boolean): void {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    entry.sequential = value
    const torrent = entry.torrent
    if (torrent === undefined) return
    if (value) {
      this.applySequentialWindow(entry)
    } else {
      if (entry.seqWindow !== undefined) {
        torrent.deselect(entry.seqWindow.from, entry.seqWindow.to)
        entry.seqWindow = undefined
      }
      if (torrent.pieces.length > 0) torrent.select(0, torrent.pieces.length - 1)
    }
    this.refresh(key, torrent)
  }

  private applySequentialWindow(entry: Entry): void {
    const torrent = entry.torrent
    if (torrent === undefined) return
    const last = torrent.pieces.length - 1
    if (last < 0) return
    let first = 0
    const bitfield = torrent.bitfield
    if (bitfield !== undefined) {
      while (first < last && bitfield.get(first)) first++
    }
    const to = Math.min(first + SEQ_WINDOW - 1, last)
    if (entry.seqWindow !== undefined && entry.seqWindow.from === first) return
    if (entry.seqWindow !== undefined) torrent.deselect(entry.seqWindow.from, entry.seqWindow.to)
    torrent.select(first, to, 1)
    entry.seqWindow = { from: first, to }
  }

  // Per-torrent seeding override; off by default, so a torrent never uploads
  // until this is turned on (see gateWire). Turning seed ON for an
  // already-destroyed done torrent re-attaches it (webtorrent resumes from the
  // existing data on disk); turning it OFF on a live done torrent destroys it
  // and parks the entry as done. On a live torrent it chokes/unchokes peers.
  setSeed(key: string, value: boolean): void {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    entry.seed = value
    const torrent = entry.torrent
    if (torrent === undefined) {
      if (value && entry.snapshot.state === "done") this.attach(key, entry)
      return
    }
    if (!value && entry.snapshot.state === "done") {
      torrent.destroy()
      entry.torrent = undefined
      entry.snapshot = { ...entry.snapshot, seeding: false }
      return
    }
    if (value) torrent._rechoke()
    else for (const wire of torrent.wires) wire.choke()
    this.refresh(key, torrent)
  }

  selectAll(key: string): void {
    this.setAllFiles(key, false)
  }

  selectNone(key: string): void {
    this.setAllFiles(key, true)
  }

  private setAllFiles(key: string, deselect: boolean): void {
    const entry = this.entries.get(key)
    if (entry?.torrent === undefined) return
    const deselected = new Set<number>(deselect ? entry.torrent.files.map((_, index) => index) : [])
    entry.torrent.files.forEach((file, index) =>
      deselected.has(index) ? file.deselect() : file.select(),
    )
    entry.deselected = deselected
    this.refresh(key, entry.torrent)
  }

  toggleFile(key: string, index: number): void {
    const entry = this.entries.get(key)
    if (entry?.torrent === undefined) return
    const file = entry.torrent.files[index]
    if (file === undefined) return
    const deselected = new Set(entry.deselected)
    if (deselected.has(index)) {
      deselected.delete(index)
      file.select()
    } else {
      deselected.add(index)
      file.deselect()
    }
    entry.deselected = deselected
    this.refresh(key, entry.torrent)
  }

  async remove(key: string, opts?: { deleteData?: boolean }): Promise<void> {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    const deleteData = opts?.deleteData === true
    const torrent = entry.torrent
    if (torrent !== undefined) {
      await new Promise<void>((resolve) => torrent.destroy({ destroyStore: deleteData }, () => resolve()))
    } else if (deleteData) {
      // Done torrents are already destroyed; remove their data from disk directly.
      const location = entry.snapshot.location
      if (location !== undefined) await rm(location, { recursive: true, force: true }).catch(() => {})
    }
    this.entries.delete(key)
  }

  magnetFor(key: string): string | undefined {
    return this.entries.get(key)?.magnet
  }

  snapshots(): DownloadSnapshot[] {
    for (const [key, entry] of this.entries) {
      if (entry.torrent !== undefined) this.refresh(key, entry.torrent)
    }
    return [...this.entries.values()].map((entry) => withFetching(entry.snapshot, entry.addedAt))
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
    entry.snapshot = {
      ...base,
      ...(typeof torrent.name === "string" && torrent.name !== ""
        ? { location: path.join(this.options.downloadDir, torrent.name) }
        : {}),
      fetchingSeconds: elapsedFetching(base.state, entry.addedAt),
      seeding: entry.seed,
      sequential: entry.sequential,
      uploadedBytes: entry.uploadedBytes,
      uploadSpeed: uploadSpeedOf(entry),
      ratio: torrent.downloaded > 0 ? entry.uploadedBytes / torrent.downloaded : 0,
      files: torrent.files.map((file, index) => ({
        name: file.name,
        path: file.path,
        length: file.length,
        selected: !entry.deselected.has(index),
        progress: file.progress ?? 0,
      })),
    }
  }
}

const SEQ_WINDOW = 32

// Seeding gate and upload accounting. wire.piece is the only path that sends
// file data, so gating it on the live seed flag makes "not seeding" mean zero
// upload; gating unchoke keeps the choke state protocol-honest so peers do not
// request in vain. The wire "upload" event fires only for piece data, unlike
// webtorrent's torrent.uploadSpeed which counts raw socket bytes (handshakes,
// metadata serving, PEX) and therefore reads nonzero even when never seeding.
function gateWire(entry: Entry, wire: Wire): void {
  const unchoke = wire.unchoke.bind(wire)
  const piece = wire.piece.bind(wire)
  wire.unchoke = () => {
    if (entry.seed) unchoke()
  }
  wire.piece = (index, offset, buffer) => {
    if (entry.seed) piece(index, offset, buffer)
  }
  wire.on("upload", (bytes: number) => {
    entry.uploadedBytes += bytes
  })
}

function uploadSpeedOf(entry: Entry): number {
  const sample = entry.uploadSample
  const dt = Date.now() - sample.at
  if (dt >= 1000) {
    sample.speed = Math.round(((entry.uploadedBytes - sample.bytes) * 1000) / dt)
    sample.at = Date.now()
    sample.bytes = entry.uploadedBytes
  }
  return sample.speed
}

function elapsedFetching(state: DownloadSnapshot["state"], addedAt: number): number | undefined {
  return state === "fetching"
    ? Math.max(0, Math.round((Date.now() - addedAt) / 1000))
    : undefined
}

function withFetching(snapshot: DownloadSnapshot, addedAt: number): DownloadSnapshot {
  if (snapshot.state !== "fetching") return snapshot
  return { ...snapshot, fetchingSeconds: elapsedFetching(snapshot.state, addedAt) }
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
    uploadedBytes: 0,
    ratio: 0,
    seeding: false,
    sequential: false,
    etaSeconds: undefined,
    fetchingSeconds: undefined,
    files: [],
  }
}

function errorSnapshot(key: string, message: string): DownloadSnapshot {
  return { ...emptySnapshot(key), state: "error", error: message }
}
