import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { Effect } from "effect"
import { onMount } from "solid-js"
import type { Engine } from "@corvus/core"
import type { Provider, ProviderError, TorrentResult } from "@corvus/providers"
import { Shell } from "./component/shell"
import { DownloadsProvider } from "./context/downloads"
import { SearchProvider, useSearch } from "./context/search"
import { ShellProvider } from "./context/shell"
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

// 30 results with equal relevance and strictly decreasing seeders, so ranking
// keeps them in index order and scroll assertions stay deterministic.
class ManyResultsProvider implements Provider {
  readonly name = "many"
  search(_query: string): Effect.Effect<readonly TorrentResult[], ProviderError> {
    return Effect.succeed(
      Array.from({ length: 30 }, (_, i): TorrentResult => {
        const nn = String(i).padStart(2, "0")
        return {
          title: `stub query item ${nn}`,
          size: "1.0 GB",
          sizeBytes: 1_000_000_000,
          seeders: 500 - i,
          leechers: 3,
          magnet: `magnet:?xt=urn:btih:${nn.repeat(20)}`,
          provider: "many",
          trusted: false,
          alsoOn: [],
        }
      }),
    )
  }
}

// One title far wider than the terminal, one short — the numeric columns must
// land at the same x either way.
class MixedWidthProvider implements Provider {
  readonly name = "mixed"
  search(_query: string): Effect.Effect<readonly TorrentResult[], ProviderError> {
    const base = {
      size: "1.0 GB",
      sizeBytes: 1_000_000_000,
      leechers: 3,
      provider: "mixed",
      trusted: false,
      alsoOn: [],
    }
    return Effect.succeed([
      {
        ...base,
        title: `stub query long ${"very ".repeat(40)}title`,
        seeders: 400,
        magnet: `magnet:?xt=urn:btih:${"aa".repeat(20)}`,
      },
      {
        ...base,
        title: "stub query short",
        seeders: 399,
        magnet: `magnet:?xt=urn:btih:${"bb".repeat(20)}`,
      },
    ])
  }
}

function SearchRunner() {
  const search = useSearch()
  onMount(() => search.run("stub query"))
  return null
}

function Harness(props: { provider?: Provider }) {
  return (
    <SearchProvider providers={[props.provider ?? new StubProvider()]}>
      <DownloadsProvider engine={fakeEngine} persist={() => {}}>
        <ShellProvider>
          <Shell route="results">
            <SearchRunner />
            <Results onBack={() => {}} onDownload={() => {}} />
          </Shell>
        </ShellProvider>
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

  test("numeric columns align regardless of title width", async () => {
    const t = await testRender(() => <Harness provider={new MixedWidthProvider()} />, {
      width: 80,
      height: 20,
    })
    await t.flush()
    const lines = t.captureCharFrame().split("\n")
    const longRow = lines.find((l) => l.includes("400"))
    const shortRow = lines.find((l) => l.includes("399"))
    expect(longRow).toBeDefined()
    expect(shortRow).toBeDefined()
    expect(longRow!.indexOf("400")).toBe(shortRow!.indexOf("399"))
    expect(longRow!.indexOf("1.0 GB")).toBe(shortRow!.indexOf("1.0 GB"))
    await t.renderer.destroy()
  })

  test("cursor movement scrolls rows into view on a short terminal", async () => {
    const t = await testRender(() => <Harness provider={new ManyResultsProvider()} />, {
      width: 80,
      height: 12,
    })
    await t.flush()
    expect(t.captureCharFrame()).toContain("stub query item 00")
    expect(t.captureCharFrame()).not.toContain("stub query item 20")

    for (let i = 0; i < 20; i++) {
      t.mockInput.pressArrow("down")
      await t.flush()
    }
    const frame = t.captureCharFrame()
    expect(frame).toContain("stub query item 20")
    expect(frame).not.toContain("stub query item 00")
    await t.renderer.destroy()
  })
})
