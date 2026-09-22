import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { seedColor, theme } from "../theme"

describe("theme", () => {
  test("uses terminal color names", () => {
    expect(theme.bg).toBeInstanceOf(RGBA)
    expect(theme.text).toBeInstanceOf(RGBA)
    expect(theme.accent).toBeInstanceOf(RGBA)
  })

  test("seedColor buckets by seeder count", () => {
    expect(seedColor(100)).toBe(theme.success)
    expect(seedColor(10)).toBe(theme.warning)
    expect(seedColor(0)).toBe(theme.error)
  })
})
