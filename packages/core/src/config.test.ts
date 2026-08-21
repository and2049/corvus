import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { defaultConfig, loadConfig, saveConfig } from "./config"

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

describe("saveConfig", () => {
  const withFile = async (contents: string): Promise<string> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvus-save-"))
    const file = path.join(dir, "config.yaml")
    await writeFile(file, contents)
    return file
  }

  test("preserves comments and untouched keys when editing a leaf", async () => {
    const file = await withFile(
      "# my config\nseedAfterComplete: true  # seeding on\ncloudflare:\n  1337x.to:\n    cookie: \"cf_clearance=keepme\"\n",
    )
    await saveConfig({ seedAfterComplete: false }, file)
    const written = await readFile(file, "utf8")
    expect(written).toContain("# my config")
    expect(written).toContain("# seeding on")
    expect(written).toContain("cf_clearance=keepme")
    expect(written).toContain("seedAfterComplete: false")
    const reloaded = await loadConfig(file)
    expect(reloaded.seedAfterComplete).toBe(false)
    expect(reloaded.cloudflare?.["1337x.to"]?.cookie).toBe("cf_clearance=keepme")
  })

  test("sets a nested provider flag without disturbing siblings", async () => {
    const file = await withFile("providers:\n  knaben:\n    enabled: true\n  nyaa:\n    enabled: true\n")
    await saveConfig({ providers: { nyaa: { enabled: false } } }, file)
    const reloaded = await loadConfig(file)
    expect(reloaded.providers.nyaa?.enabled).toBe(false)
    expect(reloaded.providers.knaben?.enabled).toBe(true)
  })

  test("creates the file from a patch when it does not exist", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "corvus-save-"))
    const file = path.join(dir, "config.yaml")
    await saveConfig({ torrentPort: 51413 }, file)
    expect((await loadConfig(file)).torrentPort).toBe(51413)
  })

  test("writes atomically leaving no temp file", async () => {
    const file = await withFile("seedAfterComplete: true\n")
    await saveConfig({ seedAfterComplete: false }, file)
    const entries = await readdir(path.dirname(file))
    expect(entries.some((name) => name.endsWith(".tmp"))).toBe(false)
  })

  test("serializes concurrent saves without losing updates", async () => {
    const file = await withFile("providers:\n  x1337:\n    enabled: true\n  eztv:\n    enabled: true\n")
    await Promise.all([
      saveConfig({ providers: { x1337: { enabled: false } } }, file),
      saveConfig({ providers: { eztv: { enabled: false } } }, file),
    ])
    const c = await loadConfig(file)
    expect(c.providers.x1337?.enabled).toBe(false)
    expect(c.providers.eztv?.enabled).toBe(false)
  })
})
