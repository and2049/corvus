import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { defaultConfig } from "@corvus/core"
import type { Engine } from "@corvus/core"
import { App } from "./app"

const fakeEngine = {
  snapshots: () => [],
  magnets: () => [],
  keys: () => [],
  add: () => "",
  remove: async () => {},
  shutdown: async () => {},
} as unknown as Engine

describe("App", () => {
  test("home screen renders bird art, name and search prompt", async () => {
    const t = await testRender(() => <App config={defaultConfig()} engine={fakeEngine} persist={() => {}} />, {
      width: 100,
      height: 30,
    })
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("corvus")
    expect(frame).toContain("search")
    expect(frame).toContain("enter search")
    expect(frame.includes("⣿")).toBe(true)
    await t.renderer.destroy()
  })

  test("shell footer shows identity, stats and route hints", async () => {
    const t = await testRender(() => <App config={defaultConfig()} engine={fakeEngine} persist={() => {}} />, {
      width: 100,
      height: 30,
    })
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("corvus v0.1.0")
    expect(frame).toContain("idle")
    expect(frame).toContain("ctrl+g settings")
    await t.renderer.destroy()
  })
})
