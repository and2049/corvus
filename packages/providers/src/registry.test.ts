import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createProviders, type ProviderEntry } from "./registry"
import type { Provider, TorrentResult } from "./provider"

function fakeProvider(name: string): Provider {
  return {
    name,
    search: (): Effect.Effect<readonly TorrentResult[], never> => Effect.succeed([]),
  }
}

const testSources = [
  { type: "alpha", create: (o: { name?: string }) => fakeProvider(o.name ?? "alpha") },
  { type: "beta", create: (o: { name?: string }) => fakeProvider(o.name ?? "beta") },
  {
    type: "multi",
    create: (o: { name?: string }) => [fakeProvider(`${o.name}-1`), fakeProvider(`${o.name}-2`)],
  },
]

describe("createProviders", () => {
  test("instantiates enabled entries in builtin order", () => {
    const entries: Record<string, ProviderEntry> = {
      beta: { enabled: true },
      alpha: { enabled: true },
    }
    const providers = createProviders(entries, testSources)
    expect(providers.map((p) => p.name)).toEqual(["alpha", "beta"])
  })

  test("skips disabled entries and unknown types", () => {
    const entries: Record<string, ProviderEntry> = {
      alpha: { enabled: false },
      beta: {},
      ghost: {},
    }
    const providers = createProviders(entries, testSources)
    expect(providers.map((p) => p.name)).toEqual(["beta"])
  })

  test("type override lets custom names reuse a source", () => {
    const entries: Record<string, ProviderEntry> = {
      "my-feed": { type: "alpha" },
    }
    const providers = createProviders(entries, testSources)
    expect(providers.map((p) => p.name)).toEqual(["my-feed"])
  })

  test("factories may return multiple providers under one entry", () => {
    const entries: Record<string, ProviderEntry> = {
      pack: { type: "multi" },
    }
    const providers = createProviders(entries, testSources)
    expect(providers.map((p) => p.name)).toEqual(["pack-1", "pack-2"])
  })

  test("custom entries sort alphabetically after builtins", () => {
    const sources = [
      ...testSources,
      { type: "knaben", create: (o: { name?: string }) => fakeProvider(o.name ?? "knaben") },
    ]
    const entries: Record<string, ProviderEntry> = {
      zeta: { type: "alpha" },
      knaben: {},
      "a-custom": { type: "beta" },
    }
    const providers = createProviders(entries, sources)
    expect(providers.map((p) => p.name)).toEqual(["knaben", "a-custom", "zeta"])
  })
})
