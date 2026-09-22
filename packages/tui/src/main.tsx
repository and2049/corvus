import { printHelp, runUpdate } from "./update"
import { CORVUS_VERSION } from "./version"

// Lightweight CLI dispatch. The TUI boot (and its native dependencies) is loaded
// dynamically only when actually launching the app, so `corvus update`,
// `--version`, and `--help` stay fast and dependency-free.
const cmd = process.argv[2]
if (cmd === "update") {
  await runUpdate(process.argv.slice(3))
  process.exit(0)
}
if (cmd === "--version" || cmd === "-v") {
  console.log(`corvus v${CORVUS_VERSION}`)
  process.exit(0)
}
if (cmd === "--help" || cmd === "-h") {
  printHelp()
  process.exit(0)
}

const { boot } = await import("./boot")
await boot()
