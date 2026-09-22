import { createContext, createSignal, onCleanup, useContext, type JSX } from "solid-js"
import { Effect } from "effect"
import {
  AUDIO_FORMAT_EXPR,
  DEFAULT_YTDLP_AUDIO_FORMAT,
  looksLikeTorrentInput,
  magnetFromTorrentInput,
  resolveFormatExpr,
} from "@corvus/core"
import type {
  DownloadSnapshot,
  Engine,
  HttpDownloads,
  PersistedDownload,
  SoulseekDownloads,
  YtDlpFormat,
  YtDlpInfo,
} from "@corvus/core"
import {
  buildMagnet,
  DEFAULT_TRACKERS,
  infoHashFromMagnet,
  parseMagnet,
  unionMagnet,
  type Provider,
  type TorrentResult,
} from "@corvus/providers"

export type AddOutcome = "added" | "duplicate" | "invalid"

export type ProbeOutcome = { info: YtDlpInfo } | { error: string }

// The chosen yt-dlp audio-extraction target. `format` is the --audio-format
// container (mp3/flac/best/...); `quality` is --audio-quality for lossy re-encodes.
export interface AudioSpec {
  readonly format: string
  readonly quality?: string
}

export interface DownloadsStore {
  readonly snapshots: () => readonly DownloadSnapshot[]
  readonly add: (result: TorrentResult, providers: readonly Provider[]) => Promise<boolean>
  readonly addMagnet: (magnet: string) => AddOutcome
  readonly addInput: (raw: string) => Promise<AddOutcome>
  readonly probeHttp: (url: string) => Promise<ProbeOutcome>
  readonly addHttp: (info: YtDlpInfo, format: YtDlpFormat | undefined, audio?: AudioSpec) => AddOutcome
  readonly addHttpPreset: (info: YtDlpInfo, request: { format: string; extractAudio?: boolean; audioFormat?: string; audioQuality?: string }) => AddOutcome
  readonly audioFormat: () => string
  readonly toolStatus: () => string | undefined
  readonly remove: (key: string, opts?: { deleteData?: boolean }) => Promise<void>
  readonly togglePause: (key: string) => void
  readonly toggleFile: (key: string, index: number) => void
  readonly selectFiles: (key: string, all: boolean) => void
  readonly toggleSeed: (key: string) => void
  readonly toggleSequential: (key: string) => void
  readonly retry: (key: string) => Promise<void>
  readonly magnetFor: (key: string) => string | undefined
  readonly clientError: () => string | undefined
}

const DownloadsContext = createContext<DownloadsStore>()

export function DownloadsProvider(props: {
  engine: Engine
  slsk?: SoulseekDownloads
  http?: HttpDownloads
  persisted?: readonly PersistedDownload[]
  persist: (downloads: readonly PersistedDownload[]) => void
  children: JSX.Element
}) {
  const allSnapshots = (): DownloadSnapshot[] => [
    ...props.engine.snapshots(),
    ...(props.slsk?.snapshots() ?? []),
    ...(props.http?.snapshots() ?? []),
  ]
  const [snapshots, setSnapshots] = createSignal<readonly DownloadSnapshot[]>(allSnapshots())
  const [toolStatus, setToolStatus] = createSignal<string | undefined>(props.http?.toolStatus())

  const addedAt = new Map<string, number>()
  for (const download of props.persisted ?? []) {
    addedAt.set(download.magnet, download.addedAt)
  }

  const lastStates = new Map<string, DownloadSnapshot["state"]>()
  const tick = () => {
    setToolStatus(props.http?.toolStatus())
    const next = allSnapshots()
    setSnapshots(next)
    let changed = false
    for (const snapshot of next) {
      if (lastStates.get(snapshot.key) !== snapshot.state) {
        lastStates.set(snapshot.key, snapshot.state)
        changed = true
      }
    }
    if (changed) persistNow()
  }
  const interval = setInterval(tick, 1_000)
  onCleanup(() => clearInterval(interval))

  const persistNow = () => {
    const snaps = props.engine.snapshots()
    const torrents = props.engine.magnets().map((magnet) => {
      const key = infoHashFromMagnet(magnet) ?? magnet
      const snapshot = snaps.find((s) => s.key === key)
      return {
        magnet,
        name: snapshot?.name ?? key,
        addedAt: addedAt.get(magnet) ?? Date.now(),
        done: snapshot?.state === "done",
        ...(snapshot?.seeding ? { seed: true } : {}),
        ...(snapshot !== undefined && snapshot.files.length > 0
          ? { deselected: deselectedIndexes(snapshot) }
          : {}),
      } satisfies PersistedDownload
    })
    props.persist([...torrents, ...(props.slsk?.persisted() ?? []), ...(props.http?.persisted() ?? [])])
  }

  const deselectedIndexes = (snapshot: DownloadSnapshot): number[] | undefined => {
    const indexes = snapshot.files.flatMap((file, index) => (file.selected ? [] : [index]))
    return indexes.length === 0 ? undefined : indexes
  }

  const add = async (result: TorrentResult, providers: readonly Provider[]): Promise<boolean> => {
    if (result.slsk !== undefined) {
      const slsk = props.slsk
      if (slsk === undefined || !slsk.canDownload()) return false
      slsk.add(result.slsk)
      tick()
      persistNow()
      return true
    }
    let magnet = result.magnet
    if (magnet === "") {
      const provider = providers.find((p) => p.name === result.provider)
      if (provider?.resolveMagnet === undefined) return false
      try {
        magnet = await Effect.runPromise(provider.resolveMagnet(result))
      } catch {
        return false
      }
    }
    if (!addedAt.has(magnet)) addedAt.set(magnet, Date.now())
    props.engine.add(magnet)
    tick()
    persistNow()
    return true
  }

  const addMagnet = (raw: string): AddOutcome => {
    const magnet = raw.trim()
    const parsed = parseMagnet(magnet)
    if (parsed === undefined) return "invalid"
    if (props.engine.keys().includes(parsed.infoHash)) return "duplicate"
    // Bare pastes often carry no trackers; merge in the defaults so they don't sit on DHT alone.
    const withTrackers = unionMagnet(magnet, buildMagnet(parsed.infoHash, "", DEFAULT_TRACKERS))
    if (!addedAt.has(withTrackers)) addedAt.set(withTrackers, Date.now())
    props.engine.add(withTrackers)
    tick()
    persistNow()
    return "added"
  }

  const addInput = async (raw: string): Promise<AddOutcome> => {
    const text = raw.trim()
    if (looksLikeTorrentInput(text)) {
      const magnet = await magnetFromTorrentInput(text)
      if (magnet === undefined) return "invalid"
      return addMagnet(magnet)
    }
    return addMagnet(text)
  }

  const probeHttp = async (url: string): Promise<ProbeOutcome> => {
    if (props.http === undefined) return { error: "yt-dlp backend unavailable" }
    try {
      return { info: await props.http.probe(url.trim()) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  const addHttp = (info: YtDlpInfo, format: YtDlpFormat | undefined, audio?: AudioSpec): AddOutcome => {
    const http = props.http
    if (http === undefined) return "invalid"
    if (http.keys().includes(`http:${info.url}`)) return "duplicate"
    if (audio !== undefined) {
      // Audio extraction ignores the highlighted video format: it pulls the best
      // audio and (via yt-dlp -x) re-encodes it to the chosen container/quality.
      http.add({
        url: info.url,
        title: info.title,
        format: AUDIO_FORMAT_EXPR,
        extractAudio: true,
        audioFormat: audio.format,
        audioQuality: audio.quality,
      })
    } else {
      if (format === undefined) return "invalid"
      http.add({ url: info.url, title: info.title, format: resolveFormatExpr(format), size: format.filesize })
    }
    tick()
    persistNow()
    return "added"
  }

  const audioFormat = (): string => props.http?.audioFormat() ?? DEFAULT_YTDLP_AUDIO_FORMAT

  const addHttpPreset: DownloadsStore["addHttpPreset"] = (info, request) => {
    if (!props.http) return "invalid"
    if (props.http.keys().includes(`http:${info.url}`)) return "duplicate"
    props.http.add({ url: info.url, title: info.title, ...request })
    tick()
    persistNow()
    return "added"
  }

  const remove = async (key: string, opts?: { deleteData?: boolean }) => {
    if (key.startsWith("slsk:")) await props.slsk?.remove(key, opts)
    else if (key.startsWith("http:")) await props.http?.remove(key, opts)
    else await props.engine.remove(key, opts)
    tick()
    persistNow()
  }

  const togglePause = (key: string) => {
    if (key.startsWith("slsk:")) {
      const state = props.slsk?.snapshots().find((s) => s.key === key)?.state
      if (state === "paused") props.slsk?.resume(key)
      else props.slsk?.pause(key)
      tick()
      return
    }
    if (key.startsWith("http:")) {
      const state = props.http?.snapshots().find((s) => s.key === key)?.state
      if (state === "paused") props.http?.resume(key)
      else props.http?.pause(key)
      tick()
      return
    }
    const snapshot = props.engine.snapshots().find((s) => s.key === key)
    if (snapshot?.state === "paused") {
      props.engine.resume(key)
    } else {
      props.engine.pause(key)
    }
    tick()
  }

  const toggleFile = (key: string, index: number) => {
    props.engine.toggleFile(key, index)
    tick()
    persistNow()
  }

  const isTorrent = (key: string) => !key.startsWith("slsk:") && !key.startsWith("http:")

  const selectFiles = (key: string, all: boolean) => {
    if (!isTorrent(key)) return
    if (all) props.engine.selectAll(key)
    else props.engine.selectNone(key)
    tick()
    persistNow()
  }

  const toggleTorrentFlag = (key: string, flag: "seeding" | "sequential") => {
    if (!isTorrent(key)) return
    const next = props.engine.snapshots().find((s) => s.key === key)?.[flag] !== true
    if (flag === "seeding") props.engine.setSeed(key, next)
    else props.engine.setSequential(key, next)
    tick()
    persistNow()
  }

  const toggleSeed = (key: string) => toggleTorrentFlag(key, "seeding")
  const toggleSequential = (key: string) => toggleTorrentFlag(key, "sequential")

  const retry = async (key: string) => {
    if (key.startsWith("slsk:")) await props.slsk?.retry(key)
    else if (key.startsWith("http:")) props.http?.retry(key)
    else await props.engine.retry(key)
    tick()
    persistNow()
  }

  const magnetFor = (key: string): string | undefined => {
    if (key.startsWith("slsk:")) {
      const file = props.slsk?.fileFor(key)
      return file === undefined ? undefined : `${file.username}\\${file.path}`
    }
    if (key.startsWith("http:")) return props.http?.urlFor(key)
    return props.engine.magnetFor(key)
  }

  const store: DownloadsStore = {
    snapshots,
    add,
    addMagnet,
    addInput,
    probeHttp,
    addHttpPreset,
    toolStatus,
    addHttp,
    audioFormat,
    remove,
    togglePause,
    toggleFile,
    selectFiles,
    toggleSeed,
    toggleSequential,
    retry,
    magnetFor,
    clientError: () => props.engine.clientError(),
  }
  return <DownloadsContext.Provider value={store}>{props.children}</DownloadsContext.Provider>
}

export function useDownloads(): DownloadsStore {
  const store = useContext(DownloadsContext)
  if (store === undefined) throw new Error("useDownloads must be used inside DownloadsProvider")
  return store
}

// For chrome (footer) that renders in test harnesses without the full provider tree.
export function useDownloadsOptional(): DownloadsStore | undefined {
  return useContext(DownloadsContext)
}
