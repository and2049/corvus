import { useTerminalDimensions } from "@opentui/solid"
import { Show, type JSX } from "solid-js"
import { useShell, type Route } from "../context/shell"
import { Footer } from "./footer"

export function Shell(props: { route: Route; children: JSX.Element }) {
  const dims = useTerminalDimensions()
  const shell = useShell()
  return (
    <box width={dims().width} height={dims().height} flexDirection="column">
      <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={1} paddingTop={1}>
        {props.children}
      </box>
      <Footer route={props.route} />
      {/* Overlays render last at the root so absolute offsets resolve against the full screen. */}
      <Show keyed when={shell.overlay()}>
        {(overlay) => overlay()}
      </Show>
    </box>
  )
}
