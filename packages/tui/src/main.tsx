import { render } from "@opentui/solid"
import { loadConfig } from "@corvus/core"
import { App } from "./app"

const config = await loadConfig()
await render(() => <App config={config} />)
