import { createContext, createSignal, onCleanup, useContext, type JSX } from "solid-js"
import { Effect } from "effect"
import type { DownloadSnapshot, Engine, PersistedDownload } from "@corvus/core"
import { infoHashFromMagnet, type Provider, type TorrentResult } from "@corvus/providers"

export interface DownloadsStore {
  readonly snapshots: () => readonly DownloadSnapshot[]
  readonly add: (result: TorrentResult, providers: readonly Provider[]) => Promise<void>
  readonly remove: (key: string) => Promise<void>
}

const DownloadsContext = createContext<DownloadsStore>()

export function DownloadsProvider(props: {
  engine: Engine
  persist: (downloads: readonly PersistedDownload[]) => void
  children: JSX.Element
}) {
  const [snapshots, setSnapshots] = createSignal<readonly DownloadSnapshot[]>(props.engine.snapshots())

  const tick = () => setSnapshots(props.engine.snapshots())
  const interval = setInterval(tick, 1_000)
  onCleanup(() => clearInterval(interval))

  const addedAt = new Map<string, number>()

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
        } satisfies PersistedDownload
      }),
    )
  }

  const add = async (result: TorrentResult, providers: readonly Provider[]) => {
    let magnet = result.magnet
    if (magnet === "") {
      const provider = providers.find((p) => p.name === result.provider)
      if (provider?.resolveMagnet === undefined) return
      try {
        magnet = await Effect.runPromise(provider.resolveMagnet(result))
      } catch {
        return
      }
    }
    if (!addedAt.has(magnet)) addedAt.set(magnet, Date.now())
    props.engine.add(magnet)
    tick()
    persistNow()
  }

  const remove = async (key: string) => {
    await props.engine.remove(key)
    tick()
    persistNow()
  }

  const store: DownloadsStore = { snapshots, add, remove }
  return <DownloadsContext.Provider value={store}>{props.children}</DownloadsContext.Provider>
}

export function useDownloads(): DownloadsStore {
  const store = useContext(DownloadsContext)
  if (store === undefined) throw new Error("useDownloads must be used inside DownloadsProvider")
  return store
}
