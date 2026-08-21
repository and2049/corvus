import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { onMount, type JSX } from "solid-js"
import { Shell } from "../component/shell"
import { type ShellStore, ShellProvider, useShell } from "../context/shell"

describe("Shell notice banner", () => {
  test("shows the banner and auto-expires it", async () => {
    let store: ShellStore | undefined
    function Capture(): JSX.Element {
      const shell = useShell()
      onMount(() => {
        store = shell
      })
      return <text>capture</text>
    }
    const t = await testRender(
      () => (
        <ShellProvider>
          <Shell route="home">
            <Capture />
          </Shell>
        </ShellProvider>
      ),
      { width: 80, height: 24 },
    )
    await t.flush()
    expect(store).toBeDefined()
    store!.showNotice("Copied to clipboard", 300)
    await t.flush()
    await Bun.sleep(30)
    await t.flush()
    const shown = String(t.captureCharFrame())
    expect(shown.includes("Copied to clipboard")).toBe(true)
    await Bun.sleep(450)
    await t.flush()
    const expired = String(t.captureCharFrame())
    expect(expired.includes("Copied to clipboard")).toBe(false)
    expect(expired).toContain("capture")
    await t.renderer.destroy()
  })

  test("a new notice replaces a pending one", async () => {
    let store: ShellStore | undefined
    function Capture(): JSX.Element {
      const shell = useShell()
      onMount(() => {
        store = shell
      })
      return <text>capture</text>
    }
    const t = await testRender(
      () => (
        <ShellProvider>
          <Shell route="home">
            <Capture />
          </Shell>
        </ShellProvider>
      ),
      { width: 80, height: 24 },
    )
    await t.flush()
    expect(store).toBeDefined()
    store!.showNotice("first notice", 30)
    store!.showNotice("second notice", 5000)
    await t.flush()
    const frame = String(t.captureCharFrame())
    expect(frame).toContain("second notice")
    expect(frame.includes("first notice")).toBe(false)
    await t.renderer.destroy()
  })
})
