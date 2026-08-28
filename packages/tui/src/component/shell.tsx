import { MouseButton } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Show, type JSX } from "solid-js"
import { useShell, type Route } from "../context/shell"
import { theme } from "../theme"
import { Footer } from "./footer"
import { ShortcutsDialog } from "./shortcuts-dialog"

export function Shell(props: {
  route: Route
  children: JSX.Element
  onCopySelection?: () => void
}) {
  const dims = useTerminalDimensions()
  const shell = useShell()
  return (
    <box
      width={dims().width}
      height={dims().height}
      flexDirection="column"
      onMouseDown={(evt) => {
        if (evt.button !== MouseButton.RIGHT) return
        props.onCopySelection?.()
      }}
    >
      <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={1} paddingTop={1}>
        {props.children}
      </box>
      <Footer route={props.route} />
      {/* Overlays render last at the root so absolute offsets resolve against the full screen. */}
      <Show keyed when={shell.overlay()}>
        {(overlay) => overlay()}
      </Show>
      <Show when={shell.shortcutsOpen()}>
        <ShortcutsDialog hints={shell.hints()} />
      </Show>
      <Show when={shell.notice()} keyed>
        {(message) => (
          <box
            position="absolute"
            top={1}
            right={2}
            border={["left", "right"]}
            borderColor={theme.accent}
            backgroundColor="#1a1a1a"
            paddingLeft={2}
            paddingRight={2}
          >
            <text fg={theme.text}>{message}</text>
          </box>
        )}
      </Show>
    </box>
  )
}
