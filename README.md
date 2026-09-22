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
  corvus update             # latest
  corvus update -v 0.1.0    # a specific version
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

### Presets and media settings

The media picker opens with presets for **Best available**, **Up to 1080p**,
**Up to 720p**, **MP3**, **Opus**, **original audio**, and a **Custom format**
expression. Resolution presets keep their cap even when falling back to another
format; a source with no matching resolution reports a download error.

- `enter` downloads the selected preset.
- `f` opens individual stream formats; `p` returns to presets.
- `a` toggles the audio format/quality picker.
- `m` in presets toggles the MP4 preference: prefer H.264 video + AAC audio,
  falling back to other codecs when unavailable. This does not transcode video.

Under `ctrl+g` settings, configure the default preset, MP4 preference, audio
format/quality, custom yt-dlp format expression, and executable path. Changes
apply to new probes/downloads without restarting. Existing downloads keep their
chosen format.

**Remember media choice** is on by default: adding a download saves the selected
preset or picker mode, plus audio options when using the audio picker. Individual
stream IDs are source-specific, so only the individual-format picker mode is
remembered. Turn this off to keep a fixed default preset.

```yaml
ytdlp:
  preset: 1080p             # best, 1080p, 720p, mp3, opus, original, custom, audio, formats
  preferMp4: true
  rememberLast: true
  audioFormat: mp3
  audioQuality: "0"         # 0 best, 2 high, 5 standard, 9 low (lossy audio only)
  format: bestvideo*+bestaudio/best  # Custom format preset
```

An existing `ytdlp.format` setting selects the Custom format preset by default
when no explicit `ytdlp.preset` is set.

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
