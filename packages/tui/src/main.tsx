import { mkdir } from "node:fs/promises"
import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import {
  configDir,
  DownloadsFile,
  Engine,
  loadConfig,
  loadDownloads,
  saveConfig,
  SoulseekDownloads,
  type ConfigPatch,
  type PersistedDownload,
} from "@corvus/core"
import { setFetchCookies, setFetchProxy } from "@corvus/providers"
import { App } from "./app"

const config = await loadConfig()
setFetchProxy(config.proxy)
setFetchCookies(config.cloudflare)
await mkdir(config.downloadDir, { recursive: true })

const engine = new Engine({
  downloadDir: config.downloadDir,
  seedAfterComplete: config.seedAfterComplete,
  torrentPort: config.torrentPort,
  maxConns: config.maxConns,
  downloadLimit: config.downloadLimit,
  uploadLimit: config.uploadLimit,
})

const slskConfig = config.providers["soulseek"]
const slskDownloads = new SoulseekDownloads({
  downloadDir: config.downloadDir,
  credentials: {
    username: slskConfig?.username,
    password: slskConfig?.password,
    listenPort: slskConfig?.listenPort,
  },
})

const downloadsFile = new DownloadsFile(`${configDir()}/downloads.json`)
const persisted = await loadDownloads(`${configDir()}/downloads.json`)
for (const download of persisted) {
  if (download.done) continue
  if (download.slsk !== undefined) slskDownloads.add(download.slsk, download.addedAt)
  else engine.add(download.magnet, { deselected: download.deselected })
}

let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  await downloadsFile.close()
  await slskDownloads.shutdown()
  await engine.shutdown()
}

// exitOnCtrlC is off so ctrl+c goes through quit() — opentui's built-in exit
// would kill the process before engine.shutdown() flushes downloads.json.
// TODO(win32): consider redsun-style console hardening (disable processed
// input, flush input buffer on teardown) in the rendering-fixes pass.
const renderer = await createCliRenderer({ exitOnCtrlC: false })

function quit(): void {
  if (!renderer.isDestroyed) renderer.destroy() // restore the terminal first
  void shutdown().finally(() => process.exit(0))
}

process.on("SIGINT", quit)

// render() resolves as soon as the app mounts (it does NOT wait for the renderer
// to be destroyed), so we must NOT call shutdown() after it — that would destroy
// the torrent client while the UI keeps running. Shutdown happens only on quit.
await render(
  () => (
    <App
      config={config}
      engine={engine}
      slsk={slskDownloads}
      persisted={persisted}
      persist={(d: readonly PersistedDownload[]) => downloadsFile.set(d)}
      onConfigChange={(patch: ConfigPatch) => void saveConfig(patch)}
      onExit={quit}
    />
  ),
  renderer,
)
