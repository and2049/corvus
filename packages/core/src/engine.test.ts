import { describe, expect, test } from "bun:test"
import { snapshotFrom, type TorrentLike } from "./engine"

const makeTorrent = (overrides: Partial<TorrentLike>): TorrentLike => ({
  infoHash: "ab".repeat(20),
  name: "Some Torrent",
  progress: 0,
  downloaded: 0,
  length: 0,
  downloadSpeed: 0,
  uploadSpeed: 0,
  numPeers: 0,
  timeRemaining: Infinity,
  done: false,
  ...overrides,
})

describe("snapshotFrom", () => {
  test("fetching state before any data", () => {
    const snap = snapshotFrom("k", makeTorrent({}))
    expect(snap.state).toBe("fetching")
    expect(snap.progress).toBe(0)
    expect(snap.etaSeconds).toBeUndefined()
  })

  test("downloading state with speed and eta", () => {
    const snap = snapshotFrom(
      "k",
      makeTorrent({
        progress: 0.5,
        downloaded: 500,
        length: 1000,
        downloadSpeed: 100,
        uploadSpeed: 10,
        numPeers: 7,
        timeRemaining: 90_000,
      }),
    )
    expect(snap.state).toBe("downloading")
    expect(snap.progress).toBe(0.5)
    expect(snap.downloadSpeed).toBe(100)
    expect(snap.peers).toBe(7)
    expect(snap.etaSeconds).toBe(90)
  })

  test("done state", () => {
    const snap = snapshotFrom("k", makeTorrent({ done: true, progress: 1 }))
    expect(snap.state).toBe("done")
    expect(snap.progress).toBe(1)
  })

  test("progress is clamped to [0,1]", () => {
    expect(snapshotFrom("k", makeTorrent({ progress: 1.5 })).progress).toBe(1)
    expect(snapshotFrom("k", makeTorrent({ progress: -1 })).progress).toBe(0)
  })

  test("falls back to key as name when empty", () => {
    expect(snapshotFrom("deadbeef", makeTorrent({ name: "" })).name).toBe("deadbeef")
  })
})
