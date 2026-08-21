import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { TorrentResult } from "@corvus/providers"
import { PreviewDialog } from "../component/preview-dialog"
import { Spinner } from "../component/spinner"
import { useDownloads } from "../context/downloads"
import { useSearch } from "../context/search"
import { useShell, type Hint } from "../context/shell"
import { formatSize } from "../format"
import { seedColor, theme } from "../theme"

const RESULTS_HINTS: readonly Hint[] = [
  { key: "enter", label: "preview" },
  { key: "o", label: "sort" },
  { key: "h", label: "hidden" },
  { key: "d", label: "downloads" },
  { key: "esc", label: "back" },
]

const PREVIEW_HINTS: readonly Hint[] = [
  { key: "enter", label: "download" },
  { key: "esc", label: "cancel" },
]

function truncate(text: string, maxWidth: number): string {
  return text.length <= maxWidth ? text : `${text.slice(0, Math.max(maxWidth - 3, 1))}...`
}

const PROVIDER_COL = 10

const providerLabel = (result: TorrentResult): string => {
  const label = result.provider + (result.alsoOn.length > 0 ? `+${result.alsoOn.length}` : "")
  return label.length > PROVIDER_COL ? label.slice(0, PROVIDER_COL) : label.padEnd(PROVIDER_COL)
}

export function Results(props: { onBack: () => void; onDownload: () => void }) {
  const search = useSearch()
  const downloads = useDownloads()
  const shell = useShell()
  const [cursor, setCursor] = createSignal(0)
  const [adding, setAdding] = createSignal(false)
  const [preview, setPreview] = createSignal<TorrentResult | undefined>(undefined)
  let scroll: ScrollBoxRenderable | undefined

  const results = createMemo(() => search.results())

  // Keep the cursor row inside the scrollbox viewport.
  createEffect(() => {
    const index = cursor()
    void results().length
    if (scroll === undefined) return
    const target = scroll.getChildren()[index]
    if (target === undefined) return
    const y = target.y - scroll.y
    if (y >= scroll.height) scroll.scrollBy(y - scroll.height + 1)
    else if (y < 0) scroll.scrollBy(y)
  })

  createEffect(() => {
    const selected = preview()
    shell.setOverlay(selected === undefined ? undefined : () => <PreviewDialog result={selected} />)
    shell.setHints(selected === undefined ? RESULTS_HINTS : PREVIEW_HINTS)
  })
  onCleanup(() => shell.setOverlay(undefined))

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
    if (preview() === undefined && key.name === "h") {
      search.toggleHidden()
      return
    }
    if (preview() === undefined && key.name === "o") {
      search.cycleSort()
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
    const added = await downloads.add(selected, search.providers())
    setAdding(false)
    if (added) props.onDownload()
  }

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} width="100%">
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme.muted}>search:</text>
        <text fg={theme.text}>{search.query()}</text>
        <Show
          when={search.running()}
          fallback={<text fg={theme.dim}>{`${results().length} results`}</text>}
        >
          <Spinner message="searching..." />
        </Show>
        <text fg={theme.dim}>{`· sort: ${search.sortMode()}`}</text>
        <Show when={search.hiddenCount() > 0}>
          <text fg={theme.warning}>
            {search.showHidden() ? `· ${search.hiddenCount()} unrelated shown` : `· ${search.hiddenCount()} hidden (h)`}
          </text>
        </Show>
      </box>
      <text fg={theme.dim} flexShrink={0}>
        {Object.entries(search.statuses())
          .map(([name, status]) => {
            if (status.state === "pending") return `${name} ...`
            if (status.state === "error") return `${name} error (${truncate(status.message ?? "", 30)})`
            return `${name} done`
          })
          .join("  |  ")}
      </text>
      <box flexGrow={1} minHeight={0} flexDirection="column" paddingTop={1}>
        <scrollbox
          ref={(el: ScrollBoxRenderable) => (scroll = el)}
          flexGrow={1}
          viewportOptions={{ paddingRight: 1 }}
        >
          <For each={results()}>
            {(result, index) => {
              const selected = createMemo(() => index() === cursor())
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
                  <text
                    fg={selected() ? theme.accent : theme.text}
                    truncate
                    flexGrow={1}
                    flexShrink={1}
                    minWidth={0}
                    wrapMode="none"
                  >
                    {result.trusted ? `${result.title} [trusted]` : result.title}
                  </text>
                  <text flexShrink={0} fg={seedColor(result.seeders)}>
                    {String(result.seeders).padStart(4)}
                  </text>
                  <text flexShrink={0} fg={theme.muted}>
                    {formatSize(result).padStart(9)}
                  </text>
                  <text flexShrink={0} fg={theme.dim}>
                    {providerLabel(result)}
                  </text>
                </box>
              )
            }}
          </For>
        </scrollbox>
        <Show when={results().length === 0}>
          <text fg={theme.dim}>{search.running() ? "searching..." : "no results"}</text>
        </Show>
      </box>
    </box>
  )
}
