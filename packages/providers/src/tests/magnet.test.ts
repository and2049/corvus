import { describe, expect, test } from "bun:test"
import { buildMagnet, DEFAULT_TRACKERS, infoHashFromMagnet, parseMagnet, unionMagnet } from "../magnet"

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

  test("treats a 40-char hex hash as hex even when its prefix looks like base32", () => {
    // first 32 chars are all in the base32 alphabet [a-f2-7]; must not be base32-decoded
    const hash = "abcdef2345672345672345672345672345672345"
    expect(infoHashFromMagnet(`magnet:?xt=urn:btih:${hash}`)).toBe(hash)
  })
})

describe("parseMagnet", () => {
  test("extracts hash, name, trackers and extra params", () => {
    const parsed = parseMagnet(
      "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Test&ws=http%3A%2F%2Fx.example%2Ffile&tr=udp%3A%2F%2Fa.example%2Fannounce&tr=udp%3A%2F%2Fb.example%2Fannounce",
    )
    expect(parsed?.infoHash).toBe("abcdef0123456789abcdef0123456789abcdef01")
    expect(parsed?.displayName).toBe("Test")
    expect(parsed?.trackers).toEqual(["udp://a.example/announce", "udp://b.example/announce"])
    expect(parsed?.params).toEqual([["ws", "http://x.example/file"]])
  })

  test("returns undefined for non-magnets and magnets without xt", () => {
    expect(parseMagnet("http://example.com")).toBeUndefined()
    expect(parseMagnet("magnet:?dn=only")).toBeUndefined()
  })
})

describe("unionMagnet", () => {
  const hash = "ab".repeat(20)
  const withTracker = (tr: string): string => `magnet:?xt=urn:btih:${hash}&dn=Name&tr=${encodeURIComponent(tr)}`

  test("unions trackers from both magnets", () => {
    const merged = unionMagnet(withTracker("udp://a/announce"), withTracker("udp://b/announce"))
    expect(merged).toContain("a%2Fannounce")
    expect(merged).toContain("b%2Fannounce")
    expect(merged).toContain("dn=Name")
  })

  test("keeps the magnet untouched when the other adds nothing", () => {
    const keep = withTracker("udp://a/announce")
    expect(unionMagnet(keep, withTracker("udp://a/announce/"))).toBe(keep)
  })

  test("returns keep unchanged when either side does not parse", () => {
    const keep = withTracker("udp://a/announce")
    expect(unionMagnet(keep, "not-a-magnet")).toBe(keep)
    expect(unionMagnet("not-a-magnet", withTracker("udp://a/announce"))).toBe("not-a-magnet")
  })
})
