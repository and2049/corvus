import { createWriteStream, type WriteStream } from "node:fs"
import { mkdir, rename, stat, unlink } from "node:fs/promises"
import path from "node:path"
import {
  registerTransferDenier,
  sharedSoulseekClient,
  startTransfer,
  type SlskFileRef,
  type SlskTransferEvent,
  type SlskTransferHandle,
  type SoulseekClient,
} from "@corvus/providers"
import type { DownloadSnapshot } from "./engine"
import type { PersistedDownload } from "./state"

const SPEED_WINDOW_MS = 5_000
const MAX_AUTO_REQUEUES = 2

export interface SoulseekCredentials {
  readonly username?: string
  readonly password?: string
  readonly listenPort?: number
}

export interface SoulseekDownloadsOptions {
  readonly downloadDir: string
  readonly credentials: SoulseekCredentials
}

export function slskKey(file: SlskFileRef): string {
  return `slsk:${file.username}:${file.path}`
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** Turns one remote path segment into a safe local filename. */
export function sanitizeSlskName(segment: string): string {
  let name = segment.replace(/[<>:"/\x5c|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "")
  if (name === "" || WINDOWS_RESERVED.test(name)) name = `_${name}`
  return name
}

interface SlskEntry {
  readonly key: string
  readonly file: SlskFileRef
  state: DownloadSnapshot["state"]
  error?: string
  size: number
  received: number
  queuePosition?: number
  addedAt: number
  startedWaitingAt: number
  generation: number
  requeues: number
  handle?: SlskTransferHandle
  stream?: WriteStream
  // Pending stream close; start() awaits it so the resume-offset stat sees flushed bytes.
  closing?: Promise<void>
  readonly partPath: string
  finalPath?: string
  window: { at: number; received: number }[]
}

/**
 * Download lifecycle for soulseek files: disk IO, progress/speed accounting,
 * and the same pull snapshot shape the torrent engine produces, so both render
 * in one dashboard. All network work happens in the providers transfer layer.
 */
export class SoulseekDownloads {
  private readonly client: SoulseekClient
  private readonly entries = new Map<string, SlskEntry>()
  private readonly unregisterDenier: () => void

  constructor(
    private readonly options: SoulseekDownloadsOptions,
    client: SoulseekClient = sharedSoulseekClient(),
    private readonly transfer: typeof startTransfer = startTransfer,
  ) {
    this.client = client
    this.unregisterDenier = registerTransferDenier(client, (username, filePath) => {
      const entry = this.entries.get(slskKey({ username, path: filePath, size: 0 }))
      return entry?.state === "paused"
    })
  }

  canDownload(): boolean {
    const { username, password } = this.options.credentials
    return username !== undefined && username !== "" && password !== undefined && password !== ""
  }

  add(file: SlskFileRef, addedAt?: number): string {
    const key = slskKey(file)
    if (this.entries.has(key)) return key
    const dir = path.join(this.options.downloadDir, "soulseek", sanitizeSlskName(file.username))
    const base = sanitizeSlskName(lastSegment(file.path))
    const entry: SlskEntry = {
      key,
      file,
      state: "fetching",
      size: file.size,
      received: 0,
      addedAt: addedAt ?? Date.now(),
      startedWaitingAt: Date.now(),
      generation: 0,
      requeues: 0,
      partPath: path.join(dir, `${base}.part`),
      window: [],
    }
    this.entries.set(key, entry)
    void this.start(entry)
    return key
  }

  pause(key: string): void {
    const entry = this.entries.get(key)
    if (entry === undefined || entry.state === "done" || entry.state === "paused") return
    entry.generation += 1
    entry.handle?.abort()
    entry.handle = undefined
    this.closeStream(entry)
    entry.state = "paused"
    entry.window = []
  }

  resume(key: string): void {
    const entry = this.entries.get(key)
    if (entry?.state !== "paused") return
    entry.state = "fetching"
    entry.startedWaitingAt = Date.now()
    void this.start(entry)
  }

  async retry(key: string): Promise<void> {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    if (entry.state !== "error" && entry.state !== "fetching") return
    entry.generation += 1
    entry.handle?.abort()
    entry.handle = undefined
    this.closeStream(entry)
    entry.state = "fetching"
    entry.error = undefined
    entry.startedWaitingAt = Date.now()
    await this.start(entry)
  }

  async remove(key: string, opts?: { deleteData?: boolean }): Promise<void> {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    entry.generation += 1
    entry.handle?.abort()
    entry.handle = undefined
    this.closeStream(entry)
    this.entries.delete(key)
    if (entry.state !== "done") {
      await unlink(entry.partPath).catch(() => {})
    } else if (opts?.deleteData === true && entry.finalPath !== undefined) {
      await unlink(entry.finalPath).catch(() => {})
    }
  }

  fileFor(key: string): SlskFileRef | undefined {
    return this.entries.get(key)?.file
  }

  snapshots(): DownloadSnapshot[] {
    const now = Date.now()
    return [...this.entries.values()].map((entry) => {
      const speed = entry.state === "downloading" ? windowSpeed(entry.window, now) : 0
      const remaining = entry.size - entry.received
      return {
        key: entry.key,
        name: lastSegment(entry.file.path),
        state: entry.state,
        progress: entry.size > 0 ? Math.min(entry.received / entry.size, 1) : 0,
        downloadedBytes: entry.received,
        totalBytes: entry.size,
        downloadSpeed: speed,
        uploadSpeed: 0,
        peers: entry.state === "downloading" ? 1 : 0,
        etaSeconds: speed > 0 && remaining > 0 ? Math.round(remaining / speed) : undefined,
        fetchingSeconds:
          entry.state === "fetching" ? Math.max(0, Math.round((now - entry.startedWaitingAt) / 1000)) : undefined,
        files: [],
        ...(entry.error !== undefined ? { error: entry.error } : {}),
        ...(entry.queuePosition !== undefined ? { queuePosition: entry.queuePosition } : {}),
        location: entry.finalPath ?? entry.partPath,
      }
    })
  }

  persisted(): PersistedDownload[] {
    return [...this.entries.values()].map((entry) => ({
      magnet: "",
      name: lastSegment(entry.file.path),
      addedAt: entry.addedAt,
      done: entry.state === "done",
      slsk: entry.file,
    }))
  }

  keys(): string[] {
    return [...this.entries.keys()]
  }

  async shutdown(): Promise<void> {
    this.unregisterDenier()
    for (const entry of this.entries.values()) {
      entry.generation += 1
      entry.handle?.abort()
      entry.handle = undefined
      this.closeStream(entry)
    }
    await this.client.disconnect()
  }

  private async start(entry: SlskEntry): Promise<void> {
    const generation = entry.generation
    if (!this.canDownload()) {
      entry.state = "error"
      entry.error = "soulseek username/password not configured"
      return
    }
    try {
      const { username, password, listenPort } = this.options.credentials
      const response = await this.client.connect({
        username: username ?? "",
        password: password ?? "",
        ...(listenPort !== undefined ? { listenPort } : {}),
      })
      if (!response.success) {
        throw new Error(`login rejected: ${response.rejectionReason ?? "unknown reason"}`)
      }
      await entry.closing
      await mkdir(path.dirname(entry.partPath), { recursive: true })
      const offset = await stat(entry.partPath).then(
        (info) => info.size,
        () => 0,
      )
      if (entry.generation !== generation) return
      entry.received = offset
      entry.stream = createWriteStream(entry.partPath, { flags: "a" })
      entry.handle = this.transfer(
        this.client,
        { username: entry.file.username, path: entry.file.path, size: entry.size, offset },
        (event) => {
          if (entry.generation === generation) this.onTransferEvent(entry, event)
        },
      )
    } catch (error) {
      if (entry.generation !== generation) return
      this.closeStream(entry)
      entry.state = "error"
      entry.error = String(error instanceof Error ? error.message : error)
    }
  }

  private onTransferEvent(entry: SlskEntry, event: SlskTransferEvent): void {
    switch (event.kind) {
      case "queued":
        if (event.place !== undefined) entry.queuePosition = event.place
        return
      case "started":
        // A resumed partial only makes sense against an unchanged remote file;
        // when the uploader reports a different size, drop it and start over.
        if (event.offset > 0 && event.size !== entry.size) {
          void this.restartWithoutPartial(entry)
          return
        }
        entry.state = "downloading"
        entry.size = event.size
        entry.received = event.offset
        entry.queuePosition = undefined
        entry.requeues = 0
        entry.window = [{ at: Date.now(), received: event.offset }]
        return
      case "data":
        entry.stream?.write(event.chunk)
        entry.received += event.chunk.length
        pushWindow(entry, Date.now())
        return
      case "done":
        entry.handle = undefined
        void this.finalize(entry)
        return
      case "failed":
        entry.handle = undefined
        this.closeStream(entry)
        entry.window = []
        if (event.requeueable && entry.requeues < MAX_AUTO_REQUEUES) {
          entry.requeues += 1
          entry.generation += 1
          entry.state = "fetching"
          entry.startedWaitingAt = Date.now()
          void this.start(entry)
          return
        }
        entry.state = "error"
        entry.error = event.reason
        return
    }
  }

  private async restartWithoutPartial(entry: SlskEntry): Promise<void> {
    entry.generation += 1
    entry.handle?.abort()
    entry.handle = undefined
    this.closeStream(entry)
    await entry.closing
    await unlink(entry.partPath).catch(() => {})
    entry.received = 0
    entry.size = entry.file.size
    entry.state = "fetching"
    entry.startedWaitingAt = Date.now()
    await this.start(entry)
  }

  private async finalize(entry: SlskEntry): Promise<void> {
    const generation = entry.generation
    await this.endStream(entry)
    const dir = path.dirname(entry.partPath)
    const base = path.basename(entry.partPath, ".part")
    const extension = path.extname(base)
    const stem = path.basename(base, extension)
    // fs.rename overwrites silently, so probe for a free name first.
    let target = path.join(dir, base)
    for (let attempt = 1; await exists(target); attempt += 1) {
      target = path.join(dir, `${stem} (${attempt})${extension}`)
    }
    try {
      await rename(entry.partPath, target)
    } catch (error) {
      if (entry.generation === generation) {
        entry.state = "error"
        entry.error = `could not move completed file: ${String(error)}`
      }
      return
    }
    if (entry.generation !== generation) return
    entry.finalPath = target
    entry.state = "done"
    entry.received = entry.size
    entry.window = []
  }

  private closeStream(entry: SlskEntry): void {
    entry.closing = this.endStream(entry)
  }

  private endStream(entry: SlskEntry): Promise<void> {
    const stream = entry.stream
    entry.stream = undefined
    if (stream === undefined) return Promise.resolve()
    return new Promise((resolve) => stream.end(() => resolve()))
  }
}

function exists(filePath: string): Promise<boolean> {
  return stat(filePath).then(
    () => true,
    () => false,
  )
}

function lastSegment(remotePath: string): string {
  const parts = remotePath.split("\\")
  return parts[parts.length - 1] ?? remotePath
}

function pushWindow(entry: SlskEntry, now: number): void {
  entry.window.push({ at: now, received: entry.received })
  while (entry.window.length > 0 && now - entry.window[0]!.at > SPEED_WINDOW_MS) {
    entry.window.shift()
  }
}

function windowSpeed(window: readonly { at: number; received: number }[], now: number): number {
  const recent = window.filter((sample) => now - sample.at <= SPEED_WINDOW_MS)
  if (recent.length < 2) return 0
  const first = recent[0]!
  const last = recent[recent.length - 1]!
  const seconds = (last.at - first.at) / 1000
  if (seconds <= 0) return 0
  return Math.max(0, (last.received - first.received) / seconds)
}
