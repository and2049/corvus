import { Effect } from "effect"
import type { SoulseekClient } from "./client"
import { describeLoginRejection, validateCredentials } from "./credentials"
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
    const invalid = validateCredentials(this.credentials.username, this.credentials.password)
    if (invalid !== undefined) return Effect.fail(new ProviderError({ provider: this.name, message: invalid }))
    return Effect.tryPromise({
      try: async () => {
        const response = await this.client.connect({ ...this.credentials })
        if (!response.success) {
          throw new Error(describeLoginRejection(response.rejectionReason, response.rejectionDetail))
        }
        return await this.client.search(q)
      },
      catch: (cause): ProviderError =>
        new ProviderError({ provider: this.name, message: cause instanceof Error ? cause.message : String(cause) }),
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
