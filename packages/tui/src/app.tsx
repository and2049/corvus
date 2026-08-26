import { createMemo, createSignal, Match, Switch } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { writeToClipboard } from "./clipboard"
import type { ConfigPatch, CorvusConfig, Engine, HttpDownloads, PersistedDownload, SoulseekDownloads } from "@corvus/core"
import { ContentFilter, createProviders } from "@corvus/providers"
import { Shell } from "./component/shell"
import { ConfigProvider, useConfig } from "./context/config"
import { DownloadsProvider } from "./context/downloads"
import { SearchProvider, useSearch } from "./context/search"
import { ShellProvider, useShell, type Route } from "./context/shell"
import { Home } from "./routes/home"
import { Results } from "./routes/results"
import { Downloads } from "./routes/downloads"
import { Settings } from "./routes/settings"
import { Sources } from "./routes/sources"

export function App(props: {
  config: CorvusConfig
  engine: Engine
  slsk?: SoulseekDownloads
  http?: HttpDownloads
  persisted?: readonly PersistedDownload[]
  persist: (downloads: readonly PersistedDownload[]) => void
  onConfigChange?: (patch: ConfigPatch) => void
  onExit?: () => void
}) {
  return (
    <ConfigProvider engine={props.engine} initial={props.config} persist={props.onConfigChange}>
      <AppInner
        engine={props.engine}
        slsk={props.slsk}
        http={props.http}
        persisted={props.persisted}
        persist={props.persist}
        onExit={props.onExit}
      />
    </ConfigProvider>
  )
}

function AppInner(props: {
  engine: Engine
  slsk?: SoulseekDownloads
  http?: HttpDownloads
  persisted?: readonly PersistedDownload[]
  persist: (downloads: readonly PersistedDownload[]) => void
  onExit?: () => void
}) {
  const { config } = useConfig()
  const providers = createMemo(() => createProviders(config().providers))
  const filter = createMemo(() => new ContentFilter(config().hideNSFW))

  return (
    <SearchProvider providers={providers()} filter={filter()} timeoutMs={config().searchTimeoutMs}>
      <DownloadsProvider engine={props.engine} slsk={props.slsk} http={props.http} persisted={props.persisted} persist={props.persist}>
        <ShellProvider>
          <Router onExit={props.onExit} />
        </ShellProvider>
      </DownloadsProvider>
    </SearchProvider>
  )
}

export function Router(props: { onExit?: () => void }) {
  const search = useSearch()
  const shell = useShell()
  const renderer = useRenderer()
  const [route, setRoute] = createSignal<Route>("home")
  const [returnTo, setReturnTo] = createSignal<Route>("home")

  const open = (target: Route) => {
    setReturnTo(route())
    setRoute(target)
  }

  const copySelection = () => {
    const text = renderer.getSelection()?.getSelectedText() ?? ""
    if (text === "") return
    renderer.clearSelection()
    void writeToClipboard(text, { renderer }).then(
      (ok) => shell.showNotice(ok ? "Copied to clipboard" : "Copy failed"),
      () => shell.showNotice("Copy failed"),
    )
  }

  useKeyboard((key) => {
    // must be checked before plain ctrl+c - shift+c also matches ctrl+c here
    if (key.ctrl && key.shift && key.name === "c") {
      copySelection()
      return
    }
    if (key.ctrl && !key.shift && key.name === "c") {
      props.onExit?.()
      return
    }
    if (key.ctrl && key.name === "g") {
      open("settings")
      return
    }
    if (key.ctrl && key.name === "f") {
      open("sources")
      return
    }
    if (key.name === "d" && !key.ctrl && route() === "results") setRoute("downloads")
  })

  const backFrom = (current: Route): Route => {
    if (current === "settings" || current === "sources") return returnTo()
    if (current === "results") return "home"
    return search.query() !== "" ? "results" : "home"
  }

  return (
    <Shell route={route()} onCopySelection={copySelection}>
      <Switch fallback={null}>
        <Match when={route() === "home"}>
          <Home
            onSubmit={(query) => {
              search.run(query)
              setRoute("results")
            }}
            onDownload={() => setRoute("downloads")}
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
        <Match when={route() === "settings"}>
          <Settings onBack={() => setRoute(backFrom("settings"))} onOpenSources={() => open("sources")} />
        </Match>
        <Match when={route() === "sources"}>
          <Sources onBack={() => setRoute(backFrom("sources"))} />
        </Match>
      </Switch>
    </Shell>
  )
}
