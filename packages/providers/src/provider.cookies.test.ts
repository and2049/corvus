import { afterEach, describe, expect, test } from "bun:test"
import { fetchText, setFetchCookies } from "./provider"

type FetchArgs = { url: string; init: RequestInit | undefined }

const originalFetch = globalThis.fetch

function stubFetch(response: () => Response): FetchArgs[] {
  const calls: FetchArgs[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return response()
  }) as typeof fetch
  return calls
}

const headerOf = (init: RequestInit | undefined, name: string): string | undefined => {
  const headers = init?.headers as Record<string, string> | undefined
  return headers?.[name]
}

afterEach(() => {
  setFetchCookies(undefined)
  globalThis.fetch = originalFetch
})

describe("setFetchCookies", () => {
  test("sends the cookie and matching user-agent for a configured host", async () => {
    setFetchCookies({ "1337x.to": { cookie: "cf_clearance=abc", userAgent: "MyBrowser/1.0" } })
    const calls = stubFetch(() => new Response("ok", { status: 200 }))
    await fetchText("https://1337x.to/search/x/1/")
    expect(headerOf(calls[0]!.init, "cookie")).toBe("cf_clearance=abc")
    expect(headerOf(calls[0]!.init, "user-agent")).toBe("MyBrowser/1.0")
  })

  test("normalizes host keys given as full URLs and matches case-insensitively", async () => {
    setFetchCookies({ "https://EZTV.re/": { cookie: "cf_clearance=z" } })
    const calls = stubFetch(() => new Response("ok", { status: 200 }))
    await fetchText("https://eztv.re/search/x")
    expect(headerOf(calls[0]!.init, "cookie")).toBe("cf_clearance=z")
  })

  test("does not attach a cookie for unconfigured hosts", async () => {
    setFetchCookies({ "1337x.to": { cookie: "cf_clearance=abc" } })
    const calls = stubFetch(() => new Response("ok", { status: 200 }))
    await fetchText("https://nyaa.si/?q=x")
    expect(headerOf(calls[0]!.init, "cookie")).toBeUndefined()
    expect(headerOf(calls[0]!.init, "user-agent")).toContain("Mozilla/5.0")
  })

  test("a 403 while a cookie is configured hints the cookie is stale", async () => {
    setFetchCookies({ "1337x.to": { cookie: "cf_clearance=stale" } })
    stubFetch(() => new Response("", { status: 403 }))
    await expect(fetchText("https://1337x.to/search/x/1/")).rejects.toThrow(/re-solve/)
  })
})
