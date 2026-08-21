import { SoulseekClient } from "../src/sources/soulseek/client"

const username = process.argv[2] ?? ""
const password = process.argv[3] ?? ""

const client = new SoulseekClient()
try {
  const response = await client.connect({ username, password })
  if (!response.success) {
    console.log(`login rejected: ${response.rejectionReason}`)
    process.exit(0)
  }
  console.log(`logged in as ${username} (ip ${response.ipAddress})`)
  const results = await client.search(process.argv[4] ?? "radiohead", 10_000)
  console.log(`search responses: ${results.length}`)
  let fileCount = 0
  for (const r of results.slice(0, 5)) {
    fileCount += r.files.length
    console.log(`  ${r.username}: ${r.files.length} files, freeSlots=${r.freeUploadSlots}, speed=${r.uploadSpeed}`)
    for (const f of r.files.slice(0, 2)) {
      console.log(`    ${f.path} (${(f.size / 1e6).toFixed(1)} MB)`)
    }
  }
  console.log(`total files (first 5 peers): ${fileCount}`)
} catch (error) {
  console.error(`ERROR: ${String(error)}`)
} finally {
  await client.disconnect()
}
