import { createSignal, Match, Switch } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { CorvusConfig, Engine, PersistedDownload } from "@corvus/core"
import { ContentFilter, createProviders } from "@corvus/providers"
import { DownloadsProvider } from "./context/downloads"
import { SearchProvider, useSearch } from "./context/search"
import { Home } from "./routes/home"
import { Results } from "./routes/results"
import { Downloads } from "./routes/downloads"

export function App(props: {
  config: CorvusConfig
  engine: Engine
  persist: (downloads: readonly PersistedDownload[]) => void
}) {
  return (
    <SearchProvider
      providers={createProviders(props.config.providers)}
      filter={new ContentFilter(props.config.hideNSFW)}
    >
      <DownloadsProvider engine={props.engine} persist={props.persist}>
        <Router />
      </DownloadsProvider>
    </SearchProvider>
  )
}

type Route = "home" | "results" | "downloads"

function Router() {
  const search = useSearch()
  const [route, setRoute] = createSignal<Route>("home")

  useKeyboard((key) => {
    if (key.name === "d" && !key.ctrl && route() === "results") setRoute("downloads")
  })

  const backFrom = (current: Route): Route => {
    if (current === "results") return "home"
    return search.query() !== "" ? "results" : "home"
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Switch fallback={null}>
        <Match when={route() === "home"}>
          <Home
            onSubmit={(query) => {
              search.run(query)
              setRoute("results")
            }}
          />
        </Match>
        <Match when={route() === "results"}>
          <Results
            onBack={() => setRoute(backFrom("results"))}
            onDownload={() => setRoute("downloads")}
          />
        </Match>
        <Match when={route() === "downloads"}>
          <Downloads onBack={() => setRoute(backFrom("downloads"))} />
        </Match>
      </Switch>
    </box>
  )
}
