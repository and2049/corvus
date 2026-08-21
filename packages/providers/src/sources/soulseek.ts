import { Effect } from "effect"
import { SoulseekClient, type SlskSearchResponse } from "@corvus/soulseek"
import { ProviderError, type Provider, type TorrentResult } from "../provider"

export class Soulseek implements Provider {
  readonly name = "soulseek"
  private readonly client = new SoulseekClient()
  private readonly credentials: {
    readonly username: string
    readonly password: string
    readonly listenPort?: number
  }

  constructor(options: { username?: string; password?: string; listenPort?: number } = {}) {
    this.credentials = {
      username: options.username ?? "",
      password: options.password ?? "",
      listenPort: options.listenPort,
    }
  }

  search(query: string): Effect.Effect<readonly TorrentResult[], ProviderError> {
    const q = query.trim()
    if (q === "") return Effect.succeed([])
    return Effect.tryPromise({
      try: async () => {
        if (this.client.connectionState !== "logged-in") {
          const response = await this.client.connect({ ...this.credentials })
          if (!response.success) {
            throw new Error(`login rejected: ${response.rejectionReason ?? "unknown reason"}`)
          }
        }
        return await this.client.search(q)
      },
      catch: (cause): ProviderError => new ProviderError({ provider: this.name, message: String(cause) }),
    }).pipe(Effect.map((responses) => responses.flatMap(toResults)))
  }
}

function toResults(response: SlskSearchResponse): TorrentResult[] {
  return response.files.map((file) => ({
    title: file.path.replaceAll("\\", " / "),
    size: "",
    sizeBytes: file.size,
    seeders: response.freeUploadSlots ? 1 : 0,
    leechers: response.queueLength,
    magnet: "",
    provider: "soulseek",
    trusted: false,
    alsoOn: [],
  }))
}
