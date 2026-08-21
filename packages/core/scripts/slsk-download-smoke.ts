// Live end-to-end soulseek download: logs in with real credentials, searches,
// picks the first result from a free-slot peer, and downloads it.
// Usage: bun scripts/slsk-download-smoke.ts <username> <password> [query]
// Requires inbound reachability on listen port 2234 (forward it), like search.
import { sharedSoulseekClient } from "@corvus/providers"
import { SoulseekDownloads } from "../src/soulseek-downloads"

const username = process.argv[2] ?? ""
const password = process.argv[3] ?? ""
const query = process.argv[4] ?? "creative commons mp3"

const client = sharedSoulseekClient()
const downloads = new SoulseekDownloads(
  { downloadDir: `${process.env["TEMP"] ?? "/tmp"}/corvus-slsk-smoke`, credentials: { username, password } },
  client,
)

const login = await client.connect({ username, password })
if (!login.success) {
  console.log(`login rejected: ${login.rejectionReason}`)
  process.exit(1)
}
console.log(`logged in as ${username}`)

const responses = await client.search(query, 10_000)
console.log(`search responses: ${responses.length}`)
const candidate = responses
  .filter((r) => r.freeUploadSlots)
  .flatMap((r) => r.files.map((f) => ({ username: r.username, path: f.path, size: f.size })))
  .filter((f) => f.size > 0 && f.size < 20_000_000)[0]
if (candidate === undefined) {
  console.log("no small free-slot file found; try another query")
  await downloads.shutdown()
  process.exit(0)
}
console.log(`downloading ${candidate.path} (${(candidate.size / 1e6).toFixed(1)} MB) from ${candidate.username}`)
downloads.add(candidate)

const deadline = Date.now() + 120_000
for (;;) {
  await Bun.sleep(1_000)
  const snapshot = downloads.snapshots()[0]
  if (snapshot === undefined) break
  console.log(
    `${snapshot.state} ${(snapshot.progress * 100).toFixed(0)}% ` +
      `${snapshot.downloadedBytes}/${snapshot.totalBytes}B ` +
      `${snapshot.queuePosition !== undefined ? `queue #${snapshot.queuePosition} ` : ""}` +
      `${snapshot.error ?? ""}`,
  )
  if (snapshot.state === "done") {
    console.log(`DONE -> ${snapshot.location}`)
    break
  }
  if (snapshot.state === "error" || Date.now() > deadline) break
}
await downloads.shutdown()
process.exit(0)
