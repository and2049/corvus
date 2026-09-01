import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Option } from "effect"
import type { SoulseekClient, SoulseekOptions } from "../sources/soulseek/client"
import { Soulseek } from "../sources/soulseek"

function fakeClient(connect: (options: SoulseekOptions) => Promise<{ success: boolean; rejectionReason?: string }>): {
  client: SoulseekClient
  connects: SoulseekOptions[]
} {
  const connects: SoulseekOptions[] = []
  const client = {
    connectionState: "disconnected",
    connect: async (options: SoulseekOptions) => {
      connects.push(options)
      return connect(options)
    },
    search: async () => [],
  } as unknown as SoulseekClient
  return { client, connects }
}

async function failureMessage(provider: Soulseek): Promise<string> {
  const exit = await Effect.runPromiseExit(provider.search("pink floyd"))
  if (Exit.isSuccess(exit)) throw new Error("expected failure")
  const failure = Cause.failureOption(exit.cause)
  if (Option.isNone(failure)) throw new Error("expected a ProviderError")
  return failure.value.message
}

describe("Soulseek provider login handling", () => {
  test("missing credentials fail without contacting the server", async () => {
    const { client, connects } = fakeClient(async () => ({ success: true }))
    const message = await failureMessage(new Soulseek({ username: "", password: "" }, client))
    expect(message).toContain("not configured")
    expect(connects).toEqual([])
  })

  test("a locally invalid username fails without contacting the server", async () => {
    const { client, connects } = fakeClient(async () => ({ success: true }))
    const message = await failureMessage(new Soulseek({ username: " me", password: "pw" }, client))
    expect(message).toContain("spaces")
    expect(connects).toEqual([])
  })

  test("a server rejection becomes a readable message without an Error prefix", async () => {
    const { client } = fakeClient(async () => ({ success: false, rejectionReason: "INVALIDPASS" }))
    const message = await failureMessage(new Soulseek({ username: "me", password: "pw" }, client))
    expect(message).toBe("login rejected: wrong password or username taken")
  })

  test("credentials are passed to connect on every search", async () => {
    const { client, connects } = fakeClient(async () => ({ success: true }))
    const provider = new Soulseek({ username: "me", password: "pw", listenPort: 0 }, client)
    await Effect.runPromise(provider.search("a"))
    await Effect.runPromise(provider.search("b"))
    expect(connects.map((c) => c.username)).toEqual(["me", "me"])
  })
})
