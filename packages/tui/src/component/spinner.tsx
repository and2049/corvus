import { createSignal, onCleanup, Show } from "solid-js"
import { theme } from "../theme"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: { message?: string }) {
  const [frame, setFrame] = createSignal(0)
  const interval = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80)
  onCleanup(() => clearInterval(interval))
  return (
    <box flexDirection="row" gap={1}>
      <text fg={theme.accent}>{FRAMES[frame()]}</text>
      <Show when={props.message !== undefined}>
        <text fg={theme.muted}>{props.message}</text>
      </Show>
    </box>
  )
}
