import type { SourceDefinition } from "../registry"
import { Knaben } from "./knaben"
import { Eztv } from "./eztv"
import { Nyaa } from "./nyaa"
import { Rss } from "./rss"
import { Soulseek } from "./soulseek"
import { X1337 } from "./x1337"
import { Yts } from "./yts"

export const builtinSources: readonly SourceDefinition[] = [
  { type: "knaben", create: (options) => new Knaben(options.baseUrl) },
  { type: "yts", create: (options) => new Yts(options.baseUrl) },
  { type: "nyaa", create: (options) => new Nyaa(options.baseUrl) },
  { type: "eztv", create: (options) => new Eztv(options.baseUrl) },
  { type: "x1337", create: (options) => new X1337(options.baseUrls) },
  { type: "rss", create: (options) => new Rss(options.name ?? "rss", options.searchUrl) },
  {
    type: "soulseek",
    create: (options) =>
      new Soulseek({ username: options.username, password: options.password, listenPort: options.listenPort }),
  },
]
