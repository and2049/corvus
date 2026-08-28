import { useTerminalDimensions } from "@opentui/solid"
import { For } from "solid-js"
import { menuHints, type Hint } from "../context/shell"
import { theme } from "../theme"

const WIDTH = 34

export function ShortcutsDialog(props: { hints: readonly Hint[] }) {
  const dims = useTerminalDimensions()
  const rows = () => menuHints(props.hints)
  return (
    <box
      position="absolute"
      top={Math.floor(dims().height * 0.2)}
      left={Math.floor((dims().width - WIDTH) / 2)}
      width={WIDTH}
      zIndex={10}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.accent}
      backgroundColor="#000000"
      padding={1}
    >
      <text fg={theme.accent}>shortcuts</text>
      <box flexDirection="column" paddingTop={1}>
        <For each={rows()}>
          {(hint) => (
            <box flexDirection="row">
              <text fg={theme.dim}>{hint.key.padEnd(10)}</text>
              <text fg={theme.text}>{hint.label}</text>
            </box>
          )}
        </For>
      </box>
      <text fg={theme.dim} paddingTop={1}>
        esc close
      </text>
    </box>
  )
}
