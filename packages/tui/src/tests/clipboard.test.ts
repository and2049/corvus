import { describe, expect, test } from "bun:test"
import { writeToClipboard } from "../clipboard"

const fakeRenderer = (result: boolean) => ({
  copyToClipboardOSC52: (text: string) => {
    void text
    return result
  },
})

describe("writeToClipboard", () => {
  test("rejects empty text without touching any backend", async () => {
    let spawned = false
    const ok = await writeToClipboard("", {
      platform: "win32",
      spawn: async () => {
        spawned = true
        return true
      },
    })
    expect(ok).toBe(false)
    expect(spawned).toBe(false)
  })

  test("prefers the native command when the platform has one", async () => {
    const calls: Array<{ command: string; input: string }> = []
    let oscUsed = false
    for (const platform of ["win32", "darwin"] as const) {
      const ok = await writeToClipboard("hello", {
        renderer: {
          copyToClipboardOSC52: () => {
            oscUsed = true
            return true
          },
        },
        platform,
        spawn: async (command, input) => {
          calls.push({ command, input })
          return true
        },
      })
      expect(ok).toBe(true)
    }
    expect(calls).toEqual([
      { command: "clip", input: "hello" },
      { command: "pbcopy", input: "hello" },
    ])
    expect(oscUsed).toBe(false)
  })

  test("falls back to OSC 52 on platforms without a native command", async () => {
    const ok = await writeToClipboard("hello", {
      renderer: fakeRenderer(true),
      platform: "linux",
      spawn: async () => {
        throw new Error("must not spawn")
      },
    })
    expect(ok).toBe(true)
    const failed = await writeToClipboard("hello", { platform: "linux" })
    expect(failed).toBe(false)
  })

  test("propagates native command failure", async () => {
    const ok = await writeToClipboard("hello", {
      platform: "win32",
      spawn: async () => false,
    })
    expect(ok).toBe(false)
  })
})
