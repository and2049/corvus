import { RGBA, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { JSX } from "solid-js"
import { theme } from "../theme"

// Alpha backgroundColor on the full-screen box dims everything behind the
// panel; opentui composites it over the existing buffer.
const BACKDROP = RGBA.fromInts(0, 0, 0, 150)

export function Dialog(props: { title: string; width: number; top?: number; children: JSX.Element }) {
  const dims = useTerminalDimensions()
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={dims().width}
      height={dims().height}
      zIndex={10}
      flexDirection="column"
      alignItems="center"
      paddingTop={Math.floor(dims().height * (props.top ?? 0.25))}
      backgroundColor={BACKDROP}
    >
      <box
        width={Math.min(props.width, dims().width - 2)}
        flexDirection="column"
        backgroundColor={theme.elevatedBg}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            {props.title}
          </text>
          <text fg={theme.dim}>esc</text>
        </box>
        {props.children}
      </box>
    </box>
  )
}
