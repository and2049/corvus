import { createContext, createSignal, useContext, type Accessor, type JSX } from "solid-js"

export type Route = "home" | "results" | "downloads" | "settings" | "sources"

export interface Hint {
  readonly key: string
  readonly label: string
}

export interface ShellStore {
  readonly hints: Accessor<readonly Hint[]>
  readonly setHints: (hints: readonly Hint[]) => void
  readonly overlay: Accessor<(() => JSX.Element) | undefined>
  readonly setOverlay: (overlay: (() => JSX.Element) | undefined) => void
}

// Routes are mounted without a ShellProvider in unit tests; the no-op default
// keeps their setHints/setOverlay calls harmless there.
const NOOP_SHELL: ShellStore = {
  hints: () => [],
  setHints: () => {},
  overlay: () => undefined,
  setOverlay: () => {},
}

const ShellContext = createContext<ShellStore>(NOOP_SHELL)

export function ShellProvider(props: { children: JSX.Element }) {
  const [hints, setHints] = createSignal<readonly Hint[]>([])
  const [overlay, setOverlay] = createSignal<(() => JSX.Element) | undefined>(undefined)
  const store: ShellStore = {
    hints,
    setHints: (next) => setHints(next),
    overlay,
    setOverlay: (next) => setOverlay(() => next),
  }
  return <ShellContext.Provider value={store}>{props.children}</ShellContext.Provider>
}

export function useShell(): ShellStore {
  return useContext(ShellContext)
}
