import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { formatBytes, type TorrentResult } from "@corvus/providers"
import { useDownloads } from "../context/downloads"
import { useSearch } from "../context/search"
import { theme } from "../theme"

const seedColor = (seeders: number): string =>
  seeders >= 50 ? theme.seedGood : seeders >= 10 ? theme.seedMid : theme.seedLow

const formatSize = (result: TorrentResult): string =>
  result.sizeBytes > 0 ? formatBytes(result.sizeBytes) : result.size === "" ? "-" : result.size

function truncate(text: string, maxWidth: number): string {
  return text.length <= maxWidth ? text : `${text.slice(0, Math.max(maxWidth - 3, 1))}...`
}

export function Results(props: { onBack: () => void; onDownload: () => void }) {
  const search = useSearch()
  const downloads = useDownloads()
  const [cursor, setCursor] = createSignal(0)
  const [adding, setAdding] = createSignal(false)
  const [preview, setPreview] = createSignal<TorrentResult | undefined>(undefined)
  const dims = useTerminalDimensions()

  const results = createMemo(() => search.results())
  const visibleCount = createMemo(() => Math.max(dims().height - 8, 1))
  const offset = createMemo(() => {
    const total = results().length
    if (total <= visibleCount()) return 0
    const half = Math.floor(visibleCount() / 2)
    return Math.max(0, Math.min(cursor() - half, total - visibleCount()))
  })
  const rows = createMemo(() => results().slice(offset(), offset() + visibleCount()))

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (preview() !== undefined) {
        setPreview(undefined)
        return
      }
      props.onBack()
      return
    }
    if (key.name === "up") {
      setCursor((c) => Math.max(0, c - 1))
      return
    }
    if (key.name === "down") {
      setCursor((c) => Math.min(Math.max(results().length - 1, 0), c + 1))
      return
    }
    if (key.name === "return" && !adding()) {
      if (preview() !== undefined) {
        void confirmDownload()
        return
      }
      const selected = results()[cursor()]
      if (selected === undefined) return
      setPreview(selected)
    }
  })

  const confirmDownload = async (): Promise<void> => {
    const selected = preview()
    if (selected === undefined) return
    setPreview(undefined)
    setAdding(true)
    await downloads.add(selected, search.providers())
    setAdding(false)
    props.onDownload()
  }

  return (
    <box flexDirection="column" width="100%" height="100%" paddingLeft={2} paddingRight={1}>
      <box flexDirection="row" gap={1}>
        <text fg={theme.subtle}>search:</text>
        <text fg={theme.text}>{search.query()}</text>
        <text fg={theme.dim}>
          {search.running() ? "searching..." : `${results().length} results`}
        </text>
      </box>
      <text fg={theme.dim}>
        {Object.entries(search.statuses())
          .map(([name, status]) => {
            if (status.state === "pending") return `${name} ...`
            if (status.state === "error") return `${name} error (${truncate(status.message ?? "", 30)})`
            return `${name} done`
          })
          .join("  |  ")}
      </text>
      <box flexDirection="column" paddingTop={1}>
        <For each={rows()}>
          {(result, index) => {
            const rowIndex = createMemo(() => offset() + index())
            const selected = createMemo(() => rowIndex() === cursor())
            return (
              <box flexDirection="row" gap={1}>
                <text fg={selected() ? theme.accent : "transparent"}>
                  {selected() ? ">" : " "}
                </text>
                <text fg={selected() ? theme.accent : theme.text} truncate flexGrow={1} wrapMode="none">
                  {result.trusted ? `${truncate(result.title, 200)} [trusted]` : truncate(result.title, 200)}
                </text>
                <text fg={seedColor(result.seeders)}>{String(result.seeders).padStart(4)}</text>
                <text fg={theme.subtle}>{formatSize(result).padStart(9)}</text>
                <text fg={theme.dim}>
                  {result.provider}
                  {result.alsoOn.length > 0 ? `+${result.alsoOn.length}` : ""}
                </text>
              </box>
            )
          }}
        </For>
        <Show when={results().length === 0}>
          <text fg={theme.dim}>{search.running() ? "searching..." : "no results"}</text>
        </Show>
      </box>
      <text fg={theme.dim} marginTop="auto">
        enter preview · up/down select · d downloads · esc back
      </text>
      <Show when={preview() !== undefined}>
        <PreviewDialog result={preview()!} />
      </Show>
    </box>
  )
}

export function PreviewDialog(props: { result: TorrentResult }) {
  const r = () => props.result
  return (
    <box
      position="absolute"
      top="25%"
      left="10%"
      width="80%"
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.accent}
      backgroundColor="#000000"
      padding={1}
      gap={0}
    >
      <text fg={theme.accent}>download this torrent?</text>
      <text fg={theme.text} wrapMode="none" truncate>
        {r().title}
      </text>
      <box flexDirection="row" gap={2} paddingTop={1}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.subtle}>seeders</text>
          <text fg={seedColor(r().seeders)}>{String(r().seeders)}</text>
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.subtle}>leechers</text>
          <text fg={theme.dim}>{String(r().leechers)}</text>
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.subtle}>size</text>
          <text fg={theme.text}>{formatSize(r())}</text>
        </box>
      </box>
      <box flexDirection="row" gap={2}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.subtle}>source</text>
          <text fg={theme.dim}>{r().provider}</text>
        </box>
        <Show when={r().alsoOn.length > 0}>
          <text fg={theme.dim}>also on {r().alsoOn.join(", ")}</text>
        </Show>
        <Show when={r().trusted}>
          <text fg={theme.seedGood}>trusted</text>
        </Show>
      </box>
      <text fg={theme.dim} paddingTop={1}>
        enter download · esc cancel
      </text>
    </box>
  )
}
