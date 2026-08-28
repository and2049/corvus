import { For } from "solid-js"
import { menuHints, type Hint } from "../context/shell"
import { theme } from "../theme"
import { Dialog } from "./dialog"

export function ShortcutsDialog(props: { hints: readonly Hint[] }) {
  const rows = () => menuHints(props.hints)
  return (
    <Dialog title="shortcuts" width={40} top={0.2}>
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
    </Dialog>
  )
}
