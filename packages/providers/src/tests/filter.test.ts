import { describe, expect, test } from "bun:test"
import { ContentFilter, containsAnyToken, isAdultResult, queryAllowsAdult } from "../filter"
import type { TorrentResult } from "../provider"

const make = (overrides: Partial<TorrentResult>): TorrentResult => ({
  title: "Some Movie 2024",
  size: "",
  sizeBytes: 0,
  seeders: 1,
  leechers: 0,
  magnet: "magnet:?xt=urn:btih:" + "ab".repeat(20),
  provider: "test",
  trusted: false,
  alsoOn: [],
  ...overrides,
})

describe("isAdultResult", () => {
  test("category signal", () => {
    expect(isAdultResult(make({ category: "XXX" }))).toBe(true)
    expect(isAdultResult(make({ category: "Hentai" }))).toBe(true)
    expect(isAdultResult(make({ category: "Movies" }))).toBe(false)
  })

  test("title token signal with word boundaries", () => {
    expect(isAdultResult(make({ title: "Brazzers Collection 2024" }))).toBe(true)
    expect(isAdultResult(make({ title: "Visit Portland 2024" }))).toBe(false)
  })

  test("collision-prone words are not signals", () => {
    expect(isAdultResult(make({ title: "xXx (2002)" }))).toBe(false)
    expect(isAdultResult(make({ title: "Sex Education S01" }))).toBe(false)
  })
})

describe("queryAllowsAdult", () => {
  test("unambiguous tokens bypass the filter", () => {
    expect(queryAllowsAdult("brazzers new")).toBe(true)
    expect(queryAllowsAdult("some movie")).toBe(false)
  })

  test("xxx and sex do not bypass", () => {
    expect(queryAllowsAdult("xXx 2002")).toBe(false)
    expect(queryAllowsAdult("sex education")).toBe(false)
  })
})

describe("containsAnyToken", () => {
  test("whole-word matching only", () => {
    expect(containsAnyToken("the porn leak", ["porn"])).toBe(true)
    expect(containsAnyToken("pornography_law", ["porn"])).toBe(false)
  })
})

describe("ContentFilter", () => {
  const adult = make({ category: "XXX" })

  test("pass-through when not hiding nsfw", () => {
    const filter = new ContentFilter(false)
    expect(filter.allow("anything", adult)).toBe(true)
  })

  test("hides adult results for clean queries", () => {
    const filter = new ContentFilter(true)
    expect(filter.allow("some movie", adult)).toBe(false)
    expect(filter.allow("some movie", make({}))).toBe(true)
  })

  test("deliberate adult searches bypass the filter", () => {
    const filter = new ContentFilter(true)
    expect(filter.allow("brazzers collection", adult)).toBe(true)
  })
})
