import type { Provider } from "./provider"

export interface SourceOptions {
  readonly name?: string
  readonly baseUrl?: string
  readonly baseUrls?: readonly string[]
  readonly searchUrl?: string
}

export type SourceFactory = (options: SourceOptions) => Provider | readonly Provider[]

export interface SourceDefinition {
  readonly type: string
  readonly create: SourceFactory
}

export interface ProviderEntry {
  readonly enabled?: boolean
  readonly type?: string
  readonly baseUrl?: string
  readonly baseUrls?: readonly string[]
  readonly searchUrl?: string
}

const BUILTIN_ORDER = ["knaben", "yts", "nyaa", "eztv", "x1337"] as const

function isBuiltin(name: string): boolean {
  return (BUILTIN_ORDER as readonly string[]).includes(name)
}

export function createProviders(
  entries: Readonly<Record<string, ProviderEntry | undefined>>,
  sources: readonly SourceDefinition[],
): Provider[] {
  const byType = new Map(sources.map((source) => [source.type, source.create]))
  const names = [
    ...BUILTIN_ORDER.filter((name) => entries[name] !== undefined),
    ...Object.keys(entries)
      .filter((name) => !isBuiltin(name))
      .sort(),
  ]
  const out: Provider[] = []
  for (const name of names) {
    const entry = entries[name]
    if (entry === undefined || entry.enabled === false) continue
    const create = byType.get(entry.type ?? name)
    if (create === undefined) continue
    const created = create({
      name,
      baseUrl: entry.baseUrl,
      baseUrls: entry.baseUrls,
      searchUrl: entry.searchUrl,
    })
    for (const provider of Array.isArray(created) ? created : [created]) {
      out.push(provider)
    }
  }
  return out
}
