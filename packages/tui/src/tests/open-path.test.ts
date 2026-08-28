import { describe, expect, test } from "bun:test"
import { revealPath } from "../open-path"

function capture(): { commands: (readonly string[])[]; spawn: (command: readonly string[]) => Promise<void> } {
  const commands: (readonly string[])[] = []
  return {
    commands,
    spawn: async (command) => {
      commands.push(command)
    },
  }
}

describe("revealPath", () => {
  test("win32 selects the file in explorer, path as its own argument", async () => {
    const fake = capture()
    expect(
      await revealPath("C:\\dl\\My File 1080p.mkv", { platform: "win32", spawn: fake.spawn }),
    ).toBe(true)
    expect(fake.commands).toEqual([["explorer", "/select,", "C:\\dl\\My File 1080p.mkv"]])
  })

  test("darwin reveals with open -R", async () => {
    const fake = capture()
    await revealPath("/dl/file.mkv", { platform: "darwin", spawn: fake.spawn })
    expect(fake.commands).toEqual([["open", "-R", "/dl/file.mkv"]])
  })

  test("linux opens the containing directory", async () => {
    const fake = capture()
    await revealPath("/dl/file.mkv", { platform: "linux", spawn: fake.spawn })
    expect(fake.commands).toEqual([["xdg-open", "/dl"]])
  })

  test("empty path and spawn failure return false", async () => {
    expect(await revealPath("", { platform: "win32", spawn: async () => {} })).toBe(false)
    expect(
      await revealPath("/dl/x", {
        platform: "linux",
        spawn: async () => {
          throw new Error("no xdg-open")
        },
      }),
    ).toBe(false)
  })
})
