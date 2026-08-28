import { createSignal } from "solid-js"
import { dark } from "./dark"
import { light } from "./light"
import type { Palette } from "./palette"

export type ThemeMode = "dark" | "light"
export type { Palette }
export { dark, light }

const [mode, setMode] = createSignal<ThemeMode>("dark")

export const themeMode = mode
export const setThemeMode = setMode

const palette = (): Palette => (mode() === "light" ? light : dark)

export const theme: Palette = {
  get bg() {
    return palette().bg
  },
  get elevatedBg() {
    return palette().elevatedBg
  },
  get selectedBg() {
    return palette().selectedBg
  },
  get borderMuted() {
    return palette().borderMuted
  },
  get text() {
    return palette().text
  },
  get muted() {
    return palette().muted
  },
  get dim() {
    return palette().dim
  },
  get accent() {
    return palette().accent
  },
  get success() {
    return palette().success
  },
  get warning() {
    return palette().warning
  },
  get error() {
    return palette().error
  },
}

export const seedColor = (seeders: number): string =>
  seeders >= 50 ? theme.success : seeders >= 10 ? theme.warning : theme.error
