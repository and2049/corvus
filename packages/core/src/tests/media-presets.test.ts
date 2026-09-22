import { describe, expect, test } from "bun:test"
import { resolveMediaPreset } from "../media-presets"

describe("media presets", () => {
  test("best selects video and audio; custom expressions remain untouched", () => {
    expect(resolveMediaPreset("best").format).toBe("bestvideo*+bestaudio/best")
    expect(resolveMediaPreset("custom", { format: "  best[ext=webm]  ", preferMp4: true }).format).toBe("best[ext=webm]")
    expect(resolveMediaPreset("custom", { format: " " }).format).toBe("bestvideo*+bestaudio/best")
  })

  for (const preset of ["1080p", "720p"] as const) {
    test(`${preset} caps every fallback, including MP4 preference`, () => {
      const limit = preset === "1080p" ? 1080 : 720
      for (const preferMp4 of [true, false]) {
        const expression = resolveMediaPreset(preset, { preferMp4 }).format
        for (const fallback of expression.split("/")) {
          expect(fallback).toContain(`[height<=${limit}]`)
        }
        if (preferMp4) {
          expect(expression).toContain("[vcodec^=avc1]+bestaudio[ext=m4a]")
          expect(expression).toEndWith(`bestvideo*[height<=${limit}]+bestaudio/best[height<=${limit}]`)
        }
      }
    })
  }

  test("audio presets carry conversion options, while original avoids re-encoding quality", () => {
    expect(resolveMediaPreset("mp3", { audioQuality: "5" })).toEqual({
      format: "bestaudio/best", extractAudio: true, audioFormat: "mp3", audioQuality: "5",
    })
    expect(resolveMediaPreset("opus").audioFormat).toBe("opus")
    expect(resolveMediaPreset("original", { audioQuality: "5" })).toEqual({
      format: "bestaudio/best", extractAudio: true, audioFormat: "best",
    })
  })
})
