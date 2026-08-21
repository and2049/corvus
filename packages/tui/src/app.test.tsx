import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { defaultConfig } from "@corvus/core"
import type { Engine } from "@corvus/core"
import { App } from "./app"

function createFakeEngine() {
  const added: string[] = []
  return {
    added,
    engine: {
      snapshots: () => [],
      magnets: () => added,
      keys: () => added,
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
    expect(frame).toContain("v0.1.0")
    expect(frame).toContain("ctrl+g settings")
    expect(frame).toContain("right-click copy selection")
    expect(frame.includes("corvus v0.1.0")).toBe(false)
    await t.renderer.destroy()
  })

  test("tab switches to magnet mode and enter starts the download", async () => {
    const { fake, t } = await renderApp()
    await t.flush()
    expect(t.captureCharFrame()).toContain("enter search")
    t.mockInput.pressTab()
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("magnet link...")
    expect(frame).toContain("enter download")
    const magnet = `magnet:?xt=urn:btih:${"ab".repeat(20)}&dn=ubuntu`
    await t.mockInput.typeText(magnet)
    t.mockInput.pressEnter()
    await t.flush()
    expect(t.captureCharFrame()).toContain("downloads")
    expect(fake.added).toEqual([magnet])
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
    expect(frame).toContain("invalid magnet link")
    expect(frame).toContain("corvus")
    expect(fake.added).toEqual([])
    await t.renderer.destroy()
  })
})
