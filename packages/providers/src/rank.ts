import type { TorrentResult } from "./provider"

export type SortMode = "relevance" | "seeders" | "size"

export interface RankWeights {
  readonly seeders: number
  readonly quality: number
  readonly trusted: number
  readonly deadPenalty: number
}

export const DEFAULT_WEIGHTS: RankWeights = {
  seeders: 40,
  quality: 1,
  trusted: 12,
  deadPenalty: 1000,
}

export interface RankOptions {
  readonly mode?: SortMode
  readonly hideNonMatches?: boolean
  readonly weights?: RankWeights
}

export interface RankedResults {
  readonly visible: readonly TorrentResult[]
  readonly hidden: readonly TorrentResult[]
}

// Release-noise tokens stripped before relevance matching so codecs/resolutions
// don't count as title words. Trimmed port of tork's normalize.reNoise.
const NOISE_TOKENS = new Set([
  "480p", "576p", "720p", "1080p", "1440p", "2160p", "4k", "8k", "uhd", "hd", "sd",
  "x264", "x265", "h264", "h265", "hevc", "avc", "av1", "xvid", "divx",
  "web", "webrip", "web-dl", "webdl", "bluray", "brrip", "bdrip", "dvdrip", "hdrip",
  "hdtv", "remux", "cam", "camrip", "hdcam", "ts", "telesync", "hdts",
  "aac", "ac3", "dts", "ddp", "dd", "flac", "mp3", "atmos", "truehd", "5", "1", "7",
  "hdr", "hdr10", "dv", "dolby", "vision", "10bit", "8bit",
  "mkv", "mp4", "avi", "srt", "proper", "repack", "internal", "extended", "remastered",
])

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\.[a-z0-9]{2,4}$/i, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function titleWords(title: string): Set<string> {
  const words = new Set<string>()
  for (const word of normalizeTitle(title).split(" ")) {
    if (word !== "" && !NOISE_TOKENS.has(word)) words.add(word)
  }
  return words
}

function queryTokens(query: string): string[] {
  const tokens: string[] = []
  for (const token of query.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")) {
    if (token !== "") tokens.push(token)
  }
  return tokens
}

// Fraction of query tokens present as whole words in the title (0..1).
// No query tokens means nothing to filter on, so everything is relevant.
export function relevance(query: string, title: string): number {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return 1
  const words = titleWords(title)
  let hit = 0
  for (const token of tokens) if (words.has(token)) hit += 1
  return hit / tokens.length
}

function qualityBoost(title: string): number {
  const t = title.toLowerCase()
  let boost = 0
  if (/\b(?:2160p|4k|uhd)\b/.test(t)) boost += 18
  else if (/\b1080p\b/.test(t)) boost += 15
  else if (/\b720p\b/.test(t)) boost += 8
  if (/\b(?:x265|hevc|av1)\b/.test(t)) boost += 4
  if (/\b(?:cam|camrip|hdcam|telesync|hdts)\b/.test(t)) boost -= 60
  return boost
}

function deadPenalty(seeders: number, weights: RankWeights): number {
  if (seeders <= 0) return weights.deadPenalty
  if (seeders <= 2) return 20
  return 0
}

// Quality/health score used to order results that share a relevance level.
// Log-scaled seeders so a 50k-seeder torrent doesn't bury a solid 300-seeder one.
export function scoreResult(result: TorrentResult, weights: RankWeights = DEFAULT_WEIGHTS): number {
  const seeders = Math.max(0, result.seeders)
  let score = weights.seeders * Math.log10(1 + seeders)
  score += weights.quality * qualityBoost(result.title)
  if (result.trusted) score += weights.trusted
  score -= deadPenalty(seeders, weights)
  return score
}

interface Scored {
  readonly result: TorrentResult
  readonly rel: number
  readonly score: number
}

function comparator(mode: SortMode): (a: Scored, b: Scored) => number {
  if (mode === "seeders") {
    return (a, b) => b.result.seeders - a.result.seeders || b.score - a.score
  }
  if (mode === "size") {
    return (a, b) => b.result.sizeBytes - a.result.sizeBytes || b.score - a.score
  }
  return (a, b) => b.rel - a.rel || b.score - a.score
}

export function rankResults(
  results: readonly TorrentResult[],
  query: string,
  options: RankOptions = {},
): RankedResults {
  const mode = options.mode ?? "relevance"
  const weights = options.weights ?? DEFAULT_WEIGHTS
  const hasQuery = query.trim() !== ""
  const kept: Scored[] = []
  const hidden: Scored[] = []
  for (const result of results) {
    const scored: Scored = { result, rel: relevance(query, result.title), score: scoreResult(result, weights) }
    if (options.hideNonMatches && hasQuery && scored.rel === 0) hidden.push(scored)
    else kept.push(scored)
  }
  kept.sort(comparator(mode))
  hidden.sort((a, b) => b.score - a.score)
  return {
    visible: kept.map((s) => s.result),
    hidden: hidden.map((s) => s.result),
  }
}
