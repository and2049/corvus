import { describe, expect, test } from "bun:test"
import type { TorrentClient, Torrent, TorrentFile } from "./webtorrent-types"
import { Engine } from "./engine"

const MAGNET = `magnet:?xt=urn:btih:${"ab".repeat(20)}&dn=Test`

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
  timeRemaining = Number.POSITIVE_INFINITY
  done = false
  paused = false
  files: TorrentFile[] = []
  destroyed = false
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

  destroy(_opts?: { destroyStore?: boolean }, cb?: () => void): void {
    this.destroyed = true
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
    expect(engine.keys()).toEqual([])
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
