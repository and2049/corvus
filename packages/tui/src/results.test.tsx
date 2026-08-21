import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { Effect } from "effect"
import { onMount } from "solid-js"
import type { Engine } from "@corvus/core"
import type { Provider, ProviderError, TorrentResult } from "@corvus/providers"
import { DownloadsProvider } from "./context/downloads"
import { SearchProvider, useSearch } from "./context/search"
import { Results } from "./routes/results"

const fakeEngine = {
  snapshots: () => [],
  magnets: () => [],
  keys: () => [],
  add: () => "",
  remove: async () => {},
  shutdown: async () => {},
} as unknown as Engine

class StubProvider implements Provider {
  readonly name = "stub"
  search(_query: string): Effect.Effect<readonly TorrentResult[], ProviderError> {
    return Effect.succeed([
      {
        title: "Stub Movie 2024 1080p",
        size: "1.4 GB",
        sizeBytes: 1_400_000_000,
        seeders: 77,
        leechers: 3,
        magnet: "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01",
        provider: "stub",
        trusted: false,
        alsoOn: [],
      },
    ])
  }
}

function SearchRunner() {
  const search = useSearch()
  onMount(() => search.run("stub query"))
  return null
}

function Harness() {
  return (
    <SearchProvider providers={[new StubProvider()]}>
      <DownloadsProvider engine={fakeEngine} persist={() => {}}>
        <SearchRunner />
        <Results onBack={() => {}} onDownload={() => {}} />
      </DownloadsProvider>
    </SearchProvider>
  )
}

describe("Results", () => {
  test("renders streamed results after a search", async () => {
    const t = await testRender(() => <Harness />, { width: 100, height: 30 })
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("Stub Movie 2024 1080p")
    expect(frame).toContain("77")
    expect(frame).toContain("1.4 GB")
    await t.renderer.destroy()
  })

  test("enter opens the pre-download preview dialog", async () => {
    const t = await testRender(() => <Harness />, { width: 100, height: 30 })
    await t.flush()
    t.mockInput.pressEnter()
    await t.flush()
    const frame = t.captureCharFrame()
    expect(frame).toContain("download this torrent?")
    expect(frame).toContain("source stub")
    expect(frame).toContain("esc cancel")
    t.mockInput.pressEscape()
    await Bun.sleep(50)
    await t.flush()
    expect(t.captureCharFrame()).not.toContain("download this torrent?")
    await t.renderer.destroy()
  })
})
