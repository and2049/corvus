#!/usr/bin/env bun
// Builds the host binary, smoke-tests it, and archives each dist/<asset>/ into
// dist/<asset>.(tar.gz|zip) for upload as GitHub release assets.
import { $ } from "bun"
import { existsSync } from "node:fs"
import path from "node:path"

const dir = path.resolve(import.meta.dirname, "..")
process.chdir(dir)

const binary = "corvus"
const skipBuild = process.argv.includes("--skip-build")

if (!skipBuild) {
  // Native per-OS matrix: each runner builds only its own host target.
  process.argv.push("--single")
  await import("./build.ts")
}

const targets: string[] = []
for (const entry of new Bun.Glob("*/").scanSync({ cwd: "./dist", onlyFiles: false })) {
  const name = entry.replace(/[/\\]$/, "")
  if (name.startsWith(`${binary}-`)) targets.push(name)
}
if (!targets.length) throw new Error("No build output found in dist; run script/build.ts first")

async function zip(cwd: string, out: string, file: string): Promise<void> {
  if (Bun.which("zip")) return void (await $`zip -qr ${out} ${file}`.cwd(cwd))
  await $`powershell -NoProfile -NonInteractive -Command ${`Compress-Archive -Path '${file}' -DestinationPath '${out}' -Force`}`.cwd(
    cwd,
  )
}

const host = `${binary}-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`

const archives: string[] = []
for (const target of targets) {
  const executable = target.includes("windows") ? `${binary}.exe` : binary
  const binDir = `dist/${target}`
  const source = `${binDir}/${executable}`
  if (!existsSync(source)) throw new Error(`Missing ${source}`)

  if (process.platform !== "win32") await $`chmod 755 ${executable}`.cwd(binDir)

  // Smoke-test the host binary before archiving it.
  if (target === host) {
    console.log(`smoke test: ${source} --version`)
    await $`${path.resolve(source)} --version`
  }

  if (target.includes("linux")) {
    await $`tar -czf ../${target}.tar.gz ${executable}`.cwd(binDir)
    archives.push(`${target}.tar.gz`)
  } else {
    await zip(binDir, `../${target}.zip`, executable)
    archives.push(`${target}.zip`)
  }
}

console.log("Created release archives:")
for (const archive of archives) {
  const contents = archive.endsWith(".tar.gz")
    ? await $`tar -tzf dist/${archive}`.text()
    : await $`unzip -l dist/${archive}`.text()
  if (!contents.includes(binary)) throw new Error(`Archive ${archive} does not contain ${binary}`)
  console.log(`  validated ${archive}`)
}
