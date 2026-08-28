import { rm } from "node:fs/promises"
import type { YtDlpConfig } from "./config"
import type { DownloadSnapshot } from "./engine"
import type { PersistedDownload } from "./state"
import {
  buildDownloadArgs,
  defaultRun,
  parseFilepathLine,
  parseProgressLine,
  probeFormats,
  ytdlpAudioFormat,
  ytdlpBin,
  ytdlpDefaultFormat,
  type RunHandle,
  type RunProcess,
  type YtDlpInfo,
} from "./ytdlp"

const SPEED_WINDOW_MS = 5_000

export interface HttpDownloadsOptions {
  readonly downloadDir: string
  readonly config?: YtDlpConfig
}

export interface HttpDownloadRequest {
  readonly url: string
  readonly title: string
  readonly format: string
  readonly size?: number
  readonly extractAudio?: boolean
  readonly audioFormat?: string
  readonly audioQuality?: string
}

export function httpKey(url: string): string {
  return `http:${url}`
}

interface HttpEntry {
  readonly key: string
  readonly url: string
  readonly title: string
  format: string
  readonly extractAudio: boolean
  readonly audioFormat?: string
  readonly audioQuality?: string
  state: DownloadSnapshot["state"]
  error?: string
  size: number
  received: number
  addedAt: number
  startedWaitingAt: number
  generation: number
  handle?: RunHandle
  finalPath?: string
  window: { at: number; received: number }[]
}

/**
 * Download lifecycle for arbitrary media URLs via a yt-dlp subprocess. Produces
 * the same pull snapshot shape as the torrent engine and SoulseekDownloads, so
 * all three render in one dashboard. Mirrors SoulseekDownloads: an entry map, a
 * generation counter that invalidates stale async work, and a rolling speed
 * window. yt-dlp must be installed and on PATH (or configured via ytdlp.path).
 */
export class HttpDownloads {
  private readonly entries = new Map<string, HttpEntry>()

  constructor(
    private readonly options: HttpDownloadsOptions,
    private readonly run: RunProcess = defaultRun,
    private readonly probeFn: typeof probeFormats = probeFormats,
  ) {}

  probe(url: string): Promise<YtDlpInfo> {
    return this.probeFn(url, this.options.config)
  }

  defaultFormat(): string {
    return ytdlpDefaultFormat(this.options.config)
  }

  audioFormat(): string {
    return ytdlpAudioFormat(this.options.config)
  }

  add(request: HttpDownloadRequest, addedAt?: number): string {
    const key = httpKey(request.url)
    if (this.entries.has(key)) return key
    const entry: HttpEntry = {
      key,
      url: request.url,
      title: request.title,
      format: request.format,
      extractAudio: request.extractAudio === true,
      audioFormat: request.extractAudio === true ? request.audioFormat ?? this.audioFormat() : undefined,
      audioQuality: request.extractAudio === true ? request.audioQuality : undefined,
      state: "fetching",
      size: request.size ?? 0,
      received: 0,
      addedAt: addedAt ?? Date.now(),
      startedWaitingAt: Date.now(),
      generation: 0,
      window: [],
    }
    this.entries.set(key, entry)
    this.start(entry)
    return key
  }

  pause(key: string): void {
    const entry = this.entries.get(key)
    if (entry === undefined || entry.state === "done" || entry.state === "paused") return
    entry.generation += 1
    entry.handle?.kill()
    entry.handle = undefined
    entry.state = "paused"
    entry.window = []
  }

  resume(key: string): void {
    const entry = this.entries.get(key)
    if (entry?.state !== "paused") return
    entry.state = "fetching"
    entry.startedWaitingAt = Date.now()
    this.start(entry)
  }

  retry(key: string): void {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    if (entry.state !== "error" && entry.state !== "fetching") return
    entry.generation += 1
    entry.handle?.kill()
    entry.handle = undefined
    entry.state = "fetching"
    entry.error = undefined
    entry.startedWaitingAt = Date.now()
    this.start(entry)
  }

  async remove(key: string, opts?: { deleteData?: boolean }): Promise<void> {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    entry.generation += 1
    entry.handle?.kill()
    entry.handle = undefined
    this.entries.delete(key)
    // An in-progress .part has a yt-dlp-chosen name we do not know until it moves,
    // so only a completed file's location is safe to delete.
    if (opts?.deleteData === true && entry.state === "done" && entry.finalPath !== undefined) {
      await rm(entry.finalPath, { force: true }).catch(() => {})
    }
  }

  urlFor(key: string): string | undefined {
    return this.entries.get(key)?.url
  }

  snapshots(): DownloadSnapshot[] {
    const now = Date.now()
    return [...this.entries.values()].map((entry) => {
      const speed = entry.state === "downloading" ? windowSpeed(entry.window, now) : 0
      const remaining = entry.size - entry.received
      return {
        key: entry.key,
        name: entry.title,
        state: entry.state,
        progress: entry.size > 0 ? Math.min(entry.received / entry.size, 1) : 0,
        downloadedBytes: entry.received,
        totalBytes: entry.size,
        downloadSpeed: speed,
        uploadSpeed: 0,
        peers: entry.state === "downloading" ? 1 : 0,
        uploadedBytes: 0,
        ratio: 0,
        seeding: false,
        sequential: false,
        etaSeconds: speed > 0 && remaining > 0 ? Math.round(remaining / speed) : undefined,
        fetchingSeconds:
          entry.state === "fetching" ? Math.max(0, Math.round((now - entry.startedWaitingAt) / 1000)) : undefined,
        files: [],
        ...(entry.error !== undefined ? { error: entry.error } : {}),
        location: entry.finalPath ?? this.options.downloadDir,
      }
    })
  }

  persisted(): PersistedDownload[] {
    return [...this.entries.values()].map((entry) => ({
      magnet: "",
      name: entry.title,
      addedAt: entry.addedAt,
      done: entry.state === "done",
      http: {
        url: entry.url,
        title: entry.title,
        format: entry.format,
        ...(entry.extractAudio
          ? {
              extractAudio: true,
              audioFormat: entry.audioFormat,
              ...(entry.audioQuality !== undefined ? { audioQuality: entry.audioQuality } : {}),
            }
          : {}),
      },
    }))
  }

  keys(): string[] {
    return [...this.entries.keys()]
  }

  async shutdown(): Promise<void> {
    for (const entry of this.entries.values()) {
      entry.generation += 1
      entry.handle?.kill()
      entry.handle = undefined
    }
  }

  private start(entry: HttpEntry): void {
    const generation = entry.generation
    const bin = ytdlpBin(this.options.config)
    const args = buildDownloadArgs(entry.url, entry.format, this.options.downloadDir, {
      extractAudio: entry.extractAudio,
      audioFormat: entry.audioFormat,
      audioQuality: entry.audioQuality,
    })
    let started: ReturnType<RunProcess>
    try {
      started = this.run(bin, args, (line) => {
        if (entry.generation === generation) this.onLine(entry, line)
      })
    } catch (error) {
      entry.state = "error"
      entry.error = error instanceof Error ? error.message : String(error)
      return
    }
    entry.handle = started.handle
    void started.done.then(
      (result) => {
        if (entry.generation !== generation) return
        entry.handle = undefined
        entry.window = []
        if (result.code === 0) {
          entry.state = "done"
          if (entry.size > 0) entry.received = entry.size
        } else {
          entry.state = "error"
          entry.error = firstLine(result.stderr) ?? `yt-dlp exited with code ${result.code}`
        }
      },
      (error) => {
        if (entry.generation !== generation) return
        entry.handle = undefined
        entry.state = "error"
        entry.error = error instanceof Error ? error.message : String(error)
      },
    )
  }

  private onLine(entry: HttpEntry, line: string): void {
    const filepath = parseFilepathLine(line)
    if (filepath !== undefined) {
      entry.finalPath = filepath
      return
    }
    const progress = parseProgressLine(line)
    if (progress === undefined) return
    if (progress.total !== undefined && progress.total > 0) entry.size = progress.total
    if (progress.downloaded !== undefined) entry.received = progress.downloaded
    if (progress.status === "downloading") {
      entry.state = "downloading"
      pushWindow(entry, Date.now())
    }
  }
}

function firstLine(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "")
  return line?.replace(/^ERROR:\s*/i, "")
}

function pushWindow(entry: HttpEntry, now: number): void {
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
