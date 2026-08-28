import { describe, expect, test } from "bun:test"
import { dark, light, seedColor, setThemeMode, theme } from "../theme"

describe("theme", () => {
  test("getters follow the active mode", () => {
    setThemeMode("dark")
    expect(theme.bg).toBe(dark.bg)
    expect(theme.accent).toBe(dark.accent)
    setThemeMode("light")
    expect(theme.bg).toBe(light.bg)
    expect(theme.accent).toBe(light.accent)
    setThemeMode("dark")
  })

  test("palettes define the same explicit hex keys", () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort())
    for (const value of [...Object.values(dark), ...Object.values(light)]) {
      expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  test("seedColor buckets by seeder count", () => {
    setThemeMode("dark")
    expect(seedColor(100)).toBe(dark.success)
    expect(seedColor(10)).toBe(dark.warning)
    expect(seedColor(0)).toBe(dark.error)
  })
})
