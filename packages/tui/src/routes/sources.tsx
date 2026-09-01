import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onMount } from "solid-js"
import { NOT_CONFIGURED, validateCredentials } from "@corvus/providers"
import { useConfig } from "../context/config"
import { useShell, type Hint } from "../context/shell"
import { theme } from "../theme"

const SOURCES_HINTS: readonly Hint[] = [
  { key: "space", label: "toggle" },
  { key: "esc", label: "back" },
]

const isEnabled = (enabled: boolean | undefined): boolean => enabled !== false

export function Sources(props: { onBack: () => void }) {
  const { config, update } = useConfig()
  const shell = useShell()
  const [cursor, setCursor] = createSignal(0)
  const names = createMemo(() => Object.keys(config().providers))
  let scroll: ScrollBoxRenderable | undefined

  onMount(() => shell.setHints(SOURCES_HINTS))

  // Keep the cursor row inside the scrollbox viewport.
  createEffect(() => {
    const index = cursor()
    void names().length
    if (scroll === undefined) return
    const target = scroll.getChildren()[index]
    if (target === undefined) return
    const y = target.y - scroll.y
    if (y >= scroll.height) scroll.scrollBy(y - scroll.height + 1)
    else if (y < 0) scroll.scrollBy(y)
  })

  const toggle = () => {
    const name = names()[cursor()]
    if (name === undefined) return
    const current = isEnabled(config().providers[name]?.enabled)
    update({ providers: { [name]: { enabled: !current } } })
    if (!current && needsCredentials(name)) shell.showNotice("soulseek needs a username and password - ctrl+g settings")
  }

  const needsCredentials = (name: string): boolean => {
    const entry = config().providers[name]
    const isSlsk = name === "soulseek" || entry?.type === "soulseek"
    return isSlsk && validateCredentials(entry?.username ?? "", entry?.password ?? "") === NOT_CONFIGURED
  }

  useKeyboard((key) => {
    if (shell.shortcutsOpen()) return
    if (key.name === "escape") {
      props.onBack()
      return
    }
    if (key.name === "up") {
      setCursor((c) => Math.max(0, c - 1))
      return
    }
    if (key.name === "down") {
      setCursor((c) => Math.min(Math.max(names().length - 1, 0), c + 1))
      return
    }
    if (key.name === "space" || key.name === "return") toggle()
  })

  const enabledCount = createMemo(
    () => names().filter((name) => isEnabled(config().providers[name]?.enabled)).length,
  )

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} width="100%">
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme.accent}>sources</text>
        <text fg={theme.dim}>{`${enabledCount()}/${names().length} enabled`}</text>
      </box>
      <box flexGrow={1} minHeight={0} flexDirection="column" paddingTop={1}>
        <scrollbox
          ref={(el: ScrollBoxRenderable) => (scroll = el)}
          flexGrow={1}
          viewportOptions={{ paddingRight: 1 }}
        >
          <For each={names()}>
            {(name, index) => {
              const selected = createMemo(() => index() === cursor())
              const on = createMemo(() => isEnabled(config().providers[name]?.enabled))
              const entry = createMemo(() => config().providers[name])
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
                  <text flexShrink={0} fg={on() ? theme.success : theme.dim}>
                    {on() ? "[x]" : "[ ]"}
                  </text>
                  <text fg={selected() ? theme.accent : theme.text}>{name}</text>
                  <text fg={theme.dim}>{entry()?.type !== undefined ? `(${entry()!.type})` : ""}</text>
                  <text fg={theme.warning}>{needsCredentials(name) ? "not configured" : ""}</text>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </box>
    </box>
  )
}
