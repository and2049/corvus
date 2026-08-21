import { formatBytes, type TorrentResult } from "@corvus/providers"

export const formatSize = (result: TorrentResult): string =>
  result.sizeBytes > 0 ? formatBytes(result.sizeBytes) : result.size === "" ? "-" : result.size
