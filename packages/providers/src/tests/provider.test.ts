import { describe, expect, test } from "bun:test"
import { atoiDefault, formatBytes, parseHumanSize } from "../provider"

describe("parseHumanSize", () => {
  test("parses decimal units", () => {
    expect(parseHumanSize("1.4 GB")).toBe(1_400_000_000)
    expect(parseHumanSize("700 MB")).toBe(700_000_000)
    expect(parseHumanSize("5 KB")).toBe(5_000)
    expect(parseHumanSize("128 B")).toBe(128)
  })

  test("parses binary units", () => {
    expect(parseHumanSize("1.00 GiB")).toBe(1_073_741_824)
    expect(parseHumanSize("273.61 MiB")).toBe(286_900_879)
  })

  test("returns 0 for garbage", () => {
    expect(parseHumanSize("")).toBe(0)
    expect(parseHumanSize("hello")).toBe(0)
  })
})

describe("formatBytes", () => {
  test("formats across units", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1_400_000_000)).toBe("1.4 GB")
    expect(formatBytes(700_000_000)).toBe("700 MB")
  })
})

describe("atoiDefault", () => {
  test("parses digits and tolerates junk", () => {
    expect(atoiDefault("1234")).toBe(1234)
    expect(atoiDefault(" 42 ")).toBe(42)
    expect(atoiDefault("")).toBe(0)
    expect(atoiDefault("n/a")).toBe(0)
  })
})
