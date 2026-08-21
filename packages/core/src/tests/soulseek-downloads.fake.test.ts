import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import type { SoulseekClient, SlskDownloadRequest, SlskTransferEvent, startTransfer } from "@corvus/providers"
import { sanitizeSlskName, slskKey, SoulseekDownloads } from "../soulseek-downloads"

const tmpRoot = path.join(process.env["TEMP"] ?? "/tmp", `corvus-slsk-test-${process.pid}`)
let dirCounter = 0

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

function fakeClient(): SoulseekClient {
  return {
    connect: async () => ({ success: true }),
    disconnect: async () => {},
    onPeerMessage: () => () => {},
    onDisconnect: () => () => {},
  } as unknown as SoulseekClient
}

interface FakeTransfer {
  readonly starter: typeof startTransfer
  readonly started: { request: SlskDownloadRequest; emit: (event: SlskTransferEvent) => void }[]
  readonly aborted: number[]
  waitForStart(count?: number): Promise<{ request: SlskDownloadRequest; emit: (event: SlskTransferEvent) => void }>
}

function fakeTransfer(): FakeTransfer {
  const started: { request: SlskDownloadRequest; emit: (event: SlskTransferEvent) => void }[] = []
  const aborted: number[] = []
  const waiters: { count: number; resolve: () => void }[] = []
  return {
    started,
    aborted,
    starter: (_client, request, onEvent) => {
      const index = started.length
      started.push({ request, emit: onEvent })
      for (const waiter of waiters.splice(0)) {
        if (started.length >= waiter.count) waiter.resolve()
        else waiters.push(waiter)
      }
      return { abort: () => aborted.push(index) }
    },
    waitForStart: async (count = 1) => {
      if (started.length < count) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("transfer never started")), 3_000)
          waiters.push({
            count,
            resolve: () => {
              clearTimeout(timer)
              resolve()
            },
          })
        })
      }
      return started[count - 1]!
    },
  }
}

function makeManager(overrides?: { credentials?: { username?: string; password?: string } }): {
  manager: SoulseekDownloads
  transfer: FakeTransfer
  downloadDir: string
} {
  const downloadDir = path.join(tmpRoot, `dl-${dirCounter++}`)
  const transfer = fakeTransfer()
  const manager = new SoulseekDownloads(
    { downloadDir, credentials: overrides?.credentials ?? { username: "me", password: "pw" } },
    fakeClient(),
    transfer.starter,
  )
  return { manager, transfer, downloadDir }
}

const FILE = { username: "peer", path: "Music\\Artist\\01 - Song.flac", size: 10 }

describe("sanitizeSlskName", () => {
  test("strips windows-illegal characters and keeps spaces", () => {
    expect(sanitizeSlskName('a<b>:c"d/e\\f|g?h*i.mp3')).toBe("a_b__c_d_e_f_g_h_i.mp3")
    expect(sanitizeSlskName("01 - Song.flac")).toBe("01 - Song.flac")
  })

  test("guards reserved device names and trailing dots", () => {
    expect(sanitizeSlskName("CON")).toBe("_CON")
    expect(sanitizeSlskName("nul.txt")).toBe("_nul.txt")
    expect(sanitizeSlskName("song...")).toBe("song")
    expect(sanitizeSlskName("")).toBe("_")
  })
})

describe("SoulseekDownloads", () => {
  test("full lifecycle: queued, downloading with bytes on disk, done with rename", async () => {
    const { manager, transfer, downloadDir } = makeManager()
    const key = manager.add(FILE)
    expect(key).toBe(slskKey(FILE))
    expect(manager.snapshots()[0]!.state).toBe("fetching")

    const { request, emit } = await transfer.waitForStart()
    expect(request).toEqual({ username: "peer", path: FILE.path, size: 10, offset: 0 })

    emit({ kind: "queued", place: 3 })
    expect(manager.snapshots()[0]!.queuePosition).toBe(3)

    emit({ kind: "started", size: 10, offset: 0 })
    emit({ kind: "data", chunk: Buffer.from("01234") })
    emit({ kind: "data", chunk: Buffer.from("56789") })
    let snapshot = manager.snapshots()[0]!
    expect(snapshot.state).toBe("downloading")
    expect(snapshot.downloadedBytes).toBe(10)
    expect(snapshot.progress).toBe(1)

    emit({ kind: "done" })
    await Bun.sleep(50)
    snapshot = manager.snapshots()[0]!
    expect(snapshot.state).toBe("done")
    const finalPath = path.join(downloadDir, "soulseek", "peer", "01 - Song.flac")
    expect(snapshot.location).toBe(finalPath)
    expect((await readFile(finalPath)).toString()).toBe("0123456789")
    expect(existsSync(`${finalPath}.part`)).toBe(false)
  })

  test("resumes from an existing .part file's size", async () => {
    const { manager, transfer, downloadDir } = makeManager()
    const partPath = path.join(downloadDir, "soulseek", "peer", "01 - Song.flac.part")
    await mkdir(path.dirname(partPath), { recursive: true })
    await writeFile(partPath, "0123")

    manager.add(FILE)
    const { request } = await transfer.waitForStart()
    expect(request.offset).toBe(4)
  })

  test("done rename picks a free name when the final file already exists", async () => {
    const { manager, transfer, downloadDir } = makeManager()
    const finalPath = path.join(downloadDir, "soulseek", "peer", "01 - Song.flac")
    await mkdir(path.dirname(finalPath), { recursive: true })
    await writeFile(finalPath, "old contents")

    manager.add(FILE)
    const { emit } = await transfer.waitForStart()
    emit({ kind: "started", size: 3, offset: 0 })
    emit({ kind: "data", chunk: Buffer.from("new") })
    emit({ kind: "done" })
    await Bun.sleep(50)

    expect((await readFile(finalPath)).toString()).toBe("old contents")
    const renamed = path.join(downloadDir, "soulseek", "peer", "01 - Song (1).flac")
    expect((await readFile(renamed)).toString()).toBe("new")
  })

  test("pause aborts the transfer and resume restarts with a fresh offset", async () => {
    const { manager, transfer } = makeManager()
    const key = manager.add(FILE)
    const first = await transfer.waitForStart()
    first.emit({ kind: "started", size: 10, offset: 0 })
    first.emit({ kind: "data", chunk: Buffer.from("0123") })

    manager.pause(key)
    expect(transfer.aborted).toEqual([0])
    expect(manager.snapshots()[0]!.state).toBe("paused")

    first.emit({ kind: "data", chunk: Buffer.from("XXXX") })
    expect(manager.snapshots()[0]!.downloadedBytes).toBe(4)

    manager.resume(key)
    const second = await transfer.waitForStart(2)
    expect(second.request.offset).toBe(4)
    expect(manager.snapshots()[0]!.state).toBe("fetching")
  })

  test("failed transfer becomes a retryable error row", async () => {
    const { manager, transfer } = makeManager()
    const key = manager.add(FILE)
    const first = await transfer.waitForStart()
    first.emit({ kind: "failed", reason: "File not shared.", requeueable: false })
    let snapshot = manager.snapshots()[0]!
    expect(snapshot.state).toBe("error")
    expect(snapshot.error).toBe("File not shared.")

    await manager.retry(key)
    await transfer.waitForStart(2)
    snapshot = manager.snapshots()[0]!
    expect(snapshot.state).toBe("fetching")
    expect(snapshot.error).toBeUndefined()
  })

  test("remove deletes the partial file", async () => {
    const { manager, transfer, downloadDir } = makeManager()
    const key = manager.add(FILE)
    const first = await transfer.waitForStart()
    first.emit({ kind: "started", size: 10, offset: 0 })
    first.emit({ kind: "data", chunk: Buffer.from("0123") })
    const partPath = path.join(downloadDir, "soulseek", "peer", "01 - Song.flac.part")
    await Bun.sleep(20)
    expect(existsSync(partPath)).toBe(true)

    await manager.remove(key)
    expect(manager.snapshots()).toEqual([])
    expect(existsSync(partPath)).toBe(false)
    expect(transfer.aborted).toEqual([0])
  })

  test("missing credentials produce an error row instead of a transfer", async () => {
    const { manager, transfer } = makeManager({ credentials: {} })
    expect(manager.canDownload()).toBe(false)
    manager.add(FILE)
    await Bun.sleep(20)
    const snapshot = manager.snapshots()[0]!
    expect(snapshot.state).toBe("error")
    expect(snapshot.error).toContain("not configured")
    expect(transfer.started).toEqual([])
  })

  test("persisted round-trips the slsk file reference", async () => {
    const { manager, transfer } = makeManager()
    manager.add(FILE, 12345)
    await transfer.waitForStart()
    expect(manager.persisted()).toEqual([
      { magnet: "", name: "01 - Song.flac", addedAt: 12345, done: false, slsk: FILE },
    ])
  })

  test("requeueable failures auto-restart a bounded number of times", async () => {
    const { manager, transfer } = makeManager()
    manager.add(FILE)
    const first = await transfer.waitForStart()
    first.emit({ kind: "failed", reason: "transfer stalled", requeueable: true })
    const second = await transfer.waitForStart(2)
    expect(manager.snapshots()[0]!.state).toBe("fetching")
    second.emit({ kind: "failed", reason: "transfer stalled", requeueable: true })
    const third = await transfer.waitForStart(3)
    third.emit({ kind: "failed", reason: "transfer stalled", requeueable: true })
    await Bun.sleep(20)
    expect(transfer.started).toHaveLength(3)
    const snapshot = manager.snapshots()[0]!
    expect(snapshot.state).toBe("error")
    expect(snapshot.error).toBe("transfer stalled")
  })

  test("a resumed partial is dropped when the uploader reports a different size", async () => {
    const { manager, transfer, downloadDir } = makeManager()
    const partPath = path.join(downloadDir, "soulseek", "peer", "01 - Song.flac.part")
    await mkdir(path.dirname(partPath), { recursive: true })
    await writeFile(partPath, "0123")

    manager.add(FILE)
    const first = await transfer.waitForStart()
    expect(first.request.offset).toBe(4)
    first.emit({ kind: "started", size: 999, offset: 4 })

    const second = await transfer.waitForStart(2)
    expect(second.request.offset).toBe(0)
    expect(existsSync(partPath)).toBe(false)
  })

  test("duplicate add returns the same key without a second transfer", async () => {
    const { manager, transfer } = makeManager()
    const key = manager.add(FILE)
    await transfer.waitForStart()
    expect(manager.add(FILE)).toBe(key)
    await Bun.sleep(20)
    expect(transfer.started).toHaveLength(1)
  })
})
