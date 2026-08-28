import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { defaultConfig } from "@corvus/core"
import type { Engine, HttpDownloads, YtDlpInfo } from "@corvus/core"
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

function createFakeHttp(info: YtDlpInfo, configuredAudioFormat = "mp3") {
  const added: { url: string; format: string; extractAudio?: boolean; audioFormat?: string; audioQuality?: string }[] = []
  const probes: string[] = []
  return {
    added,
    probes,
    http: {
      probe: async (url: string) => {
        probes.push(url)
        return info
      },
      add: (req: {
        url: string
        format: string
        extractAudio?: boolean
        audioFormat?: string
        audioQuality?: string
      }) => {
        added.push({
          url: req.url,
          format: req.format,
          extractAudio: req.extractAudio,
          audioFormat: req.audioFormat,
          audioQuality: req.audioQuality,
        })
        return `http:${req.url}`
      },
      audioFormat: () => configuredAudioFormat,
      keys: () => added.map((a) => `http:${a.url}`),
      snapshots: () => [],
      persisted: () => [],
      remove: async () => {},
      pause: () => {},
      resume: () => {},
      retry: () => {},
      urlFor: () => undefined,
    } as unknown as HttpDownloads,
  }
}

const SAMPLE_INFO: YtDlpInfo = {
  url: "https://example.com/watch?v=abc",
  id: "abc",
  title: "Sample Clip",
  formats: [
    { formatId: "137", ext: "mp4", height: 1080, vcodec: "avc1", acodec: "none", filesize: 52_000_000, note: "1080p" },
    { formatId: "140", ext: "m4a", vcodec: "none", acodec: "mp4a", filesize: 3_400_000, resolution: "audio only" },
  ],
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

  test("tab cycles search -> magnet -> http -> search", async () => {
    const { t } = await renderApp()
    await t.flush()
    t.mockInput.pressTab()
    await t.flush()
    expect(t.captureCharFrame()).toContain("magnet, .torrent path or url...")
    t.mockInput.pressTab()
    await t.flush()
    const httpFrame = t.captureCharFrame()
    expect(httpFrame).toContain("video url")
    expect(httpFrame).toContain("enter fetch formats")
    t.mockInput.pressTab()
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("query...")
    expect(frame).toContain("enter search")
    await t.renderer.destroy()
  })

  test("http mode: url opens the format picker and enter starts the chosen download", async () => {
    const fake = createFakeEngine()
    const fakeHttp = createFakeHttp(SAMPLE_INFO)
    const t = await testRender(
      () => <App config={defaultConfig()} engine={fake.engine} http={fakeHttp.http} persist={() => {}} />,
      { width: 100, height: 30 },
    )
    await t.flush()
    t.mockInput.pressTab()
    t.mockInput.pressTab()
    await t.flush()
    await t.mockInput.typeText("https://example.com/watch?v=abc")
    t.mockInput.pressEnter()
    await t.flush()
    await Bun.sleep(30)
    await t.flush()
    const picker = t.captureCharFrame()
    expect(picker).toContain("choose a format")
    expect(picker).toContain("1080p")
    // Enter downloads the highlighted (best-first) format and routes to downloads.
    t.mockInput.pressEnter()
    await t.flush()
    expect(t.captureCharFrame()).toContain("downloads")
    expect(fakeHttp.added).toHaveLength(1)
    expect(fakeHttp.added[0]!.format).toBe("137+bestaudio/137")
    await t.renderer.destroy()
  })

  test("choosing a format does not re-probe or reopen the picker", async () => {
    const fake = createFakeEngine()
    const fakeHttp = createFakeHttp(SAMPLE_INFO)
    const t = await testRender(
      () => <App config={defaultConfig()} engine={fake.engine} http={fakeHttp.http} persist={() => {}} />,
      { width: 100, height: 30 },
    )
    await t.flush()
    t.mockInput.pressTab()
    t.mockInput.pressTab()
    await t.flush()
    await t.mockInput.typeText("https://example.com/watch?v=abc")
    t.mockInput.pressEnter()
    await t.flush()
    await Bun.sleep(30)
    await t.flush()
    expect(t.captureCharFrame()).toContain("choose a format")
    expect(fakeHttp.probes).toHaveLength(1)
    // Selecting the format must not let the Enter also re-fire the input's
    // submit, which would re-probe the URL and reopen the picker on top of the
    // downloads screen with no handler left to dismiss it.
    t.mockInput.pressEnter()
    await t.flush()
    await Bun.sleep(30)
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("downloads")
    expect(frame).not.toContain("choose a format")
    expect(fakeHttp.probes).toHaveLength(1)
    expect(fakeHttp.added).toHaveLength(1)
    await t.renderer.destroy()
  })

  async function openAudioPicker(fakeHttp: ReturnType<typeof createFakeHttp>, config = defaultConfig()) {
    const fake = createFakeEngine()
    const t = await testRender(
      () => <App config={config} engine={fake.engine} http={fakeHttp.http} persist={() => {}} />,
      { width: 100, height: 30 },
    )
    await t.flush()
    t.mockInput.pressTab()
    t.mockInput.pressTab()
    await t.flush()
    await t.mockInput.typeText("https://example.com/watch?v=abc")
    t.mockInput.pressEnter()
    await t.flush()
    await Bun.sleep(30)
    await t.flush()
    expect(t.captureCharFrame()).toContain("choose a format")
    await t.mockInput.typeText("a")
    await t.flush()
    return t
  }

  test("http mode: 'a' shows the audio format list and enter extracts best audio", async () => {
    const fakeHttp = createFakeHttp(SAMPLE_INFO)
    const t = await openAudioPicker(fakeHttp)
    const frame = t.captureCharFrame()
    expect(frame).toContain("extract audio")
    // The list now shows audio containers/quality, not video resolutions.
    expect(frame).toContain("mp3")
    expect(frame).toContain("flac")
    expect(frame).toContain("lossless")
    t.mockInput.pressEnter()
    await t.flush()
    expect(t.captureCharFrame()).toContain("downloads")
    expect(fakeHttp.added).toHaveLength(1)
    expect(fakeHttp.added[0]!.extractAudio).toBe(true)
    expect(fakeHttp.added[0]!.audioFormat).toBe("mp3")
    expect(fakeHttp.added[0]!.audioQuality).toBe("0")
    // Audio extraction ignores the highlighted video format.
    expect(fakeHttp.added[0]!.format).toBe("bestaudio/best")
    await t.renderer.destroy()
  })

  test("audio picker: down selects flac, which is lossless and carries no quality", async () => {
    const fakeHttp = createFakeHttp(SAMPLE_INFO)
    const t = await openAudioPicker(fakeHttp)
    // mp3(0) m4a(1) opus(2) vorbis(3) aac(4) flac(5) -> five downs to flac.
    for (let i = 0; i < 5; i++) t.mockInput.pressArrow("down")
    await t.flush()
    t.mockInput.pressEnter()
    await t.flush()
    expect(fakeHttp.added[0]!.audioFormat).toBe("flac")
    // Lossless carries no --audio-quality.
    expect(fakeHttp.added[0]!.audioQuality).toBeUndefined()
    await t.renderer.destroy()
  })

  test("audio picker: right lowers the quality for a lossy format", async () => {
    const fakeHttp = createFakeHttp(SAMPLE_INFO)
    const t = await openAudioPicker(fakeHttp)
    // best(0) high(2) std(5) -> two rights lands on std.
    t.mockInput.pressArrow("right")
    t.mockInput.pressArrow("right")
    await t.flush()
    t.mockInput.pressEnter()
    await t.flush()
    expect(fakeHttp.added[0]!.audioFormat).toBe("mp3")
    expect(fakeHttp.added[0]!.audioQuality).toBe("5")
    await t.renderer.destroy()
  })

  test("audio picker seeds the configured default format", async () => {
    const fakeHttp = createFakeHttp(SAMPLE_INFO, "opus")
    const t = await openAudioPicker(fakeHttp)
    t.mockInput.pressEnter()
    await t.flush()
    expect(fakeHttp.added[0]!.audioFormat).toBe("opus")
    await t.renderer.destroy()
  })

  test("http mode rejects a non-url with a notice", async () => {
    const fake = createFakeEngine()
    const fakeHttp = createFakeHttp(SAMPLE_INFO)
    const t = await testRender(
      () => <App config={defaultConfig()} engine={fake.engine} http={fakeHttp.http} persist={() => {}} />,
      { width: 100, height: 30 },
    )
    await t.flush()
    t.mockInput.pressTab()
    t.mockInput.pressTab()
    await t.flush()
    await t.mockInput.typeText("not a url")
    t.mockInput.pressEnter()
    await t.flush()
    expect(t.captureCharFrame()).toContain("enter an http(s) url")
    expect(fakeHttp.added).toEqual([])
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

  test("esc enters home normal mode where d opens downloads and i returns to insert", async () => {
    const { t } = await renderApp()
    await t.flush()
    expect(t.captureCharFrame()).toContain("esc normal")
    t.mockInput.pressEscape()
    await Bun.sleep(50)
    await t.flush()
    const normalFrame = t.captureCharFrame()
    expect(normalFrame).toContain("i insert")
    expect(normalFrame.includes("esc normal")).toBe(false)
    // typing must not reach the blurred input; i returns to insert without
    // the i itself being typed
    t.mockInput.pressKey("i")
    await t.flush()
    expect(t.captureCharFrame()).toContain("esc normal")
    await t.mockInput.typeText("hello")
    await t.flush()
    const insertFrame = t.captureCharFrame()
    expect(insertFrame).toContain("hello")
    expect(insertFrame.includes("ihello")).toBe(false)
    t.mockInput.pressEscape()
    await Bun.sleep(50)
    await t.flush()
    t.mockInput.pressKey("d")
    await t.flush()
    expect(t.captureCharFrame()).toContain("downloads · 0")
    await t.renderer.destroy()
  })

  test("shortcuts menu: closed on home insert mode, esc closes it without leaving the route", async () => {
    const { t } = await renderApp()
    await t.flush()
    t.mockInput.pressKey("k", { ctrl: true })
    await t.flush()
    expect(t.captureCharFrame().includes("d         downloads")).toBe(false)
    t.mockInput.pressEscape()
    await Bun.sleep(50)
    await t.flush()
    t.mockInput.pressKey("k", { ctrl: true })
    await t.flush()
    expect(t.captureCharFrame()).toContain("d         downloads")
    t.mockInput.pressKey("d")
    await t.flush()
    expect(t.captureCharFrame().includes("downloads · 0")).toBe(false)
    t.mockInput.pressEscape()
    await Bun.sleep(50)
    await t.flush()
    const closed = t.captureCharFrame()
    expect(closed.includes("d         downloads")).toBe(false)
    expect(closed).toContain("i insert")
    await t.renderer.destroy()
  })

  test("settings: esc still leaves after a sources round trip", async () => {
    const { t } = await renderApp()
    await t.flush()
    t.mockInput.pressKey("g", { ctrl: true })
    await t.flush()
    expect(t.captureCharFrame()).toContain("download dir")
    for (let i = 0; i < 9; i += 1) t.mockInput.pressArrow("down")
    await t.flush()
    t.mockInput.pressEnter()
    await t.flush()
    expect(t.captureCharFrame()).toContain("[x] knaben")
    t.mockInput.pressEscape()
    await Bun.sleep(50)
    await t.flush()
    expect(t.captureCharFrame()).toContain("download dir")
    t.mockInput.pressEscape()
    await Bun.sleep(50)
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame.includes("download dir")).toBe(false)
    expect(frame).toContain("enter search")
    await t.renderer.destroy()
  })

  test("settings: repeated ctrl+g does not trap esc", async () => {
    const { t } = await renderApp()
    await t.flush()
    t.mockInput.pressKey("g", { ctrl: true })
    await t.flush()
    t.mockInput.pressKey("g", { ctrl: true })
    await t.flush()
    expect(t.captureCharFrame()).toContain("download dir")
    t.mockInput.pressEscape()
    await Bun.sleep(50)
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame.includes("download dir")).toBe(false)
    expect(frame).toContain("enter search")
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
