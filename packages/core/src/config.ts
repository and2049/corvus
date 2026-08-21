import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse, parseDocument } from "yaml"

export interface ProviderConfig {
  readonly enabled?: boolean
  readonly type?: string
  readonly baseUrl?: string
  readonly baseUrls?: readonly string[]
  readonly searchUrl?: string
  readonly username?: string
  readonly password?: string
  readonly listenPort?: number
}

export type ProvidersConfig = Readonly<Record<string, ProviderConfig | undefined>>

export interface CloudflareCredential {
  readonly cookie: string
  readonly userAgent?: string
}

export type CloudflareConfig = Readonly<Record<string, CloudflareCredential>>

export interface CorvusConfig {
  readonly downloadDir: string
  readonly seedAfterComplete: boolean
  readonly searchTimeoutMs: number
  readonly hideNSFW: boolean
  readonly proxy?: string
  readonly torrentPort?: number
  readonly maxConns?: number
  readonly cloudflare?: CloudflareConfig
  readonly providers: ProvidersConfig
}

export function defaultConfig(): CorvusConfig {
  return {
    downloadDir: path.join(os.homedir(), "Downloads", "corvus"),
    seedAfterComplete: false,
    searchTimeoutMs: 15_000,
    hideNSFW: true,
    providers: {
      knaben: { enabled: true },
      yts: { enabled: true },
      nyaa: { enabled: true },
      eztv: { enabled: true },
      x1337: { enabled: true },
      soulseek: { enabled: false, username: "", password: "" },
    },
  }
}

export function configDir(): string {
  return path.join(os.homedir(), ".corvus")
}

export function configPath(): string {
  return path.join(configDir(), "config.yaml")
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) {
    return patch === undefined ? base : (patch as T)
  }
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    out[key] = deepMerge((base as Record<string, unknown>)[key], value)
  }
  return out as T
}

export async function loadConfig(filePath: string = configPath()): Promise<CorvusConfig> {
  let raw: string | undefined
  try {
    raw = await readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return defaultConfig()
  }
  if (raw === undefined || raw.trim() === "") return defaultConfig()
  return deepMerge(defaultConfig(), parse(raw))
}

export type ConfigPatch = Record<string, unknown>

function leafPaths(patch: unknown, prefix: readonly string[] = []): [string[], unknown][] {
  if (!isPlainObject(patch)) return [[[...prefix], patch]]
  const out: [string[], unknown][] = []
  for (const [key, value] of Object.entries(patch)) {
    out.push(...leafPaths(value, [...prefix, key]))
  }
  return out
}

// Writes changed keys back into config.yaml while preserving comments, formatting
// and untouched keys (via the yaml Document API). Refuses symlinked/non-regular
// files and writes atomically. Undefined leaf values delete the key.
//
// Calls are serialized through a single chain so overlapping saves (e.g. toggling
// two sources in quick succession) each read the latest file state instead of
// racing on a stale read-modify-write or a shared temp file.
let saveChain: Promise<void> = Promise.resolve()

export function saveConfig(patch: ConfigPatch, filePath: string = configPath()): Promise<void> {
  const run = (): Promise<void> => doSaveConfig(patch, filePath)
  const next = saveChain.then(run, run)
  saveChain = next.catch(() => {})
  return next
}

async function doSaveConfig(patch: ConfigPatch, filePath: string): Promise<void> {
  let raw = ""
  try {
    const stats = await lstat(filePath)
    if (!stats.isFile()) {
      throw new Error(`refusing to write non-regular config file: ${filePath}`)
    }
    raw = await readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const doc = parseDocument(raw)
  for (const [keyPath, value] of leafPaths(patch)) {
    if (keyPath.length === 0) continue
    if (value === undefined) doc.deleteIn(keyPath)
    else doc.setIn(keyPath, value)
  }
  await writeConfigAtomic(filePath, String(doc))
}

let tmpCounter = 0

async function writeConfigAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${(tmpCounter += 1)}.tmp`
  await writeFile(tmpPath, contents, "utf8")
  await rename(tmpPath, filePath)
}
