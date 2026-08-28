import { createContext, createSignal, onCleanup, useContext, type Accessor, type JSX } from "solid-js"

export type Route = "home" | "results" | "downloads" | "settings" | "sources"

export interface Hint {
  readonly key: string
  readonly label: string
}

export interface ShellStore {
  readonly hints: Accessor<readonly Hint[]>
  readonly setHints: (hints: readonly Hint[]) => void
  readonly shortcutsOpen: Accessor<boolean>
  readonly setShortcutsOpen: (open: boolean) => void
  readonly overlay: Accessor<(() => JSX.Element) | undefined>
  readonly setOverlay: (overlay: (() => JSX.Element) | undefined) => void
  readonly notice: Accessor<string | undefined>
  readonly showNotice: (message: string, durationMs?: number) => void
}

// Routes are mounted without a ShellProvider in unit tests; the no-op default
// keeps their setHints/setOverlay calls harmless there.
const NOOP_SHELL: ShellStore = {
  hints: () => [],
  setHints: () => {},
  shortcutsOpen: () => false,
  setShortcutsOpen: () => {},
  overlay: () => undefined,
  setOverlay: () => {},
  notice: () => undefined,
  showNotice: () => {},
}

const ShellContext = createContext<ShellStore>(NOOP_SHELL)

export function ShellProvider(props: { children: JSX.Element }) {
  const [hints, setHints] = createSignal<readonly Hint[]>([])
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false)
  const [overlay, setOverlay] = createSignal<(() => JSX.Element) | undefined>(undefined)
  const [notice, setNotice] = createSignal<string | undefined>(undefined)
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  })
  const store: ShellStore = {
    hints,
    // Hints changes (route or mode switches) close a stale shortcuts menu.
    setHints: (next) => {
      setHints(next)
      setShortcutsOpen(false)
    },
    shortcutsOpen,
    setShortcutsOpen,
    overlay,
    setOverlay: (next) => setOverlay(() => next),
    notice,
    showNotice: (message, durationMs = 2500) => {
      setNotice(message)
      if (noticeTimer !== undefined) clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => setNotice(undefined), durationMs)
    },
  }
  return <ShellContext.Provider value={store}>{props.children}</ShellContext.Provider>
}

export function useShell(): ShellStore {
  return useContext(ShellContext)
}
