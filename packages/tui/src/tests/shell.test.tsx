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

  test("shortcuts menu lists non-esc hints and closes when hints change", async () => {
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
          <Shell route="downloads">
            <Capture />
          </Shell>
        </ShellProvider>
      ),
      { width: 80, height: 24 },
    )
    await t.flush()
    store!.setHints([
      { key: "p", label: "pause/resume" },
      { key: "esc", label: "back" },
    ])
    await t.flush()
    const footer = String(t.captureCharFrame())
    expect(footer).toContain("ctrl+k shortcuts")
    expect(footer).toContain("esc back")
    expect(footer.includes("pause/resume")).toBe(false)
    store!.setShortcutsOpen(true)
    await t.flush()
    const open = String(t.captureCharFrame())
    expect(open).toContain("pause/resume")
    store!.setHints([{ key: "esc", label: "back" }])
    await t.flush()
    expect(store!.shortcutsOpen()).toBe(false)
    const closed = String(t.captureCharFrame())
    expect(closed.includes("pause/resume")).toBe(false)
    expect(closed.includes("ctrl+k shortcuts")).toBe(false)
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
