import { describe, expect, test } from "bun:test"
import {
  buildDownloadArgs,
  buildProbeArgs,
  parseInfoJson,
  parseProgressLine,
  probeFormats,
  resolveFormatExpr,
} from "../ytdlp"

const SAMPLE = JSON.stringify({
  id: "abc123",
  title: "Test Video",
  webpage_url: "https://example.com/watch?v=abc123",
  duration: 212,
  formats: [
    { format_id: "sb0", ext: "mhtml", vcodec: "none", acodec: "none", resolution: "48x27" },
    { format_id: "140", ext: "m4a", vcodec: "none", acodec: "mp4a.40.2", resolution: "audio only", filesize: 3_400_000 },
    { format_id: "137", ext: "mp4", vcodec: "avc1.640028", acodec: "none", height: 1080, fps: 30, filesize: 52_000_000, format_note: "1080p" },
  ],
})

describe("parseInfoJson", () => {
  test("extracts info and normalizes formats best-first, dropping storyboards", () => {
    const info = parseInfoJson(SAMPLE)
    expect(info.id).toBe("abc123")
    expect(info.title).toBe("Test Video")
    expect(info.url).toBe("https://example.com/watch?v=abc123")
    expect(info.duration).toBe(212)
    // storyboard (mhtml) dropped; reversed so 1080p comes first
    expect(info.formats.map((f) => f.formatId)).toEqual(["137", "140"])
    const best = info.formats[0]!
    expect(best.height).toBe(1080)
    expect(best.note).toBe("1080p")
    expect(best.filesize).toBe(52_000_000)
  })

  test("uses filesize_approx when filesize is absent", () => {
    const json = JSON.stringify({ id: "x", title: "t", formats: [{ format_id: "1", ext: "mp4", filesize_approx: 999 }] })
    expect(parseInfoJson(json).formats[0]!.filesize).toBe(999)
  })

  test("falls back to the first playlist entry", () => {
    const json = JSON.stringify({ id: "p", title: "list", entries: [{ id: "e", title: "entry", formats: [{ format_id: "1", ext: "mp4" }] }] })
    const info = parseInfoJson(json)
    expect(info.id).toBe("e")
    expect(info.formats).toHaveLength(1)
  })
})

describe("resolveFormatExpr", () => {
  test("muxes bestaudio into a video-only stream", () => {
    expect(resolveFormatExpr({ formatId: "137", ext: "mp4", vcodec: "avc1", acodec: "none" })).toBe("137+bestaudio/137")
  })

  test("leaves a combined or audio-only stream alone", () => {
    expect(resolveFormatExpr({ formatId: "18", ext: "mp4", vcodec: "avc1", acodec: "mp4a" })).toBe("18")
    expect(resolveFormatExpr({ formatId: "140", ext: "m4a", vcodec: "none", acodec: "mp4a" })).toBe("140")
  })
})

describe("parseProgressLine", () => {
  test("parses a progress tick", () => {
    expect(parseProgressLine('{"status":"downloading","downloaded":5,"total":10,"speed":1000,"eta":3}')).toEqual({
      status: "downloading",
      downloaded: 5,
      total: 10,
      speed: 1000,
      eta: 3,
    })
  })

  test("sanitizes NA placeholders to undefined and prefers total_est", () => {
    const progress = parseProgressLine('{"status":"downloading","downloaded":5,"total":NA,"total_est":20,"speed":NA,"eta":NA}')
    expect(progress).toEqual({ status: "downloading", downloaded: 5, total: 20, speed: undefined, eta: undefined })
  })

  test("returns undefined for non-progress lines", () => {
    expect(parseProgressLine("corvus-filepath:/tmp/x.mp4")).toBeUndefined()
    expect(parseProgressLine("[download] Destination: x")).toBeUndefined()
    expect(parseProgressLine("")).toBeUndefined()
  })
})

describe("arg builders", () => {
  test("probe args request a single-json dump", () => {
    expect(buildProbeArgs("URL")).toEqual(["--no-playlist", "--no-warnings", "--quiet", "-J", "URL"])
  })

  test("download args carry format, output template, progress template and final-path print", () => {
    const args = buildDownloadArgs("URL", "137+bestaudio", "/downloads")
    expect(args).toContain("--newline")
    expect(args).toContain("137+bestaudio")
    expect(args).toContain("/downloads")
    expect(args[args.length - 1]).toBe("URL")
    expect(args).not.toContain("-x")
    const printIndex = args.indexOf("--print")
    expect(args[printIndex + 1]).toContain("after_move:corvus-filepath:")
  })

  test("audio extraction adds -x and the audio format, url stays last", () => {
    const args = buildDownloadArgs("URL", "bestaudio/best", "/downloads", { extractAudio: true, audioFormat: "opus" })
    const x = args.indexOf("-x")
    expect(x).toBeGreaterThanOrEqual(0)
    expect(args[args.indexOf("--audio-format") + 1]).toBe("opus")
    expect(args[args.length - 1]).toBe("URL")
  })

  test("audio extraction falls back to the default audio format", () => {
    const args = buildDownloadArgs("URL", "bestaudio/best", "/downloads", { extractAudio: true })
    expect(args[args.indexOf("--audio-format") + 1]).toBe("mp3")
    expect(args).not.toContain("--audio-quality")
  })

  test("audio quality adds --audio-quality when set", () => {
    const args = buildDownloadArgs("URL", "bestaudio/best", "/downloads", {
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: "0",
    })
    expect(args[args.indexOf("--audio-quality") + 1]).toBe("0")
  })

  test("audio quality is ignored without audio extraction", () => {
    const args = buildDownloadArgs("URL", "137", "/downloads", { audioQuality: "0" })
    expect(args).not.toContain("--audio-quality")
    expect(args).not.toContain("-x")
  })
})

describe("probeFormats", () => {
  test("returns parsed info on success", async () => {
    const info = await probeFormats("URL", undefined, async () => ({ code: 0, stdout: SAMPLE, stderr: "" }))
    expect(info.id).toBe("abc123")
  })

  test("throws the first stderr error line on non-zero exit", async () => {
    const promise = probeFormats("URL", undefined, async () => ({ code: 1, stdout: "", stderr: "ERROR: Unsupported URL: foo" }))
    await expect(promise).rejects.toThrow("Unsupported URL: foo")
  })

  test("reports a friendly message when yt-dlp is missing", async () => {
    const promise = probeFormats("URL", undefined, async () => {
      const err = new Error("spawn ENOENT") as NodeJS.ErrnoException
      err.code = "ENOENT"
      throw err
    })
    await expect(promise).rejects.toThrow("yt-dlp not found")
  })
})
