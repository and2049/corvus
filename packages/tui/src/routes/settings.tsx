import { type InputRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { humanSizeBinary, parseHumanSize } from "@corvus/providers"
import { useConfig } from "../context/config"
import { useShell, type Hint } from "../context/shell"
import { theme } from "../theme"

const NAV_HINTS: readonly Hint[] = [
  { key: "enter", label: "change" },
  { key: "esc", label: "back" },
]

const EDIT_HINTS: readonly Hint[] = [
  { key: "enter", label: "save" },
  { key: "esc", label: "cancel" },
]

type RowKind = "toggle" | "text" | "int" | "size" | "nav"

interface Row {
  readonly key: string
  readonly label: string
  readonly kind: RowKind
  readonly note: string
}

const ROWS: readonly Row[] = [
  { key: "downloadDir", label: "download dir", kind: "text", note: "restart to apply" },
  { key: "seedAfterComplete", label: "seed after complete", kind: "toggle", note: "applies now" },
  { key: "torrentPort", label: "torrent port", kind: "int", note: "restart to apply · set to your VPN-forwarded port" },
  { key: "maxConns", label: "max connections", kind: "int", note: "restart to apply" },
  { key: "downloadLimit", label: "download limit", kind: "size", note: "applies now · e.g. 524288 or 512KB · empty = unlimited" },
  { key: "uploadLimit", label: "upload limit", kind: "size", note: "applies now · e.g. 1048576 or 1MB · empty = unlimited" },
  { key: "proxy", label: "search proxy", kind: "text", note: "applies now · search traffic only, not BT peers" },
  { key: "hideNSFW", label: "hide nsfw", kind: "toggle", note: "applies now" },
  { key: "searchTimeoutMs", label: "search timeout (ms)", kind: "int", note: "applies now" },
  { key: "sources", label: "sources »", kind: "nav", note: "enable/disable search sources" },
]

export function Settings(props: { onBack: () => void; onOpenSources: () => void }) {
  const { config, update } = useConfig()
  const shell = useShell()
  const [cursor, setCursor] = createSignal(0)
  const [editing, setEditing] = createSignal<string | undefined>(undefined)
  let scroll: ScrollBoxRenderable | undefined

  const current = createMemo(() => ROWS[cursor()]!)

  // Keep the cursor row inside the scrollbox viewport.
  createEffect(() => {
    const index = cursor()
    if (scroll === undefined) return
    const target = scroll.getChildren()[index]
    if (target === undefined) return
    const y = target.y - scroll.y
    if (y >= scroll.height) scroll.scrollBy(y - scroll.height + 1)
    else if (y < 0) scroll.scrollBy(y)
  })

  createEffect(() => shell.setHints(editing() === undefined ? NAV_HINTS : EDIT_HINTS))

  const displayValue = (row: Row): string => {
    const c = config()
    switch (row.key) {
      case "downloadDir":
        return c.downloadDir
      case "seedAfterComplete":
        return c.seedAfterComplete ? "on" : "off"
      case "torrentPort":
        return c.torrentPort !== undefined ? String(c.torrentPort) : "(ephemeral)"
      case "maxConns":
        return c.maxConns !== undefined ? String(c.maxConns) : "(default)"
      case "downloadLimit":
      case "uploadLimit": {
        const limit = c[row.key as "downloadLimit" | "uploadLimit"]
        return limit !== undefined && limit >= 0 ? humanSizeBinary(limit) + "/s" : "(unlimited)"
      }
      case "proxy":
        return c.proxy !== undefined && c.proxy !== "" ? c.proxy : "(none)"
      case "hideNSFW":
        return c.hideNSFW ? "on" : "off"
      case "searchTimeoutMs":
        return String(c.searchTimeoutMs)
      case "sources":
        return ""
      default:
        return ""
    }
  }

  const editInitial = (row: Row): string => {
    // Size rows always start empty: typing replaces the limit, an empty submit clears it.
    if (row.kind === "size") return ""
    const value = displayValue(row)
    return value.startsWith("(") ? "" : value
  }

  const activate = () => {
    const row = current()
    if (row.kind === "nav") {
      props.onOpenSources()
      return
    }
    if (row.kind === "toggle") {
      update({ [row.key]: !(config()[row.key as "seedAfterComplete" | "hideNSFW"] ?? false) })
      return
    }
    setEditing(row.key)
  }

  const save = (raw: string) => {
    const row = current()
    const trimmed = raw.trim()
    if (row.kind === "int") {
      const n = Number.parseInt(trimmed, 10)
      const valid = trimmed !== "" && Number.isFinite(n) && n >= 0
      update({ [row.key]: valid ? n : undefined })
    } else if (row.kind === "size") {
      // -1 means unlimited (webtorrent's disabled-throttle sentinel); an empty
      // input clears the limit.
      const bytes = trimmed === "" ? -1 : parseHumanSize(trimmed)
      update({ [row.key]: bytes > 0 ? bytes : -1 })
    } else {
      update({ [row.key]: trimmed })
    }
    setEditing(undefined)
  }

  useKeyboard((key) => {
    if (shell.shortcutsOpen()) return
    if (editing() !== undefined) {
      if (key.name === "escape") setEditing(undefined)
      return
    }
    if (key.name === "escape") {
      props.onBack()
      return
    }
    if (key.name === "up") {
      setCursor((c) => Math.max(0, c - 1))
      return
    }
    if (key.name === "down") {
      setCursor((c) => Math.min(ROWS.length - 1, c + 1))
      return
    }
    if (key.name === "return" || key.name === "space") activate()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} width="100%">
      <text fg={theme.accent} flexShrink={0}>
        settings
      </text>
      <box flexGrow={1} minHeight={0} flexDirection="column" paddingTop={1}>
        <scrollbox
          ref={(el: ScrollBoxRenderable) => (scroll = el)}
          flexGrow={1}
          viewportOptions={{ paddingRight: 1 }}
        >
          <For each={ROWS}>
            {(row, index) => {
              const selected = createMemo(() => index() === cursor())
              const isEditing = createMemo(() => editing() === row.key)
              return (
                <box flexDirection="column" flexShrink={0} width="100%">
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} fg={selected() ? theme.accent : "transparent"}>
                      {selected() ? "→" : " "}
                    </text>
                    <text flexShrink={0} fg={selected() ? theme.accent : theme.text}>
                      {row.label.padEnd(22)}
                    </text>
                    <Show
                      when={isEditing()}
                      fallback={
                        <text
                          fg={selected() ? theme.accent : theme.muted}
                          truncate
                          flexShrink={1}
                          minWidth={0}
                          wrapMode="none"
                        >
                          {displayValue(row)}
                        </text>
                      }
                    >
                      <input
                        ref={(el: InputRenderable) => queueMicrotask(() => el.focus())}
                        flexGrow={1}
                        value={editInitial(row)}
                        onSubmit={(value: unknown) => save(String(value))}
                        textColor={theme.text}
                        focusedTextColor={theme.text}
                        cursorColor={theme.accent}
                      />
                    </Show>
                  </box>
                  <Show when={selected()}>
                    <text fg={theme.dim} truncate wrapMode="none">{`  ${row.note}`}</text>
                  </Show>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </box>
    </box>
  )
}
