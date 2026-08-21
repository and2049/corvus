import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { Home } from "../routes/home"

function inputLine(frame: string): string {
  const line = frame.split("\n").find((l) => l.includes("search")) ?? ""
  return line.replace(/.*search/, "").trim()
}

describe("Home input", () => {
  test("typing appends characters without losing the first", async () => {
    const t = await testRender(() => <Home onSubmit={() => {}} />, { width: 100, height: 30 })
    await t.flush()
    expect(inputLine(t.captureCharFrame())).toBe("query...")

    let typed = ""
    for (const ch of ["a", "b", "c", "d"]) {
      t.mockInput.typeText(ch)
      typed += ch
      await t.flush()
      expect(inputLine(t.captureCharFrame())).toBe(typed)
    }

    t.mockInput.typeText("efg")
    await t.flush()
    expect(inputLine(t.captureCharFrame())).toBe("abcdefg")
    await t.renderer.destroy()
  })

  test("backspace removes the last character", async () => {
    const t = await testRender(() => <Home onSubmit={() => {}} />, { width: 100, height: 30 })
    await t.flush()
    t.mockInput.typeText("ab")
    await t.flush()
    t.mockInput.pressBackspace()
    await t.flush()
    expect(inputLine(t.captureCharFrame())).toBe("a")
    await t.renderer.destroy()
  })

  test("enter submits the current value", async () => {
    const submitted: string[] = []
    const t = await testRender(() => <Home onSubmit={(query) => submitted.push(query)} />, { width: 100, height: 30 })
    await t.flush()
    t.mockInput.typeText("crow")
    await t.flush()
    t.mockInput.pressEnter()
    await t.flush()
    expect(submitted).toEqual(["crow"])
    await t.renderer.destroy()
  })
})
