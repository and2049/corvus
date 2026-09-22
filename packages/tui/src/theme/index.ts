import { RGBA } from "@opentui/core"
import type { Palette } from "./palette"

export type { Palette }
// Keep all UI colors terminal-native so the user's terminal controls the
// actual appearance rather than a light/dark application palette.
export const theme: Palette = {
  bg: RGBA.defaultBackground(),
  elevatedBg: RGBA.defaultBackground(),
  selectedBg: RGBA.fromIndex(4),
  borderMuted: RGBA.fromIndex(8),
  text: RGBA.defaultForeground(),
  muted: RGBA.fromIndex(8),
  dim: RGBA.fromIndex(8),
  accent: RGBA.fromIndex(6),
  success: RGBA.fromIndex(2),
  warning: RGBA.fromIndex(3),
  error: RGBA.fromIndex(1),
}

export const seedColor = (seeders: number): Palette[keyof Palette] =>
  seeders >= 50 ? theme.success : seeders >= 10 ? theme.warning : theme.error
