import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { DownloadSnapshot } from "@corvus/core"
import { formatBytes } from "@corvus/providers"
import { writeToClipboard } from "../clipboard"
import { useDownloads } from "../context/downloads"
import { useShell, type Hint } from "../context/shell"
import { revealPath } from "../open-path"
import { theme } from "../theme"

const SORT_MODES = ["added", "progress", "name"] as const

const LIST_HINTS: readonly Hint[] = [
  { key: "enter", label: "files" },
  { key: "p", label: "pause/resume" },
  { key: "s", label: "seed" },
  { key: "q", label: "seq" },
  { key: "t", label: "retry" },
  { key: "r", label: "remove" },
  { key: "shift+r", label: "delete data" },
  { key: "o", label: "open" },
  { key: "c", label: "copy link" },
  { key: "a", label: "sort" },
  { key: "esc", label: "back" },
]

const FILES_HINTS: readonly Hint[] = [
  { key: "space", label: "toggle file" },
  { key: "a", label: "select all" },
  { key: "n", label: "select none" },
  { key: "esc", label: "back" },
]

const BAR_WIDTH = 20
const BAR_GLYPHS = [" ", "▏", "▎", "▎", "▍", "▍", "▌", "▋", "▋", "▊", "▊", "▉"]

function progressBar(progress: number): string {
  const exact = progress * BAR_WIDTH
  const full = Math.floor(exact)
  const frac = exact - full
  let bar = "█".repeat(full)
  if (full < BAR_WIDTH) {
    bar += BAR_GLYPHS[Math.min(Math.round(frac * (BAR_GLYPHS.length - 1)), BAR_GLYPHS.length - 1)]
    bar += " ".repeat(BAR_WIDTH - full - 1)
  }
  return bar
}

function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "--"
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function sortSnapshots(list: readonly DownloadSnapshot[], mode: number): DownloadSnapshot[] {
  if (mode === 1) return [...list].sort((a, b) => b.progress - a.progress)
  if (mode === 2) return [...list].sort((a, b) => a.name.localeCompare(b.name))
  return [...list]
}

const stateColor = (snapshot: DownloadSnapshot): string => {
  if (snapshot.seeding) return theme.success
  switch (snapshot.state) {
    case "done":
      return theme.success
    case "error":
      return theme.error
    case "downloading":
      return theme.accent
    default:
      return theme.dim
  }
}

// Keep the cursor row inside the scrollbox viewport.
function followCursor(scroll: ScrollBoxRenderable | undefined, index: number): void {
  if (scroll === undefined) return
  const target = scroll.getChildren()[index]
  if (target === undefined) return
  const y = target.y - scroll.y
  if (y >= scroll.height) scroll.scrollBy(y - scroll.height + 1)
  else if (y < 0) scroll.scrollBy(y)
}

export function Downloads(props: { onBack: () => void }) {
  const downloads = useDownloads()
  const shell = useShell()
  const renderer = useRenderer()
  const [cursorKey, setCursorKey] = createSignal<string | undefined>(undefined)
  const [fileCursor, setFileCursor] = createSignal(0)
  const [openKey, setOpenKey] = createSignal<string | undefined>(undefined)
  const [armedDelete, setArmedDelete] = createSignal<string | undefined>(undefined)
  let armTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (armTimer !== undefined) clearTimeout(armTimer)
  })
  let scroll: ScrollBoxRenderable | undefined

  const deleteWithData = (key: string): void => {
    if (armTimer !== undefined) clearTimeout(armTimer)
    if (armedDelete() === key) {
      setArmedDelete(undefined)
      void downloads.remove(key, { deleteData: true })
      shell.showNotice("removed download and data")
      return
    }
    setArmedDelete(key)
    armTimer = setTimeout(() => setArmedDelete(undefined), 3_000)
    shell.showNotice("press shift+r again to also delete the data")
  }

  const snapshots = createMemo(() => downloads.snapshots())
  const [sortMode, setSortMode] = createSignal(0)
  const visible = createMemo(() => sortSnapshots(snapshots(), sortMode()))
  const cursorIndex = createMemo(() => {
    const key = cursorKey()
    const index = key === undefined ? -1 : visible().findIndex((s) => s.key === key)
    return index === -1 ? 0 : index
  })
  const moveCursor = (delta: number): void => {
    const list = visible()
    if (list.length === 0) return
    const next = Math.min(Math.max(cursorIndex() + delta, 0), list.length - 1)
    setCursorKey(list[next]!.key)
  }
  const selectedSnapshot = (): DownloadSnapshot | undefined => visible()[cursorIndex()]
  const clientError = createMemo(() => downloads.clientError())
  const openSnapshot = createMemo(() => snapshots().find((s) => s.key === openKey()))

  createEffect(() => {
    void snapshots().length
    followCursor(scroll, cursorIndex())
  })

  createEffect(() => shell.setHints(openKey() === undefined ? LIST_HINTS : FILES_HINTS))

  useKeyboard((key) => {
    if (shell.shortcutsOpen()) return
    if (key.name === "escape") {
      if (openKey() !== undefined) {
        setOpenKey(undefined)
        return
      }
      props.onBack()
      return
    }
    if (openKey() !== undefined) {
      const snapshot = openSnapshot()
      if (snapshot === undefined) return
      if (key.name === "up") {
        setFileCursor((c) => Math.max(0, c - 1))
        return
      }
      if (key.name === "down") {
        setFileCursor((c) => Math.min(Math.max(snapshot.files.length - 1, 0), c + 1))
        return
      }
      if (key.name === "space") {
        downloads.toggleFile(snapshot.key, fileCursor())
        return
      }
      if (key.name === "a") {
        downloads.selectFiles(snapshot.key, true)
        return
      }
      if (key.name === "n") {
        downloads.selectFiles(snapshot.key, false)
      }
      return
    }
    if (key.name === "up") {
      moveCursor(-1)
      return
    }
    if (key.name === "down") {
      moveCursor(1)
      return
    }
    if (key.ctrl) return
    if (key.name === "a") {
      setSortMode((mode) => (mode + 1) % SORT_MODES.length)
      return
    }
    const selected = selectedSnapshot()
    if (selected === undefined) return
    if (key.name === "R" || (key.name === "r" && key.shift)) {
      deleteWithData(selected.key)
      return
    }
    switch (key.name) {
      case "p":
        return downloads.togglePause(selected.key)
      case "s":
        return downloads.toggleSeed(selected.key)
      case "q":
        return downloads.toggleSequential(selected.key)
      case "t":
        return void downloads.retry(selected.key)
      case "r":
        return void downloads.remove(selected.key)
      case "return":
        if (selected.files.length > 0) {
          setFileCursor(0)
          setOpenKey(selected.key)
        }
        return
      case "o":
        if (selected.location === undefined) return
        return void revealPath(selected.location).then((ok) => {
          if (!ok) shell.showNotice("could not open location")
        })
      case "c": {
        const link = downloads.magnetFor(selected.key)
        if (link === undefined) return
        void writeToClipboard(link, { renderer }).then(
          (ok) => shell.showNotice(ok ? "Copied to clipboard" : "Copy failed"),
          () => shell.showNotice("Copy failed"),
        )
      }
    }
  })

  return (
    <Show when={openKey() === undefined} fallback={<FilesView snapshot={openSnapshot()} cursor={fileCursor} />}>
      <box flexDirection="column" flexGrow={1} minHeight={0} width="100%">
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={theme.muted}>downloads</text>
          <text fg={theme.dim}>{String(snapshots().length)}</text>
          <text fg={theme.dim}>{`sort: ${SORT_MODES[sortMode()]}`}</text>
        </box>
        <box flexGrow={1} minHeight={0} flexDirection="column" paddingTop={1}>
          <scrollbox
            ref={(el: ScrollBoxRenderable) => (scroll = el)}
            flexGrow={1}
            viewportOptions={{ paddingRight: 1 }}
          >
            <For each={visible()}>
              {(snapshot, index) => {
                const selected = createMemo(() => index() === cursorIndex())
                return (
                  <box
                    flexDirection="row"
                    gap={1}
                    flexShrink={0}
                    width="100%"
                    height={1}
                    backgroundColor={selected() ? theme.selectedBg : undefined}
                  >
                    <text flexShrink={0} fg={selected() ? theme.accent : "transparent"}>
                      {selected() ? "›" : " "}
                    </text>
                    <text flexShrink={0} fg={stateColor(snapshot)}>
                      {progressBar(snapshot.progress)}
                    </text>
                    <text flexShrink={0} fg={theme.dim}>
                      {String(Math.round(snapshot.progress * 100)).padStart(3)}%
                    </text>
                    <text
                      fg={snapshot.seeding ? theme.success : selected() ? theme.accent : theme.text}
                      truncate
                      flexGrow={1}
                      flexShrink={1}
                      minWidth={0}
                      wrapMode="none"
                    >
                      {snapshot.name}
                    </text>
                    <Show when={snapshot.state === "downloading" || snapshot.state === "paused"}>
                      <text flexShrink={0} fg={theme.muted}>{formatBytes(snapshot.downloadSpeed)}/s</text>
                      <Show when={snapshot.uploadSpeed > 0}>
                        <text flexShrink={0} fg={theme.dim}>{`↑${formatBytes(snapshot.uploadSpeed)}/s`}</text>
                      </Show>
                      <text flexShrink={0} fg={theme.dim}>{formatEta(snapshot.etaSeconds)}</text>
                      <Show when={snapshot.sequential}>
                        <text flexShrink={0} fg={theme.dim}>[seq]</text>
                      </Show>
                    </Show>
                    <Show when={snapshot.state !== "downloading" && snapshot.state !== "paused"}>
                      <text flexShrink={0} fg={stateColor(snapshot)}>
                        {snapshot.state === "error" && snapshot.error !== undefined
                          ? `error: ${truncate(snapshot.error, 60)}`
                          : snapshot.state === "fetching"
                            ? snapshot.queuePosition !== undefined
                              ? `queued #${String(snapshot.queuePosition)}`
                              : `fetching ${formatEta(snapshot.fetchingSeconds)}`
                            : snapshot.state === "done" && snapshot.seeding
                              ? `seeding ↑${formatBytes(snapshot.uploadSpeed)}/s`
                              : snapshot.state}
                      </text>
                    </Show>
                  </box>
                )
              }}
            </For>
          </scrollbox>
          <Show when={snapshots().length === 0}>
            <text fg={theme.dim}>no downloads</text>
          </Show>
          <Show when={clientError()} keyed>
            {(message) => <text fg={theme.error} truncate wrapMode="none">{`client: ${message}`}</text>}
          </Show>
        </box>
      </box>
    </Show>
  )
}

function FilesView(props: { snapshot: DownloadSnapshot | undefined; cursor: () => number }) {
  const snapshot = () => props.snapshot
  let scroll: ScrollBoxRenderable | undefined

  createEffect(() => {
    void (snapshot()?.files.length ?? 0)
    followCursor(scroll, props.cursor())
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} width="100%">
      <text fg={theme.muted} wrapMode="none" truncate flexShrink={0}>
        files: {snapshot()?.name ?? ""}
      </text>
      <Show when={snapshot() !== undefined}>
        <FilesSummary snapshot={snapshot()!} />
      </Show>
      <box flexGrow={1} minHeight={0} flexDirection="column" paddingTop={1}>
        <scrollbox
          ref={(el: ScrollBoxRenderable) => (scroll = el)}
          flexGrow={1}
          viewportOptions={{ paddingRight: 1 }}
        >
          <For each={snapshot()?.files ?? []}>
            {(file, index) => {
              const selected = createMemo(() => index() === props.cursor())
              return (
                <box
                  flexDirection="row"
                  gap={1}
                  flexShrink={0}
                  width="100%"
                  height={1}
                  backgroundColor={selected() ? theme.selectedBg : undefined}
                >
                  <text flexShrink={0} fg={selected() ? theme.accent : "transparent"}>
                    {selected() ? "›" : " "}
                  </text>
                  <text flexShrink={0} fg={file.selected ? theme.success : theme.dim}>
                    {file.selected ? "[x]" : "[ ]"}
                  </text>
                  <text
                    fg={selected() ? theme.text : theme.muted}
                    truncate
                    flexGrow={1}
                    flexShrink={1}
                    minWidth={0}
                    wrapMode="none"
                  >
                    {file.path}
                  </text>
                  <text flexShrink={0} fg={file.progress >= 1 ? theme.success : theme.dim}>
                    {String(Math.round(file.progress * 100)).padStart(4)}%
                  </text>
                  <text flexShrink={0} fg={theme.dim}>
                    {formatBytes(file.length).padStart(9)}
                  </text>
                </box>
              )
            }}
          </For>
        </scrollbox>
        <Show when={(snapshot()?.files.length ?? 0) === 0}>
          <text fg={theme.dim}>no file metadata yet</text>
        </Show>
      </box>
    </box>
  )
}

function FilesSummary(props: { snapshot: DownloadSnapshot }) {
  const summary = createMemo(() => {
    const files = props.snapshot.files
    const selectedBytes = files.reduce((sum, f) => (f.selected ? sum + f.length : sum), 0)
    const totalBytes = files.reduce((sum, f) => sum + f.length, 0)
    const selectedCount = files.filter((f) => f.selected).length
    return `${String(selectedCount)}/${String(files.length)} files ${formatBytes(selectedBytes)}/${formatBytes(totalBytes)}`
  })
  return <text fg={theme.dim} flexShrink={0}>{summary()}</text>
}

function truncate(text: string | undefined, maxWidth: number): string {
  const value = text ?? ""
  return value.length <= maxWidth ? value : `${value.slice(0, Math.max(maxWidth - 3, 1))}...`
}
