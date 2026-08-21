import { type InputRenderable, TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { onMount } from "solid-js"
import { Logo } from "../component/logo"
import { theme } from "../theme"

export function Home(props: {
  onSubmit: (query: string) => void
  inputRef?: (el: InputRenderable) => void
}) {
  let input: InputRenderable | undefined
  onMount(() => input?.focus())
  useKeyboard((key) => {
    if (key.name === "escape") process.exit(0)
  })
  return (
    <box flexDirection="column" width="100%" height="100%" paddingTop={1} paddingLeft={2}>
      <Logo />
      <box flexDirection="row" gap={1} paddingTop={1}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          corvus
        </text>
        <text fg={theme.dim}>v0.1.0</text>
      </box>
      <box flexDirection="row" gap={1} paddingTop={1}>
        <text fg={theme.subtle}>search</text>
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
      <text fg={theme.dim} paddingTop={2}>
        enter search · esc quit
      </text>
    </box>
  )
}
