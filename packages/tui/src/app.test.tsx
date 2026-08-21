import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { defaultConfig } from "@corvus/core"
import { App } from "./app"

describe("App", () => {
  test("home screen renders bird art, name and search prompt", async () => {
    const t = await testRender(() => <App config={defaultConfig()} />, { width: 100, height: 30 })
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("corvus")
    expect(frame).toContain("search")
    expect(frame).toContain("enter search")
    expect(frame.includes("⣿")).toBe(true)
    await t.renderer.destroy()
  })
})
