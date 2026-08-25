import { createMemo, For, Show } from "solid-js"
import type { CorvusConfig } from "@corvus/core"
import { formatBytes } from "@corvus/providers"
import { useConfigOptional } from "../context/config"
import { useDownloadsOptional } from "../context/downloads"
import { useSearchOptional } from "../context/search"
import { useShell, type Route } from "../context/shell"
import { theme } from "../theme"
import { CORVUS_VERSION } from "../version"

// Re-exported so home.tsx keeps its existing import site. Value is "local" when
// running from source; the real version is injected at build time (see version.ts).
export const APP_VERSION = CORVUS_VERSION

export function providerCounts(c: CorvusConfig | undefined): string {
  if (c === undefined) return ""
  const names = Object.keys(c.providers)
  const enabled = names.filter((name) => c.providers[name]?.enabled !== false).length
  return `${enabled}/${names.length}`
}

export function Footer(props: { route: Route }) {
  const shell = useShell()
  const config = useConfigOptional()
  const search = useSearchOptional()
  const downloads = useDownloadsOptional()

  const context = createMemo(() => {
    switch (props.route) {
      case "home":
        // home carries its identity/hints in the right-hand info panel instead
        return ""
      case "results": {
        if (search === undefined) return "results"
        const hidden = search.hiddenCount() > 0 ? ` · ${search.hiddenCount()} hidden` : ""
        return `results · "${search.query()}" · ${search.results().length} results · sort ${search.sortMode()}${hidden}`
      }
      case "downloads":
        return `downloads · ${downloads?.snapshots().length ?? 0}`
      case "settings":
        return "settings"
      case "sources":
        return `sources · ${providerCounts(config?.config())} enabled`
    }
  })

  const stats = createMemo(() => {
    const active = (downloads?.snapshots() ?? []).filter((s) => s.state === "downloading")
    if (active.length === 0) return "idle"
    const down = active.reduce((sum, s) => sum + s.downloadSpeed, 0)
    const up = active.reduce((sum, s) => sum + s.uploadSpeed, 0)
    return `↓ ${formatBytes(down)}/s · ↑ ${formatBytes(up)}/s · ${active.length} active`
  })

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={2} paddingRight={1}>
      <box flexDirection="row" height={1}>
        <text fg={theme.muted} truncate wrapMode="none">
          {context()}
        </text>
        <box flexGrow={1} minWidth={1} />
        <box flexDirection="row" flexShrink={0}>
          <For each={shell.hints()}>
            {(hint, index) => (
              <box flexDirection="row">
                <Show when={index() > 0}>
                  <text fg={theme.muted}>{" · "}</text>
                </Show>
                <text fg={theme.dim}>{hint.key}</text>
                <text fg={theme.muted}>{` ${hint.label}`}</text>
              </box>
            )}
          </For>
        </box>
      </box>
      <box flexDirection="row" height={1}>
        <text fg={theme.dim}>{stats()}</text>
        <box flexGrow={1} minWidth={1} />
        <Show when={props.route !== "home"}>
          <text fg={theme.dim} flexShrink={0}>{`corvus v${APP_VERSION}`}</text>
        </Show>
      </box>
    </box>
  )
}
