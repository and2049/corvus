import { mkdir } from "node:fs/promises"
import { render } from "@opentui/solid"
import {
  configDir,
  DownloadsFile,
  Engine,
  loadConfig,
  loadDownloads,
  type PersistedDownload,
} from "@corvus/core"
import { setFetchProxy } from "@corvus/providers"
import { App } from "./app"

const config = await loadConfig()
setFetchProxy(config.proxy)
await mkdir(config.downloadDir, { recursive: true })

const engine = new Engine({
  downloadDir: config.downloadDir,
  seedAfterComplete: config.seedAfterComplete,
})

const downloadsFile = new DownloadsFile(`${configDir()}/downloads.json`)
const persisted = await loadDownloads(`${configDir()}/downloads.json`)
for (const download of persisted) {
  if (!download.done) engine.add(download.magnet)
}

let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  await downloadsFile.close()
  await engine.shutdown()
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0))
})

await render(() => <App config={config} engine={engine} persist={(d: readonly PersistedDownload[]) => downloadsFile.set(d)} />)
await shutdown()
