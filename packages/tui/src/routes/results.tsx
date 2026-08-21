import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { formatBytes, type TorrentResult } from "@corvus/providers"
import { useSearch } from "../context/search"
import { theme } from "../theme"

const seedColor = (seeders: number): string =>
  seeders >= 50 ? theme.seedGood : seeders >= 10 ? theme.seedMid : theme.seedLow

const formatSize = (result: TorrentResult): string =>
  result.sizeBytes > 0 ? formatBytes(result.sizeBytes) : result.size === "" ? "-" : result.size

function truncate(text: string, maxWidth: number): string {
  return text.length <= maxWidth ? text : `${text.slice(0, Math.max(maxWidth - 3, 1))}...`
}

export function Results(props: { onBack: () => void }) {
  const search = useSearch()
  const [cursor, setCursor] = createSignal(0)
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
  })

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
        up/down select · esc back
      </text>
    </box>
  )
}
