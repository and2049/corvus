import { Engine } from "../src/engine"

const SINTEL =
  "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent"

const tmp = `${process.env.TEMP ?? "/tmp"}/corvus-engine-smoke`
const engine = new Engine({ downloadDir: tmp })
engine.add(SINTEL)

let ticks = 0
const timer = setInterval(() => {
  ticks += 1
  const snap = engine.snapshots()[0]
  if (snap === undefined) return
  console.log(
    `[${ticks}s] state=${snap.state} progress=${(snap.progress * 100).toFixed(1)}% peers=${snap.peers} down=${(snap.downloadSpeed / 1024).toFixed(0)}KB/s name="${snap.name.slice(0, 40)}"`,
  )
  if (snap.state === "done" || ticks >= 25) {
    clearInterval(timer)
    void (async () => {
      await engine.shutdown()
      console.log("shutdown ok")
      process.exit(0)
    })()
  }
}, 1000)
