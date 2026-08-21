import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { Effect } from "effect"
import { onMount } from "solid-js"
import type { Provider, ProviderError, TorrentResult } from "@corvus/providers"
import { SearchProvider, useSearch } from "./context/search"
import { Results } from "./routes/results"

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
      <SearchRunner />
      <Results onBack={() => {}} />
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
})
