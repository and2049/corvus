import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

export interface PersistedDownload {
  readonly magnet: string
  readonly name: string
  readonly addedAt: number
  readonly done: boolean
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

function isPersistedDownload(value: unknown): value is PersistedDownload {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record["magnet"] === "string" &&
    record["magnet"] !== "" &&
    typeof record["name"] === "string" &&
    typeof record["addedAt"] === "number" &&
    typeof record["done"] === "boolean"
  )
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
