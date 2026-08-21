# corvus

TUI torrent and media downloading client.

## Development

```bash
bun install
bun dev        # run the app
bun test       # run all tests
bun run typecheck
```

## Structure

- `packages/providers` — torrent search sources behind a registry (`builtinSources` + config entries): Knaben, YTS, Nyaa, EZTV, 1337x, generic RSS/torznab; concurrent search aggregator, deterministic infohash merge with tracker union, NSFW filter
- `packages/core` — config (`~/.corvus/config.yaml`), engine and state (later phases)
- `packages/tui` — OpenTUI + Solid terminal app

Design notes live in [`.redsun/memory.md`](.redsun/memory.md).

## Configuration

```yaml
downloadDir: ~/Downloads/corvus
seedAfterComplete: false   # uploads off by default
hideNSFW: true
providers:
  knaben: { enabled: true }
  yts: { enabled: true }
  nyaa: { enabled: true }          # baseUrl override supported
  eztv: { enabled: true }
  x1337: { enabled: true }         # baseUrls: [mirror, ...] override supported
  my-indexer:                      # any custom name; type: rss for user-added indexers
    type: rss
    searchUrl: "https://indexer.example/api?t=search&q={query}"
```
