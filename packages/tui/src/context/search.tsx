import { createContext, createSignal, useContext, type JSX } from "solid-js"
import { Effect, Stream } from "effect"
import {
  ContentFilter,
  createProviders,
  mergeInto,
  searchAll,
  type Provider,
  type SearchEvent,
  type TorrentResult,
} from "@corvus/providers"

export interface ProviderStatus {
  readonly state: "pending" | "done" | "error"
  readonly message?: string
}

export interface SearchStore {
  readonly query: () => string
  readonly running: () => boolean
  readonly results: () => readonly TorrentResult[]
  readonly statuses: () => Readonly<Record<string, ProviderStatus>>
  readonly run: (query: string) => void
  readonly reset: () => void
}

const SearchContext = createContext<SearchStore>()

export function SearchProvider(props: {
  providers: readonly Provider[]
  filter?: ContentFilter
  children: JSX.Element
}) {
  const [query, setQuery] = createSignal("")
  const [running, setRunning] = createSignal(false)
  const [results, setResults] = createSignal<readonly TorrentResult[]>([])
  const [statuses, setStatuses] = createSignal<Readonly<Record<string, ProviderStatus>>>({})

  const resultsMap = new Map<string, TorrentResult>()
  let generation = 0

  const publish = () => {
    setResults([...resultsMap.values()].sort((a, b) => b.seeders - a.seeders))
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
    setResults([])
    setRunning(true)
    setStatuses(Object.fromEntries(props.providers.map((provider) => [provider.name, { state: "pending" as const }])))
    Effect.runPromise(
      Stream.runForEach(searchAll(props.providers, query), (event) =>
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
    setResults([])
    setStatuses({})
    setRunning(false)
  }

  const store: SearchStore = { query, running, results, statuses, run, reset }
  return <SearchContext.Provider value={store}>{props.children}</SearchContext.Provider>
}

export function useSearch(): SearchStore {
  const store = useContext(SearchContext)
  if (store === undefined) throw new Error("useSearch must be used inside SearchProvider")
  return store
}

export { createProviders }
