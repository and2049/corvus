import type { Provider } from "./provider"
import { createProviders as fromRegistry, type ProviderEntry } from "./registry"
import { builtinSources } from "./sources"

export function createProviders(
  entries: Readonly<Record<string, ProviderEntry | undefined>>,
): Provider[] {
  return fromRegistry(entries, builtinSources)
}

export { builtinSources }
