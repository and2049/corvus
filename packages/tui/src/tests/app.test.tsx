import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { defaultConfig } from "@corvus/core"
import type { Engine } from "@corvus/core"
import { infoHashFromMagnet } from "@corvus/providers"
import { App } from "../app"
import { CORVUS_VERSION } from "../version"

function createFakeEngine() {
  const added: string[] = []
  return {
    added,
    engine: {
      snapshots: () => [],
      magnets: () => added,
      keys: () => added.map((magnet) => infoHashFromMagnet(magnet) ?? magnet),
      add: (magnet: string) => {
        added.push(magnet)
        return magnet
      },
      remove: async () => {},
      pause: () => {},
      resume: () => {},
      toggleFile: () => {},
      retry: async () => {},
      clientError: () => undefined,
      shutdown: async () => {},
    } as unknown as Engine,
  }
}

async function renderApp() {
  const fake = createFakeEngine()
  const t = await testRender(() => <App config={defaultConfig()} engine={fake.engine} persist={() => {}} />, {
    width: 100,
    height: 30,
  })
  return { fake, t }
}

describe("App", () => {
  test("home screen renders bird art, name and search prompt", async () => {
    const { t } = await renderApp()
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("corvus")
    expect(frame).toContain("search")
    expect(frame).toContain("enter search")
    expect(frame.includes("⣿")).toBe(true)
    await t.renderer.destroy()
  })

  test("home footer shows stats only; identity and hints live in the info panel", async () => {
    const { t } = await renderApp()
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("idle")
    expect(frame).toContain(`v${CORVUS_VERSION}`)
    expect(frame).toContain("ctrl+g settings")
    expect(frame).toContain("ctrl+shift+c copy selection")
    expect(frame.includes(`corvus v${CORVUS_VERSION}`)).toBe(false)
    await t.renderer.destroy()
  })

  test("tab switches to magnet mode and enter starts the download", async () => {
    const { fake, t } = await renderApp()
    await t.flush()
    expect(t.captureCharFrame()).toContain("enter search")
    t.mockInput.pressTab()
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("magnet, .torrent path or url...")
    expect(frame).toContain("enter download")
    const magnet = `magnet:?xt=urn:btih:${"ab".repeat(20)}&dn=ubuntu`
    await t.mockInput.typeText(magnet)
    t.mockInput.pressEnter()
    await t.flush()
    expect(t.captureCharFrame()).toContain("downloads")
    // The pasted magnet is merged with DEFAULT_TRACKERS before hitting the engine.
    expect(fake.added).toHaveLength(1)
    expect(fake.added[0]!.startsWith(magnet)).toBe(true)
    expect(fake.added[0]).toContain("&tr=")
    await t.renderer.destroy()
  })

  test("tab toggles back to search mode", async () => {
    const { t } = await renderApp()
    await t.flush()
    t.mockInput.pressTab()
    await t.flush()
    t.mockInput.pressTab()
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("query...")
    expect(frame).toContain("enter search")
    await t.renderer.destroy()
  })

  test("an invalid magnet shows a notice and stays on home", async () => {
    const { fake, t } = await renderApp()
    await t.flush()
    t.mockInput.pressTab()
    await t.flush()
    await t.mockInput.typeText("not-a-magnet")
    t.mockInput.pressEnter()
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("invalid magnet or torrent")
    expect(frame).toContain("corvus")
    expect(fake.added).toEqual([])
    await t.renderer.destroy()
  })

  test("an infohash without the magnet:? header is rejected", async () => {
    const { fake, t } = await renderApp()
    await t.flush()
    t.mockInput.pressTab()
    await t.flush()
    await t.mockInput.typeText(`urn:btih:${"ab".repeat(20)}`)
    t.mockInput.pressEnter()
    await t.flush()
    expect(t.captureCharFrame()).toContain("invalid magnet or torrent")
    expect(fake.added).toEqual([])
    await t.renderer.destroy()
  })

  test("pasting a magnet for an already-added infohash shows a notice, not a new row", async () => {
    const fake = createFakeEngine()
    fake.added.push(`magnet:?xt=urn:btih:${"ab".repeat(20)}&dn=original`)
    const t = await testRender(() => <App config={defaultConfig()} engine={fake.engine} persist={() => {}} />, {
      width: 100,
      height: 30,
    })
    await t.flush()
    t.mockInput.pressTab()
    await t.flush()
    await t.mockInput.typeText(`magnet:?xt=urn:btih:${"ab".repeat(20)}&dn=other`)
    t.mockInput.pressEnter()
    await t.flush()
    expect(t.captureCharFrame()).toContain("already added")
    expect(fake.added).toHaveLength(1)
    await t.renderer.destroy()
  })

  test("ctrl+shift+c copies instead of exiting; plain ctrl+c still exits", async () => {
    const fake = createFakeEngine()
    let exited = 0
    const t = await testRender(
      () => (
        <App
          config={defaultConfig()}
          engine={fake.engine}
          persist={() => {}}
          onExit={() => {
            exited += 1
          }}
        />
      ),
      { width: 100, height: 30, kittyKeyboard: true },
    )
    await t.flush()
    t.mockInput.pressKey("c", { ctrl: true, shift: true })
    await t.flush()
    expect(exited).toBe(0)
    t.mockInput.pressKey("c", { ctrl: true })
    await t.flush()
    expect(exited).toBe(1)
    await t.renderer.destroy()
  })
})
