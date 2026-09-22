import type { ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, For, Match, Show, Switch } from "solid-js"
import type { YtDlpFormat, YtDlpInfo } from "@corvus/core"
import { MEDIA_PRESETS } from "@corvus/core"
import { formatBytes } from "@corvus/providers"
import { theme } from "../theme"
import { Dialog } from "./dialog"

export interface AudioFormatChoice {
  readonly format: string
  readonly kind: "lossy" | "lossless" | "source"
  readonly note: string
}

// The output containers yt-dlp's --audio-format accepts, most useful first.
export const AUDIO_FORMATS: readonly AudioFormatChoice[] = [
  { format: "mp3", kind: "lossy", note: "universal" },
  { format: "m4a", kind: "lossy", note: "aac in mp4" },
  { format: "opus", kind: "lossy", note: "best size/quality" },
  { format: "vorbis", kind: "lossy", note: "ogg" },
  { format: "aac", kind: "lossy", note: "" },
  { format: "flac", kind: "lossless", note: "compressed lossless" },
  { format: "wav", kind: "lossless", note: "uncompressed" },
  { format: "alac", kind: "lossless", note: "apple lossless" },
  { format: "best", kind: "source", note: "keep source, no re-encode" },
]

export interface AudioQualityChoice {
  readonly label: string
  // yt-dlp --audio-quality: 0 (best) .. 9 (worst) VBR for lossy re-encodes.
  readonly value: string
}

export const AUDIO_QUALITIES: readonly AudioQualityChoice[] = [
  { label: "best", value: "0" },
  { label: "high", value: "2" },
  { label: "std", value: "5" },
  { label: "low", value: "9" },
]

export function audioFormatIndex(format: string): number {
  const index = AUDIO_FORMATS.findIndex((choice) => choice.format === format)
  return index === -1 ? 0 : index
}

function quality(format: YtDlpFormat): string {
  if (format.resolution === "audio only" || (format.vcodec === "none" && format.acodec !== "none")) return "audio"
  if (format.note !== undefined && format.note !== "") return format.note
  if (format.height !== undefined) return `${format.height}p`
  return format.resolution ?? format.formatId
}

function codecs(format: YtDlpFormat): string {
  const parts = [format.vcodec, format.acodec]
    .filter((c): c is string => c !== undefined && c !== "" && c !== "none")
    .map((c) => c.split(".")[0])
  return parts.join("+")
}

function size(format: YtDlpFormat): string {
  return format.filesize !== undefined && format.filesize > 0 ? formatBytes(format.filesize) : "?"
}

// Keep the cursor row inside the scrollbox viewport.
function followCursor(scroll: ScrollBoxRenderable | undefined, index: number): void {
  if (scroll === undefined) return
  const target = scroll.getChildren()[index]
  if (target === undefined) return
  const y = target.y - scroll.y
  if (y >= scroll.height) scroll.scrollBy(y - scroll.height + 1)
  else if (y < 0) scroll.scrollBy(y)
}

export function FormatDialog(props: {
  info: YtDlpInfo
  cursor: () => number
  audio: () => boolean
  audioCursor: () => number
  audioQuality: () => number
  presets: () => boolean
  presetCursor: () => number
  preferMp4: () => boolean
}) {
  const dims = useTerminalDimensions()
  const formats = createMemo(() => props.info.formats)
  const listHeight = () => Math.max(3, Math.floor(dims().height * 0.5))
  const audioChoice = createMemo(() => AUDIO_FORMATS[props.audioCursor()])
  let scroll: ScrollBoxRenderable | undefined

  createEffect(() => {
    const index = props.audio() ? props.audioCursor() : props.presets() ? props.presetCursor() : props.cursor()
    void (props.audio() ? AUDIO_FORMATS.length : props.presets() ? MEDIA_PRESETS.length : formats().length)
    followCursor(scroll, index)
  })

  return (
    <Dialog title={props.audio() ? "extract audio" : "choose a format"} width={88} top={0.15}>
      <text fg={theme.text} wrapMode="none" truncate>
        {props.info.title}
      </text>
      <box height={listHeight()} flexShrink={0} flexDirection="column" paddingTop={1}>
        <scrollbox ref={(el: ScrollBoxRenderable) => (scroll = el)} flexGrow={1} viewportOptions={{ paddingRight: 1 }}>
          <Switch>
            <Match when={!props.audio() && !props.presets()}>
              <For each={formats()}>
                {(format, index) => {
                  const selected = createMemo(() => index() === props.cursor())
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
                      <text flexShrink={0} fg={selected() ? theme.accent : theme.text}>
                        {quality(format).padEnd(9)}
                      </text>
                      <text flexShrink={0} fg={theme.muted}>
                        {format.ext.padEnd(5)}
                      </text>
                      <text fg={theme.dim} truncate flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none">
                        {codecs(format)}
                      </text>
                      <text flexShrink={0} fg={theme.text}>
                        {size(format).padStart(9)}
                      </text>
                    </box>
                  )
                }}
              </For>
            </Match>
            <Match when={props.audio()}>
              <For each={AUDIO_FORMATS}>
              {(choice, index) => {
                const selected = createMemo(() => index() === props.audioCursor())
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
                    <text flexShrink={0} fg={selected() ? theme.accent : theme.text}>
                      {choice.format.padEnd(7)}
                    </text>
                    <text flexShrink={0} fg={theme.muted}>
                      {choice.kind.padEnd(9)}
                    </text>
                    <text fg={theme.dim} truncate flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none">
                      {choice.note}
                    </text>
                    <text flexShrink={0} fg={selected() && choice.kind === "lossy" ? theme.accent : theme.muted}>
                      {(selected() && choice.kind === "lossy" ? AUDIO_QUALITIES[props.audioQuality()]!.label : "").padStart(8)}
                    </text>
                  </box>
                )
              }}
              </For>
            </Match>
            <Match when={props.presets()}>
              <For each={MEDIA_PRESETS}>
              {(preset, index) => (
                <box flexDirection="row" gap={1} height={1} flexShrink={0} backgroundColor={index() === props.presetCursor() ? theme.selectedBg : undefined}>
                  <text fg={theme.accent}>{index() === props.presetCursor() ? "›" : " "}</text>
                  <text fg={index() === props.presetCursor() ? theme.accent : theme.text}>{preset.label.padEnd(20)}</text>
                  <text fg={theme.dim} truncate wrapMode="none">{preset.note}</text>
                </box>
              )}
              </For>
            </Match>
          </Switch>
        </scrollbox>
      </box>
      <text fg={theme.dim} flexShrink={0}>
        <Show when={props.audio()} fallback={props.presets()
          ? `enter download · f formats · a audio · m prefer MP4: ${props.preferMp4() ? "on" : "off"}`
          : "enter download · p presets · a audio"}>
          {audioChoice()?.kind === "lossy"
            ? "enter extract audio · ←/→ quality · a video · p presets"
            : "enter extract audio · a video · p presets"}
        </Show>
      </text>
    </Dialog>
  )
}
