import { Duration, Effect, Stream, pipe } from "effect"
import { ProviderError, type Provider, type TorrentResult } from "./provider"

export type SearchEvent =
  | { readonly type: "result"; readonly result: TorrentResult }
  | { readonly type: "provider-done"; readonly provider: string }
  | { readonly type: "provider-error"; readonly provider: string; readonly message: string }

const providerEvents = (provider: Provider, query: string, timeoutMs?: number): Stream.Stream<SearchEvent> =>
  pipe(
    timeoutMs === undefined || timeoutMs <= 0
      ? provider.search(query)
      : Effect.timeoutFail(provider.search(query), {
          duration: Duration.millis(timeoutMs),
          onTimeout: () => new ProviderError({ provider: provider.name, message: `timed out after ${timeoutMs}ms` }),
        }),
    Effect.map((results): Stream.Stream<SearchEvent> =>
      Stream.fromIterable(
        results.map((result): SearchEvent => ({ type: "result", result })),
      ),
    ),
    Effect.map((stream) =>
      pipe(
        stream,
        Stream.concat(
          Stream.fromIterable([
            { type: "provider-done", provider: provider.name } as const,
          ] satisfies SearchEvent[]),
        ),
      ),
    ),
    Effect.catchAll((error) =>
      Effect.succeed(
        Stream.fromIterable([
          {
            type: "provider-error",
            provider: error.provider,
            message: error.message,
          } as const,
        ] satisfies SearchEvent[]),
      ),
    ),
    Stream.unwrap,
  )

export function searchAll(
  providers: readonly Provider[],
  query: string,
  timeoutMs?: number,
): Stream.Stream<SearchEvent> {
  if (providers.length === 0) return Stream.empty
  return Stream.mergeAll(providers.map((provider) => providerEvents(provider, query, timeoutMs)), {
    concurrency: "unbounded",
  })
}
