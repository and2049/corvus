import type { Provider } from "./provider"
import { createProviders as fromRegistry, createProvidersWithSkipped as fromRegistryWithSkipped, type ProviderEntry } from "./registry"
import { builtinSources } from "./sources"

export function createProviders(
  entries: Readonly<Record<string, ProviderEntry | undefined>>,
): Provider[] {
  return fromRegistry(entries, builtinSources)
}

export function createProvidersWithSkipped(
  entries: Readonly<Record<string, ProviderEntry | undefined>>,
): { providers: Provider[]; skipped: readonly string[] } {
  return fromRegistryWithSkipped(entries, builtinSources)
}

export { builtinSources }
