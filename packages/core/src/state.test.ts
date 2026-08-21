import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DownloadsFile, loadDownloads, type PersistedDownload } from "./state"

const makeDownload = (magnet: string): PersistedDownload => ({
  magnet,
  name: "n",
  addedAt: 1_700_000_000_000,
  done: false,
})

describe("loadDownloads", () => {
  test("returns empty for a missing file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvus-state-"))
    try {
      expect(await loadDownloads(path.join(dir, "missing.json"))).toEqual([])
    } finally {
      await rm(dir, { recursive: true })
    }
  })

  test("round-trips through DownloadsFile", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvus-state-"))
    const file = path.join(dir, "downloads.json")
    try {
      const store = new DownloadsFile(file)
      store.set([makeDownload("magnet:?xt=urn:btih:" + "ab".repeat(20))])
      await store.close()
      const loaded = await loadDownloads(file)
      expect(loaded.length).toBe(1)
      expect(loaded[0]!.magnet).toBe("magnet:?xt=urn:btih:" + "ab".repeat(20))
    } finally {
      await rm(dir, { recursive: true })
    }
  })

  test("writes atomically (no temp files left behind)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvus-state-"))
    const file = path.join(dir, "downloads.json")
    try {
      const store = new DownloadsFile(file)
      store.set([makeDownload("magnet:?xt=urn:btih:" + "cd".repeat(20))])
      await store.close()
      const entries = await readdir(dir)
      expect(entries.some((name) => name.endsWith(".tmp"))).toBe(false)
      expect(JSON.parse(await readFile(file, "utf8"))).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true })
    }
  })

  test("skips malformed entries", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvus-state-"))
    const file = path.join(dir, "downloads.json")
    try {
      await writeFile(
        file,
        JSON.stringify([
          { magnet: "magnet:?xt=urn:btih:" + "ab".repeat(20), name: "ok", addedAt: 1, done: false },
          { name: "no magnet" },
          "junk",
        ]),
      )
      const loaded = await loadDownloads(file)
      expect(loaded.length).toBe(1)
    } finally {
      await rm(dir, { recursive: true })
    }
  })

  test("round-trips deselected file indexes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvus-state-"))
    const file = path.join(dir, "downloads.json")
    try {
      const store = new DownloadsFile(file)
      store.set([{ ...makeDownload("magnet:?xt=urn:btih:" + "ef".repeat(20)), deselected: [1, 3] }])
      await store.close()
      const loaded = await loadDownloads(file)
      expect(loaded[0]!.deselected).toEqual([1, 3])
    } finally {
      await rm(dir, { recursive: true })
    }
  })

  test("skips entries with a malformed deselected list", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvus-state-"))
    const file = path.join(dir, "downloads.json")
    try {
      await writeFile(
        file,
        JSON.stringify([
          { magnet: "magnet:?xt=urn:btih:" + "12".repeat(20), name: "bad", addedAt: 1, done: false, deselected: ["0"] },
          { magnet: "magnet:?xt=urn:btih:" + "34".repeat(20), name: "good", addedAt: 1, done: false, deselected: [2] },
        ]),
      )
      const loaded = await loadDownloads(file)
      expect(loaded.map((entry) => entry.name)).toEqual(["good"])
    } finally {
      await rm(dir, { recursive: true })
    }
  })
})
