import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import type { DownloadSnapshot, Engine, PersistedDownload, SoulseekDownloads } from "@corvus/core"
import type { SlskFileRef, TorrentResult } from "@corvus/providers"
import { DownloadsProvider, useDownloads, type DownloadsStore } from "../context/downloads"
import { Downloads } from "../routes/downloads"

const fakeEngine = {
  snapshots: () => [],
  magnets: () => [],
  keys: () => [],
  add: () => "",
  remove: async () => {},
  pause: () => {},
  resume: () => {},
  retry: async () => {},
  clientError: () => undefined,
  shutdown: async () => {},
} as unknown as Engine

function slskSnapshot(overrides: Partial<DownloadSnapshot>): DownloadSnapshot {
  return {
    key: "slsk:peer:Music\\song.flac",
    name: "song.flac",
    state: "fetching",
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 100,
    downloadSpeed: 0,
    uploadSpeed: 0,
    peers: 0,
    uploadedBytes: 0,
    ratio: 0,
    seeding: false,
    sequential: false,
    etaSeconds: undefined,
    fetchingSeconds: 5,
    files: [],
    ...overrides,
  }
}

interface FakeSlsk {
  readonly backend: SoulseekDownloads
  readonly calls: string[]
  snapshotRows: DownloadSnapshot[]
  credentialed: boolean
}

function fakeSlsk(): FakeSlsk {
  const calls: string[] = []
  const state: { snapshotRows: DownloadSnapshot[]; credentialed: boolean } = {
    snapshotRows: [],
    credentialed: true,
  }
  const backend = {
    canDownload: () => state.credentialed,
    add: (file: SlskFileRef) => {
      calls.push(`add:${file.username}:${file.path}`)
      return `slsk:${file.username}:${file.path}`
    },
    pause: (key: string) => calls.push(`pause:${key}`),
    resume: (key: string) => calls.push(`resume:${key}`),
    retry: async (key: string) => {
      calls.push(`retry:${key}`)
    },
    remove: async (key: string) => {
      calls.push(`remove:${key}`)
    },
    snapshots: () => state.snapshotRows,
    persisted: (): PersistedDownload[] =>
      state.snapshotRows.map((snapshot) => ({
        magnet: "",
        name: snapshot.name,
        addedAt: 1,
        done: snapshot.state === "done",
        slsk: { username: "peer", path: "Music\\song.flac", size: 100 },
      })),
    keys: () => state.snapshotRows.map((snapshot) => snapshot.key),
    shutdown: async () => {},
  } as unknown as SoulseekDownloads
  return {
    backend,
    calls,
    get snapshotRows() {
      return state.snapshotRows
    },
    set snapshotRows(rows) {
      state.snapshotRows = rows
    },
    get credentialed() {
      return state.credentialed
    },
    set credentialed(value) {
      state.credentialed = value
    },
  }
}

const SLSK_RESULT: TorrentResult = {
  title: "Music / song.flac",
  size: "",
  sizeBytes: 100,
  seeders: 1,
  leechers: 0,
  magnet: "",
  provider: "soulseek",
  trusted: false,
  alsoOn: [],
  slsk: { username: "peer", path: "Music\\song.flac", size: 100 },
}

describe("soulseek downloads in the TUI", () => {
  test("add dispatches slsk results to the soulseek backend and persists them", async () => {
    const slsk = fakeSlsk()
    const persistedBatches: (readonly PersistedDownload[])[] = []
    let store: DownloadsStore | undefined
    function Capture() {
      store = useDownloads()
      return <text>capture</text>
    }
    const t = await testRender(
      () => (
        <DownloadsProvider engine={fakeEngine} slsk={slsk.backend} persist={(d) => persistedBatches.push(d)}>
          <Capture />
        </DownloadsProvider>
      ),
      { width: 80, height: 24 },
    )
    await t.flush()

    expect(await store!.add(SLSK_RESULT, [])).toBe(true)
    expect(slsk.calls).toEqual(["add:peer:Music\\song.flac"])
    expect(persistedBatches.at(-1)).toEqual([])

    slsk.snapshotRows = [slskSnapshot({})]
    expect(await store!.add(SLSK_RESULT, [])).toBe(true)
    expect(persistedBatches.at(-1)).toEqual([
      {
        magnet: "",
        name: "song.flac",
        addedAt: 1,
        done: false,
        slsk: { username: "peer", path: "Music\\song.flac", size: 100 },
      },
    ])
    await t.renderer.destroy()
  })

  test("add returns false without credentials so the UI can show a notice", async () => {
    const slsk = fakeSlsk()
    slsk.credentialed = false
    let store: DownloadsStore | undefined
    function Capture() {
      store = useDownloads()
      return <text>capture</text>
    }
    const t = await testRender(
      () => (
        <DownloadsProvider engine={fakeEngine} slsk={slsk.backend} persist={() => {}}>
          <Capture />
        </DownloadsProvider>
      ),
      { width: 80, height: 24 },
    )
    await t.flush()
    expect(await store!.add(SLSK_RESULT, [])).toBe(false)
    expect(slsk.calls).toEqual([])
    await t.renderer.destroy()
  })

  test("downloads route renders slsk rows with queue position and dispatches keys by prefix", async () => {
    const slsk = fakeSlsk()
    slsk.snapshotRows = [slskSnapshot({ queuePosition: 4 })]
    const t = await testRender(
      () => (
        <DownloadsProvider engine={fakeEngine} slsk={slsk.backend} persist={() => {}}>
          <Downloads onBack={() => {}} />
        </DownloadsProvider>
      ),
      { width: 100, height: 24 },
    )
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("song.flac")
    expect(frame).toContain("queued #4")

    await t.mockInput.typeText("p")
    await t.flush()
    expect(slsk.calls).toContain("pause:slsk:peer:Music\\song.flac")

    slsk.snapshotRows = [slskSnapshot({ state: "paused" })]
    await t.mockInput.typeText("p")
    await t.flush()
    expect(slsk.calls).toContain("resume:slsk:peer:Music\\song.flac")

    await t.mockInput.typeText("t")
    await t.flush()
    expect(slsk.calls.some((call) => call.startsWith("retry:slsk:"))).toBe(true)

    await t.mockInput.typeText("r")
    await t.flush()
    expect(slsk.calls.some((call) => call.startsWith("remove:slsk:"))).toBe(true)
    await t.renderer.destroy()
  })

  test("torrent rows toggle per-torrent seed and cycle sort modes", async () => {
    const seedCalls: [string, boolean][] = []
    const engine = {
      ...fakeEngine,
      snapshots: () => [
        slskSnapshot({ key: "bt:aaa", name: "b-torrent", state: "downloading", progress: 0.5 }),
        slskSnapshot({ key: "bt:bbb", name: "a-torrent", state: "done", progress: 1, seeding: true, uploadSpeed: 2048 }),
      ],
      setSeed: (key: string, value: boolean) => {
        seedCalls.push([key, value])
      },
    } as unknown as Engine
    const t = await testRender(
      () => (
        <DownloadsProvider engine={engine} persist={() => {}}>
          <Downloads onBack={() => {}} />
        </DownloadsProvider>
      ),
      { width: 100, height: 24 },
    )
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("b-torrent")
    expect(frame).toContain("seeding")

    await t.mockInput.typeText("s")
    await t.flush()
    expect(seedCalls).toEqual([["bt:aaa", true]])

    // sort cycles added -> progress; the finished row (progress 1) moves first
    await t.mockInput.typeText("a")
    await t.flush()
    const sorted = t.captureCharFrame()
    expect(sorted.indexOf("a-torrent")).toBeLessThan(sorted.indexOf("b-torrent"))
    await t.renderer.destroy()
  })
})
