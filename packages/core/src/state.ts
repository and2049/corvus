import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

export interface PersistedSlskFile {
  readonly username: string
  readonly path: string
  readonly size: number
}

export interface PersistedHttpDownload {
  readonly url: string
  readonly title: string
  readonly format: string
  readonly extractAudio?: boolean
  readonly audioFormat?: string
  readonly audioQuality?: string
}

export interface PersistedDownload {
  readonly magnet: string
  readonly name: string
  readonly addedAt: number
  readonly done: boolean
  readonly deselected?: readonly number[]
  readonly slsk?: PersistedSlskFile
  readonly http?: PersistedHttpDownload
}

export async function loadDownloads(filePath: string): Promise<PersistedDownload[]> {
  let raw: string | undefined
  try {
    raw = await readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return []
  }
  if (raw === undefined || raw.trim() === "") return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []
  const out: PersistedDownload[] = []
  for (const item of parsed) {
    if (!isPersistedDownload(item)) continue
    out.push(item)
  }
  return out
}

function isPersistedSlskFile(value: unknown): value is PersistedSlskFile {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record["username"] === "string" &&
    record["username"] !== "" &&
    typeof record["path"] === "string" &&
    record["path"] !== "" &&
    typeof record["size"] === "number"
  )
}

function isPersistedHttpDownload(value: unknown): value is PersistedHttpDownload {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  if (record["extractAudio"] !== undefined && typeof record["extractAudio"] !== "boolean") return false
  if (record["audioFormat"] !== undefined && typeof record["audioFormat"] !== "string") return false
  if (record["audioQuality"] !== undefined && typeof record["audioQuality"] !== "string") return false
  return (
    typeof record["url"] === "string" &&
    record["url"] !== "" &&
    typeof record["title"] === "string" &&
    typeof record["format"] === "string" &&
    record["format"] !== ""
  )
}

function isPersistedDownload(value: unknown): value is PersistedDownload {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  if (
    typeof record["magnet"] !== "string" ||
    typeof record["name"] !== "string" ||
    typeof record["addedAt"] !== "number" ||
    typeof record["done"] !== "boolean"
  ) {
    return false
  }
  // A magnet identifies a torrent download; a slsk block a soulseek one; an http
  // block a yt-dlp one. Entries with none are dropped (also rejects pre-slsk empty
  // magnets).
  if (
    record["magnet"] === "" &&
    !isPersistedSlskFile(record["slsk"]) &&
    !isPersistedHttpDownload(record["http"])
  ) {
    return false
  }
  if (record["slsk"] !== undefined && !isPersistedSlskFile(record["slsk"])) return false
  if (record["http"] !== undefined && !isPersistedHttpDownload(record["http"])) return false
  const deselected = record["deselected"]
  if (deselected === undefined) return true
  return Array.isArray(deselected) && deselected.every((index) => typeof index === "number" && Number.isInteger(index) && index >= 0)
}

export class DownloadsFile {
  private dirty = false
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly filePath: string,
    flushIntervalMs = 5_000,
  ) {
    this.timer = setInterval(() => void this.flushIfDirty(), flushIntervalMs)
    this.timer.unref?.()
  }

  set(downloads: readonly PersistedDownload[]): void {
    this.pending = downloads
    this.dirty = true
  }

  private pending: readonly PersistedDownload[] = []

  async flush(): Promise<void> {
    if (!this.dirty) return
    const data = this.pending
    this.dirty = false
    try {
      await writeFileAtomic(this.filePath, JSON.stringify(data, null, 2))
    } catch (error) {
      this.dirty = true
      throw error
    }
  }

  private async flushIfDirty(): Promise<void> {
    try {
      await this.flush()
    } catch {
      // retried on the next tick or at close
    }
  }

  async close(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    await this.flush()
  }
}

async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.tmp`
  await writeFile(tmpPath, contents, "utf8")
  await rename(tmpPath, filePath)
}
