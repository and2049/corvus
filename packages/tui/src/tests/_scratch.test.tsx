import { test } from "bun:test"
import { testRender } from "@opentui/solid"
import { defaultConfig } from "@corvus/core"
import type { Engine, HttpDownloads, YtDlpInfo } from "@corvus/core"
import { infoHashFromMagnet } from "@corvus/providers"
import { App } from "../app"

const INFO: YtDlpInfo = {
  url: "https://example.com/watch?v=abc",
  id: "abc",
  title: "Some Music Video - Artist",
  formats: [
    { formatId: "137", ext: "mp4", height: 1080, vcodec: "avc1", acodec: "none", filesize: 52_000_000, note: "1080p" },
    { formatId: "140", ext: "m4a", vcodec: "none", acodec: "mp4a", filesize: 3_400_000, resolution: "audio only" },
  ],
}

test("scratch: audio picker frame", async () => {
  const added: string[] = []
  const engine = {
    snapshots: () => [],
    magnets: () => added,
    keys: () => added.map((m) => infoHashFromMagnet(m) ?? m),
    add: (m: string) => (added.push(m), m),
    remove: async () => {},
    pause: () => {},
    resume: () => {},
    toggleFile: () => {},
    retry: async () => {},
    clientError: () => undefined,
    shutdown: async () => {},
  } as unknown as Engine
  const http = {
    probe: async () => INFO,
    add: () => "http:x",
    audioFormat: () => "mp3",
    keys: () => [],
    snapshots: () => [],
    persisted: () => [],
    remove: async () => {},
    pause: () => {},
    resume: () => {},
    retry: () => {},
    urlFor: () => undefined,
  } as unknown as HttpDownloads
  const t = await testRender(() => <App config={defaultConfig()} engine={engine} http={http} persist={() => {}} />, {
    width: 100,
    height: 30,
  })
  await t.flush()
  t.mockInput.pressTab()
  t.mockInput.pressTab()
  await t.flush()
  await t.mockInput.typeText("https://example.com/watch?v=abc")
  t.mockInput.pressEnter()
  await t.flush()
  await Bun.sleep(30)
  await t.flush()
  await t.mockInput.typeText("a")
  await t.flush()
  t.mockInput.pressArrow("right")
  await t.flush()
  console.log("\n" + t.captureCharFrame())
  await t.renderer.destroy()
})
