import type { TorrentResult } from "./provider"

const ADULT_CATEGORIES = new Set(["xxx", "porn", "adult", "hentai", "r18", "jav", "3d porn"])

const ADULT_TOKENS = [
  "onlyfans",
  "brazzers",
  "naughtyamerica",
  "realitykings",
  "bangbros",
  "blacked",
  "tushy",
  "vixen",
  "evilangel",
  "digitalplayground",
  "pornhub",
  "xvideos",
  "xnxx",
  "porn",
  "camwhores",
  "chaturbate",
  "myfreecams",
  "manyvids",
  "fansly",
  "javhd",
]

export function isAdultResult(result: TorrentResult): boolean {
  const category = (result.category ?? "").trim().toLowerCase()
  if (category !== "" && ADULT_CATEGORIES.has(category)) return true
  return containsAnyToken(result.title, ADULT_TOKENS)
}

export function queryAllowsAdult(query: string): boolean {
  return containsAnyToken(query, ADULT_TOKENS)
}

export function containsAnyToken(input: string, tokens: readonly string[]): boolean {
  const lower = input.toLowerCase()
  return tokens.some((token) => hasWholeWord(lower, token))
}

function hasWholeWord(lower: string, token: string): boolean {
  let from = 0
  for (;;) {
    const index = lower.indexOf(token, from)
    if (index < 0) return false
    const end = index + token.length
    if (!isWordChar(lower, index - 1) && !isWordChar(lower, end)) return true
    from = index + 1
  }
}

function isWordChar(input: string, index: number): boolean {
  if (index < 0 || index >= input.length) return false
  const code = input.charCodeAt(index)
  return (
    code === 95 || (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
  )
}

export class ContentFilter {
  constructor(private readonly hideNSFW: boolean) {}

  allow(query: string, result: TorrentResult): boolean {
    if (!this.hideNSFW) return true
    if (queryAllowsAdult(query)) return true
    return !isAdultResult(result)
  }
}
