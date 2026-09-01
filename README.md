# corvus

TUI torrent and media downloading client.

## Install

**macOS / Linux**

```bash
curl -fsSL https://github.com/and2049/corvus/releases/latest/download/install | bash
```

**Windows**

```powershell
irm https://github.com/and2049/corvus/releases/latest/download/install.ps1 | iex
```

This installs the `corvus` binary to `~/.corvus/bin` and adds it to your PATH. Then run `corvus`.

Update to the latest release:

```bash
corvus upgrade            # latest
corvus upgrade -v 0.1.0   # a specific version
```

Releases are published from git tags (`v*.*.*`). Running from source (`bun dev`) reports version `local`.

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
  soulseek:                        # search + downloads; needs an account (an unused
    enabled: false                 # username/password registers one on first login;
                                   # also editable in-app under ctrl+g settings)
    username: ""
    password: ""
    listenPort: 2234               # must be reachable inbound for results (forward it)
  my-indexer:                      # any custom name; type: rss for user-added indexers
    type: rss
    searchUrl: "https://indexer.example/api?t=search&q={query}"
```
