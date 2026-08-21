import type { Provider } from "./provider"
import { Knaben } from "./sources/knaben"
import { Yts } from "./sources/yts"

export interface ProviderOptions {
  readonly yts?: { readonly enabled?: boolean; readonly baseUrl?: string }
  readonly knaben?: { readonly enabled?: boolean; readonly baseUrl?: string }
}

export function createProviders(opts: ProviderOptions = {}): Provider[] {
  const providers: Provider[] = []
  if (opts.yts?.enabled !== false) providers.push(new Yts(opts.yts?.baseUrl))
  if (opts.knaben?.enabled !== false) providers.push(new Knaben(opts.knaben?.baseUrl))
  return providers
}
