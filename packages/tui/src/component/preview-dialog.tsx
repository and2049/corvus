import { Show } from "solid-js"
import type { TorrentResult } from "@corvus/providers"
import { formatSize } from "../format"
import { seedColor, theme } from "../theme"
import { Dialog } from "./dialog"

export function PreviewDialog(props: { result: TorrentResult }) {
  const r = () => props.result
  return (
    <Dialog title={r().slsk !== undefined ? "download this file?" : "download this torrent?"} width={88}>
      <text fg={theme.text} wrapMode="none" truncate>
        {r().title}
      </text>
      <box flexDirection="row" gap={2} paddingTop={1}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.muted}>seeders</text>
          <text fg={seedColor(r().seeders)}>{String(r().seeders)}</text>
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.muted}>leechers</text>
          <text fg={theme.dim}>{String(r().leechers)}</text>
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.muted}>size</text>
          <text fg={theme.text}>{formatSize(r())}</text>
        </box>
      </box>
      <box flexDirection="row" gap={2}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.muted}>source</text>
          <text fg={theme.dim}>{r().provider}</text>
        </box>
        <Show when={r().alsoOn.length > 0}>
          <text fg={theme.dim}>also on {r().alsoOn.join(", ")}</text>
        </Show>
        <Show when={r().trusted}>
          <text fg={theme.success}>trusted</text>
        </Show>
      </box>
      <Show when={r().slsk} keyed>
        {(slsk) => (
          <box flexDirection="row" gap={2}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.muted}>peer</text>
              <text fg={theme.text}>{slsk.username}</text>
            </box>
            <text fg={theme.dim}>{r().seeders > 0 ? "slot free" : `queue ${String(r().leechers)}`}</text>
          </box>
        )}
      </Show>
      <text fg={theme.dim} paddingTop={1}>
        enter download
      </text>
    </Dialog>
  )
}
