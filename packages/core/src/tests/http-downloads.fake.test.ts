import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { HttpDownloads, httpKey, type HttpDownloadRequest } from "../http-downloads"
import { FILEPATH_SENTINEL, type RunProcess, type RunResult } from "../ytdlp"
import type { MediaTools } from "../media-tools"

const tmpRoot = path.join(process.env["TEMP"] ?? "/tmp", `corvus-http-test-${process.pid}`)
let dirCounter = 0

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

interface FakeProc {
  readonly args: readonly string[]
  emit: (line: string) => void
  finish: (code: number, stderr?: string) => void
  killed: boolean
}

interface FakeRunner {
  readonly run: RunProcess
  readonly procs: FakeProc[]
}

function fakeRunner(): FakeRunner {
  const procs: FakeProc[] = []
  const run: RunProcess = (_bin, args, onLine) => {
    let resolveDone!: (result: RunResult) => void
    const done = new Promise<RunResult>((resolve) => {
      resolveDone = resolve
    })
    const proc: FakeProc = {
      args: [...args],
      emit: (line) => onLine(line),
      finish: (code, stderr = "") => resolveDone({ code, stderr }),
      killed: false,
    }
    procs.push(proc)
    return { handle: { kill: () => (proc.killed = true) }, done }
  }
  return { run, procs }
}

function makeManager(): { manager: HttpDownloads; runner: FakeRunner; downloadDir: string } {
  const downloadDir = path.join(tmpRoot, `dl-${dirCounter++}`)
  const runner = fakeRunner()
  const manager = new HttpDownloads({ downloadDir }, runner.run)
  return { manager, runner, downloadDir }
}

const REQUEST: HttpDownloadRequest = {
  url: "https://example.com/watch?v=abc",
  title: "A Video",
  format: "137+bestaudio/137",
  size: 10,
}

describe("HttpDownloads", () => {
  test("probe and restored downloads use prepared executables and environment", async () => {
    const tools = { ytdlp: "/managed/yt-dlp", env: { PATH: "/system:/managed" } }
    let spawned = false
    const manager = new HttpDownloads({ downloadDir: tmpRoot, prepareTools: async () => tools },
      (bin, _args, _onLine, env) => {
        expect(bin).toBe(tools.ytdlp)
        expect(env).toEqual(tools.env)
        spawned = true
        return { handle: { kill() {} }, done: Promise.resolve({ code: 0, stderr: "" }) }
      },
      async (url, config, _capture, env) => {
        expect(config?.path).toBe(tools.ytdlp)
        expect(env).toEqual(tools.env)
        return { url, id: "abc", title: "title", formats: [] }
      },
    )
    await manager.probe(REQUEST.url)
    manager.add(REQUEST)
    expect(spawned).toBe(false)
    await Bun.sleep(0)
    expect(spawned).toBe(true)
  })

  for (const action of ["pause", "remove", "shutdown"] as const) {
    test(`${action} during dependency setup prevents a late process launch`, async () => {
      let finish!: (tools: MediaTools) => void
      const ready = new Promise<MediaTools>((resolve) => { finish = resolve })
      const runner = fakeRunner()
      const manager = new HttpDownloads({ downloadDir: tmpRoot, prepareTools: () => ready }, runner.run)
      const key = manager.add(REQUEST)
      if (action === "shutdown") await manager.shutdown()
      else await manager[action](key)
      finish({ ytdlp: "yt-dlp", env: {} })
      await Bun.sleep(0)
      expect(runner.procs).toHaveLength(0)
    })
  }

  test("setup failure becomes a retryable download error", async () => {
    let attempts = 0
    const runner = fakeRunner()
    const manager = new HttpDownloads({ downloadDir: tmpRoot, prepareTools: async () => {
      if (++attempts === 1) throw new Error("setup offline")
      return { ytdlp: "yt-dlp", env: {} }
    } }, runner.run)
    const key = manager.add(REQUEST)
    await Bun.sleep(0)
    expect(manager.snapshots()[0]!.error).toBe("setup offline")
    manager.retry(key)
    await Bun.sleep(0)
    expect(runner.procs).toHaveLength(1)
  })

  test("full lifecycle: fetching, downloading with progress, done with final path", async () => {
    const { manager, runner, downloadDir } = makeManager()
    const key = manager.add(REQUEST)
    expect(key).toBe(httpKey(REQUEST.url))
    expect(manager.snapshots()[0]!.state).toBe("fetching")
    expect(manager.snapshots()[0]!.location).toBe(downloadDir)

    const proc = runner.procs[0]!
    expect(proc.args).toContain("137+bestaudio/137")

    proc.emit('{"status":"downloading","downloaded":5,"total":10,"speed":1000,"eta":1}')
    let snapshot = manager.snapshots()[0]!
    expect(snapshot.state).toBe("downloading")
    expect(snapshot.downloadedBytes).toBe(5)
    expect(snapshot.totalBytes).toBe(10)
    expect(snapshot.progress).toBe(0.5)

    proc.emit(`${FILEPATH_SENTINEL}${path.join(downloadDir, "A Video [abc].mp4")}`)
    proc.finish(0)
    await Bun.sleep(20)
    snapshot = manager.snapshots()[0]!
    expect(snapshot.state).toBe("done")
    expect(snapshot.progress).toBe(1)
    expect(snapshot.location).toBe(path.join(downloadDir, "A Video [abc].mp4"))
  })

  test("NA placeholders in the progress line are tolerated", async () => {
    const { manager, runner } = makeManager()
    manager.add(REQUEST)
    runner.procs[0]!.emit('{"status":"downloading","downloaded":3,"total":NA,"speed":NA,"eta":NA}')
    const snapshot = manager.snapshots()[0]!
    expect(snapshot.state).toBe("downloading")
    expect(snapshot.downloadedBytes).toBe(3)
  })

  test("non-zero exit becomes an error row with the stderr reason", async () => {
    const { manager, runner } = makeManager()
    manager.add(REQUEST)
    runner.procs[0]!.finish(1, "ERROR: video unavailable")
    await Bun.sleep(20)
    const snapshot = manager.snapshots()[0]!
    expect(snapshot.state).toBe("error")
    expect(snapshot.error).toBe("video unavailable")
  })

  test("pause kills the process and resume respawns it", async () => {
    const { manager, runner } = makeManager()
    const key = manager.add(REQUEST)
    runner.procs[0]!.emit('{"status":"downloading","downloaded":4,"total":10}')

    manager.pause(key)
    expect(runner.procs[0]!.killed).toBe(true)
    expect(manager.snapshots()[0]!.state).toBe("paused")

    manager.resume(key)
    expect(runner.procs.length).toBe(2)
    expect(manager.snapshots()[0]!.state).toBe("fetching")
  })

  test("retry respawns an errored download", async () => {
    const { manager, runner } = makeManager()
    const key = manager.add(REQUEST)
    runner.procs[0]!.finish(1, "ERROR: boom")
    await Bun.sleep(20)
    expect(manager.snapshots()[0]!.state).toBe("error")

    manager.retry(key)
    expect(runner.procs.length).toBe(2)
    expect(manager.snapshots()[0]!.state).toBe("fetching")
    expect(manager.snapshots()[0]!.error).toBeUndefined()
  })

  test("remove drops the entry and deletes completed data on request", async () => {
    const { manager, runner, downloadDir } = makeManager()
    const key = manager.add(REQUEST)
    const finalPath = path.join(downloadDir, "A Video [abc].mp4")
    await mkdir(downloadDir, { recursive: true })
    await writeFile(finalPath, "data")
    runner.procs[0]!.emit(`${FILEPATH_SENTINEL}${finalPath}`)
    runner.procs[0]!.finish(0)
    await Bun.sleep(20)
    expect(manager.snapshots()[0]!.state).toBe("done")

    await manager.remove(key, { deleteData: true })
    expect(manager.snapshots().length).toBe(0)
    expect(existsSync(finalPath)).toBe(false)
  })

  test("generation guard ignores stale output after remove", async () => {
    const { manager, runner } = makeManager()
    const key = manager.add(REQUEST)
    const proc = runner.procs[0]!
    await manager.remove(key)
    expect(proc.killed).toBe(true)
    expect(manager.snapshots().length).toBe(0)

    // Late output from the killed process must not resurrect or crash anything.
    proc.emit('{"status":"downloading","downloaded":9,"total":10}')
    proc.finish(0)
    await Bun.sleep(20)
    expect(manager.snapshots().length).toBe(0)
  })

  test("persisted round-trips url/title/format", () => {
    const { manager } = makeManager()
    manager.add(REQUEST)
    const persisted = manager.persisted()
    expect(persisted).toEqual([
      {
        magnet: "",
        name: "A Video",
        addedAt: persisted[0]!.addedAt,
        done: false,
        http: { url: REQUEST.url, title: "A Video", format: REQUEST.format },
      },
    ])
  })

  test("audio extraction spawns yt-dlp with -x and persists the audio fields", () => {
    const { manager, runner } = makeManager()
    manager.add({
      url: "https://example.com/watch?v=song",
      title: "A Song",
      format: "bestaudio/best",
      extractAudio: true,
      audioFormat: "mp3",
    })
    const args = runner.procs[0]!.args
    expect(args).toContain("-x")
    expect(args[args.indexOf("--audio-format") + 1]).toBe("mp3")
    const persisted = manager.persisted()[0]!
    expect(persisted.http).toEqual({
      url: "https://example.com/watch?v=song",
      title: "A Song",
      format: "bestaudio/best",
      extractAudio: true,
      audioFormat: "mp3",
    })
  })

  test("audio quality flows into the spawn args and persistence", () => {
    const { manager, runner } = makeManager()
    manager.add({
      url: "https://example.com/watch?v=q",
      title: "Q",
      format: "bestaudio/best",
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: "0",
    })
    const args = runner.procs[0]!.args
    expect(args[args.indexOf("--audio-quality") + 1]).toBe("0")
    expect(manager.persisted()[0]!.http).toEqual({
      url: "https://example.com/watch?v=q",
      title: "Q",
      format: "bestaudio/best",
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: "0",
    })
  })

  test("audio format defaults from config when the request omits it", () => {
    const downloadDir = path.join(tmpRoot, `dl-cfg-${dirCounter++}`)
    const runner = fakeRunner()
    const manager = new HttpDownloads({ downloadDir, config: { audioFormat: "opus" } }, runner.run)
    manager.add({ url: "https://example.com/x", title: "x", format: "bestaudio/best", extractAudio: true })
    expect(runner.procs[0]!.args[runner.procs[0]!.args.indexOf("--audio-format") + 1]).toBe("opus")
    expect(manager.audioFormat()).toBe("opus")
  })

  test("dedups a re-added url", () => {
    const { manager, runner } = makeManager()
    manager.add(REQUEST)
    manager.add(REQUEST)
    expect(runner.procs.length).toBe(1)
    expect(manager.snapshots().length).toBe(1)
  })
})
