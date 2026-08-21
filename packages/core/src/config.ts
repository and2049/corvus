import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse } from "yaml"

export interface ProviderConfig {
  readonly enabled?: boolean
  readonly type?: string
  readonly baseUrl?: string
  readonly baseUrls?: readonly string[]
  readonly searchUrl?: string
}

export type ProvidersConfig = Readonly<Record<string, ProviderConfig | undefined>>

export interface CorvusConfig {
  readonly downloadDir: string
  readonly seedAfterComplete: boolean
  readonly searchTimeoutMs: number
  readonly hideNSFW: boolean
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

function deepMerge<T>(base: T, patch: unknown): T {
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
