import { type InputRenderable, TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createSignal, For, onMount } from "solid-js"
import { APP_VERSION, providerCounts } from "../component/footer"
import { HRule } from "../component/hrule"
import { Logo } from "../component/logo"
import { useConfigOptional } from "../context/config"
import { useDownloadsOptional } from "../context/downloads"
import { useShell, type Hint } from "../context/shell"
import { theme } from "../theme"

const HOME_HINTS: readonly Hint[] = [
  { key: "tab", label: "magnet mode" },
  { key: "ctrl+g", label: "settings" },
  { key: "ctrl+f", label: "sources" },
  { key: "ctrl+shift+c", label: "copy selection" },
]

// Full tracker lists push real-world magnets well past opentui's default
// input maxLength of 1000, which truncates pastes silently.
const MAGNET_MAX_LENGTH = 8192

export function Home(props: {
  onSubmit: (query: string) => void
  onDownload?: () => void
  inputRef?: (el: InputRenderable) => void
}) {
  const shell = useShell()
  const config = useConfigOptional()
  const downloads = useDownloadsOptional()
  const [mode, setMode] = createSignal<"search" | "magnet">("search")
  let input: InputRenderable | undefined
  onMount(() => {
    shell.setHints([])
    input?.focus()
  })
  useKeyboard((key) => {
    if (key.name === "tab" && !key.ctrl && !key.shift) {
      setMode((current) => (current === "search" ? "magnet" : "search"))
    }
  })
  const submit = (value: unknown) => {
    const text = String(value).trim()
    if (text === "") return
    if (mode() === "search") {
      props.onSubmit(text)
      return
    }
    const outcome = downloads?.addMagnet(text)
    if (outcome === "added" || outcome === "duplicate") {
      if (outcome === "duplicate") shell.showNotice("already added")
      props.onDownload?.()
      return
    }
    shell.showNotice("invalid magnet link")
  }
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <box flexGrow={1} flexBasis={0} minWidth={0}>
          <Logo />
        </box>
        <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0}>
          <box flexDirection="row" gap={2}>
            <text fg={theme.accent} attributes={TextAttributes.BOLD}>
              corvus
            </text>
            <text fg={theme.dim}>{`v${APP_VERSION}`}</text>
          </box>
          <text fg={theme.muted} truncate wrapMode="none">
            {config?.config()?.downloadDir ?? ""}
          </text>
          <box flexDirection="row">
            <text fg={theme.text}>{providerCounts(config?.config())}</text>
            <text fg={theme.muted}>{" sources"}</text>
          </box>
          <box height={1} flexShrink={0} />
          <For each={HOME_HINTS}>
            {(hint) => (
              <box flexDirection="row">
                <text fg={theme.text}>{hint.key}</text>
                <text fg={theme.muted}>{` ${hint.label}`}</text>
              </box>
            )}
          </For>
        </box>
      </box>
      <box flexDirection="column" flexShrink={0}>
        <HRule />
        <box flexDirection="row" gap={1}>
          <text fg={mode() === "magnet" ? theme.accent : theme.muted}>
            {mode() === "magnet" ? "magnet" : "search"}
          </text>
          <input
            ref={(el: InputRenderable) => {
              input = el
              props.inputRef?.(el)
            }}
            flexGrow={1}
            maxLength={MAGNET_MAX_LENGTH}
            onSubmit={(value: unknown) => submit(value)}
            placeholder={mode() === "magnet" ? "magnet link..." : "query..."}
            placeholderColor={theme.dim}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.accent}
          />
        </box>
        <HRule />
        <text fg={theme.dim}>{mode() === "magnet" ? "enter download" : "enter search"}</text>
      </box>
    </box>
  )
}
