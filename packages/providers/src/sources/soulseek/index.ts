import { Effect } from "effect"
import type { SoulseekClient } from "./client"
import type { SlskSearchResponse } from "./messages"
import { sharedSoulseekClient } from "./transfers"
import { ProviderError, type Provider, type TorrentResult } from "../../provider"

export class Soulseek implements Provider {
  readonly name = "soulseek"
  private readonly client: SoulseekClient
  private readonly credentials: {
    readonly username: string
    readonly password: string
    readonly listenPort?: number
  }

  constructor(
    options: { username?: string; password?: string; listenPort?: number } = {},
    client: SoulseekClient = sharedSoulseekClient(),
  ) {
    this.client = client
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
            // INVALIDPASS means the username exists with a different password; a
            // first-time login with an unused username registers the account.
            const hint =
              response.rejectionReason === "INVALIDPASS"
                ? "username taken or wrong password (an unused username would have been registered)"
                : (response.rejectionReason ?? "unknown reason")
            throw new Error(`login rejected: ${hint}`)
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
    slsk: { username: response.username, path: file.path, size: file.size },
  }))
}
