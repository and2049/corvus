import { createContext, createSignal, onCleanup, useContext, type JSX } from "solid-js"
import { Effect } from "effect"
import type { DownloadSnapshot, Engine, PersistedDownload } from "@corvus/core"
import {
  buildMagnet,
  DEFAULT_TRACKERS,
  infoHashFromMagnet,
  parseMagnet,
  unionMagnet,
  type Provider,
  type TorrentResult,
} from "@corvus/providers"

export interface DownloadsStore {
  readonly snapshots: () => readonly DownloadSnapshot[]
  readonly add: (result: TorrentResult, providers: readonly Provider[]) => Promise<boolean>
  readonly addMagnet: (magnet: string) => "added" | "duplicate" | "invalid"
  readonly remove: (key: string) => Promise<void>
  readonly togglePause: (key: string) => void
  readonly toggleFile: (key: string, index: number) => void
  readonly retry: (key: string) => Promise<void>
  readonly clientError: () => string | undefined
}

const DownloadsContext = createContext<DownloadsStore>()

export function DownloadsProvider(props: {
  engine: Engine
  persisted?: readonly PersistedDownload[]
  persist: (downloads: readonly PersistedDownload[]) => void
  children: JSX.Element
}) {
  const [snapshots, setSnapshots] = createSignal<readonly DownloadSnapshot[]>(props.engine.snapshots())

  const addedAt = new Map<string, number>()
  for (const download of props.persisted ?? []) {
    addedAt.set(download.magnet, download.addedAt)
  }

  const lastStates = new Map<string, DownloadSnapshot["state"]>()
  const tick = () => {
    const next = props.engine.snapshots()
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
    props.persist(
      props.engine.magnets().map((magnet) => {
        const key = infoHashFromMagnet(magnet) ?? magnet
        const snapshot = snaps.find((s) => s.key === key)
        return {
          magnet,
          name: snapshot?.name ?? key,
          addedAt: addedAt.get(magnet) ?? Date.now(),
          done: snapshot?.state === "done",
          ...(snapshot !== undefined && snapshot.files.length > 0
            ? { deselected: deselectedIndexes(snapshot) }
            : {}),
        } satisfies PersistedDownload
      }),
    )
  }

  const deselectedIndexes = (snapshot: DownloadSnapshot): number[] | undefined => {
    const indexes = snapshot.files.flatMap((file, index) => (file.selected ? [] : [index]))
    return indexes.length === 0 ? undefined : indexes
  }

  const add = async (result: TorrentResult, providers: readonly Provider[]): Promise<boolean> => {
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

  const addMagnet = (raw: string): "added" | "duplicate" | "invalid" => {
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

  const remove = async (key: string) => {
    await props.engine.remove(key)
    tick()
    persistNow()
  }

  const togglePause = (key: string) => {
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

  const retry = async (key: string) => {
    await props.engine.retry(key)
    tick()
    persistNow()
  }

  const store: DownloadsStore = { snapshots, add, addMagnet, remove, togglePause, toggleFile, retry, clientError: () => props.engine.clientError() }
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
