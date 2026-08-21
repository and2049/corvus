import { createSignal, Match, Switch } from "solid-js"
import { SearchProvider, useSearch } from "./context/search"
import { Home } from "./routes/home"
import { Results } from "./routes/results"
import type { CorvusConfig } from "@corvus/core"
import { createProviders } from "@corvus/providers"

export function App(props: { config: CorvusConfig }) {
  return (
    <SearchProvider providers={createProviders(props.config.providers)}>
      <Router />
    </SearchProvider>
  )
}

function Router() {
  const search = useSearch()
  const [route, setRoute] = createSignal<"home" | "results">("home")
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
            onBack={() => {
              search.reset()
              setRoute("home")
            }}
          />
        </Match>
      </Switch>
    </box>
  )
}
