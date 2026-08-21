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

- `packages/providers` — torrent search sources behind a common `Provider` interface (YTS, Knaben, ...) plus a concurrent search aggregator
- `packages/core` — config (`~/.corvus/config.yaml`), engine and state (later phases)
- `packages/tui` — OpenTUI + Solid terminal app

Design notes live in [`.redsun/memory.md`](.redsun/memory.md).

## Configuration

```yaml
downloadDir: ~/Downloads/corvus
seedAfterComplete: false   # uploads off by default
providers:
  yts:
    enabled: true
  knaben:
    enabled: true
```
