export {
  configDir,
  configPath,
  deepMerge,
  defaultConfig,
  loadConfig,
  saveConfig,
  type CloudflareConfig,
  type CloudflareCredential,
  type ConfigPatch,
  type CorvusConfig,
  type ProviderConfig,
  type ProvidersConfig,
  type YtDlpConfig,
} from "./config"
export { Engine, snapshotFrom, type DownloadSnapshot, type EngineOptions, type TorrentLike } from "./engine"
export {
  HttpDownloads,
  httpKey,
  type HttpDownloadRequest,
  type HttpDownloadsOptions,
} from "./http-downloads"
export {
  AUDIO_FORMAT_EXPR,
  buildDownloadArgs,
  buildProbeArgs,
  DEFAULT_YTDLP_AUDIO_FORMAT,
  parseInfoJson,
  parseProgressLine,
  probeFormats,
  resolveFormatExpr,
  ytdlpAudioFormat,
  type DownloadArgsOptions,
  type YtDlpFormat,
  type YtDlpInfo,
  type YtDlpProgress,
} from "./ytdlp"
export {
  sanitizeSlskName,
  slskKey,
  SoulseekDownloads,
  type SoulseekCredentials,
  type SoulseekDownloadsOptions,
} from "./soulseek-downloads"
export {
  DownloadsFile,
  loadDownloads,
  type PersistedDownload,
  type PersistedHttpDownload,
  type PersistedSlskFile,
} from "./state"
export { looksLikeTorrentInput, magnetFromTorrentBytes, magnetFromTorrentInput } from "./torrent-file"
