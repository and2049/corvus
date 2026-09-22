import { chmod, mkdir, mkdtemp, rename, rm } from "node:fs/promises"
import path from "node:path"
import { configDir, type YtDlpConfig } from "./config"

export type MediaTool = "yt-dlp" | "ffmpeg" | "ffprobe"
export interface MediaTools {
  readonly ytdlp: string
  readonly env: NodeJS.ProcessEnv
}
export type PrepareMediaTools = (config?: YtDlpConfig) => Promise<MediaTools>

interface ToolSource {
  readonly url: string
}

// Standalone executables: no Python, archive extractor, or package manager needed.
// ffmpeg-static publishes ffmpeg and ffprobe separately, including native macOS ARM.
export function mediaToolSource(tool: MediaTool, platform: string, arch: string): ToolSource {
  if (!((platform === "linux" || platform === "darwin") && (arch === "x64" || arch === "arm64")) &&
      !(platform === "win32" && arch === "x64")) {
    throw new Error(`automatic ${tool} setup is unavailable for ${platform}/${arch}; install it on PATH`)
  }
  if (tool === "yt-dlp") {
    const asset = platform === "win32" ? "yt-dlp.exe"
      : platform === "darwin" ? "yt-dlp_macos"
      : arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux"
    return { url: `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}` }
  }
  return { url: `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/${tool}-${platform}-${arch}` }
}

export interface MediaToolsOptions {
  readonly directory?: string
  readonly platform?: string
  readonly arch?: string
  readonly env?: NodeJS.ProcessEnv
  readonly which?: (name: string) => string | null
  readonly install?: (tool: MediaTool, url: string, destination: string, status: (message: string) => void) => Promise<void>
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
  readonly onStatus?: (message: string | undefined) => void
}

// Share installations between simultaneous probes/downloads. Failed attempts are
// removed so the next request can retry; only complete executables enter the cache.
const installing = new Map<string, Promise<void>>()

export function createMediaTools(options: MediaToolsOptions = {}): PrepareMediaTools {
  const directory = options.directory ?? path.join(configDir(), "tools")
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const env = options.env ?? process.env
  const which = options.which ?? ((name: string) => Bun.which(name, { PATH: env.PATH ?? env.Path ?? "" }))
  const install = options.install ?? ((tool, url, destination, status) => installTool(tool, url, destination, status, options.fetch ?? fetch))
  const pending = new Map<string, Promise<MediaTools>>()

  async function resolve(config?: YtDlpConfig): Promise<MediaTools> {
    const resolved = new Map<MediaTool, string>()
    const custom = config?.path?.trim()
    if (custom) {
      const found = which(custom)
      if (!found) throw new Error(`configured yt-dlp not found: ${custom}`)
      resolved.set("yt-dlp", found)
    }
    for (const tool of ["yt-dlp", "ffmpeg", "ffprobe"] as const) {
      if (resolved.has(tool)) continue
      // Always prefer PATH, even if an older managed copy is already cached.
      const system = which(tool)
      if (system) {
        resolved.set(tool, system)
        continue
      }
      const destination = path.join(directory, `${tool}${platform === "win32" ? ".exe" : ""}`)
      if (!which(destination)) {
        const source = mediaToolSource(tool, platform, arch)
        options.onStatus?.(`setting up ${tool}...`)
        let task = installing.get(destination)
        if (!task) {
          task = install(tool, source.url, destination, (message) => options.onStatus?.(message))
          installing.set(destination, task)
        }
        try {
          await task
        } catch (error) {
          throw new Error(`${tool} setup failed: ${error instanceof Error ? error.message : String(error)}. Retry or install ${tool} on PATH`)
        } finally {
          if (installing.get(destination) === task) installing.delete(destination)
        }
      }
      resolved.set(tool, destination)
    }
    // Append the cache so system tools still win when only one dependency was
    // missing. This environment is used only by media subprocesses.
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH"
    const separator = platform === "win32" ? ";" : ":"
    return {
      ytdlp: resolved.get("yt-dlp")!,
      env: { ...env, [pathKey]: [env[pathKey], directory].filter(Boolean).join(separator) },
    }
  }

  return (config) => {
    const key = config?.path?.trim() ?? ""
    let task = pending.get(key)
    if (!task) {
      task = resolve(config).finally(() => {
        pending.delete(key)
        if (pending.size === 0) options.onStatus?.(undefined)
      })
      pending.set(key, task)
    }
    return task
  }
}

async function installTool(
  tool: MediaTool,
  url: string,
  destination: string,
  status: (message: string) => void,
  fetchTool: (url: string, init: RequestInit) => Promise<Response>,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = await mkdtemp(path.join(path.dirname(destination), ".install-"))
  const file = path.join(temporary, path.basename(destination))
  try {
    const response = await fetchTool(url, { signal: AbortSignal.timeout(300_000) })
    if (!response.ok || !response.body) throw new Error(`download returned HTTP ${response.status}`)
    const total = Number(response.headers.get("content-length"))
    let received = 0
    let lastUpdate = 0
    const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength
        if (Date.now() - lastUpdate > 250) {
          const progress = total > 0 ? `${Math.floor(received / total * 100)}%` : `${Math.floor(received / 1_048_576)} MiB`
          status(`downloading ${tool} · ${progress}`)
          lastUpdate = Date.now()
        }
        controller.enqueue(chunk)
      },
    }))
    await Bun.write(file, new Response(stream))
    await chmod(file, 0o755)
    status(`checking ${tool}...`)
    const child = Bun.spawn([file, tool === "yt-dlp" ? "--version" : "-version"], {
      stdout: "ignore", stderr: "pipe", stdin: "ignore",
    })
    const timeout = setTimeout(() => child.kill(), 15_000)
    try {
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
      if (code !== 0) throw new Error(`downloaded binary could not run (${code}): ${stderr.trim().slice(0, 300)}`)
    } finally {
      clearTimeout(timeout)
    }
    await rename(file, destination)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
