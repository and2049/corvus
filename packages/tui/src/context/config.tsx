import { createContext, createSignal, useContext, type JSX } from "solid-js"
import { deepMerge, type ConfigPatch, type CorvusConfig, type Engine } from "@corvus/core"
import { setFetchCookies, setFetchProxy } from "@corvus/providers"

export interface ConfigStore {
  readonly config: () => CorvusConfig
  readonly update: (patch: ConfigPatch) => void
}

const ConfigContext = createContext<ConfigStore>()

export function ConfigProvider(props: {
  engine: Engine
  initial: CorvusConfig
  persist?: (patch: ConfigPatch) => void
  children: JSX.Element
}) {
  const [config, setConfig] = createSignal<CorvusConfig>(props.initial)

  const update = (patch: ConfigPatch) => {
    const next = deepMerge(config(), patch)
    setConfig(next)
    if ("proxy" in patch) setFetchProxy(next.proxy)
    if ("cloudflare" in patch) setFetchCookies(next.cloudflare)
    if ("seedAfterComplete" in patch && typeof props.engine.setSeedAfterComplete === "function") {
      props.engine.setSeedAfterComplete(next.seedAfterComplete)
    }
    if (("downloadLimit" in patch || "uploadLimit" in patch) && typeof props.engine.setLimits === "function") {
      props.engine.setLimits(next.downloadLimit, next.uploadLimit)
    }
    props.persist?.(patch)
  }

  return <ConfigContext.Provider value={{ config, update }}>{props.children}</ConfigContext.Provider>
}

export function useConfig(): ConfigStore {
  const store = useContext(ConfigContext)
  if (store === undefined) throw new Error("useConfig must be used inside ConfigProvider")
  return store
}

// For chrome (footer) that renders in test harnesses without the full provider tree.
export function useConfigOptional(): ConfigStore | undefined {
  return useContext(ConfigContext)
}
