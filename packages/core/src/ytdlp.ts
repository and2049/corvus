import type { YtDlpConfig } from "./config"

export const DEFAULT_YTDLP_BIN = "yt-dlp"
export const DEFAULT_YTDLP_FORMAT = "bestvideo*+bestaudio/best"
export const DEFAULT_YTDLP_AUDIO_FORMAT = "mp3"

// -f expression for audio extraction: best audio-only stream, else the best
// combined stream (whose audio -x will strip out). Generic across every site.
export const AUDIO_FORMAT_EXPR = "bestaudio/best"

// Sentinel prefix on the --print line so the final filepath is unambiguous among
// the warning/progress noise that also arrives on the merged output streams.
export const FILEPATH_SENTINEL = "corvus-filepath:"

// TYPES prefix ("download:") selects the download progress hook and is stripped by
// yt-dlp; only the JSON template is emitted. %s conversions render unknown numeric
// fields as the NA placeholder, so parseProgressLine sanitizes NA -> null.
const PROGRESS_TEMPLATE =
  'download:{"status":"%(progress.status)s","downloaded":%(progress.downloaded_bytes)s,' +
  '"total":%(progress.total_bytes)s,"total_est":%(progress.total_bytes_estimate)s,' +
  '"speed":%(progress.speed)s,"eta":%(progress.eta)s}'

export interface YtDlpFormat {
  readonly formatId: string
  readonly ext: string
  readonly resolution?: string
  readonly height?: number
  readonly fps?: number
  readonly vcodec?: string
  readonly acodec?: string
  readonly filesize?: number
  readonly tbr?: number
  readonly note?: string
  readonly protocol?: string
}

export interface YtDlpInfo {
  readonly url: string
  readonly id: string
  readonly title: string
  readonly duration?: number
  readonly formats: readonly YtDlpFormat[]
}

export interface YtDlpProgress {
  readonly status: string
  readonly downloaded?: number
  readonly total?: number
  readonly speed?: number
  readonly eta?: number
}

export function ytdlpBin(config?: YtDlpConfig): string {
  const path = config?.path?.trim()
  return path !== undefined && path !== "" ? path : DEFAULT_YTDLP_BIN
}

export function ytdlpDefaultFormat(config?: YtDlpConfig): string {
  const format = config?.format?.trim()
  return format !== undefined && format !== "" ? format : DEFAULT_YTDLP_FORMAT
}

export function ytdlpAudioFormat(config?: YtDlpConfig): string {
  const format = config?.audioFormat?.trim()
  return format !== undefined && format !== "" ? format : DEFAULT_YTDLP_AUDIO_FORMAT
}

export function buildProbeArgs(url: string): string[] {
  return ["--no-playlist", "--no-warnings", "--quiet", "-J", url]
}

export interface DownloadArgsOptions {
  readonly extractAudio?: boolean
  readonly audioFormat?: string
  readonly audioQuality?: string
}

export function buildDownloadArgs(
  url: string,
  format: string,
  downloadDir: string,
  opts?: DownloadArgsOptions,
): string[] {
  const args = [
    "--no-playlist",
    "--no-colors",
    "--newline",
    "--progress",
    "--progress-delta",
    "0.5",
    "--progress-template",
    PROGRESS_TEMPLATE,
    "--print",
    `after_move:${FILEPATH_SENTINEL}%(filepath)s`,
    "-P",
    downloadDir,
    "-o",
    "%(title)s [%(id)s].%(ext)s",
    "-f",
    format,
  ]
  // Extract the audio track and (via ffmpeg) convert it to a common audio
  // container. yt-dlp rewrites %(ext)s to the audio format for the -o/print.
  if (opts?.extractAudio === true) {
    args.push("-x", "--audio-format", opts.audioFormat ?? DEFAULT_YTDLP_AUDIO_FORMAT)
    // --audio-quality only affects lossy re-encodes; the UI omits it otherwise.
    if (opts.audioQuality !== undefined && opts.audioQuality !== "") {
      args.push("--audio-quality", opts.audioQuality)
    }
  }
  args.push(url)
  return args
}

/**
 * Resolves the yt-dlp -f expression for a chosen format. A video-only stream
 * (has a video codec but no audio) gets bestaudio muxed in, so picking "1080p"
 * from a DASH site does not silently produce a mute file.
 */
export function resolveFormatExpr(format: YtDlpFormat): string {
  const videoOnly = isPresent(format.vcodec) && !isPresent(format.acodec)
  return videoOnly ? `${format.formatId}+bestaudio/${format.formatId}` : format.formatId
}

function isPresent(codec: string | undefined): boolean {
  return codec !== undefined && codec !== "" && codec !== "none"
}

export function parseInfoJson(json: string): YtDlpInfo {
  const data: unknown = JSON.parse(json)
  if (typeof data !== "object" || data === null) throw new Error("unexpected yt-dlp output")
  let record = data as Record<string, unknown>
  // --no-playlist should already collapse to a single video; guard anyway.
  if (!Array.isArray(record["formats"]) && Array.isArray(record["entries"])) {
    const first = record["entries"][0]
    if (typeof first === "object" && first !== null) record = first as Record<string, unknown>
  }
  const id = str(record["id"]) ?? ""
  const title = str(record["title"]) ?? str(record["id"]) ?? "untitled"
  const url = str(record["webpage_url"]) ?? str(record["original_url"]) ?? ""
  const rawFormats = Array.isArray(record["formats"]) ? record["formats"] : []
  const formats: YtDlpFormat[] = []
  for (const raw of rawFormats) {
    const format = parseFormat(raw)
    if (format !== undefined) formats.push(format)
  }
  // yt-dlp lists worst -> best; reverse so the picker highlights the best first.
  formats.reverse()
  return { url, id, title, duration: num(record["duration"]), formats }
}

function parseFormat(raw: unknown): YtDlpFormat | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const formatId = str(record["format_id"])
  if (formatId === undefined || formatId === "") return undefined
  // Manifests with no real streams (storyboards) carry no useful download.
  if (str(record["vcodec"]) === "none" && str(record["acodec"]) === "none" && num(record["filesize"]) === undefined) {
    // keep audio/video-less entries out only when they are clearly non-media
    if (str(record["ext"]) === "mhtml") return undefined
  }
  return {
    formatId,
    ext: str(record["ext"]) ?? "",
    resolution: str(record["resolution"]),
    height: num(record["height"]),
    fps: num(record["fps"]),
    vcodec: str(record["vcodec"]),
    acodec: str(record["acodec"]),
    filesize: num(record["filesize"]) ?? num(record["filesize_approx"]),
    tbr: num(record["tbr"]),
    note: str(record["format_note"]),
    protocol: str(record["protocol"]),
  }
}

export function parseProgressLine(line: string): YtDlpProgress | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{")) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.replace(/:NA(?=[,}])/g, ":null"))
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  const status = str(record["status"])
  if (status === undefined) return undefined
  return {
    status,
    downloaded: num(record["downloaded"]),
    total: num(record["total"]) ?? num(record["total_est"]),
    speed: num(record["speed"]),
    eta: num(record["eta"]),
  }
}

export function parseFilepathLine(line: string): string | undefined {
  const trimmed = line.trim()
  return trimmed.startsWith(FILEPATH_SENTINEL) ? trimmed.slice(FILEPATH_SENTINEL.length) : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export interface RunHandle {
  kill(): void
}

export interface RunResult {
  readonly code: number
  readonly stderr: string
}

/**
 * Runs a process, forwarding every stdout+stderr line to onLine, and resolving
 * with the exit code plus accumulated stderr (for error reporting). Injectable so
 * the download backend is testable without spawning a real yt-dlp.
 */
export type RunProcess = (
  bin: string,
  args: readonly string[],
  onLine: (line: string) => void,
) => { handle: RunHandle; done: Promise<RunResult> }

export const defaultRun: RunProcess = (bin, args, onLine) => {
  const child = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" })
  const stderrChunks: string[] = []
  const stdout = pumpLines(child.stdout, onLine)
  const stderr = pumpLines(child.stderr, (line) => {
    stderrChunks.push(line)
    onLine(line)
  })
  const done = (async (): Promise<RunResult> => {
    const code = await child.exited
    await Promise.all([stdout, stderr])
    return { code, stderr: stderrChunks.slice(-40).join("\n") }
  })()
  return { handle: { kill: () => child.kill() }, done }
}

export type CaptureProcess = (bin: string, args: readonly string[]) => Promise<RunResult & { stdout: string }>

const defaultCapture: CaptureProcess = async (bin, args) => {
  const child = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, stdout, stderr }
}

/** Spawns `yt-dlp -J` and parses the available formats. Throws on failure. */
export async function probeFormats(
  url: string,
  config?: YtDlpConfig,
  capture: CaptureProcess = defaultCapture,
): Promise<YtDlpInfo> {
  let result: RunResult & { stdout: string }
  try {
    result = await capture(ytdlpBin(config), buildProbeArgs(url))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("yt-dlp not found - install it and ensure it is on your PATH")
    }
    throw error instanceof Error ? error : new Error(String(error))
  }
  if (result.code !== 0) {
    const reason = firstErrorLine(result.stderr) ?? `exited with code ${result.code}`
    throw new Error(reason)
  }
  return parseInfoJson(result.stdout)
}

function firstErrorLine(stderr: string): string | undefined {
  const line = stderr
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "")
  if (line === undefined) return undefined
  return line.replace(/^ERROR:\s*/i, "")
}

async function pumpLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ""
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf("\n")
      while (index !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, "")
        if (line !== "") onLine(line)
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf("\n")
      }
    }
  } finally {
    reader.releaseLock()
  }
  const tail = buffer.replace(/\r$/, "")
  if (tail !== "") onLine(tail)
}
