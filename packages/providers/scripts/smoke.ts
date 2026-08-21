import { Effect } from "effect"
import { createProviders } from "../src/createProviders"

const query = process.argv[2] ?? "arch linux"

const program = Effect.gen(function* () {
  for (const provider of createProviders({
    knaben: { enabled: true },
    yts: { enabled: true },
    nyaa: { enabled: true },
    eztv: { enabled: true },
    x1337: { enabled: true },
  })) {
    const result = yield* Effect.either(provider.search(query))
    if (result._tag === "Left") {
      console.log(`${provider.name}: ERROR ${result.left.message}`)
      continue
    }
    const results = result.right
    const first = results[0]
    console.log(
      `${provider.name}: ${results.length} results` +
        (first ? ` | first: "${first.title.slice(0, 60)}" seeders=${first.seeders} size=${first.size}` : ""),
    )
  }
})

Effect.runPromise(program).catch((error) => {
  console.error(error)
  process.exit(1)
})
