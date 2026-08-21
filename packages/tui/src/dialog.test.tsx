import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { TorrentResult } from "@corvus/providers"
import { PreviewDialog } from "./routes/results"

const result: TorrentResult = {
  title: "Stub Movie 2024 1080p",
  size: "1.4 GB",
  sizeBytes: 1_400_000_000,
  seeders: 77,
  leechers: 3,
  magnet: "magnet:?xt=urn:btih:" + "ab".repeat(20),
  provider: "stub",
  trusted: true,
  alsoOn: ["other"],
}

describe("PreviewDialog", () => {
  test("renders", async () => {
    const t = await testRender(() => <PreviewDialog result={result} />, { width: 100, height: 30 })
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("download this torrent?")
    await t.renderer.destroy()
  })
})
