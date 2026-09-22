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

## Media downloads

Switch the home input to HTTP mode to paste a media URL, choose a video format,
or extract audio. On first use, Corvus checks `PATH` separately for `yt-dlp`,
`ffmpeg`, and `ffprobe`. Only missing tools are downloaded to `~/.corvus/tools`;
cached tools are reused on subsequent runs. Existing system installations take
precedence and are never replaced. Setup progress appears in the TUI.

Automatic setup supports Linux x64/arm64, macOS x64/arm64, and Windows x64.
It uses standalone executables from [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases)
and [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1).
The initial setup requires an internet connection; failed downloads can be retried.
Tools are cached independently of Corvus upgrades. To refresh a managed tool,
remove its executable from `~/.corvus/tools` and use a media URL again.

An explicit yt-dlp override in `~/.corvus/config.yaml` is always respected:

```yaml
ytdlp:
  path: /path/to/yt-dlp
  audioFormat: mp3
```

If that override is missing, Corvus reports an error rather than installing a
replacement. FFmpeg and ffprobe are still checked independently.

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
