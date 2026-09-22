import type { YtDlpConfig } from "./config"
import { AUDIO_FORMAT_EXPR, ytdlpDefaultFormat } from "./ytdlp"

export const MEDIA_PRESETS = [
  { id: "best", label: "Best available", note: "highest quality video + audio" },
  { id: "1080p", label: "Up to 1080p", note: "Full HD or lower" },
  { id: "720p", label: "Up to 720p", note: "smaller video downloads" },
  { id: "mp3", label: "Audio · MP3", note: "widely compatible" },
  { id: "opus", label: "Audio · Opus", note: "efficient audio compression" },
  { id: "original", label: "Audio · original", note: "keep source audio, no re-encode" },
  { id: "custom", label: "Custom format", note: "use the yt-dlp expression from settings" },
] as const

export type MediaPreset = typeof MEDIA_PRESETS[number]["id"]

export function mediaPresetIndex(id: string | undefined): number {
  return Math.max(0, MEDIA_PRESETS.findIndex((preset) => preset.id === id))
}

export function resolveMediaPreset(preset: MediaPreset, config?: YtDlpConfig): {
  format: string
  extractAudio?: boolean
  audioFormat?: string
  audioQuality?: string
} {
  if (preset === "mp3" || preset === "opus" || preset === "original") {
    return {
      format: AUDIO_FORMAT_EXPR,
      extractAudio: true,
      audioFormat: preset === "original" ? "best" : preset,
      ...(preset !== "original" ? { audioQuality: config?.audioQuality ?? "0" } : {}),
    }
  }
  if (preset === "custom") return { format: ytdlpDefaultFormat(config) }
  const limit = preset === "best" ? "" : `[height<=${preset === "1080p" ? 1080 : 720}]`
  const fallback = `bestvideo*${limit}+bestaudio/best${limit}`
  // Prefer H.264 + AAC for compatibility, but still download when unavailable.
  // Every video branch retains the height cap; there is no uncapped fallback.
  const compatible = `bestvideo${limit}[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best${limit}[ext=mp4][vcodec^=avc1]`
  return { format: config?.preferMp4 ? `${compatible}/${fallback}` : fallback }
}
