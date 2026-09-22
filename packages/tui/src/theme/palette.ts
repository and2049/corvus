import type { ColorInput } from "@opentui/core"

export interface Palette {
  readonly bg: ColorInput
  readonly elevatedBg: ColorInput
  readonly selectedBg: ColorInput
  readonly borderMuted: ColorInput
  readonly text: ColorInput
  readonly muted: ColorInput
  readonly dim: ColorInput
  readonly accent: ColorInput
  readonly success: ColorInput
  readonly warning: ColorInput
  readonly error: ColorInput
}
