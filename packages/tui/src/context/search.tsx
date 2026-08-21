import { createContext, createSignal, useContext, type JSX } from "solid-js"
import { Effect, Stream } from "effect"
import {
  ContentFilter,
  createProviders,
  mergeInto,
  rankResults,
  searchAll,
  type Provider,
  type SearchEvent,
  type SortMode,
  type TorrentResult,
} from "@corvus/providers"

export interface ProviderStatus {
  readonly state: "pending" | "done" | "error"
  readonly message?: string
}

const SORT_MODES: readonly SortMode[] = ["relevance", "seeders", "size"]

export interface SearchStore {
  readonly query: () => string
  readonly running: () => boolean
  readonly results: () => readonly TorrentResult[]
  readonly hiddenCount: () => number
  readonly showHidden: () => boolean
  readonly toggleHidden: () => void
  readonly sortMode: () => SortMode
  readonly cycleSort: () => void
  readonly statuses: () => Readonly<Record<string, ProviderStatus>>
  readonly providers: () => readonly Provider[]
  readonly run: (query: string) => void
  readonly reset: () => void
}

const SearchContext = createContext<SearchStore>()

export function SearchProvider(props: {
  providers: readonly Provider[]
  filter?: ContentFilter
  timeoutMs?: number
  children: JSX.Element
}) {
  const [query, setQuery] = createSignal("")
  const [running, setRunning] = createSignal(false)
  const [visible, setVisible] = createSignal<readonly TorrentResult[]>([])
  const [hidden, setHidden] = createSignal<readonly TorrentResult[]>([])
  const [showHidden, setShowHidden] = createSignal(false)
  const [sortMode, setSortMode] = createSignal<SortMode>("relevance")
  const [statuses, setStatuses] = createSignal<Readonly<Record<string, ProviderStatus>>>({})

  const resultsMap = new Map<string, TorrentResult>()
  let generation = 0

  const publish = () => {
    const ranked = rankResults([...resultsMap.values()], query(), {
      mode: sortMode(),
      hideNonMatches: true,
    })
    setVisible(ranked.visible)
    setHidden(ranked.hidden)
  }

  const results = (): readonly TorrentResult[] =>
    showHidden() ? [...visible(), ...hidden()] : visible()

  const toggleHidden = () => setShowHidden((v) => !v)
  const cycleSort = () => {
    setSortMode((m) => SORT_MODES[(SORT_MODES.indexOf(m) + 1) % SORT_MODES.length]!)
    publish()
  }

  const handleEvent = (event: SearchEvent) => {
    if (event.type === "result") {
      if (props.filter !== undefined && !props.filter.allow(query(), event.result)) return
      mergeInto(resultsMap, event.result)
      publish()
      return
    }
    if (event.type === "provider-done") {
      setStatuses({ ...statuses(), [event.provider]: { state: "done" } })
      return
    }
    setStatuses({ ...statuses(), [event.provider]: { state: "error", message: event.message } })
  }

  const run = (rawQuery: string) => {
    const query = rawQuery.trim()
    if (query === "") return
    generation += 1
    const gen = generation
    resultsMap.clear()
    setQuery(query)
    setVisible([])
    setHidden([])
    setRunning(true)
    setStatuses(Object.fromEntries(props.providers.map((provider) => [provider.name, { state: "pending" as const }])))
    Effect.runPromise(
      Stream.runForEach(searchAll(props.providers, query, props.timeoutMs), (event) =>
        Effect.sync(() => {
          if (gen === generation) handleEvent(event)
        }),
      ),
    ).then(
      () => {
        if (gen === generation) setRunning(false)
      },
      () => {
        if (gen === generation) setRunning(false)
      },
    )
  }

  const reset = () => {
    generation += 1
    resultsMap.clear()
    setQuery("")
    setVisible([])
    setHidden([])
    setShowHidden(false)
    setStatuses({})
    setRunning(false)
  }

  const store: SearchStore = {
    query,
    running,
    results,
    hiddenCount: () => hidden().length,
    showHidden,
    toggleHidden,
    sortMode,
    cycleSort,
    statuses,
    providers: () => props.providers,
    run,
    reset,
  }
  return <SearchContext.Provider value={store}>{props.children}</SearchContext.Provider>
}

export function useSearch(): SearchStore {
  const store = useContext(SearchContext)
  if (store === undefined) throw new Error("useSearch must be used inside SearchProvider")
  return store
}

// For chrome (footer) that renders in test harnesses without the full provider tree.
export function useSearchOptional(): SearchStore | undefined {
  return useContext(SearchContext)
}

export { createProviders }
