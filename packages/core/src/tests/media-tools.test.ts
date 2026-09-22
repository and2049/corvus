import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createMediaTools, mediaToolSource, type MediaTool } from "../media-tools"

const tools: MediaTool[] = ["yt-dlp", "ffmpeg", "ffprobe"]
const directories: string[] = []
async function temporary(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "corvus-tools-"))
  directories.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("media tool resolution", () => {
  for (let mask = 0; mask < 8; mask++) {
    test(`installs only the missing executables (PATH mask ${mask})`, async () => {
      const directory = await temporary()
      const available = new Map<string, string>()
      tools.forEach((tool, index) => { if (mask & (1 << index)) available.set(tool, `/system/${tool}`) })
      const installed: string[] = []
      const env = { PATH: "/system", HOME: "/home/user" }
      const prepare = createMediaTools({
        directory, platform: "linux", arch: "x64", env,
        which: (name) => available.get(name) ?? null,
        install: async (tool, _url, destination) => {
          installed.push(tool)
          available.set(destination, destination)
        },
      })
      const result = await prepare()
      const missing = tools.filter((_tool, index) => !(mask & (1 << index)))
      expect(installed).toEqual(missing)
      expect(result.ytdlp).toBe(mask & 1 ? "/system/yt-dlp" : path.join(directory, "yt-dlp"))
      expect(result.env.PATH).toBe(`/system:${directory}`)
      expect(env.PATH).toBe("/system")
      await prepare()
      expect(installed).toEqual(missing)
      // A subsequent system install wins over the existing managed copy.
      available.set("yt-dlp", "/new/yt-dlp")
      expect((await prepare()).ytdlp).toBe("/new/yt-dlp")
    })
  }

  test("explicit yt-dlp override wins and a missing override does not trigger installs", async () => {
    let installs = 0
    const prepare = createMediaTools({
      which: (name) => name === "/custom/yt-dlp" ? name : tools.includes(name as MediaTool) ? `/system/${name}` : null,
      install: async () => { installs++ },
    })
    expect((await prepare({ path: " /custom/yt-dlp " })).ytdlp).toBe("/custom/yt-dlp")
    await expect(prepare({ path: "/missing/yt-dlp" })).rejects.toThrow("configured yt-dlp not found")
    expect(installs).toBe(0)
  })

  test("concurrent requests share setup, failures clear status and can be retried", async () => {
    const directory = await temporary()
    const statuses: (string | undefined)[] = []
    let installs = 0
    let reject!: (error: Error) => void
    const failure = new Promise<void>((_resolve, fail) => { reject = fail })
    const prepare = createMediaTools({
      directory, platform: "linux", arch: "x64",
      which: (name) => name === "ffmpeg" || name === "ffprobe" ? `/system/${name}` : null,
      install: async () => { if (++installs === 1) await failure },
      onStatus: (message) => statuses.push(message),
    })
    const first = prepare()
    const second = prepare()
    expect(first).toBe(second)
    reject(new Error("offline"))
    await expect(first).rejects.toThrow("yt-dlp setup failed: offline")
    expect(statuses.at(-1)).toBeUndefined()
    await prepare()
    expect(installs).toBe(2)
  })

  test("unsupported platforms work with system tools and fail clearly when one is missing", async () => {
    expect((await createMediaTools({ platform: "freebsd", which: (name) => `/system/${name}` })()).ytdlp).toBe("/system/yt-dlp")
    await expect(createMediaTools({ platform: "freebsd", which: () => null })()).rejects.toThrow("install it on PATH")
  })

  test("a changed executable override does not reuse an in-flight resolution for the old path", async () => {
    const directory = await temporary()
    let finish!: () => void
    const installing = new Promise<void>((resolve) => { finish = resolve })
    const prepare = createMediaTools({
      directory, platform: "linux", arch: "x64",
      which: (name) => name === "/custom/yt-dlp" ? name : name === "ffmpeg" || name === "ffprobe" ? `/system/${name}` : null,
      install: () => installing,
    })
    const previous = prepare()
    const current = await prepare({ path: "/custom/yt-dlp" })
    expect(current.ytdlp).toBe("/custom/yt-dlp")
    finish()
    expect((await previous).ytdlp).toBe(path.join(directory, "yt-dlp"))
  })

  test("Windows uses .exe cache names and preserves the Path environment key", async () => {
    const directory = await temporary()
    const destinations: string[] = []
    const result = await createMediaTools({
      directory, platform: "win32", arch: "x64", env: { Path: "C:\\Windows" }, which: () => null,
      install: async (_tool, _url, destination) => { destinations.push(destination) },
    })()
    expect(destinations).toEqual(tools.map((tool) => path.join(directory, `${tool}.exe`)))
    expect(result.env.Path).toBe(`C:\\Windows;${directory}`)
    expect(result.env.PATH).toBeUndefined()
  })

  test("all release targets have standalone tool assets", () => {
    for (const [platform, arch] of [["linux", "x64"], ["linux", "arm64"], ["darwin", "arm64"], ["win32", "x64"]] as const) {
      for (const tool of tools) expect(mediaToolSource(tool, platform, arch).url).toStartWith("https://github.com/")
    }
    expect(mediaToolSource("yt-dlp", "linux", "arm64").url).toEndWith("yt-dlp_linux_aarch64")
    expect(mediaToolSource("ffprobe", "darwin", "arm64").url).toEndWith("ffprobe-darwin-arm64")
  })
})

describe("managed installation", () => {
  test.skipIf(process.platform === "win32")("downloads, validates, atomically caches, and reuses executables across instances", async () => {
    const directory = await temporary()
    let downloads = 0
    const options = {
      directory,
      env: { PATH: "" },
      fetch: async () => { downloads++; return new Response("#!/bin/sh\necho test-version\n") },
    }
    await createMediaTools(options)()
    expect(downloads).toBe(3)
    expect((await readdir(directory)).sort()).toEqual([...tools].sort())
    await createMediaTools(options)()
    expect(downloads).toBe(3)
  })

  test("HTTP errors leave no cached executable or temporary files", async () => {
    const directory = await temporary()
    const prepare = createMediaTools({ directory, which: () => null, fetch: async () => new Response("missing", { status: 404 }) })
    await expect(prepare()).rejects.toThrow("HTTP 404")
    expect(await readdir(directory)).toEqual([])
  })

  test.skipIf(process.platform === "win32")("broken downloads are never published and existing tools survive", async () => {
    const directory = await temporary()
    const ffmpeg = path.join(directory, "ffmpeg")
    await writeFile(ffmpeg, "#!/bin/sh\nexit 0\n")
    await chmod(ffmpeg, 0o755)
    const prepare = createMediaTools({
      directory, env: { PATH: "" },
      fetch: async () => new Response("#!/bin/sh\nexit 1\n"),
    })
    await expect(prepare()).rejects.toThrow("downloaded binary could not run")
    expect(await readdir(directory)).toEqual(["ffmpeg"])
  })
})
