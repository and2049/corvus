import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { defaultConfig, loadConfig } from "./config"

describe("loadConfig", () => {
  test("returns defaults when file is missing", async () => {
    const config = await loadConfig(path.join(await mkdtemp(path.join(os.tmpdir(), "corvus-")), "missing.yaml"))
    expect(config).toEqual(defaultConfig())
    expect(config.seedAfterComplete).toBe(false)
  })

  test("deep merges YAML over defaults", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvus-"))
    const file = path.join(dir, "config.yaml")
    await writeFile(file, "downloadDir: /tmp/media\nproviders:\n  knaben:\n    enabled: false\n")
    const config = await loadConfig(file)
    expect(config.downloadDir).toBe("/tmp/media")
    expect(config.seedAfterComplete).toBe(false)
    expect(config.providers.knaben?.enabled).toBe(false)
    expect(config.providers.yts?.enabled).toBe(true)
  })

  test("empty file returns defaults", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvus-"))
    const file = path.join(dir, "config.yaml")
    await writeFile(file, "")
    expect(await loadConfig(file)).toEqual(defaultConfig())
  })
})
