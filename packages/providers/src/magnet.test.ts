import { describe, expect, test } from "bun:test"
import { buildMagnet, DEFAULT_TRACKERS, infoHashFromMagnet } from "./magnet"

describe("buildMagnet", () => {
  test("builds a magnet with hash, name and trackers", () => {
    const magnet = buildMagnet("ABCDEF0123", "Some Torrent", ["udp://tracker.example:1337/announce"])
    expect(magnet).toBe(
      "magnet:?xt=urn:btih:abcdef0123&dn=Some%20Torrent&tr=udp%3A%2F%2Ftracker.example%3A1337%2Fannounce",
    )
  })

  test("omits dn when name is empty and defaults trackers", () => {
    const magnet = buildMagnet("0123456789ABCDEF", "")
    expect(magnet.startsWith("magnet:?xt=urn:btih:0123456789abcdef&tr=")).toBe(true)
    expect(magnet.match(/tr=/g)?.length).toBe(DEFAULT_TRACKERS.length)
  })
})

describe("infoHashFromMagnet", () => {
  test("extracts hex infohash case-insensitively", () => {
    const hash = "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    expect(infoHashFromMagnet(`magnet:?xt=urn:btih:${hash}&dn=x`)).toBe(hash.toLowerCase())
  })

  test("decodes base32 infohash to hex", () => {
    const base32 = "VPG66AJDIVTYTK6N54ASGRLHRGV433YB"
    expect(infoHashFromMagnet(`magnet:?xt=urn:btih:${base32}`)).toBe("abcdef0123456789abcdef0123456789abcdef01")
  })

  test("returns undefined for magnets without btih", () => {
    expect(infoHashFromMagnet("magnet:?dn=foo")).toBeUndefined()
  })
})
