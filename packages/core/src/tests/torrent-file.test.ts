import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { infoHashFromMagnet, parseMagnet } from "@corvus/providers"
import { looksLikeTorrentInput, magnetFromTorrentBytes, magnetFromTorrentInput } from "../torrent-file"

const tmpDir = path.join(process.env["TEMP"] ?? "/tmp", `corvus-torrent-file-${process.pid}`)

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// Minimal valid single-file torrent, hand-bencoded.
function fixtureTorrent(): Buffer {
  const pieces = Buffer.alloc(20, 7)
  return Buffer.concat([
    Buffer.from("d8:announce30:udp://tracker.example/announce4:infod6:lengthi5e4:name8:test.bin12:piece lengthi16384e6:pieces20:"),
    pieces,
    Buffer.from("ee"),
  ])
}

describe("looksLikeTorrentInput", () => {
  test("matches urls and .torrent paths but not magnets or queries", () => {
    expect(looksLikeTorrentInput("https://example.com/a.torrent")).toBe(true)
    expect(looksLikeTorrentInput("C:\\downloads\\a.TORRENT")).toBe(true)
    expect(looksLikeTorrentInput("magnet:?xt=urn:btih:" + "ab".repeat(20))).toBe(false)
    expect(looksLikeTorrentInput("arch linux iso")).toBe(false)
  })
})

describe("magnetFromTorrentBytes", () => {
  test("produces a magnet carrying the infohash, name and tracker", async () => {
    const magnet = await magnetFromTorrentBytes(fixtureTorrent())
    expect(magnet).toBeDefined()
    const parsed = parseMagnet(magnet!)
    expect(parsed).toBeDefined()
    expect(parsed!.infoHash).toBe(infoHashFromMagnet(magnet!)!)
    expect(parsed!.displayName).toBe("test.bin")
    expect(parsed!.trackers).toEqual(["udp://tracker.example/announce"])
  })

  test("returns undefined for garbage bytes", async () => {
    expect(await magnetFromTorrentBytes(Buffer.from("not a torrent"))).toBeUndefined()
  })
})

describe("magnetFromTorrentInput", () => {
  test("reads a local .torrent file", async () => {
    await mkdir(tmpDir, { recursive: true })
    const filePath = path.join(tmpDir, "fixture.torrent")
    await writeFile(filePath, fixtureTorrent())
    const magnet = await magnetFromTorrentInput(filePath)
    expect(magnet).toBeDefined()
    expect(parseMagnet(magnet!)!.displayName).toBe("test.bin")
  })

  test("returns undefined for a missing file", async () => {
    expect(await magnetFromTorrentInput(path.join(tmpDir, "missing.torrent"))).toBeUndefined()
  })
})
