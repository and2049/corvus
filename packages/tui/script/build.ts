#!/usr/bin/env bun
// Cross-compiles corvus into standalone binaries via `bun build --compile`.
// The release workflow runs this on a native runner per OS (--single), because
// corvus depends on native modules (node-datachannel, @opentui/core) that do
// not cross-compile reliably from a single host.
import { rm } from "node:fs/promises"
import path from "node:path"
import type { BunPlugin } from "bun"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const dir = path.resolve(import.meta.dirname, "..")
process.chdir(dir)

// node-datachannel (via webtorrent -> @thaunknown/simple-peer -> webrtc-polyfill)
// loads a native N-API addon with a static
// `require(".../build/Release/node_datachannel.node")`. Bun's --compile does not
// rewrite that deep transitive require to the embedded copy, so the binary can't
// find it at runtime. This plugin rewrites the loader module to embed the addon
// via `with { type: "file" }` (which Bun extracts to a temp path at startup) and
// require it from there — the documented pattern for native addons in binaries.
const nativeAddonPlugin: BunPlugin = {
  name: "node-datachannel-native",
  setup(build) {
    build.onLoad(
      { filter: /node-datachannel[\\/]dist[\\/](?:esm|cjs)[\\/]lib[\\/]node-datachannel\.(?:mjs|cjs)$/ },
      (args) => {
        const addon = path.resolve(path.dirname(args.path), "../../../build/Release/node_datachannel.node")
        return {
          loader: "js",
          contents: [
            `import __addonPath from ${JSON.stringify(addon)} with { type: "file" }`,
            `import { createRequire as __createRequire } from "node:module"`,
            `const __nativeRequire = __createRequire(import.meta.url)`,
            `export default __nativeRequire(__addonPath)`,
          ].join("\n"),
        }
      },
    )
  },
}

const binary = "corvus"
const outdir = path.join(dir, "dist")

// Version/channel are injected as build-time globals (see src/version.ts). With
// no env set (local builds) they fall back to "local" at runtime.
const version = process.env.CORVUS_VERSION ?? "local"
const channel = process.env.CORVUS_CHANNEL ?? "local"

type Target = { os: "linux" | "darwin" | "windows"; arch: "x64" | "arm64" }

const allTargets: Target[] = [
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "darwin", arch: "arm64" },
  { os: "windows", arch: "x64" },
]

function hostOs(): Target["os"] {
  return process.platform === "win32" ? "windows" : (process.platform as Target["os"])
}

const single = process.argv.includes("--single")
const requested = process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)

const targets = requested
  ? allTargets.filter((t) => assetName(t) === requested)
  : single
    ? allTargets.filter((t) => t.os === hostOs() && t.arch === process.arch)
    : allTargets
if (!targets.length) throw new Error(`No matching build target (requested: ${requested ?? "host"})`)

const solidPlugin = createSolidTransformPlugin()

await rm(outdir, { recursive: true, force: true })

for (const target of targets) {
  const asset = assetName(target)
  const executable = target.os === "windows" ? `${binary}.exe` : binary
  console.log(`building ${asset} (v${version}, channel ${channel})`)
  const result = await Bun.build({
    entrypoints: ["./src/main.tsx"],
    tsconfig: "./tsconfig.json",
    plugins: [solidPlugin, nativeAddonPlugin],
    minify: true,
    sourcemap: channel === "local" || channel === "dev" ? "inline" : "none",
    compile: {
      // The JSX is transformed at build time by the Solid plugin, so the binary
      // must NOT re-run bunfig.toml's @opentui/solid/preload at runtime.
      autoloadBunfig: false,
      target: `bun-${target.os}-${target.arch}` as Bun.Build.CompileTarget,
      outfile: path.join(outdir, asset, executable),
    },
    define: {
      CORVUS_VERSION: `'${version}'`,
      CORVUS_CHANNEL: `'${channel}'`,
    },
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
}

function assetName(target: Target): string {
  return `${binary}-${target.os}-${target.arch}`
}
