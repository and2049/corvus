export { searchAll, type SearchEvent } from "./aggregator"
export { ContentFilter, containsAnyToken, isAdultResult, queryAllowsAdult } from "./filter"
export {
  buildMagnet,
  DEFAULT_TRACKERS,
  infoHashFromMagnet,
  parseMagnet,
  unionMagnet,
  unionTrackers,
  type ParsedMagnet,
} from "./magnet"
export { builtinSources, createProviders } from "./createProviders"
export { betterKeeper, mergeAll, mergeInto, mergeResult, resultKey } from "./merge"
export {
  DEFAULT_WEIGHTS,
  normalizeTitle,
  rankResults,
  relevance,
  scoreResult,
  type RankedResults,
  type RankOptions,
  type RankWeights,
  type SortMode,
} from "./rank"
export {
  atoiDefault,
  fetchText,
  formatBytes,
  humanSizeBinary,
  matchesQuery,
  ProviderError,
  parseHumanSize,
  setFetchCookies,
  setFetchProxy,
  type FetchTextOptions,
  type HostCredential,
  type Provider,
  type SlskFileRef,
  type TorrentResult,
} from "./provider"
export { createProviders as createProvidersFromRegistry, type ProviderEntry } from "./registry"
export { parseYts, Yts, type YtsPayload } from "./sources/yts"
export { Knaben, parseKnaben } from "./sources/knaben"
export { Nyaa, parseNyaa } from "./sources/nyaa"
export { Eztv, parseEztv } from "./sources/eztv"
export { X1337, parseX1337 } from "./sources/x1337"
export { Rss, parseRssFeed, renderSearchURL } from "./sources/rss"
export { Soulseek } from "./sources/soulseek"
export { SoulseekClient, type ConnectionState, type SoulseekOptions } from "./sources/soulseek/client"
export {
  registerTransferDenier,
  sharedSoulseekClient,
  startTransfer,
  type SlskDownloadRequest,
  type SlskTransferEvent,
  type SlskTransferHandle,
} from "./sources/soulseek/transfers"
