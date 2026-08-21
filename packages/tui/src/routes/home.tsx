import { type InputRenderable, TextAttributes } from "@opentui/core"
import { onMount } from "solid-js"
import { HRule } from "../component/hrule"
import { Logo } from "../component/logo"
import { useShell, type Hint } from "../context/shell"
import { theme } from "../theme"

const HOME_HINTS: readonly Hint[] = [
  { key: "enter", label: "search" },
  { key: "ctrl+g", label: "settings" },
  { key: "ctrl+f", label: "sources" },
  { key: "ctrl+shift+c", label: "copy" },
]

export function Home(props: {
  onSubmit: (query: string) => void
  inputRef?: (el: InputRenderable) => void
}) {
  const shell = useShell()
  let input: InputRenderable | undefined
  onMount(() => {
    shell.setHints(HOME_HINTS)
    input?.focus()
  })
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Logo />
      <box flexDirection="row" gap={1} paddingTop={1}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          corvus
        </text>
      </box>
      <box flexDirection="column" paddingTop={1}>
        <HRule />
        <box flexDirection="row" gap={1}>
          <text fg={theme.muted}>search</text>
          <input
            ref={(el: InputRenderable) => {
              input = el
              props.inputRef?.(el)
            }}
            flexGrow={1}
            onSubmit={(value: unknown) => props.onSubmit(String(value))}
            placeholder="query..."
            placeholderColor={theme.dim}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.accent}
          />
        </box>
        <HRule />
      </box>
    </box>
  )
}
