import { describe, expect, test } from "bun:test"
import type { TorrentClient, Torrent, TorrentFile, Wire } from "../webtorrent-types"
import { Engine } from "../engine"

const MAGNET = `magnet:?xt=urn:btih:${"ab".repeat(20)}&dn=Test`

class FakeWire implements Wire {
  amChoking = true
  piecesSent: number[] = []
  private readonly handlers = new Map<string, ((...args: never[]) => void)[]>()
  choke(): void {
    this.amChoking = true
  }
  unchoke(): void {
    this.amChoking = false
  }
  piece(index: number, _offset: number, buffer: Uint8Array): void {
    this.piecesSent.push(index)
    this.emit("upload", buffer.length)
  }
  on(event: string, cb: (...args: never[]) => void): void {
    const list = this.handlers.get(event) ?? []
    list.push(cb)
    this.handlers.set(event, list)
  }
  emit(event: string, arg?: unknown): void {
    for (const cb of this.handlers.get(event) ?? []) (cb as (a?: unknown) => void)(arg)
  }
}

class FakeTorrent {
  readonly infoHash: string
  name = ""
  progress = 0
  downloaded = 0
  uploaded = 0
  length = 0
  downloadSpeed = 0
  uploadSpeed = 0
  numPeers = 0
  downloadedPieces = new Set<number>()
  timeRemaining = Number.POSITIVE_INFINITY
  done = false
  paused = false
  files: TorrentFile[] = []
  destroyed = false
  pieces: unknown[] = []
  bitfield: { get(index: number): boolean } | undefined
  wires: FakeWire[] = []
  rechokeCalls = 0
  _rechoke(): void {
    this.rechokeCalls += 1
    for (const wire of this.wires) wire.unchoke()
  }
  selections: { from: number; to: number; priority: number }[] = []

  select(from: number, to: number, priority = 0): void {
    this.selections.push({ from, to, priority })
  }

  deselect(from: number, to: number): void {
    this.selections = this.selections.filter((s) => s.from !== from || s.to !== to)
  }
  private readonly handlers = new Map<string, ((...args: never[]) => void)[]>()

  constructor(infoHash: string) {
    this.infoHash = infoHash
  }

  on(event: string, cb: (...args: never[]) => void): void {
    const list = this.handlers.get(event) ?? []
    list.push(cb)
    this.handlers.set(event, list)
  }

  emit(event: string, arg?: unknown): void {
    for (const cb of this.handlers.get(event) ?? []) (cb as (a?: unknown) => void)(arg)
  }

  destroyOpts: { destroyStore?: boolean } | undefined

  destroy(opts?: { destroyStore?: boolean }, cb?: () => void): void {
    this.destroyed = true
    this.destroyOpts = opts
    cb?.()
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
  }
}

class FakeClient implements TorrentClient {
  processing = false
  destroyed = false
  readonly torrents: FakeTorrent[] = []
  addCalls = 0

  add(torrentId: string | Record<string, unknown>, _opts?: Record<string, unknown>): FakeTorrent {
    this.addCalls += 1
    const match = /urn:btih:([a-f0-9]{40})/.exec(String(torrentId))
    const torrent = new FakeTorrent(match![1]!)
    this.torrents.push(torrent)
    return torrent
  }

  get(): Promise<Torrent | null> {
    return Promise.resolve(null)
  }

  remove(): void {}

  on(): void {}

  destroy(_cb?: (err?: Error) => void): void {
    // no-op
  }

  throttleDownload(_rate: number): number {
    return _rate
  }

  throttleUpload(_rate: number): number {
    return _rate
  }
}

describe("Engine", () => {
  const makeEngine = (options?: { seedAfterComplete?: boolean }): [Engine, FakeClient] => {
    const client = new FakeClient()
    return [new Engine({ downloadDir: "/tmp/x", ...options }, client), client]
  }

  test("add is idempotent per infohash", () => {
    const [engine, client] = makeEngine()
    engine.add(MAGNET)
    engine.add(MAGNET)
    expect(client.addCalls).toBe(1)
    expect(engine.keys().length).toBe(1)
  })

  test("on done the torrent is destroyed (no seeding by default)", () => {
    const [engine, client] = makeEngine()
    engine.add(MAGNET)
    const torrent = client.torrents[0]!
    torrent.done = true
    torrent.progress = 1
    torrent.emit("done")
    expect(torrent.destroyed).toBe(true)
    const snap = engine.snapshots()[0]!
    expect(snap.state).toBe("done")
    expect(snap.progress).toBe(1)
  })

  test("seedAfterComplete keeps the torrent alive after done", () => {
    const [engine, client] = makeEngine({ seedAfterComplete: true })
    engine.add(MAGNET)
    const torrent = client.torrents[0]!
    torrent.done = true
    torrent.progress = 1
    torrent.emit("done")
    expect(torrent.destroyed).toBe(false)
  })

  test("setSeed(true) re-attaches a destroyed done torrent and keeps it alive", async () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    const original = client.torrents[0]!
    original.done = true
    original.progress = 1
    original.emit("done")
    expect(original.destroyed).toBe(true)
    engine.setSeed(key, true)
    expect(client.addCalls).toBe(2)
    const replacement = client.torrents[1]!
    expect(replacement.destroyed).toBe(false)
    replacement.done = true
    replacement.progress = 1
    replacement.emit("done")
    expect(replacement.destroyed).toBe(false)
    expect(engine.snapshots()[0]!.seeding).toBe(true)
  })

  test("setSeed(false) parks a live done torrent as done and stops seeding", () => {
    const [engine, client] = makeEngine({ seedAfterComplete: true })
    const key = engine.add(MAGNET)
    const torrent = client.torrents[0]!
    torrent.done = true
    torrent.progress = 1
    torrent.emit("done")
    expect(torrent.destroyed).toBe(false)
    engine.setSeed(key, false)
    expect(torrent.destroyed).toBe(true)
    expect(engine.snapshots()[0]!.state).toBe("done")
    expect(engine.snapshots()[0]!.seeding).toBe(false)
  })

  test("a new download does not seed: unchoke and piece are gated off", () => {
    const [engine, client] = makeEngine()
    engine.add(MAGNET)
    const torrent = client.torrents[0]!
    const wire = new FakeWire()
    torrent.wires.push(wire)
    torrent.emit("wire", wire)
    // webtorrent would unchoke an interested peer; the gate keeps it choked,
    // and even a request that slips through sends no data.
    wire.unchoke()
    expect(wire.amChoking).toBe(true)
    wire.piece(0, 0, new Uint8Array(16))
    expect(wire.piecesSent).toEqual([])
    expect(engine.snapshots()[0]!.uploadedBytes).toBe(0)
  })

  test("setSeed(true) on a live download unchokes wires and counts piece uploads", () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    const torrent = client.torrents[0]!
    torrent.progress = 0.5
    torrent.downloaded = 1000
    const wire = new FakeWire()
    torrent.wires.push(wire)
    torrent.emit("wire", wire)
    engine.setSeed(key, true)
    expect(torrent.rechokeCalls).toBe(1)
    expect(wire.amChoking).toBe(false)
    wire.piece(3, 0, new Uint8Array(250))
    expect(wire.piecesSent).toEqual([3])
    const snap = engine.snapshots()[0]!
    expect(snap.seeding).toBe(true)
    expect(snap.uploadedBytes).toBe(250)
    expect(snap.ratio).toBe(0.25)
  })

  test("setSeed(false) on a live seeding download chokes wires and re-gates", () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    const torrent = client.torrents[0]!
    torrent.progress = 0.5
    const wire = new FakeWire()
    torrent.wires.push(wire)
    torrent.emit("wire", wire)
    engine.setSeed(key, true)
    expect(wire.amChoking).toBe(false)
    engine.setSeed(key, false)
    expect(wire.amChoking).toBe(true)
    wire.unchoke()
    expect(wire.amChoking).toBe(true)
    wire.piece(0, 0, new Uint8Array(16))
    expect(wire.piecesSent).toEqual([])
    expect(engine.snapshots()[0]!.seeding).toBe(false)
  })

  test("selectAll and selectNone bulk-flip selection", () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    const torrent = client.torrents[0]!
    const deselectedFiles: string[] = []
    torrent.files = [
      { ...makeFakeFile("a.mkv", "/dl/a.mkv", 100), deselect: () => deselectedFiles.push("a") },
      { ...makeFakeFile("b.srt", "/dl/b.srt", 1), deselect: () => deselectedFiles.push("b") },
    ]
    torrent.emit("info")
    engine.selectNone(key)
    expect(engine.snapshots()[0]!.files.map((f) => f.selected)).toEqual([false, false])
    expect(deselectedFiles).toEqual(["a", "b"])
    engine.selectAll(key)
    expect(engine.snapshots()[0]!.files.map((f) => f.selected)).toEqual([true, true])
  })

  test("file snapshots carry per-file progress", () => {
    const [engine, client] = makeEngine()
    engine.add(MAGNET)
    const torrent = client.torrents[0]!
    torrent.files = [
      { ...makeFakeFile("a.mkv", "/dl/a.mkv", 100), progress: 0.4 },
      makeFakeFile("b.srt", "/dl/b.srt", 1),
    ]
    torrent.emit("info")
    expect(engine.snapshots()[0]!.files.map((f) => f.progress)).toEqual([0.4, 0])
  })

  test("setSequential applies a sliding piece window and advances it", () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    const torrent = client.torrents[0]!
    torrent.pieces = new Array(100).fill(null)
    torrent.bitfield = { get: (index) => torrent.downloadedPieces.has(index) }
    torrent.downloadedPieces = new Set()
    engine.setSequential(key, true)
    expect(torrent.selections).toEqual([{ from: 0, to: 31, priority: 1 }])
    // first 10 pieces complete; window slides to 10..41
    for (let i = 0; i < 10; i++) torrent.downloadedPieces.add(i)
    torrent.emit("download")
    expect(torrent.selections).toEqual([{ from: 10, to: 41, priority: 1 }])
    expect(engine.snapshots()[0]!.sequential).toBe(true)
  })

  test("setSequential(false) restores a full-range selection", () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    const torrent = client.torrents[0]!
    torrent.pieces = new Array(100).fill(null)
    engine.setSequential(key, true)
    engine.setSequential(key, false)
    expect(torrent.selections).toEqual([{ from: 0, to: 99, priority: 0 }])
    expect(engine.snapshots()[0]!.sequential).toBe(false)
  })

  test("torrent errors surface in the snapshot", () => {
    const [engine, client] = makeEngine()
    engine.add(MAGNET)
    client.torrents[0]!.emit("error", new Error("boom"))
    const snap = engine.snapshots()[0]!
    expect(snap.state).toBe("error")
    expect(snap.error).toContain("boom")
  })

  test("a duplicate-torrent error does not clobber a healthy download", () => {
    const [engine, client] = makeEngine()
    engine.add(MAGNET)
    const torrent = client.torrents[0]!
    torrent.progress = 0.5
    torrent.downloaded = 500
    engine.snapshots()
    torrent.emit("error", new Error("Cannot add duplicate torrent ab..."))
    expect(engine.snapshots()[0]!.state).toBe("downloading")
  })

  test("remove destroys the torrent and drops the entry", async () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    const torrent = client.torrents[0]!
    await engine.remove(key)
    expect(torrent.destroyed).toBe(true)
    expect(torrent.destroyOpts).toEqual({ destroyStore: false })
    expect(engine.keys()).toEqual([])
  })

  test("remove with deleteData asks webtorrent to destroy the store", async () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    await engine.remove(key, { deleteData: true })
    expect(client.torrents[0]!.destroyOpts).toEqual({ destroyStore: true })
  })

  test("magnetFor returns the stored magnet and location joins downloadDir with the name", () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    expect(engine.magnetFor(key)).toBe(MAGNET)
    expect(engine.magnetFor("missing")).toBeUndefined()
    const torrent = client.torrents[0]!
    torrent.name = "Test"
    torrent.emit("download")
    expect(engine.snapshots()[0]!.location?.endsWith("Test")).toBe(true)
  })

  test("pause and resume flip the snapshot state", () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    const torrent = client.torrents[0]!
    torrent.progress = 0.5
    torrent.downloaded = 500
    engine.pause(key)
    expect(torrent.paused).toBe(true)
    expect(engine.snapshots()[0]!.state).toBe("paused")
    engine.resume(key)
    expect(torrent.paused).toBe(false)
    expect(engine.snapshots()[0]!.state).toBe("downloading")
  })

  test("selection survives a snapshot poll before metadata arrives", () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    const torrent = client.torrents[0]!
    // TUI polls once per second; a poll almost always lands before "info"
    engine.snapshots()
    torrent.files = [
      makeFakeFile("a.mkv", "/dl/a.mkv", 100),
      makeFakeFile("b.srt", "/dl/b.srt", 1),
    ]
    torrent.emit("info")
    expect(engine.snapshots()[0]!.files.map((f) => f.selected)).toEqual([true, true])
    engine.toggleFile(key, 0)
    expect(engine.snapshots()[0]!.files.map((f) => f.selected)).toEqual([false, true])
  })

  test("toggleFile flips selection and calls select/deselect", () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    const torrent = client.torrents[0]!
    torrent.files = [
      makeFakeFile("a.mkv", "/dl/a.mkv", 100),
      makeFakeFile("b.srt", "/dl/b.srt", 1),
    ]
    torrent.emit("info")
    expect(engine.snapshots()[0]!.files.map((f) => f.selected)).toEqual([true, true])
    engine.toggleFile(key, 0)
    expect(engine.snapshots()[0]!.files.map((f) => f.selected)).toEqual([false, true])
    engine.toggleFile(key, 0)
    expect(engine.snapshots()[0]!.files.map((f) => f.selected)).toEqual([true, true])
  })

  test("deselected indexes passed to add are applied at info", () => {
    const [engine, client] = makeEngine()
    engine.add(MAGNET, { deselected: [1] })
    const torrent = client.torrents[0]!
    torrent.files = [
      makeFakeFile("a.mkv", "/dl/a.mkv", 100),
      makeFakeFile("b.srt", "/dl/b.srt", 1),
    ]
    torrent.emit("info")
    expect(engine.snapshots()[0]!.files.map((f) => f.selected)).toEqual([true, false])
  })

  test("retry destroys and re-adds an errored torrent, keeping selection and identity", async () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    const original = client.torrents[0]!
    original.emit("error", new Error("boom"))
    await engine.retry(key)
    expect(original.destroyed).toBe(true)
    expect(client.addCalls).toBe(2)
    expect(engine.keys()).toEqual([key])
    expect(engine.snapshots()[0]!.state).toBe("fetching")
    // selection survives the retry
    const replacement = client.torrents[1]!
    replacement.files = [
      makeFakeFile("a.mkv", "/dl/a.mkv", 100),
      makeFakeFile("b.srt", "/dl/b.srt", 1),
    ]
    engine.toggleFile(key, 1)
    replacement.emit("info")
    expect(engine.snapshots()[0]!.files.map((f) => f.selected)).toEqual([true, false])
  })

  test("retry is refused for done and active downloads", async () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    client.torrents[0]!.done = true
    client.torrents[0]!.progress = 1
    client.torrents[0]!.emit("done")
    await engine.retry(key)
    expect(client.addCalls).toBe(1)
    const [downloading, client2] = makeEngine()
    const key2 = downloading.add(MAGNET)
    client2.torrents[0]!.progress = 0.5
    client2.torrents[0]!.downloaded = 500
    downloading.snapshots()
    await downloading.retry(key2)
    expect(client2.addCalls).toBe(1)
  })

  test("retry re-attaches handlers so a second error still surfaces", async () => {
    const [engine, client] = makeEngine()
    const key = engine.add(MAGNET)
    client.torrents[0]!.emit("error", new Error("first"))
    await engine.retry(key)
    client.torrents[1]!.emit("error", new Error("second"))
    expect(engine.snapshots()[0]!.state).toBe("error")
    expect(engine.snapshots()[0]!.error).toContain("second")
  })

  test("fetching snapshots carry elapsed seconds", () => {
    const [engine] = makeEngine()
    engine.add(MAGNET)
    const snap = engine.snapshots()[0]!
    expect(snap.state).toBe("fetching")
    expect(snap.fetchingSeconds).toBeGreaterThanOrEqual(0)
  })

  test("setLimits forwards rates to the client (-1 disables)", () => {
    const [engine, client] = makeEngine()
    let downloadRate: number | undefined
    let uploadRate: number | undefined
    client.throttleDownload = (rate) => {
      downloadRate = rate
      return rate
    }
    client.throttleUpload = (rate) => {
      uploadRate = rate
      return rate
    }
    engine.setLimits(1024, undefined)
    expect(downloadRate).toBe(1024)
    expect(uploadRate).toBe(-1)
  })
})

function makeFakeFile(name: string, filePath: string, length: number): TorrentFile {
  return {
    name,
    path: filePath,
    length,
    select: () => {},
    deselect: () => {},
  }
}
