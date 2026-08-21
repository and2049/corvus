export const theme = {
  accent: "#8abeb7",
  text: "#d4d4d4",
  muted: "#808080",
  dim: "#666666",
  borderMuted: "#505050",
  selectedBg: "#3a3a4a",
  success: "#b5bd68",
  warning: "#ffff00",
  error: "#cc6666",
  blue: "#5f87ff",
  cyan: "#00d7ff",
  heading: "#f0c674",
} as const

export const seedColor = (seeders: number): string =>
  seeders >= 50 ? theme.success : seeders >= 10 ? theme.warning : theme.error
