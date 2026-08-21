import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { searchAll, type SearchEvent } from "./aggregator"
import { ProviderError, type Provider, type TorrentResult } from "./provider"

function makeResult(title: string, provider: string): TorrentResult {
  return {
    title,
    size: "",
    sizeBytes: 0,
    seeders: 1,
    leechers: 0,
    magnet: `magnet:?xt=urn:btih:${"ab".repeat(20)}`,
    provider,
    trusted: false,
    alsoOn: [],
  }
}

const okProvider: Provider = {
  name: "ok",
  search: () => Effect.succeed([makeResult("hit", "ok")]),
}

const hangingProvider: Provider = {
  name: "slow",
  search: () => Effect.never as Effect.Effect<readonly TorrentResult[], ProviderError>,
}

const collect = (stream: Stream.Stream<SearchEvent>): Promise<SearchEvent[]> =>
  Effect.runPromise(Stream.runCollect(stream).pipe(Effect.map((chunk) => [...chunk])))

describe("searchAll", () => {
  test("emits result then provider-done for a successful provider", async () => {
    const events = await collect(searchAll([okProvider], "q"))
    expect(events).toEqual([
      { type: "result", result: makeResult("hit", "ok") },
      { type: "provider-done", provider: "ok" },
    ])
  })

  test("a provider exceeding the timeout surfaces as a provider-error", async () => {
    const events = await collect(searchAll([hangingProvider], "q", 20))
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe("provider-error")
    if (events[0]!.type === "provider-error") {
      expect(events[0]!.provider).toBe("slow")
      expect(events[0]!.message).toContain("timed out")
    }
  })

  test("a fast provider still completes when a slow one times out", async () => {
    const events = await collect(searchAll([okProvider, hangingProvider], "q", 50))
    const types = events.map((e) => e.type).sort()
    expect(types).toEqual(["provider-done", "provider-error", "result"])
  })
})
