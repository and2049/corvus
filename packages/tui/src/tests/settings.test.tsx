import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { defaultConfig, type ConfigPatch, type Engine } from "@corvus/core"
import { ConfigProvider } from "../context/config"
import { Settings } from "../routes/settings"
import { Sources } from "../routes/sources"

const fakeEngine = {
  snapshots: () => [],
  magnets: () => [],
  keys: () => [],
  add: () => "",
  remove: async () => {},
  shutdown: async () => {},
} as unknown as Engine

describe("Sources", () => {
  test("space toggles the first provider off and emits a persist patch", async () => {
    const patches: ConfigPatch[] = []
    const t = await testRender(
      () => (
        <ConfigProvider engine={fakeEngine} initial={defaultConfig()} persist={(p) => patches.push(p)}>
          <Sources onBack={() => {}} />
        </ConfigProvider>
      ),
      { width: 100, height: 30 },
    )
    await t.flush()
    expect(t.captureCharFrame()).toContain("[x] knaben")
    t.mockInput.pressEnter()
    await t.flush()
    expect(t.captureCharFrame()).toContain("[ ] knaben")
    expect(patches).toEqual([{ providers: { knaben: { enabled: false } } }])
    await t.renderer.destroy()
  })
})

describe("Settings", () => {
  test("toggling seed-after-complete flips the value and persists", async () => {
    const patches: ConfigPatch[] = []
    const t = await testRender(
      () => (
        <ConfigProvider engine={fakeEngine} initial={defaultConfig()} persist={(p) => patches.push(p)}>
          <Settings onBack={() => {}} onOpenSources={() => {}} />
        </ConfigProvider>
      ),
      { width: 100, height: 30 },
    )
    await t.flush()
    expect(t.captureCharFrame()).toContain("seed after complete")
    t.mockInput.pressArrow("down")
    await t.flush()
    t.mockInput.pressEnter()
    await t.flush()
    expect(patches).toEqual([{ seedAfterComplete: true }])
    await t.renderer.destroy()
  })

  test("theme row toggles between dark and light and persists", async () => {
    const patches: ConfigPatch[] = []
    const t = await testRender(
      () => (
        <ConfigProvider engine={fakeEngine} initial={defaultConfig()} persist={(p) => patches.push(p)}>
          <Settings onBack={() => {}} onOpenSources={() => {}} />
        </ConfigProvider>
      ),
      { width: 100, height: 30 },
    )
    await t.flush()
    // rows: downloadDir, seed, torrentPort, maxConns, downloadLimit, uploadLimit, proxy, hideNSFW, theme
    for (let i = 0; i < 8; i += 1) {
      t.mockInput.pressArrow("down")
      await t.flush()
    }
    expect(t.captureCharFrame()).toContain("dark")
    t.mockInput.pressEnter()
    await t.flush()
    expect(patches).toEqual([{ theme: "light" }])
    expect(t.captureCharFrame()).toContain("light")
    t.mockInput.pressEnter()
    await t.flush()
    expect(patches).toEqual([{ theme: "light" }, { theme: "dark" }])
    await t.renderer.destroy()
  })

  test("download limit row parses a human size and persists bytes", async () => {
    const patches: ConfigPatch[] = []
    const t = await testRender(
      () => (
        <ConfigProvider engine={fakeEngine} initial={defaultConfig()} persist={(p) => patches.push(p)}>
          <Settings onBack={() => {}} onOpenSources={() => {}} />
        </ConfigProvider>
      ),
      { width: 100, height: 30 },
    )
    await t.flush()
    expect(t.captureCharFrame()).toContain("(unlimited)")
    // rows: downloadDir, seed, torrentPort, maxConns, downloadLimit
    for (let i = 0; i < 4; i += 1) {
      t.mockInput.pressArrow("down")
      await t.flush()
    }
    t.mockInput.pressEnter()
    await t.flush()
    t.mockInput.typeText("1048576")
    await t.flush()
    t.mockInput.pressEnter()
    await t.flush()
    expect(patches).toEqual([{ downloadLimit: 1048576 }])
    expect(t.captureCharFrame()).toContain("1.0 MiB/s")
    await t.renderer.destroy()
  })

  test("clearing the upload limit persists the unlimited sentinel", async () => {
    const patches: ConfigPatch[] = []
    const initial = { ...defaultConfig(), uploadLimit: 1048576 }
    const t = await testRender(
      () => (
        <ConfigProvider engine={fakeEngine} initial={initial} persist={(p) => patches.push(p)}>
          <Settings onBack={() => {}} onOpenSources={() => {}} />
        </ConfigProvider>
      ),
      { width: 100, height: 30 },
    )
    await t.flush()
    for (let i = 0; i < 5; i += 1) {
      t.mockInput.pressArrow("down")
      await t.flush()
    }
    t.mockInput.pressEnter()
    await t.flush()
    t.mockInput.pressEnter()
    await t.flush()
    expect(patches).toEqual([{ uploadLimit: -1 }])
    await t.renderer.destroy()
  })
})

describe("Settings soulseek credentials", () => {
  const openRow = async (t: Awaited<ReturnType<typeof testRender>>, index: number) => {
    for (let i = 0; i < index; i += 1) {
      t.mockInput.pressArrow("down")
      await t.flush()
    }
    t.mockInput.pressEnter()
    await t.flush()
  }

  test("username row persists under providers.soulseek and shows the value", async () => {
    const patches: ConfigPatch[] = []
    const t = await testRender(
      () => (
        <ConfigProvider engine={fakeEngine} initial={defaultConfig()} persist={(p) => patches.push(p)}>
          <Settings onBack={() => {}} onOpenSources={() => {}} />
        </ConfigProvider>
      ),
      { width: 100, height: 30 },
    )
    await t.flush()
    expect(t.captureCharFrame()).toContain("soulseek username")
    await openRow(t, 10)
    t.mockInput.typeText("crow")
    await t.flush()
    t.mockInput.pressEnter()
    await t.flush()
    expect(patches).toEqual([{ providers: { soulseek: { username: "crow" } } }])
    expect(t.captureCharFrame()).toContain("crow")
    await t.renderer.destroy()
  })

  test("password row starts empty, persists raw and renders masked", async () => {
    const patches: ConfigPatch[] = []
    const t = await testRender(
      () => (
        <ConfigProvider engine={fakeEngine} initial={defaultConfig()} persist={(p) => patches.push(p)}>
          <Settings onBack={() => {}} onOpenSources={() => {}} />
        </ConfigProvider>
      ),
      { width: 100, height: 30 },
    )
    await t.flush()
    await openRow(t, 11)
    t.mockInput.typeText("s3cret")
    await t.flush()
    t.mockInput.pressEnter()
    await t.flush()
    expect(patches).toEqual([{ providers: { soulseek: { password: "s3cret" } } }])
    const frame = t.captureCharFrame()
    expect(frame).toContain("******")
    expect(frame).not.toContain("s3cret")
    await t.renderer.destroy()
  })
})

describe("Sources soulseek guard", () => {
  test("flags soulseek as not configured until credentials exist", async () => {
    const patches: ConfigPatch[] = []
    const t = await testRender(
      () => (
        <ConfigProvider engine={fakeEngine} initial={defaultConfig()} persist={(p) => patches.push(p)}>
          <Sources onBack={() => {}} />
        </ConfigProvider>
      ),
      { width: 100, height: 30 },
    )
    await t.flush()
    expect(t.captureCharFrame()).toMatch(/soulseek\s+not configured/)
    for (let i = 0; i < 5; i += 1) {
      t.mockInput.pressArrow("down")
      await t.flush()
    }
    t.mockInput.pressEnter()
    await t.flush()
    expect(patches).toEqual([{ providers: { soulseek: { enabled: true } } }])
    await t.renderer.destroy()
  })
})
