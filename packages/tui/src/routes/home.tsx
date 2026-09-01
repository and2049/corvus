import { type InputRenderable, TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js"
import type { YtDlpInfo } from "@corvus/core"
import { APP_VERSION, providerCounts } from "../component/footer"
import { AUDIO_FORMATS, AUDIO_QUALITIES, FormatDialog, audioFormatIndex } from "../component/format-dialog"
import { HRule } from "../component/hrule"
import { Logo } from "../component/logo"
import { useConfigOptional } from "../context/config"
import { useDownloadsOptional } from "../context/downloads"
import { useShell, type Hint } from "../context/shell"
import { theme } from "../theme"

const HOME_HINTS: readonly Hint[] = [
  { key: "tab", label: "cycle mode" },
  { key: "ctrl+g", label: "settings" },
  { key: "ctrl+f", label: "sources" },
  { key: "right click", label: "copy selection" },
]

const INSERT_HINTS: readonly Hint[] = [{ key: "esc", label: "normal" }]

const NORMAL_HINTS: readonly Hint[] = [
  { key: "d", label: "downloads" },
  { key: "i", label: "insert", pinned: true },
]

type Mode = "search" | "magnet" | "http"

const MODE_ORDER: readonly Mode[] = ["search", "magnet", "http"]

interface ModeConfig {
  readonly label: string
  readonly placeholder: string
  readonly action: string
  readonly accent: boolean
}

const MODES: Record<Mode, ModeConfig> = {
  search: { label: "search", placeholder: "query...", action: "enter search", accent: false },
  magnet: { label: "magnet", placeholder: "magnet, .torrent path or url...", action: "enter download", accent: true },
  http: { label: "http", placeholder: "video url (youtube and many others)...", action: "enter fetch formats", accent: true },
}

// Full tracker lists push real-world magnets well past opentui's default
// input maxLength of 1000, which truncates pastes silently.
const MAGNET_MAX_LENGTH = 8192

export function Home(props: {
  onSubmit: (query: string) => void
  onDownload?: () => void
  inputRef?: (el: InputRenderable) => void
}) {
  const shell = useShell()
  const config = useConfigOptional()
  const downloads = useDownloadsOptional()
  const [mode, setMode] = createSignal<Mode>("search")
  const [normal, setNormal] = createSignal(false)
  const [resolving, setResolving] = createSignal(false)
  const [picker, setPicker] = createSignal<YtDlpInfo | undefined>(undefined)
  const [pickerCursor, setPickerCursor] = createSignal(0)
  const [pickerAudio, setPickerAudio] = createSignal(false)
  const [audioCursor, setAudioCursor] = createSignal(0)
  const [audioQuality, setAudioQuality] = createSignal(0)
  let input: InputRenderable | undefined

  onMount(() => input?.focus())
  createEffect(() => shell.setHints(normal() ? NORMAL_HINTS : INSERT_HINTS))
  onCleanup(() => shell.setOverlay(undefined))

  // The home input keeps focus, so while the picker is up we blur it and drive
  // the overlay from useKeyboard instead; refocus on close.
  const openPicker = (info: YtDlpInfo) => {
    setPickerCursor(0)
    setPickerAudio(false)
    // Seed the audio list on the configured default format so ytdlp.audioFormat
    // is honoured; quality starts at "best".
    setAudioCursor(audioFormatIndex(downloads?.audioFormat() ?? "mp3"))
    setAudioQuality(0)
    setPicker(info)
    input?.blur()
    shell.setOverlay(() => (
      <FormatDialog
        info={info}
        cursor={pickerCursor}
        audio={pickerAudio}
        audioCursor={audioCursor}
        audioQuality={audioQuality}
      />
    ))
  }
  const closePicker = () => {
    setPicker(undefined)
    shell.setOverlay(undefined)
    // Refocus on the next microtask, NOT synchronously. This runs inside a
    // keypress dispatch (Home's global useKeyboard handler); OpenTUI snapshots
    // the focused element's keypress handlers AFTER global listeners run, so a
    // synchronous input.focus() here would deliver this very Enter to the input
    // too - re-firing onSubmit, re-probing the URL and reopening the picker
    // after Home has unmounted (leaving no esc handler to dismiss it).
    queueMicrotask(() => {
      if (!normal()) input?.focus()
    })
  }

  const choose = (info: YtDlpInfo) => {
    const audio = pickerAudio()
    const format = info.formats[pickerCursor()]
    // In audio mode the highlighted video row is irrelevant (best audio is
    // extracted and re-encoded to the chosen container), so an empty video
    // format list still allows an audio-only download.
    const audioSpec = audio ? audioChoice() : undefined
    closePicker()
    if (format === undefined && audioSpec === undefined) return
    const outcome = downloads?.addHttp(info, format, audioSpec)
    if (outcome === "added" || outcome === "duplicate") {
      if (outcome === "duplicate") shell.showNotice("already added")
      props.onDownload?.()
      return
    }
    shell.showNotice("could not start download")
  }

  // The (format, quality) the audio list currently points at. Quality only
  // applies to lossy re-encodes; lossless/source keep the source bitrate.
  const audioChoice = (): { format: string; quality?: string } => {
    const choice = AUDIO_FORMATS[audioCursor()]!
    const quality = choice.kind === "lossy" ? AUDIO_QUALITIES[audioQuality()]!.value : undefined
    return { format: choice.format, quality }
  }

  useKeyboard((key) => {
    if (shell.shortcutsOpen()) return
    const info = picker()
    if (info !== undefined) {
      if (key.name === "escape") {
        closePicker()
      } else if (key.name === "a") {
        setPickerAudio((v) => !v)
      } else if (key.name === "return") {
        choose(info)
      } else if (pickerAudio()) {
        if (key.name === "up") setAudioCursor((c) => Math.max(0, c - 1))
        else if (key.name === "down") setAudioCursor((c) => Math.min(AUDIO_FORMATS.length - 1, c + 1))
        else if (key.name === "left") setAudioQuality((q) => Math.max(0, q - 1))
        else if (key.name === "right") setAudioQuality((q) => Math.min(AUDIO_QUALITIES.length - 1, q + 1))
      } else if (key.name === "up") {
        setPickerCursor((c) => Math.max(0, c - 1))
      } else if (key.name === "down") {
        setPickerCursor((c) => Math.min(Math.max(info.formats.length - 1, 0), c + 1))
      }
      return
    }
    if (normal()) {
      if (key.ctrl) return
      if (key.name === "i") {
        setNormal(false)
        // Deferred for the same reason as closePicker: a synchronous focus
        // would deliver this very "i" to the input.
        queueMicrotask(() => input?.focus())
      } else if (key.name === "d") {
        props.onDownload?.()
      }
      return
    }
    if (key.name === "escape") {
      setNormal(true)
      input?.blur()
      return
    }
    if (key.name === "tab" && !key.ctrl && !key.shift) {
      setMode((current) => MODE_ORDER[(MODE_ORDER.indexOf(current) + 1) % MODE_ORDER.length]!)
    }
  })

  const submit = async (value: unknown) => {
    const text = String(value).trim()
    if (text === "" || resolving() || picker() !== undefined) return
    if (mode() === "search") {
      props.onSubmit(text)
      return
    }
    if (mode() === "http") {
      if (!/^https?:\/\//i.test(text)) {
        shell.showNotice("enter an http(s) url")
        return
      }
      setResolving(true)
      const outcome = await downloads?.probeHttp(text)
      setResolving(false)
      if (outcome === undefined) return
      if ("error" in outcome) {
        shell.showNotice(`yt-dlp: ${outcome.error}`)
        return
      }
      if (outcome.info.formats.length === 0) {
        shell.showNotice("no downloadable formats found")
        return
      }
      openPicker(outcome.info)
      return
    }
    const outcome = await downloads?.addInput(text)
    if (outcome === "added" || outcome === "duplicate") {
      if (outcome === "duplicate") shell.showNotice("already added")
      props.onDownload?.()
      return
    }
    shell.showNotice("invalid magnet or torrent")
  }

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <box flexGrow={1} flexBasis={0} minWidth={0}>
          <Logo />
        </box>
        <box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0}>
          <box flexDirection="row" gap={2}>
            <text fg={theme.accent} attributes={TextAttributes.BOLD}>
              corvus
            </text>
            <text fg={theme.dim}>{`v${APP_VERSION}`}</text>
          </box>
          <text fg={theme.muted} truncate wrapMode="none">
            {config?.config()?.downloadDir ?? ""}
          </text>
          <box flexDirection="row">
            <text fg={theme.text}>{providerCounts(config?.config())}</text>
            <text fg={theme.muted}>{" sources"}</text>
          </box>
          <box height={1} flexShrink={0} />
          <For each={HOME_HINTS}>
            {(hint) => (
              <box flexDirection="row">
                <text fg={theme.text}>{hint.key}</text>
                <text fg={theme.muted}>{` ${hint.label}`}</text>
              </box>
            )}
          </For>
        </box>
      </box>
      <box flexDirection="column" flexShrink={0}>
        <HRule />
        <box flexDirection="row" gap={1}>
          <text fg={normal() ? theme.dim : MODES[mode()].accent ? theme.accent : theme.muted}>{MODES[mode()].label}</text>
          <input
            ref={(el: InputRenderable) => {
              input = el
              props.inputRef?.(el)
            }}
            flexGrow={1}
            maxLength={MAGNET_MAX_LENGTH}
            onSubmit={(value: unknown) => void submit(value)}
            placeholder={MODES[mode()].placeholder}
            placeholderColor={theme.dim}
            textColor={normal() ? theme.dim : theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.accent}
          />
        </box>
        <HRule />
        <text fg={theme.dim}>{resolving() ? "resolving..." : MODES[mode()].action}</text>
      </box>
    </box>
  )
}
