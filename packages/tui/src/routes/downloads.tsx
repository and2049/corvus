import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { DownloadSnapshot } from "@corvus/core"
import { formatBytes } from "@corvus/providers"
import { useDownloads } from "../context/downloads"
import { theme } from "../theme"

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

const stateColor = (snapshot: DownloadSnapshot): string => {
  switch (snapshot.state) {
    case "done":
      return theme.seedGood
    case "error":
      return theme.seedLow
    case "downloading":
      return theme.accent
    default:
      return theme.dim
  }
}

export function Downloads(props: { onBack: () => void }) {
  const downloads = useDownloads()
  const [cursor, setCursor] = createSignal(0)
  const [fileCursor, setFileCursor] = createSignal(0)
  const [openKey, setOpenKey] = createSignal<string | undefined>(undefined)
  const dims = useTerminalDimensions()

  const snapshots = createMemo(() => downloads.snapshots())
  const openSnapshot = createMemo(() => snapshots().find((s) => s.key === openKey()))
  const visibleCount = createMemo(() => Math.max(dims().height - 6, 1))
  const offset = createMemo(() => {
    const total = snapshots().length
    if (total <= visibleCount()) return 0
    const half = Math.floor(visibleCount() / 2)
    return Math.max(0, Math.min(cursor() - half, total - visibleCount()))
  })
  const rows = createMemo(() => snapshots().slice(offset(), offset() + visibleCount()))

  useKeyboard((key) => {
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
      }
      return
    }
    if (key.name === "up") {
      setCursor((c) => Math.max(0, c - 1))
      return
    }
    if (key.name === "down") {
      setCursor((c) => Math.min(Math.max(snapshots().length - 1, 0), c + 1))
      return
    }
    if (key.name === "p" && !key.ctrl) {
      const selected = snapshots()[cursor()]
      if (selected !== undefined) downloads.togglePause(selected.key)
      return
    }
    if (key.name === "return") {
      const selected = snapshots()[cursor()]
      if (selected !== undefined && selected.files.length > 0) {
        setFileCursor(0)
        setOpenKey(selected.key)
      }
      return
    }
    if (key.name === "r" && !key.ctrl) {
      const selected = snapshots()[cursor()]
      if (selected !== undefined) void downloads.remove(selected.key)
    }
  })

  return (
    <Show when={openKey() === undefined} fallback={<FilesView snapshot={openSnapshot()} cursor={fileCursor} />}>
      <box flexDirection="column" width="100%" height="100%" paddingLeft={2} paddingRight={1}>
      <box flexDirection="row" gap={1}>
        <text fg={theme.subtle}>downloads</text>
        <text fg={theme.dim}>{snapshots().length}</text>
      </box>
      <box flexDirection="column" paddingTop={1}>
        <For each={rows()}>
          {(snapshot, index) => {
            const selected = createMemo(() => offset() + index() === cursor())
            return (
              <box flexDirection="row" gap={1}>
                <text fg={selected() ? theme.accent : "transparent"}>{selected() ? ">" : " "}</text>
                <text fg={stateColor(snapshot)}>{progressBar(snapshot.progress)}</text>
                <text fg={theme.dim}>{String(Math.round(snapshot.progress * 100)).padStart(3)}%</text>
                <text fg={theme.text} truncate flexGrow={1} wrapMode="none">
                  {truncate(snapshot.name, 200)}
                </text>
                <Show when={snapshot.state === "downloading" || snapshot.state === "paused"}>
                  <text fg={theme.subtle}>{formatBytes(snapshot.downloadSpeed)}/s</text>
                  <text fg={theme.dim}>{formatEta(snapshot.etaSeconds)}</text>
                </Show>
                <Show when={snapshot.state !== "downloading" && snapshot.state !== "paused"}>
                  <text fg={stateColor(snapshot)}>{snapshot.state}</text>
                </Show>
              </box>
            )
          }}
        </For>
        <Show when={snapshots().length === 0}>
          <text fg={theme.dim}>no downloads</text>
        </Show>
      </box>
      <text fg={theme.dim} marginTop="auto">
        enter files · p pause/resume · r remove · up/down select · esc back
      </text>
      </box>
    </Show>
  )
}

function FilesView(props: { snapshot: DownloadSnapshot | undefined; cursor: () => number }) {
  const snapshot = () => props.snapshot
  return (
    <box flexDirection="column" width="100%" height="100%" paddingLeft={2} paddingRight={1}>
      <text fg={theme.subtle} wrapMode="none" truncate>
        files: {snapshot()?.name ?? ""}
      </text>
      <box flexDirection="column" paddingTop={1}>
        <For each={snapshot()?.files ?? []}>
          {(file, index) => {
            const selected = createMemo(() => index() === props.cursor())
            return (
              <box flexDirection="row" gap={1}>
                <text fg={selected() ? theme.accent : "transparent"}>{selected() ? ">" : " "}</text>
                <text fg={file.selected ? theme.seedGood : theme.dim}>{file.selected ? "[x]" : "[ ]"}</text>
                <text fg={selected() ? theme.text : theme.subtle} truncate flexGrow={1} wrapMode="none">
                  {truncate(file.path, 200)}
                </text>
                <text fg={theme.dim}>{formatBytes(file.length).padStart(9)}</text>
              </box>
            )
          }}
        </For>
        <Show when={(snapshot()?.files.length ?? 0) === 0}>
          <text fg={theme.dim}>no file metadata yet</text>
        </Show>
      </box>
      <text fg={theme.dim} marginTop="auto">
        space toggle file · esc back
      </text>
    </box>
  )
}

function truncate(text: string, maxWidth: number): string {
  return text.length <= maxWidth ? text : `${text.slice(0, Math.max(maxWidth - 3, 1))}...`
}
